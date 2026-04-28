import { computeParkFactor } from '../../lib/factors/park'

describe('computeParkFactor', () => {
  it('unknown venue returns 1.0 (neutral)', () => {
    expect(computeParkFactor({ venueId: 99999, batterHand: 'R' })).toBe(1)
    expect(computeParkFactor({ venueId: 0, batterHand: 'L' })).toBe(1)
  })

  it('output is always in [0.7, 1.3] for known venues', () => {
    // venueId 1 = Angel Stadium, venueId 19 = Coors Field (extreme)
    const knownVenues = [1, 2, 3, 4, 5, 7, 10, 12, 14, 15, 17, 19, 22, 31, 32]
    const hands = ['R', 'L', 'S'] as const
    for (const venueId of knownVenues) {
      for (const batterHand of hands) {
        const f = computeParkFactor({ venueId, batterHand })
        expect(f).toBeGreaterThanOrEqual(0.7)
        expect(f).toBeLessThanOrEqual(1.3)
      }
    }
  })

  it('switch hitter returns average of L and R factors (not wildly different)', () => {
    const fR = computeParkFactor({ venueId: 19, batterHand: 'R' }) // Coors
    const fL = computeParkFactor({ venueId: 19, batterHand: 'L' })
    const fS = computeParkFactor({ venueId: 19, batterHand: 'S' })
    // Switch hitter should be between L and R
    expect(fS).toBeGreaterThanOrEqual(Math.min(fR, fL) - 0.01)
    expect(fS).toBeLessThanOrEqual(Math.max(fR, fL) + 0.01)
  })

  it('Coors Field (pitcher-unfriendly) returns > 1 for most hands', () => {
    expect(computeParkFactor({ venueId: 19, batterHand: 'R' })).toBeGreaterThan(1)
    expect(computeParkFactor({ venueId: 19, batterHand: 'L' })).toBeGreaterThan(1)
  })

  it('Petco Park (pitcher-friendly) returns < 1', () => {
    // venueId 2680 = Petco Park — known suppressor
    expect(computeParkFactor({ venueId: 2680, batterHand: 'R' })).toBeLessThan(1)
    expect(computeParkFactor({ venueId: 2680, batterHand: 'L' })).toBeLessThan(1)
  })
})
