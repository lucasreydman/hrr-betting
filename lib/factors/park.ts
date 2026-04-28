/**
 * Composite HRR park factor for a batter at a venue.
 *
 * Uses available FanGraphs 2025 per-handedness data for 1B/2B/3B/HR to compute:
 *   composite = 0.50 × hitFactor + 0.25 × runFactor + 0.25 × hrFactor
 *
 * Where:
 *   hitFactor = 0.60×1B + 0.25×2B + 0.10×3B + 0.05×HR  (hit-frequency weighted)
 *   runFactor = 0.40×2B + 0.40×3B + 0.20×HR             (XBH-weighted run proxy)
 *   hrFactor  = HR factor per handedness
 *
 * Unknown venues return 1.0 (neutral). Bounded [0.7, 1.3].
 */
import {
  hasParkData,
  getHitParkFactorForBatter,
  getRunParkFactor,
  getHrParkFactorForBatter,
} from '../park-factors'

export function computeParkFactor(args: {
  venueId: number
  batterHand: 'R' | 'L' | 'S'
}): number {
  if (!hasParkData(args.venueId)) return 1
  const hit = getHitParkFactorForBatter(args.venueId, args.batterHand)
  const run = getRunParkFactor(args.venueId, args.batterHand)
  const hr = getHrParkFactorForBatter(args.venueId, args.batterHand)
  const composite = 0.50 * hit + 0.25 * run + 0.25 * hr
  return clamp(composite)
}

function clamp(x: number): number {
  return Math.min(1.3, Math.max(0.7, x))
}
