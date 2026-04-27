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

test('SCORE = EDGE × confidence', () => {
  expect(computeScore({ edge: 0.5, confidence: 0.8 })).toBeCloseTo(0.4, 6)
  expect(computeScore({ edge: 0, confidence: 1 })).toBeCloseTo(0, 6)
  expect(computeScore({ edge: 1.5, confidence: 0.6 })).toBeCloseTo(0.9, 6)
})

test('SCORE preserves negative EDGE', () => {
  expect(computeScore({ edge: -0.5, confidence: 0.8 })).toBeCloseTo(-0.4, 6)
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
