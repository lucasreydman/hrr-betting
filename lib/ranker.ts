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
import { fetchSchedule } from './mlb-api'
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

    // Fetch lineups
    const [homeLineup, awayLineup] = await Promise.all([
      fetchLineup(game.gameId, game.homeTeam.teamId, 'home', date),
      fetchLineup(game.gameId, game.awayTeam.teamId, 'away', date),
    ])

    // Build the combined lineup hash used as the sim cache key
    const lH = lineupHash(homeLineup) + ':' + lineupHash(awayLineup)
    const cacheKey = `sim:${game.gameId}:${lH}`

    const sim = await kvGet<SimCachePayload>(cacheKey)
    if (!sim) {
      gamesWithoutSim.push(game.gameId)
      continue  // orchestrator will populate on next refresh
    }
    gamesWithSim++

    // Evaluate hard gates once per game (game-level conditions don't change per rung)
    const gamePassesGates = passesHardGates({
      gameStatus: game.status,
      probableStarterId: 1,  // v1 sentinel — non-null means "known"
      lineupStatus: null,    // lineupStatus is checked per-side below
      expectedPA: 4,
    })
    // Note: passesHardGates checks lineupStatus != null, so we re-call per-side with actual status
    // The game-level call above only pre-checks gameStatus/probableStarterId/expectedPA.
    // We override lineupStatus below with the actual side's status.

    const sides = [
      { lineup: homeLineup, opponent: game.awayTeam },
      { lineup: awayLineup, opponent: game.homeTeam },
    ] as const

    for (const { lineup, opponent } of sides) {
      // Hard gate: game-level check already done; re-check with actual lineupStatus
      const sidePassesGates = gamePassesGates && passesHardGates({
        gameStatus: game.status,
        probableStarterId: 1,
        lineupStatus: lineup.status,
        expectedPA: 4,
      })

      // Compute confidence once per lineup side (same inputs for all players on this side)
      const confidence = computeConfidence({
        lineupStatus: lineup.status,
        bvpAB: 0,               // v1: no BvP layer
        pitcherStartCount: 10,  // v1: assume mature pitcher
        weatherStable: true,    // v1: no weather integration here
        isOpener: false,        // v1: assume starter
        timeToFirstPitchMin: 60,
      })

      for (const entry of lineup.entries) {
        const player = entry.player
        // Look up this player's distribution in the sim cache
        // Sim cache keys are string player IDs (see /api/sim/[gameId]/route.ts line 193)
        const dist = sim.batterHRR[String(player.playerId)]
        if (!dist) continue

        // Get P_typical for this player (cached 24h — fast on repeat calls)
        const pTypicalResult = await getPTypical({ playerId: player.playerId, date })

        for (const rung of [1, 2, 3] as Rung[]) {
          const pMatchup = dist.atLeast[rung] ?? 0
          const pTyp = pTypicalResult.atLeast[rung] ?? 0
          const edge = computeEdge({ pMatchup, pTypical: pTyp })
          const score = computeScore({ edge, confidence })

          // Hard gate: skip if side doesn't pass
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
