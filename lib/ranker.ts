/**
 * lib/ranker.ts
 *
 * Composition layer that reads sim cache, calls getPTypical, and assembles
 * ranked picks per rung for the /api/picks endpoint.
 *
 * V1 simplifications (documented):
 *  - confidence computed with bvpAB=0 (no BvP layer), pitcherStartCount=10,
 *    weatherStable=true, isOpener=false, timeToFirstPitchMin=60
 *  - probableStarterId sentinel=1 (passesHardGates only checks null, not validity)
 *  - expectedPA hardcoded to 4 per player
 *  - Hard gates evaluated once per game side (not per rung, not per player)
 */

import { kvGet } from './kv'
import { computeEdge, computeScore } from './edge'
import { computeConfidenceBreakdown, passesHardGates, type ConfidenceFactors } from './confidence'
import { getPTypical } from './p-typical'
import { fetchSchedule, fetchProbablePitchers, fetchPitcherRecentStarts, fetchBvP, fetchPeople } from './mlb-api'
import { fetchLineup, lineupHash } from './lineup'
import { getHrParkFactorForBatter, getParkVenueName } from './park-factors'
import { fetchWeather, getOutfieldFacingDegrees } from './weather-api'
import { computeWeatherFactors } from './weather-factors'
import {
  EDGE_FLOORS,
  PROB_FLOORS,
  CONFIDENCE_FLOOR_TRACKED,
  DISPLAY_FLOOR_SCORE,
} from './constants'
import type { BatterHRRDist } from './sim'
import type { Rung, BvPRecord } from './types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single batter's slot + identity, used to surface the surrounding lineup. */
export interface LineupSlotSummary {
  slot: number
  playerId: number
  fullName: string
}

/** Observed conditions + the HR multiplier they produced for the sim. */
export interface PickWeather {
  tempF: number
  windSpeedMph: number
  windFromDegrees: number
  /** Compass bearing the outfield faces (home → CF axis). */
  outfieldFacingDegrees: number
  /**
   * Signed wind component along home → CF axis, mph.
   * + = blowing OUT (helps HR), − = blowing IN (suppresses HR).
   */
  windOutMph: number
  /** HR multiplier applied to the per-PA model after temp + wind compose. */
  hrMult: number
  controlled: boolean
  failure: boolean
}

/** The math inputs that determine `confidence` × `edge` for a single pick. */
export interface PickInputs {
  /** MLB venue ID for the game (lookup key for park factors). */
  venueId: number
  venueName: string
  /** HR park factor applied inside the per-PA model (1.00 = neutral). */
  parkHrFactor: number
  /** Observed weather + the HR multiplier the sim used. */
  weather: PickWeather
  /**
   * Career batter-vs-pitcher line vs *this* opposing starter. `null` when the
   * starter is TBD or the matchup has never been recorded. Drives the BvP
   * confidence factor (0.90–1.00 ramp on `ab`).
   */
  bvp: BvPRecord | null
  /** Number of the starter's recent starts available for the IP CDF. */
  pitcherStartCount: number
  /** Minutes from now until first pitch. Drives the time-to-pitch confidence factor. */
  timeToFirstPitchMin: number
  /** The 9-batter lineup the player is part of (slot + name only). */
  lineup: LineupSlotSummary[]
  /** Per-factor breakdown of the confidence multiplier. Product = `confidence`. */
  confidenceFactors: ConfidenceFactors
}

export interface Pick {
  player: { playerId: number; fullName: string; team: string; bats: 'R' | 'L' | 'S' }
  opponent: { teamId: number; abbrev: string }
  /** The probable / confirmed starter this batter is facing, or TBD when unannounced. */
  opposingPitcher: {
    id: number  // 0 when TBD
    name: string  // "TBD" when id is 0
    status: 'tbd' | 'probable' | 'confirmed'
  }
  gameId: number
  /**
   * ISO timestamp of first pitch (e.g. "2026-04-27T23:05:00Z"). Optional
   * because settled-history rows hydrated from the DB don't carry it (no
   * game_date column on locked_picks/settled_picks). Live picks always
   * have it; UI components must handle the missing case.
   */
  gameDate?: string
  lineupSlot: number
  lineupStatus: 'confirmed' | 'partial' | 'estimated'
  pMatchup: number
  pTypical: number
  edge: number
  confidence: number
  score: number
  tier: 'tracked' | 'watching'
  /**
   * The math inputs that produced confidence × edge, surfaced for the UI's
   * "show me the math" panel. Optional because settled-history rows from the
   * DB don't have these columns.
   */
  inputs?: PickInputs
}

