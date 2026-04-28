import type { BullpenEraStats } from '../bullpen'
import { stabilizeScalar } from '../stabilization'
import {
  LG_BULLPEN_ERA,
  STABILIZATION_BULLPEN_IP,
  paShareVsBullpenBySlot,
} from '../constants'

/**
 * Adjust for opponent bullpen quality scaled by per-slot bullpen exposure.
 *
 * factor = 1 + share × (qualityRatio - 1)
 * where qualityRatio = stabilizedERA / LG_BULLPEN_ERA
 *   > 1 → poor bullpen (favours hitter)
 *   < 1 → elite bullpen (hurts hitter)
 *
 * Null bullpen (unknown team / API failure) → 1.0.
 * Bounded [0.85, 1.15].
 */
export function computeBullpenFactor(args: {
  bullpen: BullpenEraStats | null
  lineupSlot: number
}): number {
  if (!args.bullpen) return 1
  const slot =
    Number.isInteger(args.lineupSlot) &&
    args.lineupSlot >= 1 &&
    args.lineupSlot <= 9
      ? args.lineupSlot
      : 5
  const share = paShareVsBullpenBySlot[slot]
  const era = stabilizeScalar(
    args.bullpen.era,
    LG_BULLPEN_ERA,
    args.bullpen.ip,
    STABILIZATION_BULLPEN_IP,
  )
  const qualityRatio = era / LG_BULLPEN_ERA
  const factor = 1 + share * (qualityRatio - 1)
  return Math.min(1.15, Math.max(0.85, factor))
}
