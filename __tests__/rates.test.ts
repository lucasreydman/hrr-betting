import { blendRates, applyHandedness } from '@/lib/rates'

describe('blendRates', () => {
  test('produces weighted average of three time windows', () => {
    const result = blendRates({
      season: { '1B': 0.150, '2B': 0.045, '3B': 0.005, HR: 0.040, BB: 0.090, K: 0.220, OUT: 0.450 },
      l30:    { '1B': 0.140, '2B': 0.050, '3B': 0.005, HR: 0.060, BB: 0.100, K: 0.200, OUT: 0.445 },
      l15:    { '1B': 0.130, '2B': 0.055, '3B': 0.005, HR: 0.080, BB: 0.110, K: 0.180, OUT: 0.440 },
      weights: { season: 0.5, l30: 0.3, l15: 0.2 },
    })
    expect(result.HR).toBeCloseTo(0.054, 3)  // 0.5*0.040 + 0.3*0.060 + 0.2*0.080
    const sum = Object.values(result).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 6)
  })

  test('weights normalize automatically if they do not sum to 1', () => {
    const result = blendRates({
      season: { '1B': 0.143, '2B': 0.045, '3B': 0.005, HR: 0.030, BB: 0.085, K: 0.225, OUT: 0.467 },
      l30:    { '1B': 0.143, '2B': 0.045, '3B': 0.005, HR: 0.030, BB: 0.085, K: 0.225, OUT: 0.467 },
      l15:    { '1B': 0.143, '2B': 0.045, '3B': 0.005, HR: 0.030, BB: 0.085, K: 0.225, OUT: 0.467 },
      weights: { season: 1, l30: 1, l15: 1 },  // sums to 3
    })
    // Identical inputs → result should match (regardless of weight scale)
    expect(result.HR).toBeCloseTo(0.030, 6)
  })
})

describe('applyHandedness', () => {
  const seasonByHand = {
    vsR: { '1B': 0.150, '2B': 0.045, '3B': 0.005, HR: 0.030, BB: 0.090, K: 0.220, OUT: 0.460 },
    vsL: { '1B': 0.155, '2B': 0.050, '3B': 0.005, HR: 0.050, BB: 0.080, K: 0.200, OUT: 0.460 },
  }

  test('picks vsR rates when batter faces RHP', () => {
    expect(applyHandedness(seasonByHand, 'R').HR).toBe(0.030)
  })

  test('picks vsL rates when batter faces LHP', () => {
    expect(applyHandedness(seasonByHand, 'L').HR).toBe(0.050)
  })

  test('switch pitcher (S) blends both sides', () => {
    const result = applyHandedness(seasonByHand, 'S')
    // Should be between the vsR HR rate (0.030) and vsL HR rate (0.050)
    expect(result.HR).toBeGreaterThan(0.030)
    expect(result.HR).toBeLessThan(0.050)
  })
})
