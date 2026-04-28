import { getSlateBatterIds } from '@/lib/slate-batters'
import type { Game, Lineup } from '@/lib/types'

jest.mock('@/lib/mlb-api', () => ({
  fetchSchedule: jest.fn(),
  fetchLineup: jest.fn(),
}))

jest.mock('@/lib/lineup', () => ({
  fetchLineup: jest.fn(),
}))

import { fetchSchedule } from '@/lib/mlb-api'
import { fetchLineup } from '@/lib/lineup'

const mockFetchSchedule = fetchSchedule as jest.MockedFunction<typeof fetchSchedule>
const mockFetchLineup = fetchLineup as jest.MockedFunction<typeof fetchLineup>

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    gameId: 1,
    gameDate: '2026-04-28T19:05:00Z',
    homeTeam: { teamId: 147, abbrev: 'NYY', name: 'New York Yankees' },
    awayTeam: { teamId: 117, abbrev: 'HOU', name: 'Houston Astros' },
    venueId: 3313,
    venueName: 'Yankee Stadium',
    status: 'scheduled',
    ...overrides,
  }
}

function makeLineup(playerIds: number[]): Lineup {
  return {
    status: 'confirmed',
    entries: playerIds.map((id, i) => ({
      slot: i + 1,
      player: { playerId: id, fullName: `Player ${id}`, team: 'NYY', bats: 'R' },
    })),
  }
}

afterEach(() => {
  jest.resetAllMocks()
})

describe('getSlateBatterIds', () => {
  it('returns empty array when no games on schedule', async () => {
    mockFetchSchedule.mockResolvedValue([])
    const ids = await getSlateBatterIds('1990-01-01')
    expect(ids).toEqual([])
  })

  it('skips postponed and final games', async () => {
    mockFetchSchedule.mockResolvedValue([
      makeGame({ gameId: 1, status: 'postponed' }),
      makeGame({ gameId: 2, status: 'final' }),
    ])
    const ids = await getSlateBatterIds('2026-04-28')
    expect(ids).toEqual([])
    expect(mockFetchLineup).not.toHaveBeenCalled()
  })

  it('deduplicates batters across multiple games', async () => {
    mockFetchSchedule.mockResolvedValue([
      makeGame({ gameId: 10, homeTeam: { teamId: 147, abbrev: 'NYY', name: 'NYY' }, awayTeam: { teamId: 117, abbrev: 'HOU', name: 'HOU' } }),
      makeGame({ gameId: 11, homeTeam: { teamId: 143, abbrev: 'PHI', name: 'PHI' }, awayTeam: { teamId: 137, abbrev: 'SF', name: 'SF' } }),
    ])

    // Game 10: home players 1-9, away players 10-18
    // Game 11: home players 1-5 (overlap with game 10 home) + 20-23, away players 30-38
    mockFetchLineup
      .mockResolvedValueOnce(makeLineup([1, 2, 3, 4, 5, 6, 7, 8, 9]))      // game 10 home
      .mockResolvedValueOnce(makeLineup([10, 11, 12, 13, 14, 15, 16, 17, 18]))  // game 10 away
      .mockResolvedValueOnce(makeLineup([1, 2, 3, 4, 5, 20, 21, 22, 23]))    // game 11 home (overlap 1-5)
      .mockResolvedValueOnce(makeLineup([30, 31, 32, 33, 34, 35, 36, 37, 38]))  // game 11 away

    const ids = await getSlateBatterIds('2026-04-28')

    // 9 + 9 + 4 new (20-23) + 9 (30-38) = 31 unique
    expect(ids.length).toBe(31)
    // All unique
    expect(new Set(ids).size).toBe(ids.length)
    // Players 1-5 appear only once despite being in two lineups
    expect(ids.filter(id => id === 1)).toHaveLength(1)
  })

  it('includes in_progress games', async () => {
    mockFetchSchedule.mockResolvedValue([
      makeGame({ gameId: 20, status: 'in_progress' }),
    ])
    mockFetchLineup
      .mockResolvedValueOnce(makeLineup([100, 101, 102]))
      .mockResolvedValueOnce(makeLineup([200, 201, 202]))

    const ids = await getSlateBatterIds('2026-04-28')
    expect(ids.sort()).toEqual([100, 101, 102, 200, 201, 202].sort())
  })
})
