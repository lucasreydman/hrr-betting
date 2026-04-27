/**
 * __tests__/p-typical.test.ts
 *
 * Tests for getPTypical — the player-specific "typical game" denominator.
 *
 * Most tests use unknown player IDs (996–999) which trigger the league-avg
 * fallback path without any network calls. The "plausible distribution"
 * test uses jest.spyOn(global, 'fetch') to mock the three MLB Stats API
 * calls (gameLog, season stats) so the simulation actually runs against
 * synthetic player data — fully hermetic, no RUN_LIVE_TESTS gating.
 */

import { getPTypical } from '@/lib/p-typical'

// ---------------------------------------------------------------------------
// Fallback-path tests (unknown player IDs — empty game log, no sim work)
// ---------------------------------------------------------------------------

test('getPTypical returns valid distribution shape for unknown player', async () => {
  const result = await getPTypical({
    playerId: 999,
    date: '2025-07-04',
    season: 2024,
    iterationsPerGame: 100,
    maxGames: 3,
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
  const args = {
    playerId: 998,
    date: '2025-07-04',
    season: 2024,
    iterationsPerGame: 100,
    maxGames: 3,
  }
  await getPTypical(args)

  const t1 = Date.now()
  const result = await getPTypical(args)
  const elapsed = Date.now() - t1

  expect(elapsed).toBeLessThan(50)
  expect(result.atLeast).toHaveLength(5)
}, 30_000)

test('getPTypical distribution is monotonically non-increasing', async () => {
  const result = await getPTypical({
    playerId: 997,
    date: '2025-07-05',
    season: 2024,
  })

  for (let i = 1; i < result.atLeast.length; i++) {
    expect(result.atLeast[i]).toBeLessThanOrEqual(result.atLeast[i - 1])
  }
}, 30_000)

test('getPTypical fallback has basedOnGames === 0 for unknown player', async () => {
  const result = await getPTypical({
    playerId: 996,
    date: '2025-07-06',
    season: 2024,
  })
  expect(result.basedOnGames).toBe(0)
}, 30_000)

// ---------------------------------------------------------------------------
// Mocked-MLB-API smoke test — exercises the real sim path without network
// ---------------------------------------------------------------------------

describe('getPTypical with mocked MLB API responses', () => {
  /** Set up canned responses for the three MLB Stats API endpoints getPTypical hits. */
  function setupMlbFetchMocks() {
    return jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)

      // hitting gameLog — used by both fetchBatterGameLog and fetchPlayerSlotFrequency
      if (url.includes('stats=gameLog') && url.includes('group=hitting')) {
        const splits = Array.from({ length: 30 }, (_, i) => ({
          date: `2025-04-${String((i % 28) + 1).padStart(2, '0')}`,
          battingOrder: '300',  // slot 3 every game — keeps the mode-slot stable
          stat: {
            plateAppearances: 4,
            atBats:           3,
            hits:             1,
            doubles:          0,
            triples:          0,
            homeRuns:         0,
            baseOnBalls:      1,
            strikeOuts:       0,
            hitByPitch:       0,
          },
        }))
        return new Response(JSON.stringify({ stats: [{ splits }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

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

  test('returns a real player-specific distribution when MLB returns full game log + season stats', async () => {
    const fetchSpy = setupMlbFetchMocks()
    try {
      // Use a fresh player ID so the in-memory KV cache from earlier tests doesn't dominate.
      const result = await getPTypical({
        playerId: 800001,
        date: '2026-04-27',
        season: 2025,
        iterationsPerGame: 100,
        maxGames: 5,
      })
      expect(result.atLeast).toHaveLength(5)
      expect(result.atLeast[0]).toBeCloseTo(1.0, 5)
      for (let i = 1; i < result.atLeast.length; i++) {
        expect(result.atLeast[i]).toBeLessThanOrEqual(result.atLeast[i - 1])
      }
      // basedOnGames should be > 0 because the gameLog mock returned 30 splits.
      expect(result.basedOnGames).toBeGreaterThan(0)
      // The mock player has elite-ish rates (180 H / 600 PA + 25 HR), so atLeast[1]
      // (≥1 HRR) should be solidly above the league-avg fallback 0.65.
      expect(result.atLeast[1]).toBeGreaterThan(0.5)
    } finally {
      fetchSpy.mockRestore()
    }
  }, 30_000)
})