export interface PicksResponse {
  date: string
  refreshedAt: string   // ISO timestamp
  rung1: Pick[]         // sorted by score desc
  rung2: Pick[]
  rung3: Pick[]
  meta: {
    gamesTotal: number
    gamesWithSim: number
    gamesWithoutSim: number[]  // gameIds skipped this refresh
    fromCache: boolean
    /**
     * Game-state breakdown for the slate. Sums to gamesTotal modulo `postponed`,
     * which is excluded everywhere else in the pipeline. Surfaced in the
     * StatusBanner so users can see slate progress at a glance — useful as
     * games tip off and finish over the course of the day.
     */
    gameStates: { scheduled: number; inProgress: number; final: number; postponed: number }
  }
}

// ---------------------------------------------------------------------------
// Sim cache shape (matches what /api/sim/[gameId] writes)
// ---------------------------------------------------------------------------

interface SimCachePayload {
  batterHRR: Record<string, BatterHRRDist>
  iterations: number
}

// ---------------------------------------------------------------------------
// Self-warming: fire internal HTTPS requests to /api/sim/[gameId] for any
// games whose sim cache is missing. The GitHub Actions cron is supposed to
// keep these warmed every 5 min during slate hours, but the free tier
// throttles scheduled workflows heavily — sometimes firing only once an
// hour. So we let the *act of viewing the page* warm any missing sims as
// a fallback, with a tight budget so it doesn't slow the picks endpoint
// past Vercel Hobby's 10 s function limit.
// ---------------------------------------------------------------------------

/** How long rankPicks will wait for in-flight sim warm-ups before returning. */
const SIM_WARM_BUDGET_MS = 6_000

/** Resolve the deployment's own base URL for self-fetches. */
function selfBaseUrl(): string {
  // Vercel auto-injects VERCEL_URL with the deployment-specific host
  // (e.g. "hrr-betting.vercel.app" or a preview URL).
  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl) return `https://${vercelUrl}`
  const port = process.env.PORT ?? '3000'
  return `http://localhost:${port}`
}

/**
 * Fire-and-budget: kick off internal HTTPS calls to /api/sim/[gameId] for
 * each `gameId`, race the bundle against a deadline, return after either
 * (a) all warm-ups finish, or (b) the budget elapses — whichever is first.
 *
 * Each warm-up runs as its *own* Vercel function invocation, with its own
 * full function-time budget (10 s on Hobby). So even when this race resolves
 * on the timeout, the in-flight warm-ups keep going on Vercel's side and
 * the sim cache populates for the next /api/picks poll. Internally-fired
 * fetches that beat the timeout also leave their results in the sim cache,
 * which we re-read after the race.
 *
 * Errors are swallowed silently — one bad sim shouldn't block the others
 * or fail the picks request.
 */
async function warmMissingSims(gameIds: number[], date: string): Promise<void> {
  if (gameIds.length === 0) return
  const cronSecret = process.env.CRON_SECRET ?? ''
  const base = selfBaseUrl()

  const fired = gameIds.map(id => {
    const url = `${base}/api/sim/${id}?date=${encodeURIComponent(date)}`
    return fetch(url, {
      headers: cronSecret ? { 'x-cron-secret': cronSecret } : {},
      // Don't blow up the calling request on per-sim errors.
      cache: 'no-store',
    }).catch(() => undefined)
  })

  await Promise.race([
    Promise.allSettled(fired),
    new Promise(resolve => setTimeout(resolve, SIM_WARM_BUDGET_MS)),
  ])
}

// ---------------------------------------------------------------------------
// classifyTier
// ---------------------------------------------------------------------------

export function classifyTier(args: {
  rung: Rung
  edge: number
  pMatchup: number
  confidence: number
  score: number
}): 'tracked' | 'watching' | null {
  if (
    args.confidence >= CONFIDENCE_FLOOR_TRACKED &&
    args.edge >= EDGE_FLOORS[args.rung] &&
    args.pMatchup >= PROB_FLOORS[args.rung]
  ) {
    return 'tracked'
  }
  if (args.score >= DISPLAY_FLOOR_SCORE) return 'watching'
  return null  // dropped
}

