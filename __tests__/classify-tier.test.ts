import { classifyTier } from '@/lib/ranker'
import {
  CONFIDENCE_FLOOR_TRACKED,
  EDGE_FLOORS,
  PROB_FLOORS,
  SCORE_FLOORS_TRACKED,
  DISPLAY_FLOOR_SCORE,
} from '@/lib/constants'

// classifyTier gates a pick into 'tracked' | 'watching' | null.
//
// Tracked requires ALL FOUR floors:
//   confidence ≥ CONFIDENCE_FLOOR_TRACKED
//   edge       ≥ EDGE_FLOORS[rung]
//   p_matchup  ≥ PROB_FLOORS[rung]
//   score      ≥ SCORE_FLOORS_TRACKED[rung]
//
// Watching requires score ≥ DISPLAY_FLOOR_SCORE (a strictly weaker bar).
// Anything below that is dropped (returns null).
//
// The score floor was added 2026-05-05 as the 4th tracked-tier gate after a
// hot Coors slate produced 33 tracked picks where only ~10 were genuinely
// high-conviction. These tests lock the new floor into the contract.

describe('classifyTier', () => {
  // Helper: a pick that comfortably passes the first three floors at the
  // given rung, with score parameterized so individual tests can probe the
  // score gate cleanly.
  const makeTrackedPassThree = (rung: 1 | 2 | 3, score: number) => ({
    rung,
    confidence: CONFIDENCE_FLOOR_TRACKED + 0.05,
    edge: EDGE_FLOORS[rung] + 0.05,
    pMatchup: PROB_FLOORS[rung] + 0.05,
    score,
  })

  test('tracked when all four floors clear (1+)', () => {
    expect(classifyTier(makeTrackedPassThree(1, SCORE_FLOORS_TRACKED[1] + 0.01))).toBe('tracked')
  })

  test('tracked when all four floors clear (2+)', () => {
    expect(classifyTier(makeTrackedPassThree(2, SCORE_FLOORS_TRACKED[2] + 0.01))).toBe('tracked')
  })

  test('tracked when all four floors clear (3+)', () => {
    expect(classifyTier(makeTrackedPassThree(3, SCORE_FLOORS_TRACKED[3] + 0.01))).toBe('tracked')
  })

  test('not tracked when score floor fails despite clearing prob/edge/conf', () => {
    // First three floors pass with margin, score sits under the rung floor
    // but above the watching floor — must classify as watching, not tracked.
    const args = {
      rung: 1 as const,
      confidence: CONFIDENCE_FLOOR_TRACKED + 0.05,
      edge: EDGE_FLOORS[1] + 0.05,
      pMatchup: PROB_FLOORS[1] + 0.05,
      score: SCORE_FLOORS_TRACKED[1] - 0.01,  // just under the 1+ floor
    }
    expect(classifyTier(args)).toBe('watching')
  })

  test('per-rung score floor — 3+ has a lower bar than 1+', () => {
    // A score of 0.16 fails the 1+ floor (0.25) and 2+ floor (0.20) but
    // clears the 3+ floor (0.15). Same prob/edge/conf passing margins.
    const baseScore = 0.16
    expect(classifyTier({
      rung: 1, confidence: 0.95, edge: EDGE_FLOORS[1] + 0.05, pMatchup: PROB_FLOORS[1] + 0.05, score: baseScore,
    })).toBe('watching')
    expect(classifyTier({
      rung: 2, confidence: 0.95, edge: EDGE_FLOORS[2] + 0.05, pMatchup: PROB_FLOORS[2] + 0.05, score: baseScore,
    })).toBe('watching')
    expect(classifyTier({
      rung: 3, confidence: 0.95, edge: EDGE_FLOORS[3] + 0.05, pMatchup: PROB_FLOORS[3] + 0.05, score: baseScore,
    })).toBe('tracked')
  })

  test('watching when score is between display floor and tracked floor', () => {
    expect(classifyTier({
      rung: 1, confidence: 0.5, edge: 0, pMatchup: 0.5, score: DISPLAY_FLOOR_SCORE + 0.01,
    })).toBe('watching')
  })

  test('null (dropped) when score below display floor', () => {
    expect(classifyTier({
      rung: 1, confidence: 0.95, edge: 0.05, pMatchup: 0.50, score: DISPLAY_FLOOR_SCORE - 0.01,
    })).toBe(null)
  })

  // Regression guards on the original three gates — score-only fixes can't
  // accidentally let a confidence-failing or prob-failing pick through.
  test('confidence gate still binds', () => {
    expect(classifyTier({
      rung: 1,
      confidence: CONFIDENCE_FLOOR_TRACKED - 0.01,
      edge: EDGE_FLOORS[1] + 0.05,
      pMatchup: PROB_FLOORS[1] + 0.05,
      score: SCORE_FLOORS_TRACKED[1] + 0.05,
    })).toBe('watching')
  })

  test('prob floor still binds', () => {
    expect(classifyTier({
      rung: 1,
      confidence: 0.95,
      edge: EDGE_FLOORS[1] + 0.05,
      pMatchup: PROB_FLOORS[1] - 0.01,
      score: SCORE_FLOORS_TRACKED[1] + 0.05,
    })).toBe('watching')
  })

  test('edge floor still binds', () => {
    expect(classifyTier({
      rung: 1,
      confidence: 0.95,
      edge: EDGE_FLOORS[1] - 0.01,
      pMatchup: PROB_FLOORS[1] + 0.05,
      score: SCORE_FLOORS_TRACKED[1] + 0.05,
    })).toBe('watching')
  })
})
