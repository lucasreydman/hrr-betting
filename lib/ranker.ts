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
import { computeConfidence, passesHardGates } from './confidence'
import { getPTypical } from './p-typical'
import { fetchSchedule, fetchProbablePitchers, fetchPitcherRecentStarts, fetchBvP, fetchPeople } from './mlb-api'
import { fetchLineup, lineupHash } from './lineup'
import {
  EDGE_FLOORS,
  PROB_FLOORS,
  CONFIDENCE_FLOOR_TRACKED,
  DISPLAY_FLOOR_SCORE,
} from './constants'
import type { Rung } from './types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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
  lineupSlot: number
  lineupStatus: 'confirmed' | 'partial' | 'estimated'
  pMatchup: number
  pTypical: number
  edge: number
  confidence: number
  score: number
  tier: 'tracked' | 'watching'
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
  }
}

// ---------------------------------------------------------------------------
// Sim cache shape (matches what /api/sim/[gameId] writes)
// ---------------------------------------------------------------------------

interface BatterHRRDist {
  batterId: number
  totalSims: number
  /** atLeast[N] = P(HRR >= N); indices 0–4 */
  atLeast: number[]
  meanHRR: number
}

interface SimCachePayload {
  batterHRR: Record<string, BatterHRRDist>
  iterations: number
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
    const sideJobs = sides.map(({ lineup, opponent, isHome }) => {
      // The opposing starter is whoever the BATTERS face — home batters face the away starter.
      const opposingStarterId = isHome ? probables.away : probables.home
      const opposingStarterStartCount = isHome ? awayPitcherStarts.length : homePitcherStarts.length
      return {
        lineup,
        opponent,
        // Pass sentinel `1` when probable starter is TBD (common in early season /
        // far-from-game-time). The sim already uses league-avg fallback rates for
        // unknown pitchers, and pitcherStartCount=0 below already penalizes confidence.
        sidePassesGates: passesHardGates({
          gameStatus: game.status,
          probableStarterId: opposingStarterId > 0 ? opposingStarterId : 1,
          lineupStatus: lineup.status,
          expectedPA: 4,
        }),
        confidence: computeConfidence({
          lineupStatus: lineup.status,
          bvpAB: 0,                                   // v1: no BvP layer wired in
          pitcherStartCount: opposingStarterStartCount,
          weatherStable: true,                        // v1: no weather-volatility detection
          isOpener: false,                            // v1: no opener detection
          timeToFirstPitchMin,
        }),
      }
    })

    // Resolve all P_typical lookups across both sides in parallel
    const playerJobs = sideJobs.flatMap(({ lineup, opponent, sidePassesGates, confidence }) =>
      lineup.entries.map(entry => ({ entry, lineup, opponent, sidePassesGates, confidence }))
    )

    // P_typical + per-batter BvP (the latter is what gives confidence its real
    // per-pick variation — without it, every batter on a side has the same conf).
    const [pTypicalResults, bvpResults] = await Promise.all([
      Promise.all(playerJobs.map(({ entry }) => getPTypical({ playerId: entry.player.playerId, date }))),
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
      const confidence = computeConfidence({
        lineupStatus: lineup.status,
        bvpAB: bvp?.ab ?? 0,
        pitcherStartCount: opposingStarterStartCount,
        weatherStable: true,
        isOpener: false,
        timeToFirstPitchMin,
      })

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
          lineupSlot: entry.slot,
          lineupStatus: lineup.status,
          pMatchup,
          pTypical: pTyp,
          edge,
          confidence,
          score,
          tier,
        }

        if (rung === 1) rung1Picks.push(pick)
        else if (rung === 2) rung2Picks.push(pick)
        else rung3Picks.push(pick)
      }
    }
  }

  const byScoreDesc = (a: Pick, b: Pick) => b.score - a.score

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
    },
  }
}
