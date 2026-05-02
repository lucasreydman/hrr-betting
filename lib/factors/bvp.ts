import type { BvPRecord } from '../types'

/**
 * Empirical-Bayes shrunken Batter-vs-Pitcher factor.
 *
 * BvP is small-sample by definition (a typical career line is < 50 AB),
 * so we can't take observed `hits/AB` at face value. Carleton-style
 * stabilization shrinks toward the league prior with a sample size that
 * reflects how quickly batting average stabilizes (~600 PA for BABIP).
 *
 *   weight   = AB / (AB + STABILIZATION_PA)
 *   shrunk   = weight × observed + (1 − weight) × leaguePrior
 *   factor   = shrunk / leaguePrior            (ratio vs prior)
 *
 * We use a wOBA-like contact value rather than raw BAA so power and walks
 * count appropriately:
 *
 *   observed_xwoba ≈ (0.7×BB + 0.9×1B + 1.3×2B + 1.6×3B + 2.0×HR) / (AB + BB)
 *
 * League wOBA hovers around 0.310. The factor is bounded [0.90, 1.10] —
 * BvP shouldn't single-handedly swing a pick more than ±10% on top of
 * everything else the model already considers.
 *
 * Returns 1.0 (neutral) for null records or AB < 5 — small-sample noise
 * is worse than no signal.
 */

/** League-average weighted wOBA-like value used as the shrinkage prior. */
const LEAGUE_WOBA = 0.310

/** Sample-size point at which BvP weighting hits 50% of observed. */
const BVP_STABILIZATION = 600

/** Minimum AB for BvP to enter the model at all. */
const BVP_MIN_AB = 5

/** wOBA component weights. Standard FanGraphs run-value coefficients. */
const W_BB = 0.7
const W_1B = 0.9
const W_2B = 1.3
const W_3B = 1.6
const W_HR = 2.0

export function computeBvpFactor(args: { bvp: BvPRecord | null }): number {
  const bvp = args.bvp
  if (!bvp || bvp.ab < BVP_MIN_AB) return 1

  const denom = bvp.ab + bvp.BB
  if (denom <= 0) return 1

  const observed =
    (W_BB * bvp.BB +
      W_1B * bvp['1B'] +
      W_2B * bvp['2B'] +
      W_3B * bvp['3B'] +
      W_HR * bvp.HR) /
    denom

  const weight = bvp.ab / (bvp.ab + BVP_STABILIZATION)
  const shrunk = weight * observed + (1 - weight) * LEAGUE_WOBA
  const factor = shrunk / LEAGUE_WOBA
  return Math.min(1.10, Math.max(0.90, factor))
}
