/**
 * lib/p-typical.ts
 *
 * P_typical(player) — the average probability of clearing rung N hits-runs-RBIs
 * across the games a player has actually played this season.
 *
 * ## Algorithm (v1 — league-avg opponent)
 *
 * 1. Fetch the player's season game log to determine sample size.
 * 2. Fetch the player's historical lineup-slot distribution.
 * 3. For each slot the player has batted in (≥5% of games), simulate
 *    `round(maxGames × slotFreq)` games vs a synthetic league-average opponent.
 * 4. Average the resulting atLeast arrays across all simulated games.
 * 5. Cache the result for 24 h.
 *
 * ## V1 simplification (documented per spec §10)
 *
 * The full replay-the-season strategy (spec §4.10) would pull each historical
 * opponent's actual pitcher stats, bullpen, park factors, and weather for every
 * game in the sample. That requires O(n) MLB API calls and is cost-prohibitive
 * in v1.
 *
 * This implementation substitutes a **league-average opponent** for every game,
 * which captures variance from the player's own slot/frequency distribution
 * without needing per-game opponent context. Calibration target: post-launch
 * once settled-pick history is available.
 *
 * TODO(post-launch): replace `simulateOnePlayerInSlot` with a real per-game
 * opponent lookup using `fetchPitcherSeasonStats` + `fetchTeamBullpenStats`
 * for each historical opponent.
 */

