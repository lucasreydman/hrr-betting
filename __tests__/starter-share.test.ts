/**
 * __tests__/starter-share.test.ts
 *
 * TDD tests for lib/starter-share.ts
 * Tests the IP CDF builder and getStarterShare tiered-fallback logic.
 * Uses pitcherId 999999999 (unknown) to force league-avg fallback path.
 */

import { ipCdfFromStarts, getStarterShare } from '@/lib/starter-share'

describe('ipCdfFromStarts', () => {
  test('produces monotonic non-increasing CDF', () => {
    const starts = [
      { gameDate: '2025-04-01', ip: 5.0 },
      { gameDate: '2025-04-06', ip: 6.0 },
      { gameDate: '2025-04-11', ip: 5.7 },
      { gameDate: '2025-04-16', ip: 4.3 },
      { gameDate: '2025-04-21', ip: 6.2 },
    ]
    const cdf = ipCdfFromStarts(starts)
    expect(cdf.completedAtLeast(5)).toBeGreaterThan(cdf.completedAtLeast(7))
    expect(cdf.completedAtLeast(0)).toBeCloseTo(1.0)
  })

  test('completedAtLeast(0) is always 1.0', () => {
    const cdf = ipCdfFromStarts([{ gameDate: '2025-04-01', ip: 0 }])
    expect(cdf.completedAtLeast(0)).toBeCloseTo(1.0)
  })

  test('completedAtLeast for inning > all starts is 0', () => {
    const cdf = ipCdfFromStarts([
      { gameDate: '2025-04-01', ip: 5.0 },
      { gameDate: '2025-04-06', ip: 6.0 },
    ])
    expect(cdf.completedAtLeast(9)).toBeCloseTo(0)
  })
})

describe('getStarterShare', () => {
  test('top-of-order vs avg starter is ~0.65-0.85', async () => {
    const result = await getStarterShare({
      pitcherId: 999999999,  // unknown → fallback
      pitcherType: 'starter',
      lineupSlot: 1,
      expectedPA: 4,
    })
    expect(result.starterShare).toBeGreaterThan(0.65)
    expect(result.starterShare).toBeLessThan(0.85)
  })

  test('bottom-of-order vs avg starter is ~0.40-0.65', async () => {
    const result = await getStarterShare({
      pitcherId: 999999999,
      pitcherType: 'starter',
      lineupSlot: 9,
      expectedPA: 4,
    })
    expect(result.starterShare).toBeGreaterThan(0.40)
    expect(result.starterShare).toBeLessThan(0.65)
  })

  test('opener has very low starter_share', async () => {
    const result = await getStarterShare({
      pitcherId: 999999999,
      pitcherType: 'opener',
      lineupSlot: 1,
      expectedPA: 4,
    })
    expect(result.starterShare).toBeLessThan(0.4)
  })

  test('top-of-order > bottom-of-order for same starter', async () => {
    const top = await getStarterShare({ pitcherId: 999999999, pitcherType: 'starter', lineupSlot: 1, expectedPA: 4 })
    const bot = await getStarterShare({ pitcherId: 999999999, pitcherType: 'starter', lineupSlot: 9, expectedPA: 4 })
    expect(top.starterShare).toBeGreaterThan(bot.starterShare)
  })
})
