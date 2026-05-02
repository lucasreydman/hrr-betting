/**
 * lib/weather-factors.ts
 *
 * Pure math: turn observed weather (temp, wind speed, wind direction) plus
 * the stadium's outfield bearing into a per-outcome multiplier map.
 *
 * Magnitudes are grounded in published research:
 *  - Alan Nathan, "The effect of temperature on the carry of a fly ball"
 *    (~3 ft per 10°F, ~1–2 % HR rate per 10°F).
 *  - Kovalchik et al., wind-effect papers (HR rate sensitive to wind speed
 *    along the home → CF axis at roughly 1.5–2.5 % per mph).
 *
 * Formulas here are starting-point estimates. The constants
 * (TEMP_HR_PER_10F, WIND_HR_PER_MPH, the clamps) are calibration targets
 * and should be tuned via scripts/recalibrate.ts once enough settled
 * history is available.
 */

import type { Outcome, WeatherData } from './types'

/** ~1.5% HR rate per 10°F above 70°F baseline. */
const TEMP_HR_PER_10F = 0.015
/** ~2% HR rate per mph along the home → CF axis. */
const WIND_HR_PER_MPH = 0.02
/** Hard cap on the wind-only effect. */
const WIND_HR_CLAMP = 0.25
/** Hard cap on the *combined* HR multiplier so a 110°F + 20mph-out reading
 *  can't blow past +40 % and produce nonsense. */
const HR_MULT_MIN = 0.65
const HR_MULT_MAX = 1.40

/** Neutral 7-outcome map; used for domes/retractables and failed fetches. */
export function neutralWeather(): Record<Outcome, number> {
  return { '1B': 1, '2B': 1, '3B': 1, HR: 1, BB: 1, K: 1, OUT: 1 }
}

export interface WeatherFactorsResult {
  /** 7-outcome multiplier map. Currently unused at request time (the
   *  closed-form path consumes `hrMult` directly via `lib/factors/weather.ts`)
   *  but kept available for any per-PA consumer that may be reintroduced. */
  factors: Record<Outcome, number>
  /**
   * Signed wind-speed component along the home → CF axis, in mph.
   * Positive = blowing OUT (toward the outfield, helps HR).
   * Negative = blowing IN (toward home plate, suppresses HR).
   * Zero for crosswinds, domes, and failed fetches.
   */
  outComponentMph: number
  /** Convenience: just the HR multiplier. Domes/failures = 1.0. */
  hrMult: number
  /** Reason the factors are neutral, when they are. */
  neutralReason?: 'controlled' | 'fetch-failed'
}

/**
 * Compute per-outcome weather multipliers for a single game.
 *
 *   tempHrMult     = 1 + 0.015 × (tempF − 70) / 10           // ~1.5% per 10°F
 *   outMph         = −cos(windFromDeg − outfieldFacingDeg) × windSpeedMph
 *                    // signed: + = blowing out, − = blowing in
 *   windHrEffect   = clamp(0.02 × outMph, −0.25, 0.25)       // ~2%/mph, ±25% cap
 *   HR             = clamp(tempHrMult × (1 + windHrEffect), 0.65, 1.40)
 *   2B             = 1 + 0.005 × (tempF − 70) / 10           // tiny carry on liners
 *   3B             = 1 + 0.010 × (tempF − 70) / 10           // slight carry
 *   1B / BB / K / OUT = 1.00
 *
 * Domes and retractable-roof games return neutral 1.00 across the board.
 * Failed fetches do the same — never make weather penalise a pick when the
 * data is missing.
 */
export function computeWeatherFactors(args: {
  weather: WeatherData
  outfieldFacingDegrees: number
}): WeatherFactorsResult {
  const { weather, outfieldFacingDegrees } = args

  if (weather.controlled) {
    return { factors: neutralWeather(), outComponentMph: 0, hrMult: 1, neutralReason: 'controlled' }
  }
  if (weather.failure) {
    return { factors: neutralWeather(), outComponentMph: 0, hrMult: 1, neutralReason: 'fetch-failed' }
  }

  // Temperature delta in 10°F units, so the constants read as "per 10°F".
  const tempDelta10 = (weather.tempF - 70) / 10
  const tempHrMult = 1 + TEMP_HR_PER_10F * tempDelta10

  // Wind: project the wind vector onto the home → CF axis.
  //  - `outfieldFacingDegrees` is the compass bearing the OUTFIELD points to
  //    (i.e. the home → CF direction).
  //  - Open-Meteo's `wind_direction_10m` is the bearing the wind is coming FROM.
  //  - When θ = (windFromDeg − outfieldFacingDeg) is 0°, wind blows from the
  //    outfield TOWARD home → blowing IN → cos(0) = +1 → use −cos so this is
  //    a *negative* out-component. When θ = 180°, wind blows from home toward
  //    the outfield → blowing OUT → cos(180°) = −1 → −cos = +1 → positive
  //    out-component. ✓
  const angleDeg = weather.windFromDegrees - outfieldFacingDegrees
  const angleRad = (angleDeg * Math.PI) / 180
  const outComponentMph = -Math.cos(angleRad) * weather.windSpeedMph

  const rawWindHrEffect = WIND_HR_PER_MPH * outComponentMph
  const windHrEffect = Math.max(-WIND_HR_CLAMP, Math.min(WIND_HR_CLAMP, rawWindHrEffect))

  const rawHrMult = tempHrMult * (1 + windHrEffect)
  const hrMult = Math.max(HR_MULT_MIN, Math.min(HR_MULT_MAX, rawHrMult))

  // Normalise -0 to +0 (JS produces -0 from `-cos(...) * 0` on calm winds);
  // consumers shouldn't have to know about it.
  const outRounded = (Math.round(outComponentMph * 10) / 10) || 0

  return {
    factors: {
      '1B': 1.0,
      '2B': 1 + 0.005 * tempDelta10,
      '3B': 1 + 0.010 * tempDelta10,
      HR:   hrMult,
      BB:   1.0,
      K:    1.0,
      OUT:  1.0,
    },
    outComponentMph: outRounded,
    hrMult,
  }
}

/**
 * Convert a compass bearing (0–360°, clockwise from N) to a 16-point label.
 * Used for "Wind from NNW" UI strings; not part of the math pipeline.
 */
export function compassPoint(deg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const normalized = ((deg % 360) + 360) % 360
  const idx = Math.round(normalized / 22.5) % 16
  return points[idx]
}
