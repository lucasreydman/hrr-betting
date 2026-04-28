import { computeBullpenFactor } from '../../lib/factors/bullpen'
import { LG_BULLPEN_ERA } from '../../lib/constants'
import type { BullpenEraStats } from '../../lib/bullpen'

describe('computeBullpenFactor', () => {
  it('null bullpen returns 1.0', () => {
    expect(computeBullpenFactor({ bullpen: null, lineupSlot: 3 })).toBe(1)
  })

  it('invalid lineup slot falls back to slot 5', () => {
    const bullpen: BullpenEraStats = { era: 5.0, ip: 300 }
    const resultInvalid = computeBullpenFactor({ bullpen, lineupSlot: 0 })
    const resultSlot5 = computeBullpenFactor({ bullpen, lineupSlot: 5 })
    expect(resultInvalid).toBeCloseTo(resultSlot5)
  })

  it('league-average bullpen returns ~1.0', () => {
    const bullpen: BullpenEraStats = { era: LG_BULLPEN_ERA, ip: 500 }
    const f = computeBullpenFactor({ bullpen, lineupSlot: 5 })
    expect(f).toBeCloseTo(1.0, 4)
  })

  it('low-sample IP is heavily shrunk toward 1.0', () => {
    // With ip=10 (much less than STABILIZATION_BULLPEN_IP=150), ERA=6.0 gets shrunk
    const bullpen: BullpenEraStats = { era: 6.0, ip: 10 }
    const f = computeBullpenFactor({ bullpen, lineupSlot: 5 })
    // Should be much closer to 1.0 than a full-sample bad bullpen
    expect(Math.abs(f - 1)).toBeLessThan(0.05)
  })

  it('poor bullpen (high ERA) → factor > 1 (favours hitter)', () => {
    const bullpen: BullpenEraStats = { era: 6.0, ip: 400 }
    const f = computeBullpenFactor({ bullpen, lineupSlot: 5 })
    expect(f).toBeGreaterThan(1)
  })

  it('elite bullpen (low ERA) → factor < 1 (hurts hitter)', () => {
    const bullpen: BullpenEraStats = { era: 2.5, ip: 400 }
    const f = computeBullpenFactor({ bullpen, lineupSlot: 5 })
    expect(f).toBeLessThan(1)
  })

  it('top-of-order (slot 1) has smaller effect than bottom-of-order (slot 9)', () => {
    // Slot 1 has lower paShareVsBullpen (0.18) than slot 9 (0.30)
    const poorBullpen: BullpenEraStats = { era: 6.0, ip: 400 }
    const slot1 = computeBullpenFactor({ bullpen: poorBullpen, lineupSlot: 1 })
    const slot9 = computeBullpenFactor({ bullpen: poorBullpen, lineupSlot: 9 })
    // Slot 9 sees more bullpen exposure → larger positive deviation from 1.0
    expect(slot9).toBeGreaterThan(slot1)
    // Both still > 1 (poor bullpen)
    expect(slot1).toBeGreaterThan(1)
  })

  it('output is always in [0.85, 1.15]', () => {
    const extremes: BullpenEraStats[] = [
      { era: 0.5, ip: 1000 },   // impossibly elite
      { era: 9.0, ip: 1000 },   // impossibly bad
    ]
    for (const bullpen of extremes) {
      for (let slot = 1; slot <= 9; slot++) {
        const f = computeBullpenFactor({ bullpen, lineupSlot: slot })
        expect(f).toBeGreaterThanOrEqual(0.85)
        expect(f).toBeLessThanOrEqual(1.15)
      }
    }
  })
})
