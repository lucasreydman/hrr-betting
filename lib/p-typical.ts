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
import { fetchBatterSeasonStats, fetchBatterCareerStats } from './mlb-api'
import { LEAGUE_AVG_RATES, TTO_MULTIPLIERS } from './constants'
import { stabilizeRates } from './stabilization'
import type { BatterSimContext, BatterHRRDist } from './offline-sim/sim'
import type { Outcome, OutcomeRates } from './types'

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

/** Heavy compute. Called only by `/api/sim/typical` (cron path); never on
 *  the request path, which reads `getPTypical` and falls back to league avg
 *  on cache miss rather than running this 20k-iter sim inline. */
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

  // Use career rates as the stabilization prior when available — preserves
  // true skill differences (a career .280 hitter shouldn't get regressed all
  // the way to the .240 league mean by a small current-season sample).
  // Fall back to league average for rookies / missing data.
  // Run-time isolation: a network failure on the career fetch must not
  // sabotage the typical compute, so it's defensively try/catch'd.
  let prior: OutcomeRates = LEAGUE_AVG_RATES
  try {
    const career = await fetchBatterCareerStats(args.playerId)
    if (career && career.pa >= 200) {
      // 200 PA threshold = career sample large enough to be a meaningfully
      // better prior than league average. Below that, the career rates
      // themselves are still noisy and league avg is the safer prior.
      prior = career.outcomeRates
    }
  } catch {
    // Stick with league avg
  }

  const targetRates: OutcomeRates = stabilizeRates(
    batterSeason.outcomeRates,
    prior,
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

/**
 * Apply per-outcome TTO multipliers to a batter's rates for one PA index.
 *
 * Times-through-the-order penalties are fundamentally per-PA — the pitcher
 * gets progressively worse on each pass through the lineup. Baking TTO into
 * the offline sim's per-PA rate slots means the effect compounds correctly
 * through the baserunner state machine (more contact → more baserunners →
 * more RBI opportunities for everyone), instead of being applied as a single
 * uniform multiplier on the binary "≥ k HRR" probability at request time.
 *
 * Logic:
 *   1. Multiply each non-OUT outcome rate by its TTO multiplier
 *   2. OUT becomes 1 − sum(non-OUT) so probabilities still sum to 1
 *   3. Renormalise to clean up any floating-point drift
 *
 * `paIndex` is 0-based. PA 0/1/2 (first three vs the starter) get TTO 1/2/3
 * respectively. PA 3+ falls into the bullpen, which doesn't get TTO applied
 * — relievers face each batter once, no TTO buildup.
 */
function applyTto(rates: OutcomeRates, paIndex: number): OutcomeRates {
  if (paIndex >= 3) return rates  // bullpen PAs — no TTO
  const ttoKey = String(paIndex + 1) as '1' | '2' | '3'
  const mult = TTO_MULTIPLIERS[ttoKey]
  const nonOutOutcomes: Outcome[] = ['1B', '2B', '3B', 'HR', 'BB', 'K']
  const adjusted: Partial<OutcomeRates> = {}
  for (const o of nonOutOutcomes) {
    adjusted[o] = rates[o] * mult[o]
  }
  const sumNonOut = nonOutOutcomes.reduce((acc, o) => acc + (adjusted[o] ?? 0), 0)
  adjusted.OUT = Math.max(0, 1 - sumNonOut)
  // Renormalise against any floating-point drift.
  const total = Object.values(adjusted).reduce((a, b) => a + (b ?? 0), 0)
  return Object.fromEntries(
    Object.entries(adjusted).map(([k, v]) => [k, (v ?? 0) / total]),
  ) as OutcomeRates
}

function makeContext(batterId: number, rates: OutcomeRates): BatterSimContext {
  // Per-PA rate arrays. Index 0/1/2 = TTO 1/2/3 against the starter.
  // Index 3/4 = bullpen PAs (TTO not applicable). Bullpen rates use the
  // un-adjusted batter line because the closed-form bullpen factor at
  // request time captures opponent bullpen quality separately.
  const starterByPA = [
    applyTto(rates, 0),
    applyTto(rates, 1),
    applyTto(rates, 2),
    rates,
    rates,
  ]
  const bullpenByPA = [rates, rates, rates, rates, rates]
  return {
    batterId,
    ratesVsStarterByPA: starterByPA,
    ratesVsBullpenByPA: bullpenByPA,
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
