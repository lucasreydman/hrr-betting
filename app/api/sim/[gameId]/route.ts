/**
 * GET /api/sim/[gameId]?date=YYYY-MM-DD
 *
 * Runs a full Monte Carlo game simulation for the specified MLB game,
 * returning HRR (Hits + Runs + RBIs) probability distributions for all 18 batters.
 *
 * Cache strategy:
 *   - sim-meta:{gameId}  → tracks lineupHash, weatherHash, simAt, iterations
 *   - sim:{gameId}:{lineupHash} → serialized GameSimResult
 *   If both hashes match the current state, returns cached result immediately.
 *   Otherwise re-runs the sim and overwrites both keys.
 *
 * V1 simplifications (see build-context.ts for full list):
 *   - 1000 sim iterations (suitable for < 5s wall time; increase post-calibration)
 *   - No BvP layer in per-PA computation
 *   - Season stats only (no L30/L15 rolling blend)
 */

import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet } from '@/lib/kv'
import { simGame, type GameSimResult, type BatterSimContext } from '@/lib/sim'
import {
  fetchSchedule,
  fetchProbablePitchers,
  fetchPeople,
} from '@/lib/mlb-api'
import { fetchLineup, lineupHash } from '@/lib/lineup'
import { fetchWeather, weatherHash, getOutfieldFacingDegrees } from '@/lib/weather-api'
import { computeWeatherFactors } from '@/lib/weather-factors'
import { buildBatterContext } from './build-context'
import { verifyCronRequest } from '@/lib/cron-auth'
import { slateDateString, isValidIsoDate } from '@/lib/date-utils'
import type { Handedness } from '@/lib/types'

// ---------------------------------------------------------------------------
// Vercel config
// ---------------------------------------------------------------------------
// 10s default — Hobby tier. 1000-iter sim per game completes in ~500ms locally.
// If iteration count is bumped post-calibration and runtime approaches the limit,
// reduce SIM_ITERATIONS or upgrade to Vercel Pro for maxDuration: 60.
export const maxDuration = 10

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SimMeta = {
  lineupHash: string
  weatherHash: string
  /**
   * Hash of the home + away probable pitcher IDs at sim time. Used to detect
   * "pitcher just got announced" scenarios where the lineup hash hasn't changed
   * but the sim's pitcher inputs are now stale.
   * Format: "{homeId}:{awayId}"; '0' for TBD.
   */
  probableHash: string
  simAt: number
  iterations: number
}

/** Pure hash helper — keep deterministic so cache validity checks match across calls. */
function buildProbableHash(home: number, away: number): string {
  return `${home || 0}:${away || 0}`
}

type SimEnvelope = {
  /** Map<batterId, BatterHRRDist> — serialized as plain object for JSON transport */
  batterHRR: Record<string, unknown>
  iterations: number
  fromCache: boolean
  meta: SimMeta
}

const SIM_TTL = 24 * 60 * 60  // 24 hours
const SIM_ITERATIONS = 1000

