import { computeWeatherFactor } from '../../lib/factors/weather'

describe('computeWeatherFactor', () => {
  it('returns 1 for controlled (dome) regardless of hrMult', () => {
    expect(computeWeatherFactor({ hrMult: 1.40, controlled: true, failure: false })).toBe(1)
    expect(computeWeatherFactor({ hrMult: 0.65, controlled: true, failure: false })).toBe(1)
  })

  it('returns 1 for fetch failure regardless of hrMult', () => {
    expect(computeWeatherFactor({ hrMult: 1.40, controlled: false, failure: true })).toBe(1)
    expect(computeWeatherFactor({ hrMult: 0.65, controlled: false, failure: true })).toBe(1)
  })

  it('neutral hrMult 1.0 → factor 1.0', () => {
    expect(computeWeatherFactor({ hrMult: 1.0, controlled: false, failure: false })).toBeCloseTo(1.0)
  })

  it('applies 0.6 dampener: hrMult 1.20 → factor 1.12 (not 1.20)', () => {
    // factor = 1 + 0.6 × (1.20 - 1) = 1 + 0.6 × 0.20 = 1.12
    expect(computeWeatherFactor({ hrMult: 1.20, controlled: false, failure: false })).toBeCloseTo(1.12)
  })

  it('applies 0.6 dampener: hrMult 0.80 → factor 0.88', () => {
    // factor = 1 + 0.6 × (0.80 - 1) = 1 - 0.12 = 0.88
    expect(computeWeatherFactor({ hrMult: 0.80, controlled: false, failure: false })).toBeCloseTo(0.88)
  })

  it('clamps at upper bound 1.20', () => {
    // hrMult = 1.40 → raw = 1 + 0.6×0.40 = 1.24 → clamped to 1.20
    expect(computeWeatherFactor({ hrMult: 1.40, controlled: false, failure: false })).toBe(1.20)
  })

  it('clamps at lower bound 0.85', () => {
    // hrMult = 0.60 → raw = 1 + 0.6×(−0.40) = 0.76 → clamped to 0.85
    expect(computeWeatherFactor({ hrMult: 0.60, controlled: false, failure: false })).toBe(0.85)
  })

  it('output is always in [0.85, 1.20]', () => {
    const testCases = [0.5, 0.65, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4]
    for (const hrMult of testCases) {
      const f = computeWeatherFactor({ hrMult, controlled: false, failure: false })
      expect(f).toBeGreaterThanOrEqual(0.85)
      expect(f).toBeLessThanOrEqual(1.20)
    }
  })
})
