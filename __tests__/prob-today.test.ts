import { computeProbToday, computeProbTodayWithBreakdown } from '@/lib/prob-today'

describe('computeProbToday', () => {
  const baseInputs = {
    probTypical: 0.65,
    pitcher: { id: 0, kPct: 0, bbPct: 0, hrPct: 0, hardHitRate: 0, bf: 0, recentStarts: 0 },
    venueId: 0,
    batterHand: 'R' as const,
    weather: { hrMult: 1.0, controlled: true, failure: false },
    bullpen: null,
    lineupSlot: 5,
  }

  it('returns ≈ probTypical with all neutral inputs', () => {
    // batterHand R vs pitcherThrows R (same-side) → handedness factor = 0.97
    // 0.65 × 0.97 = 0.6305; all other factors are 1.0 for these neutral inputs
    const today = computeProbToday(baseInputs)
    expect(today).toBeCloseTo(0.6305, 3)
  })

  it('clamps to [0.001, 0.999]', () => {
    const tooHigh = computeProbToday({ ...baseInputs, probTypical: 1.5 })
    expect(tooHigh).toBeLessThanOrEqual(0.999)
    const tooLow = computeProbToday({ ...baseInputs, probTypical: -0.5 })
    expect(tooLow).toBeGreaterThanOrEqual(0.001)
  })

  it('elite pitcher reduces probToday meaningfully', () => {
    const today = computeProbToday({
      ...baseInputs,
      pitcher: { id: 1, kPct: 0.32, bbPct: 0.05, hrPct: 0.02, hardHitRate: 0.30, bf: 800, recentStarts: 25 },
    })
    expect(today).toBeLessThan(baseInputs.probTypical)
  })

  it('breakdown includes all 6 named factors', () => {
    const result = computeProbTodayWithBreakdown(baseInputs)
    expect(Object.keys(result.factors).sort()).toEqual(
      ['bullpen', 'handedness', 'paCount', 'park', 'pitcher', 'weather'],
    )
    expect(result.probToday).toBeCloseTo(0.6305, 3)
  })
})
