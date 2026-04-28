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
}

/**
 * Bounded [0.5, 2.0] pitcher quality multiplier.
 * TBD pitcher (id=0) or low-sample (<3 starts) → 1.0.
 *
 * Combines stabilized K%, BB%, HR%, and hard-hit rate vs league averages.
 * quality = (1/kRatio) × (1/bbRatio) × hrRatio × hhRatio
 *   - Elite pitcher (high K, low BB, low HR, low hard-hit) → quality < 1 (harder to score)
 *   - Poor pitcher (low K, high BB, high HR, high hard-hit) → quality > 1 (easier to score)
 */
export function computePitcherFactor(args: { pitcher: PitcherInputs }): number {
  const p = args.pitcher
  if (p.id === 0) return 1
  if (p.recentStarts < 3) return 1

  const k = stabilizeScalar(p.kPct, LG_K_PCT, p.bf, STABILIZATION_BF.k)
  const bb = stabilizeScalar(p.bbPct, LG_BB_PCT, p.bf, STABILIZATION_BF.bb)
  const hr = stabilizeScalar(p.hrPct, LG_HR_PCT, p.bf, STABILIZATION_BF.hr)
  const hh = stabilizeScalar(p.hardHitRate, LG_HARD_HIT_RATE, p.bf, STABILIZATION_BF.hardHit)

  const kRatio = k / LG_K_PCT
  const bbRatio = bb / LG_BB_PCT
  const hrRatio = hr / LG_HR_PCT
  const hhRatio = hh / LG_HARD_HIT_RATE

  const quality = (1 / kRatio) * (1 / bbRatio) * hrRatio * hhRatio
  return Math.min(2.0, Math.max(0.5, quality))
}
