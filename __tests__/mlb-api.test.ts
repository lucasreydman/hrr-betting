/**
 * __tests__/mlb-api.test.ts
 *
 * MLB Stats API adapter tests, fully hermetic. Each test stubs `global.fetch`
 * with a canned response that mirrors what the live MLB Stats API returns,
 * so we exercise the adapter's parsing + fallback behaviour without touching
 * the network. No RUN_LIVE_TESTS gating — every test runs in CI by default.
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

/** Build a Response wrapper from a JSON body. */
function jsonResp(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response
}

/**
 * Mock global.fetch with a per-URL-pattern dispatcher so a single test can
 * exercise functions that hit multiple endpoints (e.g. fetchLineup may try
 * boxscore + schedule).
 *
 * Returns a `jest.SpyInstance` so the test can assert call counts / URLs;
 * remember to call `.mockRestore()` in afterEach.
 */
function mockFetch(handler: (url: string) => Response | Promise<Response>): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    return handler(String(input))
  })
}

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// fetchSchedule
// ---------------------------------------------------------------------------

describe('fetchSchedule', () => {
  test('returns games for a known date', async () => {
    mockFetch(() => jsonResp({
      dates: [{
        games: [
          {
            gamePk: 745453,
            gameDate: '2025-07-04T19:05:00Z',
            status: { detailedState: 'Scheduled', abstractGameState: 'Preview' },
            venue: { id: 3313, name: 'Yankee Stadium' },
            teams: {
              home: { team: { id: 147, name: 'New York Yankees', abbreviation: 'NYY' } },
              away: { team: { id: 117, name: 'Houston Astros',   abbreviation: 'HOU' } },
            },
          },
        ],
      }],
    }))

    const games = await fetchSchedule('2099-07-04')  // year unused by tests w/ kv cache
    expect(games.length).toBe(1)
    expect(games[0]).toMatchObject({
      gameId:    745453,
      gameDate:  '2025-07-04T19:05:00Z',
      homeTeam:  expect.objectContaining({ teamId: 147, abbrev: 'NYY' }),
      awayTeam:  expect.objectContaining({ teamId: 117, abbrev: 'HOU' }),
      venueId:   3313,
      venueName: 'Yankee Stadium',
      status:    'scheduled',
    })
  })

  test('filters out postponed/cancelled games', async () => {
    mockFetch(() => jsonResp({
      dates: [{
        games: [
          {
            gamePk: 1, gameDate: '2025-07-04T19:00Z',
            status: { detailedState: 'Postponed', abstractGameState: 'Preview' },
            venue: { id: 3313, name: 'Yankee Stadium' },
            teams: {
              home: { team: { id: 147, name: 'NYY', abbreviation: 'NYY' } },
              away: { team: { id: 117, name: 'HOU', abbreviation: 'HOU' } },
            },
          },
          {
            gamePk: 2, gameDate: '2025-07-04T19:00Z',
            status: { detailedState: 'Scheduled', abstractGameState: 'Preview' },
            venue: { id: 3313, name: 'Yankee Stadium' },
            teams: {
              home: { team: { id: 147, name: 'NYY', abbreviation: 'NYY' } },
              away: { team: { id: 117, name: 'HOU', abbreviation: 'HOU' } },
            },
          },
        ],
      }],
    }))
    const games = await fetchSchedule('2099-07-05')
    expect(games.map(g => g.gameId)).toEqual([2])
  })

  test('returns empty array on HTTP failure', async () => {
    mockFetch(() => jsonResp({}, { ok: false, status: 500 }))
    const games = await fetchSchedule('2099-07-06')
    expect(games).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// fetchProbablePitchers
// ---------------------------------------------------------------------------

describe('fetchProbablePitchers', () => {
  test('returns home/away IDs from schedule probable pitcher hydration', async () => {
    mockFetch(() => jsonResp({
      dates: [{ games: [{
        teams: {
          home: { probablePitcher: { id: 543037, fullName: 'Gerrit Cole' } },
          away: { probablePitcher: { id: 676440, fullName: 'Mason Miller' } },
        },
      }] }],
    }))
    const probables = await fetchProbablePitchers(801001)
    expect(probables).toEqual({ home: 543037, away: 676440 })
  })

  test('returns 0 sentinels when probable pitcher is TBD', async () => {
    mockFetch(() => jsonResp({
      dates: [{ games: [{ teams: { home: {}, away: {} } }] }],
    }))
    const probables = await fetchProbablePitchers(801002)
    expect(probables).toEqual({ home: 0, away: 0 })
  })
})

// ---------------------------------------------------------------------------
// fetchPitcherSeasonStats
// ---------------------------------------------------------------------------

describe('fetchPitcherSeasonStats', () => {
  test('parses real season stats into FIP / K% / BB% / HR9', async () => {
    mockFetch(() => jsonResp({
      stats: [{ splits: [{ stat: {
        homeRuns: 16, baseOnBalls: 50, hitByPitch: 5, strikeOuts: 220,
        inningsPitched: '180.1', battersFaced: 720,
      } }] }],
    }))
    const s = await fetchPitcherSeasonStats(802001, 2099)
    expect(s.pitcherId).toBe(802001)
    expect(s.ip).toBeCloseTo(180 + 1 / 3, 4)
    expect(s.kPct).toBeCloseTo(220 / 720, 4)
    expect(s.bbPct).toBeCloseTo(50 / 720, 4)
    expect(s.hrPer9).toBeCloseTo(16 * 9 / (180 + 1 / 3), 4)
    expect(s.fip).toBeGreaterThan(2)
    expect(s.fip).toBeLessThan(7)
  })

  test('returns league-avg fallback for unknown pitcher (HTTP error)', async () => {
    mockFetch(() => jsonResp({}, { ok: false, status: 404 }))
    const s = await fetchPitcherSeasonStats(802002, 2099)
    expect(s.pitcherId).toBe(802002)
    expect(typeof s.fip).toBe('number')
    expect(s.ip).toBe(0)
  })

  test('returns league-avg fallback for empty splits', async () => {
    mockFetch(() => jsonResp({ stats: [{ splits: [] }] }))
    const s = await fetchPitcherSeasonStats(802003, 2099)
    expect(s.ip).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// fetchPitcherRecentStarts
// ---------------------------------------------------------------------------

describe('fetchPitcherRecentStarts', () => {
  test('parses gameLog into StartLine[], excludes 0-IP relief appearances', async () => {
    mockFetch(() => jsonResp({
      stats: [{ splits: [
        { date: '2025-04-12', stat: { inningsPitched: '6.0' } },
        { date: '2025-04-07', stat: { inningsPitched: '5.2' } },
        { date: '2025-04-03', stat: { inningsPitched: '0.0' } },  // relief; excluded
        { date: '2025-03-30', stat: { inningsPitched: '7.0' } },
      ] }],
    }))
    const starts = await fetchPitcherRecentStarts(803001, 5, 2099)
    expect(starts.map(s => s.gameDate)).toEqual(['2025-04-12', '2025-04-07', '2025-03-30'])
    expect(starts[0].ip).toBe(6.0)
    expect(starts[1].ip).toBeCloseTo(5 + 2 / 3, 4)
  })

  test('respects the n cap (newest first)', async () => {
    const splits = Array.from({ length: 10 }, (_, i) => ({
      date: `2025-04-${String(i + 1).padStart(2, '0')}`,
      stat: { inningsPitched: '6.0' },
    }))
    mockFetch(() => jsonResp({ stats: [{ splits }] }))
    const starts = await fetchPitcherRecentStarts(803002, 3, 2099)
    expect(starts).toHaveLength(3)
    expect(starts[0].gameDate).toBe('2025-04-10')
  })

  test('returns empty array on HTTP failure', async () => {
    mockFetch(() => jsonResp({}, { ok: false, status: 500 }))
    const starts = await fetchPitcherRecentStarts(803003, 5, 2099)
    expect(starts).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// fetchBatterSeasonStats
// ---------------------------------------------------------------------------

describe('fetchBatterSeasonStats', () => {
  test('parses season counts into outcomeRates that sum to 1', async () => {
    mockFetch(() => jsonResp({
      stats: [{ splits: [{ stat: {
        plateAppearances: 600, atBats: 540, hits: 165,
        doubles: 30, triples: 5, homeRuns: 25,
        baseOnBalls: 60, strikeOuts: 110, hitByPitch: 5,
      } }] }],
    }))
    const s = await fetchBatterSeasonStats(804001, 2099)
    expect(s.batterId).toBe(804001)
    expect(s.pa).toBe(600)
    expect(s.hits).toBe(165)
    const sum = Object.values(s.outcomeRates).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 4)
    expect(s.outcomeRates.HR).toBeCloseTo(25 / 600, 4)
  })

  test('returns league-avg fallback when PA = 0', async () => {
    mockFetch(() => jsonResp({
      stats: [{ splits: [{ stat: {
        plateAppearances: 0, atBats: 0, hits: 0,
        doubles: 0, triples: 0, homeRuns: 0, baseOnBalls: 0, strikeOuts: 0,
      } }] }],
    }))
    const s = await fetchBatterSeasonStats(804002, 2099)
    expect(s.pa).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// fetchBatterGameLog
// ---------------------------------------------------------------------------

describe('fetchBatterGameLog', () => {
  test('parses splits into per-game entries, sorted newest-first', async () => {
    mockFetch(() => jsonResp({
      stats: [{ splits: [
        { date: '2025-04-05', stat: { plateAppearances: 4, atBats: 4, hits: 2, doubles: 1, triples: 0, homeRuns: 0, baseOnBalls: 0, strikeOuts: 1 } },
        { date: '2025-04-10', stat: { plateAppearances: 5, atBats: 4, hits: 3, doubles: 0, triples: 0, homeRuns: 1, baseOnBalls: 1, strikeOuts: 0 } },
        { date: '2025-04-07', stat: { plateAppearances: 4, atBats: 3, hits: 1, doubles: 0, triples: 0, homeRuns: 0, baseOnBalls: 1, strikeOuts: 1 } },
      ] }],
    }))
    const log = await fetchBatterGameLog(805001, 2099)
    expect(log.map(e => e.gameDate)).toEqual(['2025-04-10', '2025-04-07', '2025-04-05'])
    expect(log[0].pa).toBe(5)
    expect(log[0].homeRuns).toBe(1)
  })

  test('PA fallback uses ab + bb + hbp + sf when plateAppearances is missing', async () => {
    mockFetch(() => jsonResp({
      stats: [{ splits: [
        { date: '2025-04-05', stat: { atBats: 4, hits: 1, baseOnBalls: 1, hitByPitch: 0, sacFlies: 1 } },
      ] }],
    }))
    const log = await fetchBatterGameLog(805002, 2099)
    expect(log[0].pa).toBe(6)  // 4 + 1 + 0 + 1
  })

  test('returns empty array on HTTP failure', async () => {
    mockFetch(() => jsonResp({}, { ok: false, status: 500 }))
    const log = await fetchBatterGameLog(805003, 2099)
    expect(log).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// fetchBoxscore
// ---------------------------------------------------------------------------

describe('fetchBoxscore', () => {
  test('parses final boxscore into per-player {hits, runs, rbis}', async () => {
    mockFetch(() => jsonResp({
      teams: {
        home: { players: {
          ID111: { person: { id: 111, fullName: 'Aaron Judge' }, stats: { batting: { hits: 2, runs: 1, rbi: 3 } } },
          ID222: { person: { id: 222, fullName: 'Anthony Volpe' }, stats: { batting: { hits: 0, runs: 0, rbi: 0 } } },
        } },
        away: { players: {
          ID333: { person: { id: 333, fullName: 'Mookie Betts' }, stats: { batting: { hits: 1, runs: 1, rbi: 0 } } },
        } },
      },
      gameData: { status: { abstractGameState: 'Final' } },
    }))
    const box = await fetchBoxscore(806001)
    expect(box.gameId).toBe(806001)
    expect(box.status).toBe('final')
    expect(box.playerStats[111]).toEqual({ hits: 2, runs: 1, rbis: 3 })
    expect(box.playerStats[222]).toEqual({ hits: 0, runs: 0, rbis: 0 })
    expect(box.playerStats[333]).toEqual({ hits: 1, runs: 1, rbis: 0 })
  })

  test('returns empty playerStats fallback on HTTP failure', async () => {
    mockFetch(() => jsonResp({}, { ok: false, status: 500 }))
    const box = await fetchBoxscore(806002)
    expect(box.gameId).toBe(806002)
    expect(box.status).toBe('scheduled')
    expect(box.playerStats).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// fetchTeamBullpenStats
// ---------------------------------------------------------------------------

describe('fetchTeamBullpenStats', () => {
  test('returns highLeverage and rest tiers from team stats', async () => {
    // Need ≥ 1 reliever (≥ 10 appearances, < 50% starts) for tiering
    const splits = Array.from({ length: 8 }, (_, i) => ({
      player: { id: 700000 + i, fullName: `Reliever ${i}` },
      stat: {
        gamesPlayed: 50, gamesStarted: 0,
        homeRuns: 5 + i, baseOnBalls: 20, hitByPitch: 1, strikeOuts: 60,
        inningsPitched: '50.0', battersFaced: 200,
      },
    }))
    mockFetch(() => jsonResp({ stats: [{ splits }] }))
    const bullpen = await fetchTeamBullpenStats(807001, 2099)
    expect(bullpen.highLeverage).toMatchObject({
      fip: expect.any(Number),
      kPct: expect.any(Number),
      bbPct: expect.any(Number),
      hrPer9: expect.any(Number),
    })
    expect(bullpen.rest).toMatchObject({ fip: expect.any(Number) })
    // High-leverage tier should have lower FIP than rest (sorted ascending by FIP).
    expect(bullpen.highLeverage.fip).toBeLessThanOrEqual(bullpen.rest.fip)
  })

  test('falls back gracefully when no relievers qualify', async () => {
    mockFetch(() => jsonResp({ stats: [{ splits: [] }] }))
    const bullpen = await fetchTeamBullpenStats(807002, 2099)
    expect(bullpen.highLeverage).toMatchObject({ fip: expect.any(Number) })
    expect(bullpen.rest).toMatchObject({ fip: expect.any(Number) })
  })
})

// ---------------------------------------------------------------------------
// fetchBvP
// ---------------------------------------------------------------------------

describe('fetchBvP', () => {
  test('parses career BvP totals into a typed record', async () => {
    mockFetch(() => jsonResp({
      stats: [{ splits: [{ stat: {
        atBats: 30, hits: 10, doubles: 2, triples: 0, homeRuns: 2,
        baseOnBalls: 5, strikeOuts: 8, hitByPitch: 1,
      } }] }],
    }))
    const bvp = await fetchBvP(808001, 808101)
    expect(bvp).toEqual({
      ab: 30, hits: 10,
      '1B': 6,   // 10 − 2 − 0 − 2
      '2B': 2,
      '3B': 0,
      HR: 2,
      BB: 6,    // 5 + 1 hbp
      K: 8,
    })
  })

  test('returns zero record when matchup has no recorded data', async () => {
    mockFetch(() => jsonResp({ stats: [{ splits: [] }] }))
    const bvp = await fetchBvP(808002, 808102)
    expect(bvp).toEqual({ ab: 0, hits: 0, '1B': 0, '2B': 0, '3B': 0, HR: 0, BB: 0, K: 0 })
  })

  test('returns zero record on HTTP failure', async () => {
    mockFetch(() => jsonResp({}, { ok: false, status: 500 }))
    const bvp = await fetchBvP(808003, 808103)
    expect(bvp.ab).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// fetchPlayerSlotFrequency
// ---------------------------------------------------------------------------

describe('fetchPlayerSlotFrequency', () => {
  test('counts batting-order slots and normalises to fractions summing to 1', async () => {
    // battingOrder is "<slot><pos><PH>" — first char is slot, "100" = slot 1 starter,
    // "401" = slot 4 PH (excluded).
    mockFetch(() => jsonResp({
      stats: [{ splits: [
        { date: '1', battingOrder: '300', stat: { plateAppearances: 4 } },
        { date: '2', battingOrder: '300', stat: { plateAppearances: 4 } },
        { date: '3', battingOrder: '400', stat: { plateAppearances: 4 } },
        { date: '4', battingOrder: '401', stat: { plateAppearances: 1 } },  // PH; excluded
        { date: '5', battingOrder: undefined, stat: { plateAppearances: 1 } }, // no order; excluded
      ] }],
    }))
    const freq = await fetchPlayerSlotFrequency(809001, 2099)
    expect(freq[3]).toBeCloseTo(2 / 3, 4)
    expect(freq[4]).toBeCloseTo(1 / 3, 4)
    const sum = Object.values(freq).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 4)
  })

  test('returns empty object when no qualifying starts', async () => {
    mockFetch(() => jsonResp({ stats: [{ splits: [] }] }))
    const freq = await fetchPlayerSlotFrequency(809002, 2099)
    expect(freq).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// fetchLineup
// ---------------------------------------------------------------------------

describe('fetchLineup', () => {
  test('Tier 1 — confirmed lineup from boxscore batters[]', async () => {
    mockFetch((url) => {
      if (url.includes('/boxscore')) {
        return jsonResp({
          teams: {
            home: {
              team: { id: 147, name: 'NYY', abbreviation: 'NYY' },
              batters: [111, 222, 333, 444, 555, 666, 777, 888, 999],
            },
          },
        })
      }
      // /people batch hydration call
      if (url.includes('/people?personIds=')) {
        return jsonResp({ people: [] })  // no enrichment — leave stubs
      }
      throw new Error(`Unmocked fetch: ${url}`)
    })

    const lineup = await fetchLineup(810001, 147, 'home', '2099-04-27')
    expect(lineup.status).toBe('confirmed')
    expect(lineup.entries).toHaveLength(9)
    expect(lineup.entries.map(e => e.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(lineup.entries.map(e => e.player.playerId)).toEqual([
      111, 222, 333, 444, 555, 666, 777, 888, 999,
    ])
  })

  test('Tier 3 — falls back to estimated when boxscore + schedule are empty', async () => {
    mockFetch((url) => {
      // Boxscore: no batters
      if (url.includes('/boxscore')) {
        return jsonResp({ teams: { home: { team: { id: 147, abbreviation: 'NYY' }, batters: [] } } })
      }
      // Schedule with lineups hydration: no players
      if (url.includes('/schedule') && url.includes('gamePk=')) {
        return jsonResp({ dates: [{ games: [{ lineups: { homePlayers: [], awayPlayers: [] } }] }] })
      }
      // Schedule with date range (estimated lineup builder): one game with 9 players
      if (url.includes('/schedule') && url.includes('teamId=')) {
        return jsonResp({
          dates: [{
            games: [{
              gameDate: '2099-04-25',
              status: { detailedState: 'Final', abstractGameState: 'Final' },
              teams: {
                home: { team: { id: 147, name: 'NYY', abbreviation: 'NYY' } },
                away: { team: { id: 117, name: 'HOU', abbreviation: 'HOU' } },
              },
              lineups: {
                homePlayers: Array.from({ length: 9 }, (_, i) => ({ id: 1000 + i, fullName: `P ${i}` })),
              },
            }],
          }],
        })
      }
      if (url.includes('/people?personIds=')) {
        return jsonResp({ people: [] })
      }
      throw new Error(`Unmocked fetch: ${url}`)
    })

    const lineup = await fetchLineup(810002, 147, 'home', '2099-04-27')
    expect(lineup.status).toBe('estimated')
    expect(lineup.entries.length).toBeGreaterThan(0)
    // Estimator now guarantees integer slots 1-9 with no duplicates.
    const slots = lineup.entries.map(e => e.slot)
    for (const s of slots) expect(Number.isInteger(s)).toBe(true)
    const unique = new Set(slots)
    expect(unique.size).toBe(slots.length)
  })
})