// ---------------------------------------------------------------------------
// Route context type (Next.js App Router)
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ gameId: string }>
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const params = await ctx.params
  const gameId = parseInt(params.gameId, 10)
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'invalid gameId' }, { status: 400 })
  }

  const dateParam = new URL(req.url).searchParams.get('date')
  if (dateParam !== null && !isValidIsoDate(dateParam)) {
    return NextResponse.json({ error: 'invalid date — expected YYYY-MM-DD' }, { status: 400 })
  }
  const date = dateParam ?? slateDateString()

  // --- Locate game in schedule ---
  const games = await fetchSchedule(date)
  const game = games.find(g => g.gameId === gameId)
  if (!game) {
    return NextResponse.json({ error: `game ${gameId} not found on ${date}` }, { status: 404 })
  }

  // --- Build lineup + probable + weather hashes in parallel ---
  const [homeLineup, awayLineup, probables, weather] = await Promise.all([
    fetchLineup(gameId, game.homeTeam.teamId, 'home', date),
    fetchLineup(gameId, game.awayTeam.teamId, 'away', date),
    fetchProbablePitchers(gameId),
    fetchWeather(game.venueId, game.gameDate),
  ])

  const lineupH = lineupHash(homeLineup) + ':' + lineupHash(awayLineup)
  const probableH = buildProbableHash(probables.home, probables.away)
  const weatherH = weatherHash(weather)

  // --- Check cache ---
  // Cache key includes probableHash so that when MLB announces a probable
  // pitcher (or changes one), the cache key changes too — forcing a fresh sim.
  // Without this, sim cache keyed only on lineupHash would happily serve stale
  // results computed against the OLD pitcher (typically league-avg fallback for TBD).
  const metaKey = `sim-meta:${gameId}`
  const cacheKey = `sim:${gameId}:${lineupH}:${probableH}`

  const meta = await kvGet<SimMeta>(metaKey)
  if (
    meta &&
    meta.lineupHash === lineupH &&
    meta.probableHash === probableH &&
    meta.weatherHash === weatherH
  ) {
    const cached = await kvGet<{ batterHRR: Record<string, unknown>; iterations: number }>(cacheKey)
    if (cached) {
      const envelope: SimEnvelope = {
        batterHRR: cached.batterHRR,
        iterations: cached.iterations,
        fromCache: true,
        meta,
      }
      return NextResponse.json(envelope)
    }
  }

  // --- Cache miss → assemble inputs and run sim ---

  // Determine season from game date
  const season = parseInt(date.slice(0, 4), 10)

  // probables already fetched above for the cache key

  // Resolve pitcher handedness from /people for both probable starters in one
  // batched call. fetchPeople has a per-ID 24h cache, so on a warm slate this
  // is free. Falls back to 'R' (the most common handedness) when MLB hasn't
  // populated pitchHand yet — same fallback as before, but now driven by data
  // for the ~30% of starts that aren't right-handed.
  const pitcherIds = [probables.home, probables.away].filter(id => id > 0)
  const pitcherPeople = pitcherIds.length > 0
    ? await fetchPeople(pitcherIds).catch(() => new Map())
    : new Map()
  const handForPitcher = (id: number): Handedness => {
    const ref = pitcherPeople.get(id)
    return ref?.throws ?? 'R'
  }

  // Apply real weather factors. The temperature term and the wind component
  // along the home → CF axis are projected onto the per-PA outcome
  // distribution (HR primarily; small 2B / 3B carry effect). Domes and
  // failed fetches return neutral 1.00 across the board so weather never
  // makes a pick worse when the data is missing or non-applicable.
  // Park factors are still resolved per-batter inside buildBatterContext
  // using FanGraphs Guts! per-handedness columns — see lib/park-factors.ts.
  const { factors: weatherFactors } = computeWeatherFactors({
    weather,
    outfieldFacingDegrees: getOutfieldFacingDegrees(game.venueId),
  })
  // Capture into a local so the nested `lineup.entries.map(...)` arrow below
  // doesn't trip TS's narrowing (it loses the post-`if (!game)` narrowing
  // across closure boundaries).
  const venueId = game.venueId

  // Build a BatterSimContext for each batter in a lineup. `side` is used
  // only to namespace placeholder sentinel batterIds when a lineup is short
  // — we mustn't reuse the same sentinel across home and away, otherwise
  // their stats would conflate in the sim's per-batter stats Map.
  async function buildLineupContexts(
    lineup: typeof homeLineup,
    opposingPitcherId: number,
    opposingTeamId: number,
    side: 'home' | 'away',
  ): Promise<BatterSimContext[]> {
    // Real pitcher handedness from /people (cached). When the pitcher is TBD
    // (id 0) or /people fails, fall back to 'R'.
    const opposingStarterThrows: Handedness =
      opposingPitcherId > 0 ? handForPitcher(opposingPitcherId) : 'R'
    // v1: opener detection requires pitch-by-pitch data (Savant). Treat all
    // probable starters as 'starter' until that wires up.
    const pitcherType: 'starter' | 'opener' = 'starter'

    // Build all 9 batter contexts in parallel (IO-bound, safe to fan out)
    const contexts = await Promise.all(
      lineup.entries.map((entry) =>
        buildBatterContext({
          batter:          entry.player,
          lineupSlot:      entry.slot,
          opposingStarter: {
            id:     opposingPitcherId,
            throws: opposingStarterThrows,
            type:   pitcherType,
          },
          opposingTeamId,
          venueId,
          weatherFactors,
          date,
          season,
        }),
      ),
    )

    // If lineup is partial/estimated, pad to 9 slots with placeholder batters
    // (use league-avg rates so the sim still runs — low-confidence result).
    // Each placeholder gets a unique sentinel batterId so they don't collide
    // in the sim's per-batter stats Map (which would conflate their hits/runs/
    // RBIs across iterations). Sentinels are namespaced > any real MLB id;
    // home and away ranges don't overlap.
    if (contexts.length < 9) {
      const sideOffset = side === 'home' ? 9_000_000 : 9_100_000
      while (contexts.length < 9) {
        const placeholder = await buildLeagueAvgPlaceholder()
        placeholder.batterId = sideOffset + contexts.length
        contexts.push(placeholder)
      }
    }

    return contexts
  }

  // Home lineup faces the away probable; away lineup faces the home probable
  const [homeContexts, awayContexts] = await Promise.all([
    buildLineupContexts(homeLineup, probables.away, game.awayTeam.teamId, 'home'),
    buildLineupContexts(awayLineup, probables.home, game.homeTeam.teamId, 'away'),
  ])

  // --- Run simulation ---
  const simResult: GameSimResult = await simGame({
    homeLineup:  homeContexts,
    awayLineup:  awayContexts,
    iterations:  SIM_ITERATIONS,
  })

  // --- Serialize Map for JSON + KV storage ---
  const batterHRRObj: Record<string, unknown> = {}
  for (const [id, dist] of simResult.batterHRR) {
    batterHRRObj[String(id)] = dist
  }

  const payload = { batterHRR: batterHRRObj, iterations: simResult.iterations }

  const newMeta: SimMeta = {
    lineupHash:   lineupH,
    weatherHash:  weatherH,
    probableHash: probableH,
    simAt:        Date.now(),
    iterations:   SIM_ITERATIONS,
  }

  // Write both cache keys in parallel
  await Promise.all([
    kvSet(cacheKey, payload, SIM_TTL),
    kvSet(metaKey, newMeta, SIM_TTL),
  ])

  const envelope: SimEnvelope = {
    batterHRR: batterHRRObj,
    iterations: simResult.iterations,
    fromCache: false,
    meta: newMeta,
  }

  return NextResponse.json(envelope)
}

// ---------------------------------------------------------------------------
// Placeholder batter for partial/estimated lineups with fewer than 9 players
// ---------------------------------------------------------------------------

async function buildLeagueAvgPlaceholder(): Promise<BatterSimContext> {
  // Import league avg rates lazily to avoid circular module issues
  const { LEAGUE_AVG_RATES } = await import('@/lib/constants')

  const lgRates = { ...LEAGUE_AVG_RATES }
  // Use length-5 arrays (PA indices 1-5) for the placeholder
  const ratesArr = [lgRates, lgRates, lgRates, lgRates, lgRates]
  const starterShare = [0.9, 0.7, 0.4, 0.15, 0.05]

  return {
    batterId:           0,  // sentinel — no real player
    ratesVsStarterByPA: ratesArr,
    ratesVsBullpenByPA: ratesArr,
    starterShareByPA:   starterShare,
  }
}
