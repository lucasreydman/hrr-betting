import { STABILIZATION_PA } from './constants'
import type { Outcome, OutcomeRates } from './types'

/**
 * Scalar stabilization helper for use in factor functions.
 * Blends an observed rate toward a prior using a custom stabilization sample size.
 *
 *   weight = sample / (sample + stabilizationN)
 *   result = weight * observed + (1 - weight) * prior
 *
 * Returns `prior` when sample <= 0 (no data).
 */
export function stabilizeScalar(
  observed: number,
  prior: number,
  sample: number,
  stabilizationN: number,
): number {
  if (sample <= 0) return prior
  const w = sample / (sample + stabilizationN)
  return w * observed + (1 - w) * prior
}

export interface StabilizeArgs {
  observed: number
  sampleSize: number
  prior: number
  statKey: string  // key into STABILIZATION_PA (case-insensitive)
}

/**
 * Per-stat empirical regression. Blends observed with prior using:
 *   weight = sampleSize / (sampleSize + stabilizationPoint)
 * Bigger samples → more weight on observed; smaller samples → more weight on prior.
 *
 * `prior` should be the player's career rate when available (preserves true skill
 * differences) — fall back to league mean only for true rookies.
 */
export function stabilize({ observed, sampleSize, prior, statKey }: StabilizeArgs): number {
  const stabPoint = STABILIZATION_PA[statKey.toLowerCase()]
  if (stabPoint == null) throw new Error(`Unknown statKey: ${statKey}`)
  const weight = sampleSize / (sampleSize + stabPoint)
  return weight * observed + (1 - weight) * prior
}

/**
 * Stabilizes the 6 hit/walk/K outcomes against career-prior rates, then computes
 * OUT as 1 - sum(others) (since the rates form a probability distribution that
 * must sum to 1). The result is renormalized so that any floating-point drift is
 * cleaned up.
 */
export function stabilizeRates(
  observed: OutcomeRates,
  prior: OutcomeRates,
  sampleSize: number,
): OutcomeRates {
  const stabilized: Partial<OutcomeRates> = {}
  const nonOutOutcomes: Outcome[] = ['1B', '2B', '3B', 'HR', 'BB', 'K']
  for (const k of nonOutOutcomes) {
    stabilized[k] = stabilize({
      observed: observed[k],
      sampleSize,
      prior: prior[k] ?? observed[k],
      statKey: k,
    })
  }
  const nonOutSum = nonOutOutcomes.reduce((a, k) => a + (stabilized[k] ?? 0), 0)
  stabilized.OUT = Math.max(0, 1 - nonOutSum)

  // Renormalize against any drift
  const total = Object.values(stabilized).reduce((a, b) => a + (b ?? 0), 0)
  return Object.fromEntries(
    Object.entries(stabilized).map(([k, v]) => [k, (v ?? 0) / total])
  ) as OutcomeRates
}
