import { classifyTier } from '@/lib/ranker'
import {
  CONFIDENCE_FLOOR_TRACKED,
  EDGE_FLOORS,
  PROB_FLOORS,
  P_TYPICAL_FLOORS_TRACKED,
  SCORE_FLOORS_TRACKED,
  DISPLAY_FLOOR_SCORE,
} from '@/lib/constants'

// classifyTier gates a pick into 'tracked' | 'watching' | null.
//
// Tracked requires ALL FIVE floors:
//   confidence ≥ CONFIDENCE_FLOOR_TRACKED
//   edge       ≥ EDGE_FLOORS[rung]
//   p_matchup  ≥ PROB_FLOORS[rung]
//   p_typical  ≥ P_TYPICAL_FLOORS_TRACKED[rung]   ← quality-first robustness
//   score      ≥ SCORE_FLOORS_TRACKED[rung]      ← Kelly conviction
//
// Watching requires score ≥ DISPLAY_FLOOR_SCORE (a strictly weaker bar).
// Anything below that is dropped (returns null).
//
// History:
//   - Score floor added 2026-05-05 as the 4th gate after a hot Coors slate
//     produced 33 tracked picks where only ~10 represented meaningful
//     conviction.
//   - p̂ typical floor added 2026-05-05 as the 5th gate to enforce
//     "quality first, slate second" — slate factors should lift quality
//     baselines, not rescue weak ones.

