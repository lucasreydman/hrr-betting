import { fetchBullpenStats } from '@/lib/bullpen'
import { kvSet } from '@/lib/kv'

describe('fetchBullpenStats', () => {
  const ORIGINAL_FETCH = global.fetch
  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = ORIGINAL_FETCH
  })

  it('returns null for non-positive teamId', async () => {
    expect(await fetchBullpenStats(0, 2026)).toBeNull()
    expect(await fetchBullpenStats(-1, 2026)).toBeNull()
  })

  it('returns cached value when present (v2 key)', async () => {
    await kvSet('bullpen:v2:147:2026', { era: 3.85, ip: 175.0 }, 60)
    const result = await fetchBullpenStats(147, 2026)
    expect(result).toEqual({ era: 3.85, ip: 175.0 })
  })

  // Regression for the silent v1 bug where every team scored as league-average
  // (factor 1.00). The fix moved to /stats?teamId=...&playerPool=ALL which
  // returns one split per pitcher — letting the "skip starters" filter
  // identify actual relievers.
  it('aggregates ERA across non-starting pitchers from per-player splits', async () => {
    const fakeApiResponse = {
      stats: [{
        splits: [
          // 3 pure starters — must be skipped
          { stat: { era: '3.50', inningsPitched: '40.0', gamesStarted: 7 } },
          { stat: { era: '4.10', inningsPitched: '38.0', gamesStarted: 7 } },
          { stat: { era: '2.80', inningsPitched: '42.0', gamesStarted: 8 } },
          // 3 relievers — should be aggregated
          { stat: { era: '2.00', inningsPitched: '20.0', gamesStarted: 0 } },
          { stat: { era: '3.00', inningsPitched: '15.0', gamesStarted: 0 } },
          { stat: { era: '4.00', inningsPitched: '10.0', gamesStarted: 0 } },
        ],
      }],
    }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeApiResponse,
    }) as unknown as typeof fetch

    // Use a teamId that has no cached value to force the fetch path.
    const result = await fetchBullpenStats(999, 2099)
    expect(result).not.toBeNull()
    // ip-weighted ERA across the 3 relievers:
    //   (2.00*20 + 3.00*15 + 4.00*10) / 45 = 125/45 ≈ 2.778
    expect(result!.ip).toBeCloseTo(45, 5)
    expect(result!.era).toBeCloseTo(2.778, 2)

    // And — critical — the URL must hit the per-player endpoint, not the
    // team-level one that returns a single combined split.
    const fetchMock = global.fetch as jest.Mock
    const urlCalled = fetchMock.mock.calls[0][0] as string
    expect(urlCalled).toContain('/api/v1/stats?')
    expect(urlCalled).toContain('teamId=999')
    expect(urlCalled).toContain('playerPool=ALL')
  })

  it('falls back to neutral fallback when no relievers are returned', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stats: [{ splits: [
        { stat: { era: '3.50', inningsPitched: '180.0', gamesStarted: 30 } },
      ] }] }),
    }) as unknown as typeof fetch
    const result = await fetchBullpenStats(998, 2099)
    expect(result).toEqual({ era: 4.2, ip: 0 })
  })
})
