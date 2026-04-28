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
  batterSeasonPa: number  // batter's PAs this season (0 = no data yet)
  maxCacheAgeSec: number  // age of the freshest-out-of-date upstream cache (seconds)
}

/** Per-factor breakdown of the confidence multiplier. Product of all eight = `confidence`. */
export interface ConfidenceFactors {
  lineup: number       // 1.00 / 0.85 / 0.70 by lineup status
  bvp: number          // 0.90–1.00 ramp from 0 to 20 BvP at-bats
  pitcherStart: number // 0.90–1.00 ramp from 3 to 10 recent starts
  weather: number      // 1.00 stable / 0.90 volatile
  time: number         // 1.00 within 90 min / 0.95 at 4+ hrs out
  opener: number       // 1.00 normal / 0.90 opener
  sampleSize: number   // 0.85 at 0 PA → 1.00 at ≥200 PA, linear
  dataFreshness: number // 1.00 if ≤5 min stale → 0.90 if ≥30 min, linear
}

/**
 * Compute the per-factor breakdown of the confidence multiplier. Used by the
 * UI to explain *why* a pick has the confidence it does — e.g. "estimated
 * lineup × 0.70, pitcher 4-start sample × 0.91". `computeConfidence` returns
 * just the product; this returns the components.
 */
export function computeConfidenceBreakdown(args: ConfidenceInputs): {
  factors: ConfidenceFactors
  product: number
} {
  const lineup =
    args.lineupStatus === 'confirmed' ? 1.00 :
    args.lineupStatus === 'partial' ? 0.85 : 0.70
  const bvp = Math.min(1.0, 0.90 + (args.bvpAB / 20) * 0.10)
  const pitcherStart =
    args.pitcherStartCount >= 10 ? 1.0 :
    args.pitcherStartCount <= 3 ? 0.90 :
    0.90 + ((args.pitcherStartCount - 3) / 7) * 0.10
  const weather = args.weatherStable ? 1.0 : 0.90
  const time =
    args.timeToFirstPitchMin <= 90 ? 1.0 :
    args.timeToFirstPitchMin >= 240 ? 0.95 :
    1.0 - ((args.timeToFirstPitchMin - 90) / 150) * 0.05
  const opener = args.isOpener ? 0.90 : 1.0
  const sampleSize = Math.min(1.0, Math.max(0.85, 0.85 + 0.15 * Math.min(1, args.batterSeasonPa / 200)))
  const dataFreshness =
    args.maxCacheAgeSec <= 5 * 60 ? 1.0 :
    args.maxCacheAgeSec >= 30 * 60 ? 0.90 :
    1.0 - ((args.maxCacheAgeSec - 5 * 60) / (25 * 60)) * 0.10

  const factors: ConfidenceFactors = { lineup, bvp, pitcherStart, weather, time, opener, sampleSize, dataFreshness }
  const product = lineup * bvp * pitcherStart * weather * time * opener * sampleSize * dataFreshness
  return { factors, product }
}

/**
 * Graded confidence multiplier in [0.55, 1.00] (typical range).
 * Each input contributes a multiplier; the product is the final confidence.
 *
 * Implementation delegates to `computeConfidenceBreakdown` so there's a
 * single source of truth for the per-factor math.
 */
export function computeConfidence(args: ConfidenceInputs): number {
  return computeConfidenceBreakdown(args).product
}
