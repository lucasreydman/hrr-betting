import { computePerPA } from '@/lib/per-pa'
import type { Outcome, OutcomeRates } from '@/lib/types'

const elliteBatter = {
  rates: { '1B': 0.16, '2B': 0.06, '3B': 0.005, HR: 0.075, BB: 0.13, K: 0.18, OUT: 0.39 } as OutcomeRates,
  statcast: { barrelPct: 0.18, hardHitPct: 0.55, xwOBA: 0.420, xISO: 0.290, avgExitVelo: 92 },
}

const avgPitcher = {
  rates: { '1B': 0.143, '2B': 0.045, '3B': 0.005, HR: 0.030, BB: 0.085, K: 0.225, OUT: 0.467 } as OutcomeRates,
  statcast: { barrelsAllowedPct: 0.08, hardHitPctAllowed: 0.40, xwOBAAllowed: 0.320, whiffPct: 0.25 },
}

const neutralOnes: Record<Outcome, number> = { '1B': 1, '2B': 1, '3B': 1, HR: 1, BB: 1, K: 1, OUT: 1 }
const neutralCtx = {
  parkFactors: neutralOnes,
  weatherFactors: neutralOnes,
  ttoMultipliers: neutralOnes,
}

test('outcomes sum to 1', () => {
  const out = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  const sum = Object.values(out).reduce((a, b) => a + b, 0)
  expect(sum).toBeCloseTo(1, 6)
})

test('elite barrel% boosts HR rate above raw batter rate', () => {
  const out = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  expect(out.HR).toBeGreaterThan(elliteBatter.rates.HR)
})

test('weak pitcher (low whiff%) lowers K rate vs avg pitcher', () => {
  const weakPitcher = { ...avgPitcher, statcast: { ...avgPitcher.statcast, whiffPct: 0.18 } }
  const outVsAvg = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  const outVsWeak = computePerPA({ batter: elliteBatter, pitcher: weakPitcher, ctx: neutralCtx })
  expect(outVsWeak.K).toBeLessThan(outVsAvg.K)
})

test('TTO 3rd-time multiplier boosts batter HR outcome', () => {
  const tto3 = {
    ...neutralCtx,
    ttoMultipliers: { '1B': 1.10, '2B': 1.15, '3B': 1.15, HR: 1.25, BB: 1.08, K: 0.94, OUT: 1.00 } as Record<Outcome, number>,
  }
  const outNeutral = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  const outTTO = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: tto3 })
  expect(outTTO.HR).toBeGreaterThan(outNeutral.HR)
})

test('park HR factor passes through', () => {
  const coors = { ...neutralCtx, parkFactors: { ...neutralCtx.parkFactors, HR: 1.30 } }
  const outNeutral = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  const outCoors = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: coors })
  expect(outCoors.HR).toBeGreaterThan(outNeutral.HR)
})

test('works without Statcast data (statcast fields undefined)', () => {
  const noSc = computePerPA({
    batter: { rates: elliteBatter.rates },
    pitcher: { rates: avgPitcher.rates },
    ctx: neutralCtx,
  })
  const sum = Object.values(noSc).reduce((a, b) => a + b, 0)
  expect(sum).toBeCloseTo(1, 6)
  // Without Statcast adjustments, HR should be log-5 result of batter*pitcher/lg
  // batter=0.075, pitcher=0.030, lg=0.030 → 0.075 * (0.030/0.030) = 0.075 (before normalization)
})

test('weak vs weak should still produce a valid distribution', () => {
  const weak = {
    rates: { '1B': 0.10, '2B': 0.02, '3B': 0.001, HR: 0.005, BB: 0.04, K: 0.30, OUT: 0.534 } as OutcomeRates,
  }
  const out = computePerPA({ batter: weak, pitcher: { rates: avgPitcher.rates }, ctx: neutralCtx })
  const sum = Object.values(out).reduce((a, b) => a + b, 0)
  expect(sum).toBeCloseTo(1, 6)
  // No outcome should be NaN or negative
  for (const v of Object.values(out)) {
    expect(v).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(v)).toBe(true)
  }
})
