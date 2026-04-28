import { computeHandednessFactor } from '../../lib/factors/handedness'

describe('computeHandednessFactor', () => {
  it('switch hitter always returns 1.00 regardless of pitcher', () => {
    expect(computeHandednessFactor({ batterHand: 'S', pitcherThrows: 'R' })).toBe(1.00)
    expect(computeHandednessFactor({ batterHand: 'S', pitcherThrows: 'L' })).toBe(1.00)
    expect(computeHandednessFactor({ batterHand: 'S', pitcherThrows: 'S' })).toBe(1.00)
  })

  it('same-side matchup returns 0.97 (platoon disadvantage)', () => {
    expect(computeHandednessFactor({ batterHand: 'R', pitcherThrows: 'R' })).toBe(0.97)
    expect(computeHandednessFactor({ batterHand: 'L', pitcherThrows: 'L' })).toBe(0.97)
  })

  it('opposite-side matchup returns 1.03 (platoon advantage)', () => {
    expect(computeHandednessFactor({ batterHand: 'R', pitcherThrows: 'L' })).toBe(1.03)
    expect(computeHandednessFactor({ batterHand: 'L', pitcherThrows: 'R' })).toBe(1.03)
  })
})
