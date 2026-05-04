import { stabilizeScalar } from '../stabilization'
import {
  LG_K_PCT,
  LG_BB_PCT,
  LG_HR_PCT,
  LG_HARD_HIT_RATE,
  STABILIZATION_BF,
} from '../constants'

export interface PitcherInputs {
  id: number
  kPct: number
  bbPct: number
  hrPct: number
  hardHitRate: number
  bf: number
  recentStarts: number
  /**
   * Optional: prior-season rate snapshot for the same pitcher. When
   * current-season has < 3 starts, the factor falls back to *blending*
   * current with prior-season instead of returning a flat 1.00.
   *
   * The blend uses prior-season BF as the stabilization-prior weight, so
   * a 30-start veteran with 1 fresh start reads ~95% prior + ~5% current,
   * which produces a real factor value reflecting their true quality. A
   * true rookie with no prior data still reads 1.00 (factor neutral).
   *
   * Only consumed in the cold-start branch; ignored once recentStarts ≥ 3.
   */
  priorSeason?: {
    kPct: number
    bbPct: number
    hrPct: number
    hardHitRate: number
    bf: number  // prior-season batters faced; ≥50 to enable fallback
  }
}

/** Minimum prior-season BF for the cold-start fallback to engage. ~12 starts
 *  worth of BF. Below this we don't trust prior-season as a stand-in. */
const PRIOR_SEASON_BF_MIN = 50

/**
 * Bounded [0.5, 2.0] pitcher quality multiplier.
 *
 * TBD pitcher (id=0) → 1.00.
 *
 * Three signal regimes:
 *
 *  · **Cold start** (current < 3 starts AND prior-season has ≥ 50 BF):
 *    Fall back to a blended-stabilization that anchors on prior-season
 *    rates. This catches the "30-start veteran with 1 fresh start" case
 *    that previously read as league-average. Uses Carleton's stabilization
 *    sample sizes against the prior-season rate as the prior, so as the
 *    current-season sample grows, the factor smoothly migrates from prior
 *    rates toward current rates.
 *
 *  · **Cold start, no prior** (current < 3 starts AND no usable prior):
 *    Return 1.00 (true rookie, league-avg fallback unsafe to extrapolate).
 *
 *  · **Normal** (current ≥ 3 starts): stabilize current-season rates
 *    against league average via Carleton sample sizes. Unchanged from
 *    prior behavior.
 *
 * In all active regimes:
 *   quality = (1/kRatio) × (1/bbRatio) × hrRatio × hhRatio
 *   - Elite pitcher (high K, low BB, low HR, low hard-hit) → quality < 1
 *   - Poor pitcher (low K, high BB, high HR, high hard-hit) → quality > 1
 */
export function computePitcherFactor(args: { pitcher: PitcherInputs }): number {
  const p = args.pitcher
  if (p.id === 0) return 1

  // Cold-start fallback: thin current-season AND usable prior-season data.
  // We stabilize current rates against prior-season rates as the prior. With
  // current.bf small, the result is dominated by prior-season; as current.bf
  // grows toward Carleton's stabilization point, current rates take over.
  // This is strictly more informative than the previous "return 1.00" gate
  // for veterans, and identical-in-output for rookies (no prior → return 1).
  if (p.recentStarts < 3) {
    if (!p.priorSeason || p.priorSeason.bf < PRIOR_SEASON_BF_MIN) {
      return 1
    }
    const k = stabilizeScalar(p.kPct, p.priorSeason.kPct, p.bf, STABILIZATION_BF.k)
    const bb = stabilizeScalar(p.bbPct, p.priorSeason.bbPct, p.bf, STABILIZATION_BF.bb)
    const hr = stabilizeScalar(p.hrPct, p.priorSeason.hrPct, p.bf, STABILIZATION_BF.hr)
    const hh = stabilizeScalar(p.hardHitRate, p.priorSeason.hardHitRate, p.bf, STABILIZATION_BF.hardHit)
    return clampQuality(k, bb, hr, hh)
  }

  // Normal path: current-season ≥ 3 starts, stabilize against league avg.
  const k = stabilizeScalar(p.kPct, LG_K_PCT, p.bf, STABILIZATION_BF.k)
  const bb = stabilizeScalar(p.bbPct, LG_BB_PCT, p.bf, STABILIZATION_BF.bb)
  const hr = stabilizeScalar(p.hrPct, LG_HR_PCT, p.bf, STABILIZATION_BF.hr)
  const hh = stabilizeScalar(p.hardHitRate, LG_HARD_HIT_RATE, p.bf, STABILIZATION_BF.hardHit)
  return clampQuality(k, bb, hr, hh)
}

function clampQuality(k: number, bb: number, hr: number, hh: number): number {
  const kRatio = k / LG_K_PCT
  const bbRatio = bb / LG_BB_PCT
  const hrRatio = hr / LG_HR_PCT
  const hhRatio = hh / LG_HARD_HIT_RATE
  const quality = (1 / kRatio) * (1 / bbRatio) * hrRatio * hhRatio
  return Math.min(2.0, Math.max(0.5, quality))
}
