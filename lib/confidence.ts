import type { Lineup } from './types'

export interface HardGateInputs {
  gameStatus: 'scheduled' | 'in_progress' | 'final' | 'postponed'
  probableStarterId: number | null
  lineupStatus: Lineup['status'] | null
  expectedPA: number
}

/**
 * Hard gates that, if any fail, the pick is dropped entirely (not even shown
 * as Watching). Returns true if ALL gates pass.
 */
export function passesHardGates(args: HardGateInputs): boolean {
  if (args.gameStatus === 'postponed' || args.gameStatus === 'final') return false
  if (args.probableStarterId == null) return false
  if (args.lineupStatus == null) return false
  if (args.expectedPA < 3) return false
  return true
}

export interface ConfidenceInputs {
  lineupStatus: Lineup['status']  // 'confirmed' | 'partial' | 'estimated'
  bvpAB: number  // career at-bats vs starter (0 if no BvP)
  pitcherStartCount: number  // recent starts available for IP CDF
  weatherStable: boolean  // forecast volatility
  isOpener: boolean  // bullpen-after-opener is harder to predict
  timeToFirstPitchMin: number  // time until first pitch (min); closer = more confident
}

/**
 * Graded confidence multiplier in [0.55, 1.00] (typical range).
 * Each input contributes a multiplier; the product is the final confidence.
 */
export function computeConfidence(args: ConfidenceInputs): number {
  let mult = 1.0

  // Lineup confirmation
  if (args.lineupStatus === 'confirmed') mult *= 1.00
  else if (args.lineupStatus === 'partial') mult *= 0.85
  else if (args.lineupStatus === 'estimated') mult *= 0.70

  // BvP sample size: 0 → 0.90, 20+ → 1.0, linear in between
  const bvpFactor = Math.min(1.0, 0.90 + (args.bvpAB / 20) * 0.10)
  mult *= bvpFactor

  // Pitcher recent-start sample: 3 → 0.90, 10+ → 1.0
  const startFactor = args.pitcherStartCount >= 10 ? 1.0
    : args.pitcherStartCount <= 3 ? 0.90
    : 0.90 + ((args.pitcherStartCount - 3) / 7) * 0.10
  mult *= startFactor

  // Weather forecast volatility
  mult *= args.weatherStable ? 1.0 : 0.90

  // Time-to-first-pitch freshness (we trust lineups closer to game time more)
  // ≤90 min → 1.0, 240+ min (4+ hrs) → 0.95
  const timeFactor = args.timeToFirstPitchMin <= 90 ? 1.0
    : args.timeToFirstPitchMin >= 240 ? 0.95
    : 1.0 - ((args.timeToFirstPitchMin - 90) / 150) * 0.05
  mult *= timeFactor

  // Opener: reduce by 0.90× because bullpen-after-opener is hard to predict
  if (args.isOpener) mult *= 0.90

  return mult
}
