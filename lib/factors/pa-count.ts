import { expectedPAByLineupSlot, LG_PA_PER_GAME } from '../constants'

/**
 * Adjust probTypical for actual lineup-slot expected PA count.
 * probTypical is computed at slot 4 (mid-order, league-mean PA);
 * this factor scales for top-of-order (more PAs) vs bottom (fewer).
 *
 * Bounded [0.85, 1.15]. Approximation: assumes per-PA HRR probability
 * is constant and PAs are independent. Both imperfect but the bound
 * keeps the error small.
 */
export function computePaCountFactor(args: {
  probTypical: number
  slot: number
}): number {
  if (!Number.isInteger(args.slot) || args.slot < 1 || args.slot > 9) return 1
  const expectedPA = expectedPAByLineupSlot[args.slot]
  if (!expectedPA) return 1
  const basePA = LG_PA_PER_GAME
  const pPerPA = Math.min(0.99, Math.max(0.001, args.probTypical / basePA))
  const notClearToday = Math.pow(1 - pPerPA, expectedPA)
  const notClearBase = Math.pow(1 - pPerPA, basePA)
  const factor = (1 - notClearToday) / Math.max(0.001, 1 - notClearBase)
  return Math.min(1.15, Math.max(0.85, factor))
}
