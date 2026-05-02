/**
 * Composite HRR park factor for a batter at a venue.
 *
 * Uses FanGraphs 2025 per-outcome park factors:
 *   composite =
 *     0.45 × hitFactor      (1B/2B/3B/HR by handedness)
 *   + 0.20 × runFactor      (XBH-weighted run proxy)
 *   + 0.20 × hrFactor       (HR by handedness)
 *   + 0.10 × (1 / kFactor)  (lower K → more contact → more HRR)
 *   + 0.05 × bbFactor       (more walks → small lift via runs)
 *
 * The K and BB factors are blended in at small weight because their effect
 * on HRR is real but modest. K is *inverted* (1/K) because a park that
 * suppresses Ks is good for the batter, not bad.
 *
 * Unknown venues return 1.0 (neutral). Bounded [0.7, 1.3].
 */
import {
  hasParkData,
  getHitParkFactorForBatter,
  getRunParkFactor,
  getHrParkFactorForBatter,
  getKParkFactor,
  getBbParkFactor,
} from '../park-factors'

export function computeParkFactor(args: {
  venueId: number
  batterHand: 'R' | 'L' | 'S'
}): number {
  if (!hasParkData(args.venueId)) return 1
  const hit = getHitParkFactorForBatter(args.venueId, args.batterHand)
  const run = getRunParkFactor(args.venueId, args.batterHand)
  const hr = getHrParkFactorForBatter(args.venueId, args.batterHand)
  const kFactor = getKParkFactor(args.venueId)
  const bb = getBbParkFactor(args.venueId)
  // Floor the K factor at 0.5 so the inverse can't blow up if a venue ever
  // gets a tiny K value. In practice FG's K factors live in [0.92, 1.10].
  const contact = 1 / Math.max(kFactor, 0.5)
  const composite =
    0.45 * hit + 0.20 * run + 0.20 * hr + 0.10 * contact + 0.05 * bb
  return clamp(composite)
}

function clamp(x: number): number {
  return Math.min(1.3, Math.max(0.7, x))
}
