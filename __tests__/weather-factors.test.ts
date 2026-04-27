import { computeWeatherFactors, neutralWeather, compassPoint } from '@/lib/weather-factors'
import type { WeatherData } from '@/lib/types'

const calm70: WeatherData = {
  tempF: 70, windSpeedMph: 0, windFromDegrees: 0, controlled: false, failure: false,
}

// Yankee Stadium — outfield faces NNE (~25°)
const YS_OUT_DEG = 25

describe('neutralWeather', () => {
  test('returns 1.00 for every outcome', () => {
    const f = neutralWeather()
    expect(f).toEqual({ '1B': 1, '2B': 1, '3B': 1, HR: 1, BB: 1, K: 1, OUT: 1 })
  })
})

describe('computeWeatherFactors — domes & failures', () => {
  test('controlled (dome) → all neutral, neutralReason=controlled', () => {
    const r = computeWeatherFactors({
      weather: { ...calm70, tempF: 90, windSpeedMph: 30, windFromDegrees: 200, controlled: true },
      outfieldFacingDegrees: 0,
    })
    expect(r.factors).toEqual(neutralWeather())
    expect(r.outComponentMph).toBe(0)
    expect(r.hrMult).toBe(1)
    expect(r.neutralReason).toBe('controlled')
  })

  test('fetch failure → all neutral, neutralReason=fetch-failed', () => {
    const r = computeWeatherFactors({
      weather: { ...calm70, failure: true },
      outfieldFacingDegrees: 0,
    })
    expect(r.factors).toEqual(neutralWeather())
    expect(r.hrMult).toBe(1)
    expect(r.neutralReason).toBe('fetch-failed')
  })
})

describe('computeWeatherFactors — temperature', () => {
  test('70°F + calm → all 1.00', () => {
    const r = computeWeatherFactors({ weather: calm70, outfieldFacingDegrees: YS_OUT_DEG })
    expect(r.hrMult).toBeCloseTo(1.0, 5)
    expect(r.factors['2B']).toBeCloseTo(1.0, 5)
    expect(r.factors['3B']).toBeCloseTo(1.0, 5)
    expect(r.outComponentMph).toBe(0)
  })

  test('cold (50°F) + calm → HR slightly suppressed', () => {
    const r = computeWeatherFactors({
      weather: { ...calm70, tempF: 50 },
      outfieldFacingDegrees: YS_OUT_DEG,
    })
    // 1 + 0.015 * (50-70)/10 = 1 + 0.015 * -2 = 0.97
    expect(r.hrMult).toBeCloseTo(0.97, 4)
  })

  test('hot (90°F) + calm → HR slightly boosted', () => {
    const r = computeWeatherFactors({
      weather: { ...calm70, tempF: 90 },
      outfieldFacingDegrees: YS_OUT_DEG,
    })
    expect(r.hrMult).toBeCloseTo(1.03, 4)
  })

  test('1B / BB / K / OUT are unaffected by temperature', () => {
    const r = computeWeatherFactors({
      weather: { ...calm70, tempF: 95 },
      outfieldFacingDegrees: 0,
    })
    expect(r.factors['1B']).toBe(1)
    expect(r.factors.BB).toBe(1)
    expect(r.factors.K).toBe(1)
    expect(r.factors.OUT).toBe(1)
  })
})

