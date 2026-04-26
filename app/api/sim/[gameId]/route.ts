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
 *   - date defaults to today's UTC date (not Pacific — Pacific adjustment is a future task)
 *   - weatherHash falls back to 'pending' until lib/weather-api exports it (Task 18b)
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
} from '@/lib/mlb-api'
import { fetchLineup, lineupHash } from '@/lib/lineup'
import { fetchWeather } from '@/lib/weather-api'
import { getParkFactors } from '@/lib/park-factors'
import { createHash } from 'crypto'
import { buildBatterContext, parkFactorsToOutcomeMap, neutralWeatherFactors } from './build-context'
import type { WeatherData, Handedness } from '@/lib/types'

// ---------------------------------------------------------------------------
// Vercel config
// ---------------------------------------------------------------------------

export const maxDuration = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SimMeta = {
  lineupHash: string
  weatherHash: string
  simAt: number
  iterations: number
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
// weatherHash helper
// weatherHash is not yet exported from lib/weather-api (Task 18b adds it).
// Use a local implementation for now.
// ---------------------------------------------------------------------------

function localWeatherHash(w: WeatherData): string {
  const canonical = `${w.tempF}:${w.windSpeedMph}:${w.windFromDegrees}:${w.failure}:${w.controlled}`
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

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
  const params = await ctx.params
  const gameId = parseInt(params.gameId, 10)
  if (isNaN(gameId)) {
    return NextResponse.json({ error: 'invalid gameId' }, { status: 400 })
  }

  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  // --- Locate game in schedule ---
  const games = await fetchSchedule(date)
  const game = games.find(g => g.gameId === gameId)
  if (!game) {
    return NextResponse.json({ error: `game ${gameId} not found on ${date}` }, { status: 404 })
  }

  // --- Build lineup hashes ---
  const [homeLineup, awayLineup] = await Promise.all([
    fetchLineup(gameId, game.homeTeam.teamId, 'home', date),
    fetchLineup(gameId, game.awayTeam.teamId, 'away', date),
  ])

  const lineupH = lineupHash(homeLineup) + ':' + lineupHash(awayLineup)

  // --- Build weather hash ---
  const weather = await fetchWeather(game.venueId, game.gameDate)
  const weatherH = localWeatherHash(weather)

  // --- Check cache ---
  const metaKey = `sim-meta:${gameId}`
  const cacheKey = `sim:${gameId}:${lineupH}`

  const meta = await kvGet<SimMeta>(metaKey)
  if (meta && meta.lineupHash === lineupH && meta.weatherHash === weatherH) {
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

  // Fetch probable pitchers
  const probables = await fetchProbablePitchers(gameId)

  // Park factors
  const pf = getParkFactors(game.venueId)
  const parkFactors = parkFactorsToOutcomeMap(pf.factors)

  // V1: neutral weather factors (see module-level jsdoc)
  const weatherFactors = neutralWeatherFactors()

  // Build a BatterSimContext for each batter in a lineup
  async function buildLineupContexts(
    lineup: typeof homeLineup,
    opposingPitcherId: number,
    opposingTeamId: number,
  ): Promise<BatterSimContext[]> {
    // We need pitcher handedness. Attempt to derive from PitcherStats; fall back to 'R'.
    // MLB Stats API doesn't surface handedness in the stats endpoint directly; we'd need
    // the people endpoint. For v1, default to 'R' (most pitchers are right-handed).
    // TODO: fetch from /people/{id} endpoint for actual handedness.
    const opposingStarterThrows: Handedness = 'R'
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
          parkFactors,
          weatherFactors,
          date,
          season,
        }),
      ),
    )

    // If lineup is partial/estimated, pad to 9 slots with placeholder batters
    // (use league-avg rates so the sim still runs — low-confidence result)
    if (contexts.length < 9) {
      const placeholder = await buildLeagueAvgPlaceholder()
      while (contexts.length < 9) contexts.push(placeholder)
    }

    return contexts
  }

  // Home lineup faces the away probable; away lineup faces the home probable
  const [homeContexts, awayContexts] = await Promise.all([
    buildLineupContexts(homeLineup, probables.away, game.awayTeam.teamId),
    buildLineupContexts(awayLineup, probables.home, game.homeTeam.teamId),
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
    lineupHash:  lineupH,
    weatherHash: weatherH,
    simAt:       Date.now(),
    iterations:  SIM_ITERATIONS,
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
