import { computeEdge, computeScore } from '@/lib/edge'

test('EDGE = pMatchup / max(pTypical, 0.01) - 1', () => {
  expect(computeEdge({ pMatchup: 0.20, pTypical: 0.10 })).toBeCloseTo(1.0, 6)
  expect(computeEdge({ pMatchup: 0.50, pTypical: 0.50 })).toBeCloseTo(0, 6)
})

test('EDGE floor: pTypical near zero clamps to 0.01', () => {
  const result = computeEdge({ pMatchup: 0.05, pTypical: 0.001 })
  expect(result).toBeCloseTo(4.0, 6)
})

test('EDGE is negative when pMatchup < pTypical', () => {
  expect(computeEdge({ pMatchup: 0.05, pTypical: 0.10 })).toBeCloseTo(-0.5, 6)
})

test('SCORE = Kelly fraction × confidence', () => {
  // Kelly = (pMatchup − pTypical) / (1 − pTypical)
  // 1+ HRR-style: high prob, modest absolute gain
  // (0.857 − 0.753) / (1 − 0.753) × 0.91 ≈ 0.421 × 0.91 ≈ 0.383
  expect(computeScore({ pMatchup: 0.857, pTypical: 0.753, confidence: 0.91 }))
    .toBeCloseTo(0.383, 3)
  // Even matchup: Kelly fraction = 0
  expect(computeScore({ pMatchup: 0.5, pTypical: 0.5, confidence: 1 }))
    .toBeCloseTo(0, 6)
  // 3+ HRR-style: longshot with monster relative edge but small Kelly
  // (0.189 − 0.10) / (1 − 0.10) × 0.80 ≈ 0.099 × 0.80 ≈ 0.079
  expect(computeScore({ pMatchup: 0.189, pTypical: 0.10, confidence: 0.80 }))
    .toBeCloseTo(0.079, 3)
})

test('SCORE is negative when pMatchup < pTypical', () => {
  // Unfavorable matchup must sort below favorable ones, not be clipped to 0.
  // (0.30 − 0.50) / (1 − 0.50) × 0.80 = −0.4 × 0.80 = −0.32
  expect(computeScore({ pMatchup: 0.30, pTypical: 0.50, confidence: 0.80 }))
    .toBeCloseTo(-0.32, 6)
})

test('SCORE floors (1 − pTypical) at 0.01 to avoid divide-by-zero', () => {
  // pTypical = 1.0 would divide by zero. Floor at 0.01.
  // Both numerator and denominator handle the degenerate case sanely.
  expect(computeScore({ pMatchup: 1.0, pTypical: 1.0, confidence: 0.9 }))
    .toBeCloseTo(0, 6)
  // pTypical = 0.999, pMatchup = 1.0: Kelly = 0.001 / max(0.001, 0.01) = 0.1, × 0.9 = 0.09
  expect(computeScore({ pMatchup: 1.0, pTypical: 0.999, confidence: 0.9 }))
    .toBeCloseTo(0.09, 3)
})

test('symmetric floor: equally rare events have edge ≈ 0', () => {
  // Without flooring pMatchup, this would compute 0.001 / 0.01 - 1 = -0.9 —
  // a misleading "huge negative edge" for two probabilities that are equally tiny.
  // With symmetric flooring (both clamped to 0.01), edge is 0, which is correct.
  expect(computeEdge({ pMatchup: 0.001, pTypical: 0.001 })).toBeCloseTo(0, 6)
})

test('symmetric floor: pMatchup above floor still divides by floored pTypical', () => {
  // pMatchup 0.05 stays as-is (above 0.01); pTypical floors to 0.01.
  // edge = 0.05 / 0.01 - 1 = 4.0
  expect(computeEdge({ pMatchup: 0.05, pTypical: 0.001 })).toBeCloseTo(4.0, 6)
})
