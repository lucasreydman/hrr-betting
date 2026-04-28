import { computePaCountFactor } from '../../lib/factors/pa-count'

describe('computePaCountFactor', () => {
  it('returns 1 for invalid slot (0)', () => {
    expect(computePaCountFactor({ probTypical: 0.5, slot: 0 })).toBe(1)
  })

  it('returns 1 for invalid slot (10)', () => {
    expect(computePaCountFactor({ probTypical: 0.5, slot: 10 })).toBe(1)
  })

  it('returns 1 for non-integer slot', () => {
    expect(computePaCountFactor({ probTypical: 0.5, slot: 1.5 })).toBe(1)
  })

  it('slot 1 (leadoff, most PAs) returns > 1 relative to slot 5 (baseline ≈ LG_PA_PER_GAME)', () => {
    const slot1 = computePaCountFactor({ probTypical: 0.5, slot: 1 })
    const slot5 = computePaCountFactor({ probTypical: 0.5, slot: 5 })
    expect(slot1).toBeGreaterThan(slot5)
    expect(slot1).toBeGreaterThan(1)
  })

  it('slot 9 (fewest PAs) returns < 1 relative to slot 5', () => {
    const slot9 = computePaCountFactor({ probTypical: 0.5, slot: 9 })
    const slot5 = computePaCountFactor({ probTypical: 0.5, slot: 5 })
    expect(slot9).toBeLessThan(slot5)
    expect(slot9).toBeLessThan(1)
  })

  it('slot 5 (≈ LG_PA_PER_GAME) is approximately 1', () => {
    // slot 5 = 4.20 PA = LG_PA_PER_GAME, so factor should be very close to 1
    const slot5 = computePaCountFactor({ probTypical: 0.5, slot: 5 })
    expect(slot5).toBeCloseTo(1, 4)
  })

  it('is monotonically decreasing from slot 1 to 9', () => {
    const factors = Array.from({ length: 9 }, (_, i) =>
      computePaCountFactor({ probTypical: 0.5, slot: i + 1 }),
    )
    for (let i = 0; i < factors.length - 1; i++) {
      expect(factors[i]).toBeGreaterThan(factors[i + 1])
    }
  })

  it('is clamped at [0.85, 1.15]', () => {
    for (let slot = 1; slot <= 9; slot++) {
      const f = computePaCountFactor({ probTypical: 0.99, slot })
      expect(f).toBeGreaterThanOrEqual(0.85)
      expect(f).toBeLessThanOrEqual(1.15)
    }
  })
})
