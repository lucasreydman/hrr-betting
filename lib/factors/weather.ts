/**
 * HRR-scaled weather factor. Wraps the HR-only multiplier from lib/weather-factors.
 * HRR is a dampened version of HR (most HRR comes from singles which weather barely
 * affects). Empirical dampener 0.6 grounded in published research.
 * Domes/failures short-circuit to 1.0.
 *
 * Bounded [0.85, 1.20].
 */
export function computeWeatherFactor(args: {
  hrMult: number
  controlled: boolean
  failure: boolean
}): number {
  if (args.controlled || args.failure) return 1
  const factor = 1 + 0.6 * (args.hrMult - 1)
  return Math.min(1.20, Math.max(0.85, factor))
}
