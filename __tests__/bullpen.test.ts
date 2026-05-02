import { fetchBullpenStats } from '@/lib/bullpen'
import { kvSet } from '@/lib/kv'

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
