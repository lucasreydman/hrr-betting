/**
 * Bounded platoon multiplier:
 *  S            → 1.00
 *  Same-side    → 0.97 (~3% disadvantage)
 *  Opposite     → 1.03 (~3% advantage)
 */
export function computeHandednessFactor(args: {
  batterHand: 'R' | 'L' | 'S'
  pitcherThrows: 'R' | 'L' | 'S'
}): number {
  if (args.batterHand === 'S') return 1.00
  if (args.batterHand === args.pitcherThrows) return 0.97
  return 1.03
}
