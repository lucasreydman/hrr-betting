import { stabilize, stabilizeRates } from '@/lib/stabilization'
import { STABILIZATION_PA } from '@/lib/constants'

describe('stabilize', () => {
  test('with PA = stabilization point, weight is 0.5 toward prior', () => {
    const result = stabilize({ observed: 0.05, sampleSize: STABILIZATION_PA.hr, prior: 0.03, statKey: 'hr' })
    expect(result).toBeCloseTo(0.04, 3)
  })

  test('with PA >> stabilization point, almost no shrinkage', () => {
    const result = stabilize({ observed: 0.05, sampleSize: 1700, prior: 0.03, statKey: 'hr' })
    expect(result).toBeGreaterThan(0.045)
    expect(result).toBeLessThan(0.05)
  })

  test('with zero PA, fully shrinks to prior', () => {
    const result = stabilize({ observed: 0.05, sampleSize: 0, prior: 0.03, statKey: 'hr' })
    expect(result).toBeCloseTo(0.03, 5)
  })

  test('preserves true skill differences between elite and average', () => {
    const elite = stabilize({ observed: 0.075, sampleSize: 600, prior: 0.065, statKey: 'hr' })
    const avg = stabilize({ observed: 0.030, sampleSize: 600, prior: 0.030, statKey: 'hr' })
    expect(elite).toBeGreaterThan(avg + 0.030)
  })

  test('throws on unknown statKey', () => {
    expect(() => stabilize({ observed: 0.5, sampleSize: 100, prior: 0.5, statKey: 'unknown' }))
      .toThrow(/Unknown statKey/)
  })
})

describe('stabilizeRates', () => {
  test('normalizes 7 outcome rates after stabilization to sum 1', () => {
    const rates = { '1B': 0.15, '2B': 0.05, '3B': 0.005, HR: 0.04, BB: 0.10, K: 0.20, OUT: 0.455 }
    const careerPrior = { '1B': 0.143, '2B': 0.045, '3B': 0.005, HR: 0.030, BB: 0.085, K: 0.225, OUT: 0.467 }
    const result = stabilizeRates(rates, careerPrior, 400)
    const sum = Object.values(result).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 6)
    // Each outcome should still be present
    expect(result.HR).toBeGreaterThan(0)
    expect(result.K).toBeGreaterThan(0)
  })

  test('uses prior when career prior provided', () => {
    const rates = { '1B': 0.10, '2B': 0.05, '3B': 0.005, HR: 0.10, BB: 0.10, K: 0.20, OUT: 0.445 }
    const prior = { '1B': 0.143, '2B': 0.045, '3B': 0.005, HR: 0.030, BB: 0.085, K: 0.225, OUT: 0.467 }
    const result = stabilizeRates(rates, prior, 50)
    // With sample=50 and HR stab=170, weight ≈ 0.227 → result HR ≈ 0.227*0.10 + 0.773*0.030 ≈ 0.046
    expect(result.HR).toBeLessThan(0.060)
    expect(result.HR).toBeGreaterThan(0.035)
  })
})
