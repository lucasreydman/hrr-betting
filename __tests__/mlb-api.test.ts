/**
 * __tests__/mlb-api.test.ts
 *
 * Live smoke tests for the MLB Stats API adapter.
 * All tests are gated by RUN_LIVE_TESTS=1 so they do not run in CI.
 *
 * Run live:
 *   RUN_LIVE_TESTS=1 npm test -- mlb-api
 */

import {
  fetchSchedule,
  fetchProbablePitchers,
  fetchLineup,
  fetchBoxscore,
  fetchPitcherSeasonStats,
  fetchPitcherRecentStarts,
  fetchBatterSeasonStats,
  fetchBatterGameLog,
  fetchTeamBullpenStats,
  fetchBvP,
  fetchPlayerSlotFrequency,
} from '@/lib/mlb-api'

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1'
const maybe = RUN_LIVE ? test : test.skip

// ---------------------------------------------------------------------------
// fetchSchedule
// ---------------------------------------------------------------------------

maybe('fetchSchedule returns games for a known date', async () => {
  const games = await fetchSchedule('2025-07-04')
  expect(games.length).toBeGreaterThan(0)
  expect(games[0]).toMatchObject({
    gameId:   expect.any(Number),
    gameDate: expect.any(String),
    homeTeam: expect.objectContaining({ teamId: expect.any(Number) }),
    awayTeam: expect.objectContaining({ teamId: expect.any(Number) }),
  })
}, 30_000)

// ---------------------------------------------------------------------------
// fetchProbablePitchers
// ---------------------------------------------------------------------------

maybe('fetchProbablePitchers returns pitcher IDs or 0', async () => {
  // Use a well-known 2025 game pk if available; otherwise just verify shape
  const games = await fetchSchedule('2025-07-04')
  const firstGame = games[0]
  if (!firstGame) return  // no games on date — skip gracefully
  const probables = await fetchProbablePitchers(firstGame.gameId)
  expect(typeof probables.home).toBe('number')
  expect(typeof probables.away).toBe('number')
}, 30_000)

// ---------------------------------------------------------------------------
// fetchPitcherSeasonStats
// ---------------------------------------------------------------------------

maybe('fetchPitcherSeasonStats returns plausible numbers for Gerrit Cole', async () => {
  // Gerrit Cole — playerId 543037
  const s = await fetchPitcherSeasonStats(543037, 2024)
  expect(s.fip).toBeGreaterThan(2)
  expect(s.fip).toBeLessThan(7)
  expect(s.kPct).toBeGreaterThan(0.1)
  expect(s.kPct).toBeLessThan(0.5)
  expect(s.ip).toBeGreaterThan(0)
}, 30_000)

maybe('fetchPitcherSeasonStats returns fallback for unknown pitcher', async () => {
  const s = await fetchPitcherSeasonStats(999999999, 2024)
  // Should return league-average fallback — not throw
  expect(s.pitcherId).toBe(999999999)
  expect(typeof s.fip).toBe('number')
}, 30_000)

// ---------------------------------------------------------------------------
// fetchPitcherRecentStarts
// ---------------------------------------------------------------------------

maybe('fetchPitcherRecentStarts returns start lines', async () => {
  // Gerrit Cole 2024 season
  const starts = await fetchPitcherRecentStarts(543037, 5, 2024)
  expect(Array.isArray(starts)).toBe(true)
  if (starts.length > 0) {
    expect(starts[0]).toMatchObject({
      gameDate: expect.any(String),
      ip:       expect.any(Number),
    })
    expect(starts[0].ip).toBeGreaterThan(0)
  }
}, 30_000)

// ---------------------------------------------------------------------------
// fetchBatterSeasonStats
// ---------------------------------------------------------------------------

maybe('fetchBatterSeasonStats returns plausible numbers for Mookie Betts', async () => {
  // Mookie Betts — playerId 605141
  const s = await fetchBatterSeasonStats(605141, 2024)
  expect(s.batterId).toBe(605141)
  expect(s.pa).toBeGreaterThan(0)
  const rates = s.outcomeRates
  const sum = Object.values(rates).reduce((a, b) => a + b, 0)
  expect(sum).toBeCloseTo(1, 1)
}, 30_000)

