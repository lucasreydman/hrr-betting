import { computeBatterFactor } from '../../lib/factors/batter'

describe('computeBatterFactor', () => {
  it('returns 1.0 (neutral) when Statcast is missing', () => {
    expect(computeBatterFactor({ statcast: null })).toBe(1)
  })

  it('elite contact profile (high barrel, hard-hit, xwOBA) lifts factor', () => {
    const f = computeBatterFactor({
      statcast: {
        batterId: 1,
        barrelPct: 0.16,
        hardHitPct: 0.55,
        xwOBA: 0.420,
        xISO: 0.260,
        avgExitVelo: 92,
      },
    })
    expect(f).toBeGreaterThan(1.0)
    expect(f).toBeLessThanOrEqual(1.05)
  })

  it('soft contact profile drops factor below 1.0', () => {
    const f = computeBatterFactor({
      statcast: {
        batterId: 2,
        barrelPct: 0.025,
        hardHitPct: 0.28,
        xwOBA: 0.260,
        xISO: 0.080,
        avgExitVelo: 84,
      },
    })
    expect(f).toBeLessThan(1.0)
    expect(f).toBeGreaterThanOrEqual(0.95)
  })

  it('clamps tightly at [0.95, 1.05] regardless of input', () => {
    const extreme = computeBatterFactor({
      statcast: {
        batterId: 3,
        barrelPct: 0.40,
        hardHitPct: 0.80,
        xwOBA: 0.500,
        xISO: 0.300,
        avgExitVelo: 95,
      },
    })
    expect(extreme).toBeLessThanOrEqual(1.05)
  })
})
