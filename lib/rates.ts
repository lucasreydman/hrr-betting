import type { Handedness, OutcomeRates } from './types'

export interface BlendArgs {
  season: OutcomeRates
  l30: OutcomeRates
  l15: OutcomeRates
  weights: { season: number; l30: number; l15: number }
}

/**
 * Weighted blend of season-stabilized / L30 / L15 rates. Weights are normalized
 * automatically (so callers can pass relative weights without worrying about sum).
 * The result is renormalized so outcomes sum to exactly 1.
 */
export function blendRates({ season, l30, l15, weights }: BlendArgs): OutcomeRates {
  const wSum = weights.season + weights.l30 + weights.l15
  const w = { season: weights.season / wSum, l30: weights.l30 / wSum, l15: weights.l15 / wSum }
  const result: Partial<OutcomeRates> = {}
  for (const k of Object.keys(season) as (keyof OutcomeRates)[]) {
    result[k] = w.season * season[k] + w.l30 * l30[k] + w.l15 * l15[k]
  }
  // Normalize against floating-point drift
  const total = Object.values(result).reduce((a, b) => a + (b ?? 0), 0)
  return Object.fromEntries(
    Object.entries(result).map(([k, v]) => [k, (v ?? 0) / total])
  ) as OutcomeRates
}

/**
 * Pick batter rates appropriate for the pitcher's handedness.
 * For switch pitchers (rare), returns a 50/50 blend of vsR and vsL.
 */
export function applyHandedness(
  splits: { vsR: OutcomeRates; vsL: OutcomeRates },
  pitcherHand: Handedness,
): OutcomeRates {
  if (pitcherHand === 'R') return splits.vsR
  if (pitcherHand === 'L') return splits.vsL
  // Switch pitcher: blend evenly. (Practically rare — most "S" pitchers throw same hand vs same-hand batters.)
  return blendRates({
    season: splits.vsR, l30: splits.vsR, l15: splits.vsL,
    weights: { season: 0.25, l30: 0.25, l15: 0.5 },
  })
}