// ---------------------------------------------------------------------------
// fetchBatterGameLog
// ---------------------------------------------------------------------------

maybe('fetchBatterGameLog returns game entries', async () => {
  // Mookie Betts 2024
  const log = await fetchBatterGameLog(605141, 2024)
  expect(Array.isArray(log)).toBe(true)
  expect(log.length).toBeGreaterThan(0)
  expect(log[0]).toMatchObject({
    gameDate:   expect.any(String),
    pa:         expect.any(Number),
    hits:       expect.any(Number),
  })
}, 30_000)

// ---------------------------------------------------------------------------
// fetchBoxscore
// ---------------------------------------------------------------------------

maybe('fetchBoxscore returns a valid shape for a 2024 game', async () => {
  // Use a known completed 2024 game (e.g. World Series Game 1 gamePk 745453)
  const box = await fetchBoxscore(745453)
  expect(box.gameId).toBe(745453)
  expect(['final', 'in_progress', 'scheduled']).toContain(box.status)
  expect(typeof box.playerStats).toBe('object')
}, 30_000)

// ---------------------------------------------------------------------------
// fetchTeamBullpenStats
// ---------------------------------------------------------------------------

maybe('fetchTeamBullpenStats returns a valid shape for the Yankees', async () => {
  // Yankees teamId = 147
  const bullpen = await fetchTeamBullpenStats(147, 2024)
  expect(bullpen).toMatchObject({
    highLeverage: expect.objectContaining({
      fip:    expect.any(Number),
      kPct:   expect.any(Number),
      bbPct:  expect.any(Number),
      hrPer9: expect.any(Number),
    }),
    rest: expect.objectContaining({
      fip: expect.any(Number),
    }),
  })
}, 30_000)

// ---------------------------------------------------------------------------
// fetchBvP
// ---------------------------------------------------------------------------

maybe('fetchBvP returns a valid BvP record', async () => {
  // Mookie Betts (605141) vs a common opponent — Gerrit Cole (543037)
  const bvp = await fetchBvP(605141, 543037)
  expect(typeof bvp.ab).toBe('number')
  expect(typeof bvp.hits).toBe('number')
  expect(bvp.hits).toBeLessThanOrEqual(bvp.ab)
}, 30_000)

maybe('fetchBvP returns zero record for no-data matchup', async () => {
  // Unlikely matchup
  const bvp = await fetchBvP(999999998, 999999997)
  expect(bvp.ab).toBe(0)
  expect(bvp.hits).toBe(0)
}, 30_000)

// ---------------------------------------------------------------------------
// fetchPlayerSlotFrequency
// ---------------------------------------------------------------------------

maybe('fetchPlayerSlotFrequency returns normalized fractions', async () => {
  // Mookie Betts 2024
  const freq = await fetchPlayerSlotFrequency(605141, 2024)
  const sum = Object.values(freq).reduce((a, b) => a + b, 0)
  if (Object.keys(freq).length > 0) {
    expect(sum).toBeCloseTo(1, 2)
    for (const slot of Object.keys(freq)) {
      const n = Number(slot)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(9)
    }
  }
}, 30_000)

// ---------------------------------------------------------------------------
// fetchLineup
// ---------------------------------------------------------------------------

maybe('fetchLineup returns a lineup with ≤9 entries', async () => {
  const games = await fetchSchedule('2025-07-04')
  const game  = games[0]
  if (!game) return
  const lineup = await fetchLineup(game.gameId, game.homeTeam.teamId, 'home', '2025-07-04')
  expect(['confirmed', 'partial', 'estimated']).toContain(lineup.status)
  expect(lineup.entries.length).toBeLessThanOrEqual(9)
  if (lineup.entries.length > 0) {
    expect(lineup.entries[0]).toMatchObject({
      slot:   expect.any(Number),
      player: expect.objectContaining({ playerId: expect.any(Number) }),
    })
  }
}, 30_000)
