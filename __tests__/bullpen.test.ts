import { weightForPA, fetchBullpenStats } from '@/lib/bullpen'
import { kvSet } from '@/lib/kv'

test('weightForPA returns mostly high-leverage in late PAs', () => {
  expect(weightForPA(4)).toBeGreaterThan(0.7)
})

test('weightForPA returns low high-leverage weight in early PAs', () => {
  expect(weightForPA(2)).toBeLessThan(0.3)
})

test('weightForPA is monotonic non-decreasing across PA index', () => {
  expect(weightForPA(2)).toBeLessThanOrEqual(weightForPA(3))
  expect(weightForPA(3)).toBeLessThanOrEqual(weightForPA(4))
})

test('weightForPA caps at 1.0 for absurdly large indices', () => {
  expect(weightForPA(99)).toBeLessThanOrEqual(1.0)
})

describe('fetchBullpenStats', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns null for non-positive teamId', async () => {
    expect(await fetchBullpenStats(0, 2026)).toBeNull()
    expect(await fetchBullpenStats(-1, 2026)).toBeNull()
  })

  it('returns cached value when present', async () => {
    await kvSet('bullpen:v1:147:2026', { era: 3.85, ip: 175.0 }, 60)
    const result = await fetchBullpenStats(147, 2026)
    expect(result).toEqual({ era: 3.85, ip: 175.0 })
  })
})