// ---------------------------------------------------------------------------
// rankPicks
// ---------------------------------------------------------------------------

export async function rankPicks(date: string): Promise<PicksResponse> {
  const games = await fetchSchedule(date)
  const gamesTotal = games.length
  const gamesWithoutSim: number[] = []
  let gamesWithSim = 0

  // Separate accumulators per rung (avoids adding `rung` to the public Pick type)
  const rung1Picks: Pick[] = []
  const rung2Picks: Pick[] = []
  const rung3Picks: Pick[] = []

  // ---------------------------------------------------------------------
  // Pre-pass: identify games whose sim isn't in the cache yet, warm them
  // in parallel with a 6 s budget, then continue. This is the safety net
  // for unreliable cron firing — even if GitHub Actions hasn't fired its
  // 5-min schedule for an hour, the act of someone viewing /api/picks
  // triggers warming. The fetchLineup / fetchProbablePitchers calls below
  // run again inside the main loop, but both go through kv-cached paths
  // so the duplication is just an extra ~30 ms of cache reads per game.
  // ---------------------------------------------------------------------
  const live = games.filter(g => g.status !== 'postponed' && g.status !== 'final')
  const preChecks = await Promise.all(live.map(async game => {
    const [homeLineup, awayLineup, probables] = await Promise.all([
      fetchLineup(game.gameId, game.homeTeam.teamId, 'home', date),
      fetchLineup(game.gameId, game.awayTeam.teamId, 'away', date),
      fetchProbablePitchers(game.gameId),
    ])
    const lH = lineupHash(homeLineup) + ':' + lineupHash(awayLineup)
    const probableH = `${probables.home || 0}:${probables.away || 0}`
    const cacheKey = `sim:${game.gameId}:${lH}:${probableH}`
    const cached = await kvGet<SimCachePayload>(cacheKey)
    return { gameId: game.gameId, hit: cached !== null }
  }))
  const missingIds = preChecks.filter(p => !p.hit).map(p => p.gameId)
  if (missingIds.length > 0) {
    await warmMissingSims(missingIds, date)
  }

  for (const game of games) {
    // Skip terminal game states — no point building picks
    if (game.status === 'postponed' || game.status === 'final') continue

    // Fetch lineups + probable pitchers in parallel
    const [homeLineup, awayLineup, probables] = await Promise.all([
      fetchLineup(game.gameId, game.homeTeam.teamId, 'home', date),
      fetchLineup(game.gameId, game.awayTeam.teamId, 'away', date),
      fetchProbablePitchers(game.gameId),
    ])

    // Build the combined lineup hash + probable-pitcher hash for the sim cache key.
    // Including probableHash ensures a pitcher announcement (TBD → known) invalidates
    // the cache key on the read side too — preventing the case where ranker reports
    // the new pitcher name while the sim was actually computed against league-avg
    // pitcher rates from when the slot was TBD.
    const lH = lineupHash(homeLineup) + ':' + lineupHash(awayLineup)
    const probableH = `${probables.home || 0}:${probables.away || 0}`
    const cacheKey = `sim:${game.gameId}:${lH}:${probableH}`

    const sim = await kvGet<SimCachePayload>(cacheKey)
    if (!sim) {
      gamesWithoutSim.push(game.gameId)
      continue  // orchestrator will populate on next refresh
    }
    gamesWithSim++

    // Compute time to first pitch (in minutes from now). Used as a confidence input.
    const firstPitchMs = new Date(game.gameDate).getTime()
    const timeToFirstPitchMin = Math.max(0, Math.round((firstPitchMs - Date.now()) / 60000))

    // Park venue name for surfacing on each pick (the actual per-batter
    // HR factor is resolved inside the per-pick loop below, since FG's
    // park factors are per-handedness).
    const venueName = getParkVenueName(game.venueId)

    // Per-game weather: fetched once, reused across all 18 picks. The fetch
    // is internally cached so this is cheap on warm slates.
    const outfieldFacingDeg = getOutfieldFacingDegrees(game.venueId)
    const weatherData = await fetchWeather(game.venueId, game.gameDate)
    const weatherResult = computeWeatherFactors({
      weather: weatherData,
      outfieldFacingDegrees: outfieldFacingDeg,
    })
    const pickWeather = {
      tempF: weatherData.tempF,
      windSpeedMph: weatherData.windSpeedMph,
      windFromDegrees: weatherData.windFromDegrees,
      outfieldFacingDegrees: outfieldFacingDeg,
      windOutMph: weatherResult.outComponentMph,
      hrMult: weatherResult.hrMult,
      controlled: weatherData.controlled,
      failure: weatherData.failure,
    }

    // Pre-compute lineup summaries (one per side) so we can attach the same
    // 9-entry array to every batter on a side without rebuilding it 9 times.
    const homeLineupSummary: LineupSlotSummary[] = homeLineup.entries.map(e => ({
      slot: e.slot, playerId: e.player.playerId, fullName: e.player.fullName,
    }))
    const awayLineupSummary: LineupSlotSummary[] = awayLineup.entries.map(e => ({
      slot: e.slot, playerId: e.player.playerId, fullName: e.player.fullName,
    }))

    // Fetch each probable pitcher's recent-starts count + name in parallel.
    // fetchPeople caches per-ID 24h so name lookups are cheap on repeat calls.
    const pitcherIds = [probables.home, probables.away].filter(id => id > 0)
    const [homePitcherStarts, awayPitcherStarts, pitcherPeople] = await Promise.all([
      probables.home > 0 ? fetchPitcherRecentStarts(probables.home, 10).catch(() => []) : Promise.resolve([]),
      probables.away > 0 ? fetchPitcherRecentStarts(probables.away, 10).catch(() => []) : Promise.resolve([]),
      pitcherIds.length > 0 ? fetchPeople(pitcherIds) : Promise.resolve(new Map()),
    ])
    const pitcherNames = new Map<number, string>()
    for (const [id, ref] of pitcherPeople) pitcherNames.set(id, ref.fullName)

    // Hard gates evaluated per-side below (lineupStatus is per-side).
    // Game-level conditions (gameStatus, probableStarterId, expectedPA) are
    // checked inside the per-side call.

    const sides = [
      { lineup: homeLineup, opponent: game.awayTeam, isHome: true },
      { lineup: awayLineup, opponent: game.homeTeam, isHome: false },
    ] as const

    // Parallelize across both sides + all 18 batters per game.
    // Each call to getPTypical hits its own cache; cold misses run a sim
    // internally. Without parallelism this is 18 × 30ms (cache hit) or
    // 18 × ~1s (cache miss) sequential — multiplied by 15 games it times out.
    //
    // Per-side hard gate is evaluated once here; per-batter confidence is
    // recomputed below because it depends on the batter's own BvP sample.
    const sideJobs = sides.map(({ lineup, opponent, isHome }) => {
      // The opposing starter is whoever the BATTERS face — home batters face the away starter.
      const opposingStarterId = isHome ? probables.away : probables.home
      return {
        lineup,
        opponent,
        // Pass sentinel `1` when probable starter is TBD (common in early season /
        // far-from-game-time). The sim already uses league-avg fallback rates for
        // unknown pitchers, and pitcherStartCount=0 already penalizes confidence below.
        sidePassesGates: passesHardGates({
          gameStatus: game.status,
          probableStarterId: opposingStarterId > 0 ? opposingStarterId : 1,
          lineupStatus: lineup.status,
          expectedPA: 4,
        }),
      }
    })

    // Resolve all P_typical lookups across both sides in parallel
    const playerJobs = sideJobs.flatMap(({ lineup, opponent, sidePassesGates }) =>
      lineup.entries.map(entry => ({ entry, lineup, opponent, sidePassesGates }))
    )

    // P_typical + per-batter BvP (the latter is what gives confidence its real
    // per-pick variation — without it, every batter on a side has the same conf).
    const [pTypicalResults, bvpResults] = await Promise.all([
      Promise.all(playerJobs.map(({ entry }) => getPTypical({ playerId: entry.player.playerId }))),
      Promise.all(playerJobs.map(({ entry, lineup }) => {
        const onHome = lineup === homeLineup
        const opposingStarterId = onHome ? probables.away : probables.home
        if (opposingStarterId <= 0) return Promise.resolve(null)  // unknown starter → no BvP
        return fetchBvP(entry.player.playerId, opposingStarterId).catch(() => null)
      })),
    ])

    for (let i = 0; i < playerJobs.length; i++) {
      const { entry, lineup, opponent, sidePassesGates } = playerJobs[i]
      const pTypicalResult = pTypicalResults[i]
      const bvp = bvpResults[i]

      const player = entry.player
      const dist = sim.batterHRR[String(player.playerId)]
      if (!dist) continue

      // Recompute confidence per-batter to incorporate this batter's BvP sample.
      // (Other inputs are per-side, so they're shared across batters on a side.)
      const onHome = lineup === homeLineup
      const opposingStarterStartCount = onHome ? awayPitcherStarts.length : homePitcherStarts.length
      const opposingStarterId = onHome ? probables.away : probables.home
      // game.status was already filtered to exclude 'postponed' and 'final' at the
      // top of the per-game loop, so reaching here means 'scheduled' or 'in_progress'.
      const opposingPitcherStatus: 'tbd' | 'probable' | 'confirmed' =
        opposingStarterId <= 0
          ? 'tbd'
          : game.status === 'in_progress'
            ? 'confirmed'
            : 'probable'
      const { factors: confidenceFactors, product: confidence } = computeConfidenceBreakdown({
        lineupStatus: lineup.status,
        bvpAB: bvp?.ab ?? 0,
        pitcherStartCount: opposingStarterStartCount,
        weatherStable: true,
        isOpener: false,
        timeToFirstPitchMin,
        batterSeasonPa: 0,    // Phase 8: wire real PA count
        maxCacheAgeSec: 0,    // Phase 8: wire real cache age
      })

      const inputs: PickInputs = {
        venueId: game.venueId,
        // Prefer FG's venue name (matches the lookup table) but fall back to
        // the MLB schedule name if the venue isn't in our park-factors map.
        venueName: venueName !== 'Unknown park' ? venueName : game.venueName,
        // The actual HR multiplier the sim used for THIS batter — picks up
        // the per-handedness asymmetry (e.g. Yankee Stadium boosts LHB more
        // than RHB).
        parkHrFactor: getHrParkFactorForBatter(game.venueId, player.bats),
        weather: pickWeather,
        bvp,
        pitcherStartCount: opposingStarterStartCount,
        timeToFirstPitchMin,
        lineup: onHome ? homeLineupSummary : awayLineupSummary,
        confidenceFactors,
      }

      for (const rung of [1, 2, 3] as Rung[]) {
        const pMatchup = dist.atLeast[rung] ?? 0
        const pTyp = pTypicalResult.atLeast[rung] ?? 0
        const edge = computeEdge({ pMatchup, pTypical: pTyp })
        const score = computeScore({ edge, confidence })

        if (!sidePassesGates) continue

        const tier = classifyTier({ rung, edge, pMatchup, confidence, score })
        if (tier === null) continue

        const pick: Pick = {
          player: {
            playerId: player.playerId,
            fullName: player.fullName,
            team: player.team,
            bats: player.bats,
          },
          opponent: { teamId: opponent.teamId, abbrev: opponent.abbrev },
          opposingPitcher: {
            id: opposingStarterId > 0 ? opposingStarterId : 0,
            name: opposingStarterId > 0 ? (pitcherNames.get(opposingStarterId) ?? `P ${opposingStarterId}`) : 'TBD',
            status: opposingPitcherStatus,
          },
          gameId: game.gameId,
          gameDate: game.gameDate,
          lineupSlot: entry.slot,
          lineupStatus: lineup.status,
          pMatchup,
          pTypical: pTyp,
          edge,
          confidence,
          score,
          tier,
          inputs,
        }

        if (rung === 1) rung1Picks.push(pick)
        else if (rung === 2) rung2Picks.push(pick)
        else rung3Picks.push(pick)
      }
    }
  }

  const byScoreDesc = (a: Pick, b: Pick) => b.score - a.score

  // Tally game states for the slate-progress chip in the status banner.
  // Use the schedule's status field directly — it's authoritative.
  const gameStates = { scheduled: 0, inProgress: 0, final: 0, postponed: 0 }
  for (const g of games) {
    if (g.status === 'scheduled') gameStates.scheduled++
    else if (g.status === 'in_progress') gameStates.inProgress++
    else if (g.status === 'final') gameStates.final++
    else if (g.status === 'postponed') gameStates.postponed++
  }

  return {
    date,
    refreshedAt: new Date().toISOString(),
    rung1: rung1Picks.sort(byScoreDesc),
    rung2: rung2Picks.sort(byScoreDesc),
    rung3: rung3Picks.sort(byScoreDesc),
    meta: {
      gamesTotal,
      gamesWithSim,
      gamesWithoutSim,
      fromCache: false,
      gameStates,
    },
  }
}
