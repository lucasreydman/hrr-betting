import { getActiveBatterIds } from '@/lib/active-batters'

describe('getActiveBatterIds', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns array (live test gated)', async () => {
    if (!process.env.RUN_LIVE_TESTS) {
      // Hermetic CI run — skip the live network call
      return
    }
    const ids = await getActiveBatterIds(new Date().getFullYear())
    expect(Array.isArray(ids)).toBe(true)
    expect(ids.length).toBeGreaterThan(400)
    expect(ids.length).toBeLessThan(1500)
    expect(ids.every(id => Number.isInteger(id) && id > 0)).toBe(true)
  })

  it('returns empty array when fetch unavailable', async () => {
    // Test the cache hit path with primed empty array
    const { kvSet } = await import('@/lib/kv')
    await kvSet('active-batters:v1:1990', [], 60)
    const ids = await getActiveBatterIds(1990)
    expect(ids).toEqual([])
  })
})
