import { simGame, simSinglePlayerHRR } from '@/lib/sim'
import type { OutcomeRates } from '@/lib/types'

const AVG_RATES: OutcomeRates = { '1B': 0.143, '2B': 0.045, '3B': 0.005, HR: 0.030, BB: 0.085, K: 0.225, OUT: 0.467 }

const ELITE_RATES: OutcomeRates = { '1B': 0.18, '2B': 0.06, '3B': 0.005, HR: 0.075, BB: 0.13, K: 0.15, OUT: 0.40 }

const WEAK_RATES: OutcomeRates = { '1B': 0.10, '2B': 0.02, '3B': 0.001, HR: 0.005, BB: 0.05, K: 0.30, OUT: 0.524 }

function makeBatter(id: number, rates: OutcomeRates) {
  return {
    batterId: id,
    ratesVsStarterByPA: [rates, rates, rates, rates, rates],
    ratesVsBullpenByPA: [rates, rates, rates, rates, rates],
    starterShareByPA: [1.0, 0.95, 0.75, 0.4, 0.1],
  }
}

const avgLineup = (start: number) => Array.from({ length: 9 }, (_, i) => makeBatter(start + i, AVG_RATES))

describe('simGame', () => {
  test('returns histogram for each batter (18 batters total)', async () => {
    const result = await simGame({
      homeLineup: avgLineup(100),
      awayLineup: avgLineup(200),
      iterations: 500,
    })
    expect(result.batterHRR.size).toBe(18)
    for (const dist of result.batterHRR.values()) {
      expect(dist.totalSims).toBe(500)
      expect(dist.atLeast.length).toBe(5)
      expect(dist.atLeast[0]).toBe(1.0)  // P(≥0) = 1
      expect(dist.atLeast[1]).toBeLessThanOrEqual(1.0)
      expect(dist.atLeast[2]).toBeLessThanOrEqual(dist.atLeast[1])  // monotonic
      expect(dist.atLeast[3]).toBeLessThanOrEqual(dist.atLeast[2])
    }
  })

  test('elite hitter has higher P(HRR ≥ 3) than weak hitter at same slot', async () => {
    const eliteLineup = [makeBatter(1, AVG_RATES), makeBatter(2, AVG_RATES), makeBatter(3, ELITE_RATES), ...Array.from({ length: 6 }, (_, i) => makeBatter(10 + i, AVG_RATES))]
    const weakLineup = [makeBatter(1, AVG_RATES), makeBatter(2, AVG_RATES), makeBatter(3, WEAK_RATES), ...Array.from({ length: 6 }, (_, i) => makeBatter(10 + i, AVG_RATES))]

    const eliteResult = await simGame({
      homeLineup: eliteLineup,
      awayLineup: avgLineup(200),
      iterations: 2000,
    })
    const weakResult = await simGame({
      homeLineup: weakLineup,
      awayLineup: avgLineup(200),
      iterations: 2000,
    })
    const eliteAtLeast3 = eliteResult.batterHRR.get(3)!.atLeast[3]
    const weakAtLeast3 = weakResult.batterHRR.get(3)!.atLeast[3]
    expect(eliteAtLeast3).toBeGreaterThan(weakAtLeast3 * 2)  // at least 2x difference
  })

  test('iterations field matches requested iterations', async () => {
    const result = await simGame({
      homeLineup: avgLineup(100),
      awayLineup: avgLineup(200),
      iterations: 200,
    })
    expect(result.iterations).toBe(200)
  })

  test('meanHRR is within plausible baseball range', async () => {
    const result = await simGame({
      homeLineup: avgLineup(100),
      awayLineup: avgLineup(200),
      iterations: 1000,
    })
    for (const dist of result.batterHRR.values()) {
      // A typical player has ~0-3 HRR per game; mean should be < 5
      expect(dist.meanHRR).toBeGreaterThanOrEqual(0)
      expect(dist.meanHRR).toBeLessThan(5)
    }
  })

  test('atLeast array is strictly monotonically non-increasing', async () => {
    const result = await simGame({
      homeLineup: avgLineup(100),
      awayLineup: avgLineup(200),
      iterations: 500,
    })
    for (const dist of result.batterHRR.values()) {
      for (let i = 1; i < dist.atLeast.length; i++) {
        expect(dist.atLeast[i]).toBeLessThanOrEqual(dist.atLeast[i - 1])
      }
    }
  })
})

describe('simSinglePlayerHRR', () => {
  test('returns single-batter distribution', async () => {
    const targetId = 105
    const lineup = avgLineup(101)
    const result = await simSinglePlayerHRR({
      targetPlayerId: targetId,
      homeLineup: lineup,
      awayLineup: avgLineup(200),
      iterations: 500,
    })
    expect(result.totalSims).toBe(500)
    expect(result.atLeast.length).toBe(5)
    expect(result.atLeast[0]).toBe(1.0)
  })

  test('produces consistent estimates with simGame for same target', async () => {
    const lineup = avgLineup(101)
    const opp = avgLineup(200)
    const targetId = 105

    const fullSim = await simGame({
      homeLineup: lineup,
      awayLineup: opp,
      iterations: 3000,
    })
    const singleSim = await simSinglePlayerHRR({
      targetPlayerId: targetId,
      homeLineup: lineup,
      awayLineup: opp,
      iterations: 3000,
    })

    const fullAtLeast1 = fullSim.batterHRR.get(targetId)!.atLeast[1]
    const singleAtLeast1 = singleSim.atLeast[1]
    expect(Math.abs(fullAtLeast1 - singleAtLeast1)).toBeLessThan(0.05)  // within 5pp due to MC noise
  })

  test('target in away lineup is tracked correctly', async () => {
    const targetId = 205
    const awayLineup = avgLineup(201)
    const result = await simSinglePlayerHRR({
      targetPlayerId: targetId,
      homeLineup: avgLineup(100),
      awayLineup,
      iterations: 500,
    })
    expect(result.totalSims).toBe(500)
    expect(result.atLeast[0]).toBe(1.0)
  })
})
