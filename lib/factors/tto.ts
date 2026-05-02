import { TTO_MULTIPLIERS } from '../constants'
import type { Outcome } from '../types'

/**
 * Times-through-the-order factor.
 *
 * Each batter typically faces the starter ~3 times before the bullpen takes
 * over. The pitcher gets progressively worse on each pass — the second-time
 * effect is small (~3-5% on most outcomes), the third-time effect is sharper
 * (especially HR). Documented in Mitchel Lichtman's TTO research; the
 * per-outcome ramp is in `lib/constants.ts:TTO_MULTIPLIERS`.
 *
 * The offline `pTypical` baseline does NOT apply TTO. We add it as a
 * separate request-time factor so the matchup probability accurately
 * reflects the cumulative penalty across PAs against the starter.
 *
 * Composition:
 *   1. Compute average per-outcome multiplier across PAs 1, 2, 3 (the
 *      typical PAs a batter sees vs the starter; PA 4+ falls into the
 *      bullpen factor's coverage).
 *   2. Weight each outcome by its HRR contribution (same weights used in
 *      lib/factors/weather.ts for consistency).
 *   3. Return the HRR-weighted composite.
 *
 * The result is uniformly slightly positive (~1.05-1.07) because the
 * pitcher-degradation effect is real and applies to every batter. Adding
 * it lifts every pToday by a small amount that pTypical was missing.
 *
 * Bounded [0.95, 1.15] as a safety rail.
 */

const HRR_WEIGHTS: Record<Outcome, number> = {
  '1B': 1.0,
  '2B': 1.5,
  '3B': 1.5,
  HR: 3.0,
  BB: 0.3,
  K: 0,
  OUT: 0,
}

const HRR_OUTCOMES: Outcome[] = ['1B', '2B', '3B', 'HR', 'BB']
const HRR_WEIGHT_SUM = HRR_OUTCOMES.reduce((s, o) => s + HRR_WEIGHTS[o], 0)
const TTO_PASSES: Array<'1' | '2' | '3'> = ['1', '2', '3']

/** Memoised composite — TTO_MULTIPLIERS are constants, so this never changes. */
let cached: number | null = null

export function computeTtoFactor(): number {
  if (cached !== null) return cached
  let composite = 0
  for (const o of HRR_OUTCOMES) {
    const meanMult =
      TTO_PASSES.reduce((s, p) => s + TTO_MULTIPLIERS[p][o], 0) / TTO_PASSES.length
    composite += HRR_WEIGHTS[o] * meanMult
  }
  composite /= HRR_WEIGHT_SUM
  cached = Math.min(1.15, Math.max(0.95, composite))
  return cached
}
