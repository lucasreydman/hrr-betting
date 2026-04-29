/**
 * lib/p-typical.ts
 *
 * Cache-reader for `probTypical` baselines. The heavy compute lives in
 * computeTypicalOffline() which runs in the offline sim cron path —
 * see app/api/sim/typical/route.ts.
 *
 * Cache key prefix: `typical:v1:{playerId}`
 * TTL: 14 days (covers two refresh cycles)
 *
 * v1 simplification: single-slot baseline (slot 4 = mid-order, league-mean PA).
 * Slot variance at request time is absorbed by `paCountFactor` in lib/prob-today.ts.
 */

import { kvGet } from './kv'
import { simSinglePlayerHRR } from './offline-sim/sim'
import { fetchBatterSeasonStats } from './mlb-api'
import { LEAGUE_AVG_RATES } from './constants'
import { stabilizeRates } from './stabilization'
import type { BatterSimContext, BatterHRRDist } from './offline-sim/sim'
import type { OutcomeRates } from './types'

export interface PTypicalResult {
  playerId: number
  /** Cumulative: atLeast[k] = P(HRR ≥ k); atLeast[0] = 1; length 5 */
  atLeast: number[]
  iterations: number
  computedAt: number
}

const SLATE_BASELINE_SLOT = 4
const ITERATIONS = 20_000

/** Fallback used when no game log / season data exists. */
const LEAGUE_AVG_FALLBACK: number[] = [1.0, 0.65, 0.30, 0.10, 0.03]

/**
 * Cache-only reader. Returns league-avg fallback on miss — does NOT
 * inline-backfill, because in production a single page request can touch
 * 200+ players, and 200 × 10s sims would blow Vercel's 10s function limit.
 *
 * The cache is populated by the offline cron path:
 *   - Weekly full sweep:   POST /api/sim/typical {mode: 'full'}    (Sun 4 AM ET)
 *   - Nightly slate sweep: POST /api/sim/typical {mode: 'player'}  (Mon-Sat 4 AM ET)
 *   - Manual warm:         npm run recalibrate (or hit the cron URL directly)
 *
 * Until the first cron run, picks are ranked using league-avg probTypical —
 * still a usable ordering (driven by probToday's matchup-quality factors)
 * but with reduced per-player fidelity.
 */
export async function getPTypical(args: {
  playerId: number
  season?: number
}): Promise<PTypicalResult> {
  const cacheKey = `typical:v1:${args.playerId}`
  const cached = await kvGet<PTypicalResult>(cacheKey)
  if (cached) return cached
  return makeFallback(args.playerId)
}

/** Heavy compute. Called by /api/sim/typical and the lazy backfill path. */
export async function computeTypicalOffline(args: {
  playerId: number
  season?: number
}): Promise<PTypicalResult> {
  const season = args.season ?? new Date().getFullYear()

  let batterSeason
  try {
    batterSeason = await fetchBatterSeasonStats(args.playerId, season)
  } catch {
    return makeFallback(args.playerId)
  }

  if (batterSeason.pa === 0) {
    return makeFallback(args.playerId)
  }

  const targetRates: OutcomeRates = stabilizeRates(
    batterSeason.outcomeRates,
    LEAGUE_AVG_RATES,
    batterSeason.pa,
  )

  const dist = await simulateAtSlot(args.playerId, SLATE_BASELINE_SLOT, ITERATIONS, targetRates)

  return {
    playerId: args.playerId,
    atLeast: [...dist.atLeast],
    iterations: ITERATIONS,
    computedAt: Date.now(),
  }
}

function makeFallback(playerId: number): PTypicalResult {
  return {
    playerId,
    atLeast: [...LEAGUE_AVG_FALLBACK],
    iterations: 0,
    computedAt: Date.now(),
  }
}

function makeContext(batterId: number, rates: OutcomeRates): BatterSimContext {
  const ratesArr = [rates, rates, rates, rates, rates]
  return {
    batterId,
    ratesVsStarterByPA: ratesArr,
    ratesVsBullpenByPA: ratesArr,
    starterShareByPA: [0.95, 0.85, 0.65, 0.40, 0.10],
  }
}

async function simulateAtSlot(
  playerId: number,
  slot: number,
  iterations: number,
  targetRates: OutcomeRates,
): Promise<BatterHRRDist> {
  const s = Math.max(1, Math.min(9, slot))
  const lgRates = { ...LEAGUE_AVG_RATES }
  const homeLineup: BatterSimContext[] = Array.from({ length: 9 }, (_, i) =>
    i + 1 === s ? makeContext(playerId, targetRates) : makeContext(1_000_000 + i, lgRates),
  )
  const awayLineup: BatterSimContext[] = Array.from({ length: 9 }, (_, i) =>
    makeContext(2_000_000 + i, lgRates),
  )
  return simSinglePlayerHRR({
    targetPlayerId: playerId,
    homeLineup,
    awayLineup,
    iterations,
  })
}
