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

  it('returns ≈ probTypical with all neutral inputs (odds-ratio composition)', () => {
    // batterHand R vs pitcherThrows R (same-side) → handedness factor = 0.97;
    // all other factors are 1.0 for these neutral inputs.
    // Odds composition: oddsTypical = 0.65/0.35 ≈ 1.857; oddsToday = 1.857 × 0.97 ≈ 1.802;
    // probToday = 1.802 / 2.802 ≈ 0.6431
    const today = computeProbToday(baseInputs)
    expect(today).toBeCloseTo(0.643, 2)
  })

  it('factor product of 1.0 (truly neutral) returns probTypical exactly', () => {
    // S (switch hitter) makes handedness factor 1.0 across the board.
    const today = computeProbToday({ ...baseInputs, batterHand: 'S' })
    expect(today).toBeCloseTo(baseInputs.probTypical, 5)
  })

  it('boost factor lifts probability but never to 1.0', () => {
    // Force a large factor product via an extreme pitcher to exercise the bound.
    const today = computeProbToday({
      ...baseInputs,
      probTypical: 0.7,
      pitcher: {
        id: 1, kPct: 0.05, bbPct: 0.20, hrPct: 0.10, hardHitRate: 0.55,
        bf: 1000, recentStarts: 30,
      },
    })
    // probTypical 0.7 with a strong-positive matchup → boosted but bounded;
    // odds-ratio composition keeps it well below 1.0 even when factors compound.
    expect(today).toBeGreaterThan(baseInputs.probTypical)
    expect(today).toBeLessThan(0.95)
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
    // Same odds-composition expectation as the first test (0.65 → 0.643 with handedness 0.97).
    expect(result.probToday).toBeCloseTo(0.643, 2)
  })
})