describe('classifyTier', () => {
  // Helper: a pick that comfortably passes the first four floors at the
  // given rung, with score parameterized so individual tests can probe the
  // score gate cleanly.
  const makeTrackedPassFour = (rung: 1 | 2 | 3, score: number) => ({
    rung,
    confidence: CONFIDENCE_FLOOR_TRACKED + 0.05,
    edge: EDGE_FLOORS[rung] + 0.05,
    pMatchup: PROB_FLOORS[rung] + 0.05,
    pTypical: P_TYPICAL_FLOORS_TRACKED[rung] + 0.05,
    score,
  })

  test('tracked when all five floors clear (1+)', () => {
    expect(classifyTier(makeTrackedPassFour(1, SCORE_FLOORS_TRACKED[1] + 0.01))).toBe('tracked')
  })

  test('tracked when all five floors clear (2+)', () => {
    expect(classifyTier(makeTrackedPassFour(2, SCORE_FLOORS_TRACKED[2] + 0.01))).toBe('tracked')
  })

  test('tracked when all five floors clear (3+)', () => {
    expect(classifyTier(makeTrackedPassFour(3, SCORE_FLOORS_TRACKED[3] + 0.01))).toBe('tracked')
  })

  test('not tracked when score floor fails despite clearing prob/edge/conf/pTypical', () => {
    // First four floors pass with margin, score sits under the rung floor
    // but above the watching floor — must classify as watching, not tracked.
    const args = {
      rung: 1 as const,
      confidence: CONFIDENCE_FLOOR_TRACKED + 0.05,
      edge: EDGE_FLOORS[1] + 0.05,
      pMatchup: PROB_FLOORS[1] + 0.05,
      pTypical: P_TYPICAL_FLOORS_TRACKED[1] + 0.05,
      score: SCORE_FLOORS_TRACKED[1] - 0.01,  // just under the 1+ floor
    }
    expect(classifyTier(args)).toBe('watching')
  })

  test('per-rung score floor — 3+ has a lower bar than 1+', () => {
    // A score of 0.16 fails the 1+ floor (0.25) and 2+ floor (0.20) but
    // clears the 3+ floor (0.15). Same prob/edge/conf/pTypical passing margins.
    const baseScore = 0.16
    expect(classifyTier({
      rung: 1, confidence: 0.95, edge: EDGE_FLOORS[1] + 0.05,
      pMatchup: PROB_FLOORS[1] + 0.05, pTypical: P_TYPICAL_FLOORS_TRACKED[1] + 0.05, score: baseScore,
    })).toBe('watching')
    expect(classifyTier({
      rung: 2, confidence: 0.95, edge: EDGE_FLOORS[2] + 0.05,
      pMatchup: PROB_FLOORS[2] + 0.05, pTypical: P_TYPICAL_FLOORS_TRACKED[2] + 0.05, score: baseScore,
    })).toBe('watching')
    expect(classifyTier({
      rung: 3, confidence: 0.95, edge: EDGE_FLOORS[3] + 0.05,
      pMatchup: PROB_FLOORS[3] + 0.05, pTypical: P_TYPICAL_FLOORS_TRACKED[3] + 0.05, score: baseScore,
    })).toBe('tracked')
  })

  test('p̂ typical gate blocks a slate-rescue play (Bauers 2+ scenario)', () => {
    // Bauers 2+ on 2026-05-04: pTypical 0.474 boosted to pToday 0.609 by
    // a Coors stack. Passes prob/edge/conf/score floors but the underlying
    // baseline doesn't justify a 2+ bet — exactly what the p̂ typical floor
    // is meant to catch.
    expect(classifyTier({
      rung: 2,
      confidence: 0.86,
      edge: 0.28,                              // passes 0.20 edge floor
      pMatchup: 0.609,                         // passes 0.60 prob floor
      pTypical: 0.474,                         // FAILS 0.50 pTypical floor
      score: SCORE_FLOORS_TRACKED[2] + 0.02,   // passes score floor
    })).toBe('watching')
  })

  test('per-rung p̂ typical floor — 3+ has a lower bar than 2+', () => {
    // pTypical 0.32 fails the 2+ floor (0.50) but clears the 3+ floor (0.30).
    // This mirrors Bauers 3+ on the same slate (pTypical 0.315), which the
    // 2+ floor would gate but the 3+ floor accepts.
    const args2 = {
      rung: 2 as const, confidence: 0.95, edge: EDGE_FLOORS[2] + 0.05,
      pMatchup: PROB_FLOORS[2] + 0.05, pTypical: 0.32,
      score: SCORE_FLOORS_TRACKED[2] + 0.05,
    }
    const args3 = { ...args2, rung: 3 as const,
      edge: EDGE_FLOORS[3] + 0.05,
      pMatchup: PROB_FLOORS[3] + 0.05,
      score: SCORE_FLOORS_TRACKED[3] + 0.05,
    }
    expect(classifyTier(args2)).toBe('watching')
    expect(classifyTier(args3)).toBe('tracked')
  })

  test('watching when score is between display floor and tracked floor', () => {
    expect(classifyTier({
      rung: 1, confidence: 0.5, edge: 0, pMatchup: 0.5, pTypical: 0.5,
      score: DISPLAY_FLOOR_SCORE + 0.01,
    })).toBe('watching')
  })

  test('null (dropped) when score below display floor', () => {
    expect(classifyTier({
      rung: 1, confidence: 0.95, edge: 0.05, pMatchup: 0.50, pTypical: 0.50,
      score: DISPLAY_FLOOR_SCORE - 0.01,
    })).toBe(null)
  })

  // Regression guards on the original gates — additive new gates can't
  // accidentally let a confidence-failing or prob-failing pick through.
  test('confidence gate still binds', () => {
    expect(classifyTier({
      rung: 1,
      confidence: CONFIDENCE_FLOOR_TRACKED - 0.01,
      edge: EDGE_FLOORS[1] + 0.05,
      pMatchup: PROB_FLOORS[1] + 0.05,
      pTypical: P_TYPICAL_FLOORS_TRACKED[1] + 0.05,
      score: SCORE_FLOORS_TRACKED[1] + 0.05,
    })).toBe('watching')
  })

  test('prob floor still binds', () => {
    expect(classifyTier({
      rung: 1,
      confidence: 0.95,
      edge: EDGE_FLOORS[1] + 0.05,
      pMatchup: PROB_FLOORS[1] - 0.01,
      pTypical: P_TYPICAL_FLOORS_TRACKED[1] + 0.05,
      score: SCORE_FLOORS_TRACKED[1] + 0.05,
    })).toBe('watching')
  })

  test('edge floor still binds', () => {
    expect(classifyTier({
      rung: 1,
      confidence: 0.95,
      edge: EDGE_FLOORS[1] - 0.01,
      pMatchup: PROB_FLOORS[1] + 0.05,
      pTypical: P_TYPICAL_FLOORS_TRACKED[1] + 0.05,
      score: SCORE_FLOORS_TRACKED[1] + 0.05,
    })).toBe('watching')
  })
})
