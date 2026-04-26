/**
 * __tests__/p-typical.test.ts
 *
 * Tests for getPTypical — the P_typical replay-the-season simulator.
 *
 * These tests rely on unknown player IDs (998, 999) which return empty data
 * from the MLB API, triggering the league-avg fallback path without any
 * network calls or simulation work. This makes them fast and deterministic.
 *
 * Live smoke tests (real player IDs) are gated behind RUN_LIVE_TESTS=1.
 */

import { getPTypical } from '@/lib/p-typical'

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1'
const maybe = RUN_LIVE ? test : test.skip

// ---------------------------------------------------------------------------
// Offline tests (fallback path — no MLB API, no sim)
// ---------------------------------------------------------------------------

test('getPTypical returns valid distribution shape for unknown player', async () => {
  const result = await getPTypical({
    playerId: 999,
    date: '2025-07-04',
    season: 2024,
    iterationsPerGame: 100,
    maxGames: 3,
  })

  // Shape assertions
  expect(result.atLeast).toHaveLength(5)
  expect(result.atLeast[0]).toBeCloseTo(1.0, 6)
  expect(result.atLeast[1]).toBeLessThanOrEqual(1.0)
  expect(result.atLeast[2]).toBeLessThanOrEqual(result.atLeast[1])
  expect(result.atLeast[3]).toBeLessThanOrEqual(result.atLeast[2])
  expect(result.atLeast[4]).toBeLessThanOrEqual(result.atLeast[3])

  // Metadata
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

  // First call — computes and caches
  await getPTypical(args)

  // Second call — should be served from in-memory KV (near-instant)
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
// Live smoke tests (real player — requires network + RUN_LIVE_TESTS=1)
// ---------------------------------------------------------------------------

maybe('getPTypical returns plausible distribution for a real MLB player', async () => {
  // Mike Trout: playerId 545361
  const result = await getPTypical({
    playerId: 545361,
    date: '2025-07-04',
    season: 2025,
    iterationsPerGame: 200,
    maxGames: 10,
  })

  expect(result.atLeast).toHaveLength(5)
  expect(result.atLeast[0]).toBeCloseTo(1.0, 5)
  // Monotonic
  for (let i = 1; i < result.atLeast.length; i++) {
    expect(result.atLeast[i]).toBeLessThanOrEqual(result.atLeast[i - 1])
  }
  // Should have been based on real games (> 0)
  expect(result.basedOnGames).toBeGreaterThan(0)
}, 120_000)
