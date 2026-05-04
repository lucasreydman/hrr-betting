/**
 * Regression test for /api/admin/bvp.
 *
 * The diagnostic endpoint reports the cache state before + after a fetchBvP
 * call so an operator can verify the production cache key is being populated.
 * The previous version used `hrr:bvp:{b}:{p}` as the inspection key, but
 * `lib/mlb-api.ts:fetchBvP` actually writes to
 * `hrr:bvp:{b}:{p}:{slateDate}`, so the route always reported
 * `cachedBeforeFetch: null` regardless of cache state. Pin the slate-aligned
 * key here so a future "simplify the key" refactor doesn't silently regress
 * the diagnostic.
 */
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/bvp/route'
import { slateDateString } from '@/lib/date-utils'

function reqWith(qs: string, secret?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (secret !== undefined) headers['x-cron-secret'] = secret
  return new NextRequest(`http://localhost/api/admin/bvp${qs}`, { headers })
}

describe('GET /api/admin/bvp', () => {
  // mlb-api fetchBvP hits the live MLB Stats API on cache miss; mock it so
  // this test stays hermetic.
  beforeAll(() => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          stats: [
            {
              splits: [
                {
                  stat: {
                    atBats: 5,
                    hits: 2,
                    doubles: 0,
                    triples: 0,
                    homeRuns: 0,
                    baseOnBalls: 1,
                    strikeOuts: 1,
                  },
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )
  })

  afterAll(() => {
    jest.restoreAllMocks()
  })

  test('rejects missing batter id', async () => {
    const res = await GET(reqWith('?b=0&p=123'))
    expect(res.status).toBe(400)
  })

  test('rejects missing pitcher id', async () => {
    const res = await GET(reqWith('?b=123&p=0'))
    expect(res.status).toBe(400)
  })

  test('rejects non-integer ids', async () => {
    const res = await GET(reqWith('?b=abc&p=123'))
    expect(res.status).toBe(400)
  })

  test('returns slate-aligned cache key in success response', async () => {
    const res = await GET(reqWith('?b=547180&p=663978'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cacheKey: string }
    // Pin the exact key shape so a refactor that drops the slate suffix
    // surfaces here instead of silently breaking the diagnostic again.
    const expectedKey = `hrr:bvp:547180:663978:${slateDateString()}`
    expect(body.cacheKey).toBe(expectedKey)
  })
})
