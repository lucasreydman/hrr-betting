import { computeProbToday, computeProbTodayWithBreakdown } from '@/lib/prob-today'
import { computeTtoFactor } from '@/lib/factors/tto'

describe('computeProbToday', () => {
  const baseInputs = {
    probTypical: 0.65,
    pitcher: { id: 0, kPct: 0, bbPct: 0, hrPct: 0, hardHitRate: 0, bf: 0, recentStarts: 0 },
    venueId: 0,
    batterHand: 'R' as const,
    weather: { hrMult: 1.0, controlled: true, failure: false },
    bullpen: null,
    lineupSlot: 5,
    bvp: null,
    batterStatcast: null,
  }

  // TTO is a constant ~1.08 multiplier applied uniformly. Hardcoded here so
  // expected values below stay exact even if the upstream constants ever
  // shift slightly.
  const TTO = computeTtoFactor()

  it('returns probTypical × handedness × tto with all-neutral inputs', () => {
    // batterHand R vs pitcherThrows R (same-side) → handedness factor = 0.97;
    // TTO factor ≈ 1.08 always applied; everything else 1.0.
    // Odds composition: oddsTypical = 0.65/0.35; oddsToday = oddsTypical × 0.97 × TTO;
    // probToday = oddsToday / (1 + oddsToday).
    const today = computeProbToday(baseInputs)
    const oddsTypical = 0.65 / 0.35
    const factorProduct = 0.97 * TTO
    const oddsToday = oddsTypical * factorProduct
    const expected = oddsToday / (1 + oddsToday)
    expect(today).toBeCloseTo(expected, 4)
  })

  it('switch hitter (handedness 1.0) returns probTypical × tto', () => {
    const today = computeProbToday({ ...baseInputs, batterHand: 'S' })
    const oddsTypical = 0.65 / 0.35
    const oddsToday = oddsTypical * TTO
    const expected = oddsToday / (1 + oddsToday)
    expect(today).toBeCloseTo(expected, 4)
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

  it('breakdown includes all 9 named factors', () => {
    const result = computeProbTodayWithBreakdown(baseInputs)
    expect(Object.keys(result.factors).sort()).toEqual(
      [
        'batter',
        'bullpen',
        'bvp',
        'handedness',
        'paCount',
        'park',
        'pitcher',
        'tto',
        'weather',
      ],
    )
  })

  it('positive BvP record nudges probToday up', () => {
    const noBvp = computeProbToday(baseInputs)
    const withGoodBvP = computeProbToday({
      ...baseInputs,
      bvp: { ab: 30, hits: 14, '1B': 8, '2B': 3, '3B': 0, HR: 3, BB: 4, K: 5 },
    })
    expect(withGoodBvP).toBeGreaterThan(noBvp)
  })

  it('hot batter Statcast nudges probToday up vs no Statcast', () => {
    const noSc = computeProbToday(baseInputs)
    const withHotSc = computeProbToday({
      ...baseInputs,
      batterStatcast: {
        batterId: 1,
        barrelPct: 0.16,
        hardHitPct: 0.55,
        xwOBA: 0.420,
        xISO: 0.250,
        avgExitVelo: 92,
      },
    })
    expect(withHotSc).toBeGreaterThan(noSc)
  })
})
