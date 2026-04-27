import { LEAGUE_AVG_RATES, LG_BARREL_PCT, LG_HARD_HIT_PCT, LG_WHIFF_PCT } from './constants'
import type { Outcome, OutcomeRates } from './types'

export interface BatterContext {
  rates: OutcomeRates
  statcast?: {
    barrelPct: number
    hardHitPct: number
    xwOBA?: number
    xISO?: number
    avgExitVelo?: number
  }
}

export interface PitcherContext {
  rates: OutcomeRates
  statcast?: {
    barrelsAllowedPct: number
    hardHitPctAllowed: number
    xwOBAAllowed?: number
    whiffPct: number
  }
}

export interface PerPAContext {
  parkFactors: Record<Outcome, number>
  weatherFactors: Record<Outcome, number>
  ttoMultipliers: Record<Outcome, number>
}

/**
 * Compute per-PA outcome probability distribution using log-5 (odds ratio) blended
 * with Statcast-driven adjustments. Returns 7 outcomes summing to 1.
 *
 * Formula:
 *   base[k] = batter.rates[k] * (pitcher.rates[k] / lg_avg[k])
 *   then Statcast multipliers applied to HR (barrel), 1B/2B (hard-hit), K (whiff)
 *   using sqrt() to temper the adjustments (50/50 geometric blend with raw rate).
 *   Then park * weather * TTO multipliers per outcome, then normalize.
 *
 * NOTE: The sqrt() geometric blend weight is a placeholder pending calibration from
 * settled-pick backtest data per spec §11. When calibration data is available, replace
 * Math.sqrt(mult) with Math.pow(mult, calibratedExponent) where exponent ∈ [0.3, 0.7].
 */
export function computePerPA(args: {
  batter: BatterContext
  pitcher: PitcherContext
  ctx: PerPAContext
}): OutcomeRates {
  const { batter, pitcher, ctx } = args
  const outcomes: Outcome[] = ['1B', '2B', '3B', 'HR', 'BB', 'K', 'OUT']

  // Log-5 base: batter.rates[k] * (pitcher.rates[k] / lg_avg[k])
  const base: Partial<OutcomeRates> = {}
  for (const k of outcomes) {
    const lg = LEAGUE_AVG_RATES[k]
    if (lg === 0) { base[k] = 0; continue }
    base[k] = batter.rates[k] * (pitcher.rates[k] / lg)
  }

  // Statcast adjustments — only when BOTH sides provide Statcast data.
  // Geometric blend (sqrt) tempers each adjustment to avoid overcorrection.
  // Calibration target: spec §11 lists these exponents as forward-tracked outputs.
  //
  // The multipliers are clamped to [0.25, 4] before the sqrt so that:
  //  - A small-sample 0 in any input doesn't zero out an outcome entirely
  //    (e.g. a pitcher with 0 whiffs over 5 PAs would otherwise drive K → 0).
  //  - An extreme outlier (e.g. 25% barrel rate vs 7.5% league avg) still gets
  //    a strong-but-bounded boost (~2x via sqrt(4)) instead of an explosive value.
  // After sqrt, the effective adjustment lands in [0.5x, 2x], which is a sane
  // band for a per-outcome temper on top of the log-5 baseline.
  if (batter.statcast && pitcher.statcast) {
    const clamp = (x: number) => Math.min(4, Math.max(0.25, x))
    const barrelMult = clamp(
      (batter.statcast.barrelPct / LG_BARREL_PCT) *
      (pitcher.statcast.barrelsAllowedPct / LG_BARREL_PCT)
    )
    const hardHitMult = clamp(
      (batter.statcast.hardHitPct / LG_HARD_HIT_PCT) *
      (pitcher.statcast.hardHitPctAllowed / LG_HARD_HIT_PCT)
    )
    const whiffMult = clamp(pitcher.statcast.whiffPct / LG_WHIFF_PCT)

    base.HR = (base.HR ?? 0) * Math.sqrt(barrelMult)
    base['1B'] = (base['1B'] ?? 0) * Math.sqrt(hardHitMult)
    base['2B'] = (base['2B'] ?? 0) * Math.sqrt(hardHitMult)
    base.K = (base.K ?? 0) * Math.sqrt(whiffMult)
  }

  // Apply park, weather, and TTO multipliers per outcome
  const adjusted: Partial<OutcomeRates> = {}
  for (const k of outcomes) {
    const park = ctx.parkFactors[k] ?? 1
    const wx = ctx.weatherFactors[k] ?? 1
    const tto = ctx.ttoMultipliers[k] ?? 1
    adjusted[k] = (base[k] ?? 0) * park * wx * tto
  }

  // Normalize so all 7 outcomes sum to exactly 1
  const total = outcomes.reduce((acc, k) => acc + (adjusted[k] ?? 0), 0)
  if (total === 0) {
    // Pathological edge case: all rates are zero — return uniform fallback
    return Object.fromEntries(outcomes.map(k => [k, 1 / outcomes.length])) as OutcomeRates
  }
  return Object.fromEntries(
    outcomes.map(k => [k, (adjusted[k] ?? 0) / total])
  ) as OutcomeRates
}
