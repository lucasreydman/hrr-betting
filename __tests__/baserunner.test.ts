// __tests__/baserunner.test.ts
import { applyOutcome, EMPTY_BASES, BasesState } from '@/lib/baserunner'

describe('applyOutcome', () => {
  test('solo HR with empty bases: 1 R, 1 RBI, 0 outs', () => {
    const result = applyOutcome(EMPTY_BASES, 'HR', { batterId: 100 })
    expect(result.bases).toEqual({ b1: null, b2: null, b3: null })
    expect(result.runsScored).toEqual([100])
    expect(result.rbis).toBe(1)
    expect(result.outsRecorded).toBe(0)
  })

  test('grand slam: 4 R, 4 RBI, bases empty after, 0 outs', () => {
    const loaded: BasesState = { b1: 1, b2: 2, b3: 3 }
    const result = applyOutcome(loaded, 'HR', { batterId: 100 })
    expect(result.runsScored.sort()).toEqual([1, 100, 2, 3].sort())
    expect(result.rbis).toBe(4)
    expect(result.bases).toEqual({ b1: null, b2: null, b3: null })
    expect(result.outsRecorded).toBe(0)
  })

  test('walk with bases empty: batter to first, no RBI, 0 outs', () => {
    const result = applyOutcome(EMPTY_BASES, 'BB', { batterId: 100 })
    expect(result.bases).toEqual({ b1: 100, b2: null, b3: null })
    expect(result.runsScored).toEqual([])
    expect(result.rbis).toBe(0)
    expect(result.outsRecorded).toBe(0)
  })

  test('walk with bases loaded: 1 R (forced from 3rd), 1 RBI, 0 outs', () => {
    const loaded: BasesState = { b1: 1, b2: 2, b3: 3 }
    const result = applyOutcome(loaded, 'BB', { batterId: 100 })
    expect(result.runsScored).toEqual([3])
    expect(result.rbis).toBe(1)
    expect(result.bases).toEqual({ b1: 100, b2: 1, b3: 2 })
    expect(result.outsRecorded).toBe(0)
  })

  test('walk with runner on 1st only: not forced, 1B advances to 2B, batter to 1B', () => {
    const start: BasesState = { b1: 1, b2: null, b3: null }
    const result = applyOutcome(start, 'BB', { batterId: 100 })
    expect(result.bases).toEqual({ b1: 100, b2: 1, b3: null })
    expect(result.runsScored).toEqual([])
    expect(result.rbis).toBe(0)
  })

  test('walk with runner on 2nd only: not forced, 2B stays, batter to 1B', () => {
    const start: BasesState = { b1: null, b2: 2, b3: null }
    const result = applyOutcome(start, 'BB', { batterId: 100 })
    expect(result.bases).toEqual({ b1: 100, b2: 2, b3: null })
    expect(result.runsScored).toEqual([])
  })

  test('K records 1 out, no advancement', () => {
    const start: BasesState = { b1: 1, b2: null, b3: 3 }
    const result = applyOutcome(start, 'K', { batterId: 100 })
    expect(result.bases).toEqual(start)
    expect(result.runsScored).toEqual([])
    expect(result.rbis).toBe(0)
    expect(result.outsRecorded).toBe(1)
  })

  test('OUT records 1 out, runner on 3rd may score (sac fly)', () => {
    let scored = 0
    for (let i = 0; i < 200; i++) {
      const result = applyOutcome({ b1: null, b2: null, b3: 3 }, 'OUT', { batterId: 100 })
      expect(result.outsRecorded).toBe(1)
      if (result.runsScored.includes(3)) {
        scored++
        expect(result.rbis).toBe(1)  // RBI for the sac fly
      }
    }
    // Runner from 3rd should score on a sac fly some fraction of the time (~30%)
    expect(scored).toBeGreaterThan(20)
    expect(scored).toBeLessThan(120)
  })

  test('1B with empty bases: batter to 1B, 0 R, 0 RBI', () => {
    const result = applyOutcome(EMPTY_BASES, '1B', { batterId: 100 })
    expect(result.bases.b1).toBe(100)
    expect(result.bases.b2).toBeNull()
    expect(result.bases.b3).toBeNull()
    expect(result.runsScored).toEqual([])
  })

  test('1B with runner on 3rd: 3rd scores, batter to 1B', () => {
    const result = applyOutcome({ b1: null, b2: null, b3: 3 }, '1B', { batterId: 100 })
    expect(result.runsScored).toEqual([3])
    expect(result.rbis).toBe(1)
    expect(result.bases.b1).toBe(100)
    expect(result.bases.b3).toBeNull()
  })

  test('1B with runner on 2nd: runner often scores (~62%), sometimes stops at 3B', () => {
    let scoredCount = 0
    for (let i = 0; i < 200; i++) {
      const result = applyOutcome({ b1: null, b2: 2, b3: null }, '1B', { batterId: 100 })
      if (result.runsScored.includes(2)) scoredCount++
    }
    // Score from 2nd on 1B is ~62% per public data (Tom Tango run-expectancy tables)
    expect(scoredCount).toBeGreaterThan(100)
    expect(scoredCount).toBeLessThan(180)
  })

  test('2B with bases empty: batter to 2B', () => {
    const result = applyOutcome(EMPTY_BASES, '2B', { batterId: 100 })
    expect(result.bases.b2).toBe(100)
    expect(result.bases.b1).toBeNull()
    expect(result.bases.b3).toBeNull()
  })

  test('2B with runners on 2nd+3rd: both score, batter to 2B, 2 RBI', () => {
    const result = applyOutcome({ b1: null, b2: 2, b3: 3 }, '2B', { batterId: 100 })
    expect(result.runsScored.sort()).toEqual([2, 3])
    expect(result.rbis).toBe(2)
    expect(result.bases.b2).toBe(100)
    expect(result.bases.b3).toBeNull()
  })

  test('3B with empty bases: batter to 3B', () => {
    const result = applyOutcome(EMPTY_BASES, '3B', { batterId: 100 })
    expect(result.bases.b3).toBe(100)
    expect(result.bases.b1).toBeNull()
    expect(result.bases.b2).toBeNull()
  })

  test('3B with bases loaded: all 3 runners score, batter to 3B, 3 RBI', () => {
    const loaded: BasesState = { b1: 1, b2: 2, b3: 3 }
    const result = applyOutcome(loaded, '3B', { batterId: 100 })
    expect(result.runsScored.sort()).toEqual([1, 2, 3])
    expect(result.rbis).toBe(3)
    expect(result.bases).toEqual({ b1: null, b2: null, b3: 100 })
  })

  test('Hits and walks record 0 outs', () => {
    const variants: Array<['1B' | '2B' | '3B' | 'HR' | 'BB']> = [['1B'], ['2B'], ['3B'], ['HR'], ['BB']]
    for (const [outcome] of variants) {
      const result = applyOutcome(EMPTY_BASES, outcome, { batterId: 100 })
      expect(result.outsRecorded).toBe(0)
    }
  })
})
