import { computeBvpFactor } from '../../lib/factors/bvp'

describe('computeBvpFactor', () => {
  it('returns 1.0 (neutral) for null record', () => {
    expect(computeBvpFactor({ bvp: null })).toBe(1)
  })

  it('returns 1.0 for very small samples (AB < 5)', () => {
    expect(
      computeBvpFactor({
        bvp: { ab: 3, hits: 2, '1B': 2, '2B': 0, '3B': 0, HR: 0, BB: 0, K: 1 },
      }),
    ).toBe(1)
  })

  it('strong career line (50 AB, .350 / 5 HR) lifts factor above 1.0', () => {
    const f = computeBvpFactor({
      bvp: { ab: 50, hits: 17, '1B': 8, '2B': 4, '3B': 0, HR: 5, BB: 6, K: 8 },
    })
    expect(f).toBeGreaterThan(1.0)
    expect(f).toBeLessThanOrEqual(1.10)
  })

  it('weak career line (50 AB, .120, no power) drops below 1.0', () => {
    const f = computeBvpFactor({
      bvp: { ab: 50, hits: 6, '1B': 5, '2B': 1, '3B': 0, HR: 0, BB: 2, K: 18 },
    })
    expect(f).toBeLessThan(1.0)
    expect(f).toBeGreaterThanOrEqual(0.90)
  })

  it('clamps at the bounds [0.90, 1.10] even for extreme small samples', () => {
    // 6 AB, all HRs → would otherwise blow past the bound; shrinkage + clamp
    // protect.
    const f = computeBvpFactor({
      bvp: { ab: 6, hits: 6, '1B': 0, '2B': 0, '3B': 0, HR: 6, BB: 0, K: 0 },
    })
    expect(f).toBeGreaterThanOrEqual(0.90)
    expect(f).toBeLessThanOrEqual(1.10)
  })
})
