/**
 * HRR-weighted weather factor. The underlying weather model produces a
 * multiplier per outcome (1B / 2B / 3B / HR / BB / K). We compose them by
 * each outcome's contribution to HRR (Hits + Runs + RBIs):
 *
 *   weight(1B) = 1.0   (one hit, one runner, possible run)
 *   weight(2B) = 1.5   (XBH adds run-scoring potential)
 *   weight(3B) = 1.5   (XBH; rare)
 *   weight(HR) = 3.0   (1 H + 1 R + 1 RBI minimum, more if runners on)
 *   weight(BB) = 0.3   (no hit, no RBI, but contributes to run channel)
 *   weight(K)  = 0     (no HRR contribution)
 *   weight(OUT)= 0
 *
 *   composite = Σ(weight × outcomeMult) / Σ(weight)
 *
 * This replaces the old "HR-mult dampened by 0.6" approximation. For mild
 * weather the two formulas agree to ~2 decimal places. For extreme conditions
 * (90°F + 15 mph out at Wrigley) the new composite is more conservative
 * because it correctly weights the smaller hit/walk effects rather than
 * extrapolating the HR-only mult linearly.
 *
 * Domes / fetch failures short-circuit to 1.0. Bounded [0.85, 1.20].
 */
import type { Outcome } from '../types'

const HRR_WEIGHTS: Record<Outcome, number> = {
  '1B': 1.0,
  '2B': 1.5,
  '3B': 1.5,
  HR: 3.0,
  BB: 0.3,
  K: 0,
  OUT: 0,
}
const HRR_WEIGHT_SUM =
  HRR_WEIGHTS['1B'] + HRR_WEIGHTS['2B'] + HRR_WEIGHTS['3B'] + HRR_WEIGHTS.HR + HRR_WEIGHTS.BB

export function computeWeatherFactor(args: {
  hrMult: number
  controlled: boolean
  failure: boolean
  /** Optional full per-outcome multiplier map. When supplied, the factor
   *  composes over all outcomes weighted by their HRR contribution. When
   *  omitted (legacy callers), falls back to the `1 + 0.6 × (hrMult − 1)`
   *  approximation against the HR mult alone. */
  factors?: Partial<Record<Outcome, number>>
}): number {
  if (args.controlled || args.failure) return 1
  if (args.factors) {
    let num = 0
    for (const o of ['1B', '2B', '3B', 'HR', 'BB'] as Outcome[]) {
      const m = args.factors[o] ?? 1
      num += HRR_WEIGHTS[o] * m
    }
    const composite = num / HRR_WEIGHT_SUM
    return Math.min(1.20, Math.max(0.85, composite))
  }
  // Legacy single-mult path (kept for fallback).
  const factor = 1 + 0.6 * (args.hrMult - 1)
  return Math.min(1.20, Math.max(0.85, factor))
}