import { kvGet, kvSet } from './kv'
import { simSinglePlayerHRR } from './sim'
import { fetchBatterGameLog, fetchPlayerSlotFrequency } from './mlb-api'
import { LEAGUE_AVG_RATES } from './constants'
import type { BatterHRRDist, BatterSimContext } from './sim'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PTypicalResult {
  playerId: number
  /**
   * Cumulative probability array of length 5.
   * atLeast[N] = P(HRR >= N) averaged across simulated games.
   * Indices 0–4 correspond to ≥0, ≥1, ≥2, ≥3, ≥4+.
   * atLeast[0] is always 1.0.
   */
  atLeast: number[]
  /** Number of simulated games used to compute this result. */
  basedOnGames: number
  /** Unix timestamp (ms) when this result was computed. */
  computedAt: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TTL_24H = 24 * 60 * 60

/**
 * Rough league-average distribution used as the no-data fallback.
 * These are approximate empirical values; recalibrate after ~30 days of data.
 */
const LEAGUE_AVG_FALLBACK: number[] = [1.0, 0.65, 0.30, 0.10, 0.03]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute (or retrieve from cache) the P_typical distribution for a player.
 *
 * @param args.playerId     MLB player ID
 * @param args.date         Reference date (YYYY-MM-DD); used as cache key. Defaults to today.
 * @param args.season       MLB season year. Defaults to current year.
 * @param args.iterationsPerGame  Monte Carlo iterations per simulated game. Default 1500.
 * @param args.maxGames     Max games to sample from the season. Default 30.
 */
export async function getPTypical(args: {
  playerId: number
  date?: string
  season?: number
  iterationsPerGame?: number
  maxGames?: number
}): Promise<PTypicalResult> {
  const date = args.date ?? new Date().toISOString().slice(0, 10)
  const season = args.season ?? new Date().getFullYear()
  const iterations = args.iterationsPerGame ?? 1500
  const maxGames = args.maxGames ?? 30
  const cacheKey = `p-typical:${args.playerId}:${date}`

  // --- Cache hit ---
  const cached = await kvGet<PTypicalResult>(cacheKey)
  if (cached) return cached

  // --- Fetch season game log (needed only for sample-size tracking) ---
  const gameLog = await fetchBatterGameLog(args.playerId, season)

  if (gameLog.length === 0) {
    // Unknown player or no games played — return league-avg fallback immediately.
    const fallback = makeFallback(args.playerId)
    await kvSet(cacheKey, fallback, TTL_24H)
    return fallback
  }

  // --- Fetch lineup slot frequency ---
  const slotFreq = await fetchPlayerSlotFrequency(args.playerId, season)

  const slots: Array<{ slot: number; freq: number }> =
    Object.keys(slotFreq).length > 0
      ? Object.entries(slotFreq).map(([slot, freq]) => ({
          slot: parseInt(slot, 10),
          freq,
        }))
      : [{ slot: 4, freq: 1.0 }]  // mid-order default when no slot data

  // --- Simulate per-slot ---
  const totalAtLeast = [0, 0, 0, 0, 0]
  let totalGames = 0

  for (const { slot, freq } of slots) {
    if (freq < 0.05) continue  // skip slots accounting for < 5% of games

    const gamesForSlot = Math.max(1, Math.round(maxGames * freq))

    for (let g = 0; g < gamesForSlot; g++) {
      const dist = await simulateOnePlayerInSlot(args.playerId, slot, iterations)
      for (let i = 0; i < 5; i++) {
        totalAtLeast[i] += dist.atLeast[i]
      }
      totalGames++
    }
  }

  if (totalGames === 0) {
    const fallback = makeFallback(args.playerId)
    await kvSet(cacheKey, fallback, TTL_24H)
    return fallback
  }

  const atLeast = totalAtLeast.map(v => v / totalGames)

  const result: PTypicalResult = {
    playerId: args.playerId,
    atLeast,
    basedOnGames: totalGames,
    computedAt: Date.now(),
  }

  await kvSet(cacheKey, result, TTL_24H)
  return result
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeFallback(playerId: number): PTypicalResult {
  return {
    playerId,
    atLeast: [...LEAGUE_AVG_FALLBACK],
    basedOnGames: 0,
    computedAt: Date.now(),
  }
}

/**
 * Build a league-average BatterSimContext for a filler batter (not the target).
 *
 * V1 simplification: all fillers use identical league-avg rates across every PA.
 * Future: pull each opponent's actual season stats via fetchBatterSeasonStats.
 */
function makeLeagueAvgFiller(batterId: number): BatterSimContext {
  const rates = { ...LEAGUE_AVG_RATES }
  return {
    batterId,
    ratesVsStarterByPA: [rates, rates, rates, rates, rates],
    ratesVsBullpenByPA: [rates, rates, rates, rates, rates],
    starterShareByPA:   [0.95, 0.85, 0.65, 0.40, 0.10],
  }
}

/**
 * Simulate a single batter through one game vs a synthetic league-avg opponent
 * at a given lineup slot.
 *
 * V1 simplification: the opposing lineup, starter, and bullpen are all
 * represented by league-average rates. Real replay-the-season would read each
 * historical opponent's actual pitcher stats, bullpen, park factor, and weather.
 *
 * @param playerId   Target batter's MLB player ID
 * @param slot       1-indexed lineup slot (1 = leadoff, 9 = last)
 * @param iterations Monte Carlo iterations
 */
async function simulateOnePlayerInSlot(
  playerId: number,
  slot: number,
  iterations: number,
): Promise<BatterHRRDist> {
  // Clamp slot to valid range
  const s = Math.max(1, Math.min(9, slot))

  // Build a 9-batter home lineup with the target player at `slot`
  const homeLineup: BatterSimContext[] = Array.from({ length: 9 }, (_, i) => {
    if (i + 1 === s) {
      return makeLeagueAvgFiller(playerId)
    }
    // Unique filler IDs to avoid batterId collisions in the sim's stats map
    return makeLeagueAvgFiller(1_000_000 + i)
  })

  // Away lineup: 9 league-avg fillers (the "opponent")
  const awayLineup: BatterSimContext[] = Array.from({ length: 9 }, (_, i) =>
    makeLeagueAvgFiller(2_000_000 + i),
  )

  return simSinglePlayerHRR({
    targetPlayerId: playerId,
    homeLineup,
    awayLineup,
    iterations,
  })
}