describe('computeWeatherFactors — wind direction', () => {
  // Yankee Stadium: outfield faces 25° (NNE).
  // Wind blowing FROM 25° (NNE) → blowing IN toward home (suppresses HR)
  // Wind blowing FROM 205° (SSW = 25 + 180) → blowing OUT toward CF (boosts HR)
  // Wind blowing FROM 115° (E-ish, perpendicular) → crosswind, ~zero out-component

  test('wind blowing IN at 10 mph → suppresses HR (negative out-component)', () => {
    const r = computeWeatherFactors({
      weather: { ...calm70, windSpeedMph: 10, windFromDegrees: 25 },  // FROM outfield → INTO home
      outfieldFacingDegrees: 25,
    })
    expect(r.outComponentMph).toBeCloseTo(-10, 1)
    // 0.02 * -10 = -0.20 effect, HR mult = 1 * (1 - 0.20) = 0.80
    expect(r.hrMult).toBeCloseTo(0.80, 4)
  })

  test('wind blowing OUT at 10 mph → boosts HR (positive out-component)', () => {
    const r = computeWeatherFactors({
      weather: { ...calm70, windSpeedMph: 10, windFromDegrees: 205 },  // FROM home → toward CF
      outfieldFacingDegrees: 25,
    })
    expect(r.outComponentMph).toBeCloseTo(10, 1)
    expect(r.hrMult).toBeCloseTo(1.20, 4)
  })

  test('crosswind (perpendicular) at 10 mph → ~no HR effect', () => {
    const r = computeWeatherFactors({
      weather: { ...calm70, windSpeedMph: 10, windFromDegrees: 115 },  // 90° off outfield axis
      outfieldFacingDegrees: 25,
    })
    expect(Math.abs(r.outComponentMph)).toBeLessThan(0.5)
    expect(r.hrMult).toBeCloseTo(1.0, 2)
  })

  test('wind effect is clamped at ±25%', () => {
    const huge = computeWeatherFactors({
      weather: { ...calm70, windSpeedMph: 50, windFromDegrees: 205 },  // 50 mph straight out
      outfieldFacingDegrees: 25,
    })
    // Raw 0.02 * 50 = 1.0 effect → would be 2.0× HR; clamp brings windHrEffect to +0.25
    // Then HR = 1 * 1.25 = 1.25, well under the 1.40 outer clamp
    expect(huge.hrMult).toBeCloseTo(1.25, 4)

    const hugeIn = computeWeatherFactors({
      weather: { ...calm70, windSpeedMph: 50, windFromDegrees: 25 },
      outfieldFacingDegrees: 25,
    })
    expect(hugeIn.hrMult).toBeCloseTo(0.75, 4)
  })
})

describe('computeWeatherFactors — composed temp + wind', () => {
  test('hot day with wind blowing out compounds (Wrigley summer)', () => {
    // 90°F (+3% temp) × wind out 10 mph (+20% wind) = 1.03 × 1.20 ≈ 1.236
    const r = computeWeatherFactors({
      weather: { ...calm70, tempF: 90, windSpeedMph: 10, windFromDegrees: 173 },
      // Wrigley outfield bearing 353° → 173° is opposite (wind from home → out)
      outfieldFacingDegrees: 353,
    })
    expect(r.outComponentMph).toBeGreaterThan(9)
    expect(r.hrMult).toBeCloseTo(1.236, 2)
  })

  test('outer HR clamp prevents extreme combinations from blowing past 1.40', () => {
    // 110°F (impossible but tests clamp) + wind out
    const r = computeWeatherFactors({
      weather: { ...calm70, tempF: 110, windSpeedMph: 30, windFromDegrees: 205 },
      outfieldFacingDegrees: 25,
    })
    expect(r.hrMult).toBeLessThanOrEqual(1.40 + 1e-9)
  })

  test('outer HR clamp prevents extreme cold + wind-in from going below 0.65', () => {
    const r = computeWeatherFactors({
      weather: { ...calm70, tempF: 20, windSpeedMph: 30, windFromDegrees: 25 },
      outfieldFacingDegrees: 25,
    })
    expect(r.hrMult).toBeGreaterThanOrEqual(0.65 - 1e-9)
  })
})

describe('compassPoint', () => {
  test('cardinal directions map correctly', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(90)).toBe('E')
    expect(compassPoint(180)).toBe('S')
    expect(compassPoint(270)).toBe('W')
  })

  test('intercardinal directions map correctly', () => {
    expect(compassPoint(45)).toBe('NE')
    expect(compassPoint(135)).toBe('SE')
    expect(compassPoint(225)).toBe('SW')
    expect(compassPoint(315)).toBe('NW')
  })

  test('handles wrap-around (360 → N)', () => {
    expect(compassPoint(360)).toBe('N')
    expect(compassPoint(720)).toBe('N')
    expect(compassPoint(-1)).toBe('N')  // (((-1 % 360) + 360) % 360) = 359 → N
  })

  test('fine-grained 16-point labels', () => {
    expect(compassPoint(22.5)).toBe('NNE')
    expect(compassPoint(112.5)).toBe('ESE')
    expect(compassPoint(337.5)).toBe('NNW')
  })
})
