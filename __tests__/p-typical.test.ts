/**
 * __tests__/p-typical.test.ts
 *
 * Tests for getPTypical — the player-specific "typical game" denominator.
 *
 * Most tests use unknown player IDs (996–999) which trigger the league-avg
 * fallback path without any network calls. The cache-read test seeds the
 * in-memory KV directly so no sim runs.
 */

import { getPTypical } from '@/lib/p-typical'

// ---------------------------------------------------------------------------
// Cache-read test (seeds KV directly; no sim work)
// ---------------------------------------------------------------------------

it('reads from typical:v1:{playerId} cache', async () => {
  const { kvSet } = await import('@/lib/kv')
  await kvSet('typical:v1:592450', {
    playerId: 592450,
    atLeast: [1.0, 0.72, 0.38, 0.12, 0.04],
    iterations: 20000,
    computedAt: Date.now(),
  }, 60)
  const result = await getPTypical({ playerId: 592450 })
  expect(result.atLeast[1]).toBeCloseTo(0.72, 5)
})

// ---------------------------------------------------------------------------
// Fallback-path tests (unknown player IDs — empty season stats, no sim work)
// ---------------------------------------------------------------------------

test('getPTypical returns valid distribution shape for unknown player', async () => {
  const result = await getPTypical({
    playerId: 999,
    season: 2024,
  })

  expect(result.atLeast).toHaveLength(5)
  expect(result.atLeast[0]).toBeCloseTo(1.0, 6)
  expect(result.atLeast[1]).toBeLessThanOrEqual(1.0)
  expect(result.atLeast[2]).toBeLessThanOrEqual(result.atLeast[1])
  expect(result.atLeast[3]).toBeLessThanOrEqual(result.atLeast[2])
  expect(result.atLeast[4]).toBeLessThanOrEqual(result.atLeast[3])

  expect(result.playerId).toBe(999)
  expect(result.computedAt).toBeGreaterThan(0)
}, 30_000)

test('getPTypical caches results (second call is fast)', async () => {
  const args = { playerId: 998, season: 2024 }
  await getPTypical(args)

  const t1 = Date.now()
  const result = await getPTypical(args)
  const elapsed = Date.now() - t1

  expect(elapsed).toBeLessThan(50)
  expect(result.atLeast).toHaveLength(5)
}, 30_000)

test('getPTypical distribution is monotonically non-increasing', async () => {
  const result = await getPTypical({ playerId: 997, season: 2024 })

  for (let i = 1; i < result.atLeast.length; i++) {
    expect(result.atLeast[i]).toBeLessThanOrEqual(result.atLeast[i - 1])
  }
}, 30_000)

test('getPTypical fallback has iterations === 0 for unknown player', async () => {
  const result = await getPTypical({ playerId: 996, season: 2024 })
  expect(result.iterations).toBe(0)
}, 30_000)

// ---------------------------------------------------------------------------
// Mocked-MLB-API smoke test — exercises the real sim path without network
// ---------------------------------------------------------------------------

describe('getPTypical with mocked MLB API responses', () => {
  function setupMlbFetchMocks() {
    return jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)

      // hitting season stats — used by fetchBatterSeasonStats
      if (url.includes('stats=season') && url.includes('group=hitting')) {
        return new Response(
          JSON.stringify({
            stats: [{
              splits: [{
                stat: {
                  plateAppearances: 600,
                  atBats:           540,
                  hits:             180,
                  doubles:          30,
                  triples:          5,
                  homeRuns:         25,
                  baseOnBalls:      60,
                  strikeOuts:       100,
                  hitByPitch:       5,
                },
              }],
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      throw new Error(`Unmocked fetch in p-typical test: ${url}`)
    })
  }

  test('returns a real player-specific distribution when MLB returns season stats', async () => {
    const fetchSpy = setupMlbFetchMocks()
    try {
      // Use a fresh player ID so the in-memory KV cache from earlier tests doesn't dominate.
      const result = await getPTypical({ playerId: 800001, season: 2025 })
      expect(result.atLeast).toHaveLength(5)
      expect(result.atLeast[0]).toBeCloseTo(1.0, 5)
      for (let i = 1; i < result.atLeast.length; i++) {
        expect(result.atLeast[i]).toBeLessThanOrEqual(result.atLeast[i - 1])
      }
      // iterations should be ITERATIONS (20000) since we ran a real sim
      expect(result.iterations).toBe(20000)
      // The mock player has elite-ish rates (180 H / 600 PA + 25 HR), so atLeast[1]
      // (≥1 HRR) should be solidly above the league-avg fallback 0.65.
      expect(result.atLeast[1]).toBeGreaterThan(0.5)
    } finally {
      fetchSpy.mockRestore()
    }
  }, 60_000)
})
