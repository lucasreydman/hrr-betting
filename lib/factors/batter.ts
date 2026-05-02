import type { BatterStatcast } from '../types'

/**
 * Batter contact-quality factor from Statcast.
 *
 * Why a separate factor: pTypical (the offline baseline) already encodes
 * batter skill via career rates. But Statcast captures *underlying* contact
 * quality that traditional rates can lag behind — a hot xwOBA streak often
 * predicts coming results better than the rate stats that haven't caught up
 * yet. The factor multiplies a small adjustment when Statcast and rate stats
 * disagree.
 *
 * Inputs (from Baseball Savant):
 *  - barrelPct:  share of batted balls hit at HR-likely exit-velo + launch-angle
 *  - hardHitPct: share at ≥ 95 mph exit-velo
 *  - xwOBA:      expected wOBA from quality of contact
 *
 * Composition:
 *   contact   = (barrelPct / lg) × (hardHitPct / lg)
 *   xwobaR    = xwOBA / lg
 *   factor    = (contact^0.25) × (xwobaR^0.25)
 *
 * The 0.25 exponents heavily damp the effect — pTypical already captures
 * most batter skill, so this is meant to nudge, not steer. Bounded
 * [0.95, 1.05]: at most a ±5% swing.
 *
 * Returns 1.0 (neutral) when Statcast data is missing.
 */

const LG_BARREL_PCT = 0.075
const LG_HARD_HIT_PCT = 0.395
const LG_XWOBA = 0.320

export function computeBatterFactor(args: {
  statcast: BatterStatcast | null
}): number {
  const sc = args.statcast
  if (!sc) return 1

  const safe = (numer: number, denom: number) =>
    denom > 0 && Number.isFinite(numer) ? Math.max(numer, 0.0001) / denom : 1

  const barrelR = safe(sc.barrelPct, LG_BARREL_PCT)
  const hardR = safe(sc.hardHitPct, LG_HARD_HIT_PCT)
  const xwobaR = safe(sc.xwOBA, LG_XWOBA)

  const contact = Math.pow(barrelR * hardR, 0.25)
  const xwoba = Math.pow(xwobaR, 0.25)
  const factor = contact * xwoba
  return Math.min(1.05, Math.max(0.95, factor))
}
