/**
 * Sort comparator for the board.
 *
 * Pure helper extracted from Board.tsx so the sort behaviour can be unit-
 * tested without React. Numeric keys (score / pTypical / pMatchup / edge /
 * confidence) sort descending; the `game` key groups by first pitch
 * (earliest first), then gameId, then score-desc within a game.
 */

import { comparePicks, type SortKey } from '@/components/Board'
import type { Pick } from '@/lib/ranker'

type Sortable = Pick & { rung: 1 | 2 | 3 }

/**
 * Build a minimal `Pick & { rung }` shape for sorting tests. Only the
 * fields the comparator reads need to be real — everything else gets
 * placeholder defaults.
 */
function makePick(overrides: Partial<Sortable>): Sortable {
  return {
    player: { playerId: 1, fullName: 'X', team: 'XXX', teamId: 0, bats: 'R' },
    isHome: false,
    opponent: { teamId: 0, abbrev: 'OOO' },
    opposingPitcher: { id: 0, name: 'TBD', status: 'tbd' },
    gameId: 1,
    lineupSlot: 1,
    lineupStatus: 'confirmed',
    pMatchup: 0.5,
    pTypical: 0.5,
    edge: 0,
    confidence: 1,
    score: 0,
    tier: 'tracked',
    rung: 1,
    ...overrides,
  }
}

function sorted(picks: Sortable[], sortKey: SortKey): Sortable[] {
  return [...picks].sort((a, b) => comparePicks(a, b, sortKey))
}

describe('comparePicks — numeric keys', () => {
  test('score: descending', () => {
    const out = sorted(
      [makePick({ score: 0.1 }), makePick({ score: 0.5 }), makePick({ score: 0.3 })],
      'score',
    )
    expect(out.map(p => p.score)).toEqual([0.5, 0.3, 0.1])
  })

  test('edge: negative edges sort below positive', () => {
    const out = sorted(
      [makePick({ edge: -0.2 }), makePick({ edge: 0.4 }), makePick({ edge: 0.0 })],
      'edge',
    )
    expect(out.map(p => p.edge)).toEqual([0.4, 0.0, -0.2])
  })

  test('confidence: handles ties (stable order is fine, no swaps)', () => {
    const out = sorted(
      [makePick({ confidence: 0.85 }), makePick({ confidence: 0.85 })],
      'confidence',
    )
    expect(out).toHaveLength(2)
  })
})

describe('comparePicks — game key', () => {
  test('groups by first-pitch time, earliest first', () => {
    // Three games at 1pm, 4pm, 7pm ET. Two picks per game, in scrambled
    // input order. Expected output: all 1pm picks, then all 4pm, then 7pm.
    const a1 = makePick({ gameId: 100, gameDate: '2026-05-04T17:00:00Z', score: 0.5 })
    const a2 = makePick({ gameId: 100, gameDate: '2026-05-04T17:00:00Z', score: 0.7 })
    const b1 = makePick({ gameId: 200, gameDate: '2026-05-04T20:00:00Z', score: 0.6 })
    const b2 = makePick({ gameId: 200, gameDate: '2026-05-04T20:00:00Z', score: 0.4 })
    const c1 = makePick({ gameId: 300, gameDate: '2026-05-04T23:00:00Z', score: 0.8 })

    const out = sorted([b1, c1, a1, b2, a2], 'game')

    // Game 100 picks first (earliest), then 200, then 300.
    expect(out.map(p => p.gameId)).toEqual([100, 100, 200, 200, 300])
  })

  test('within a game: score descending so the best play in the cluster leads', () => {
    const high = makePick({ gameId: 100, gameDate: '2026-05-04T17:00:00Z', score: 0.7 })
    const low  = makePick({ gameId: 100, gameDate: '2026-05-04T17:00:00Z', score: 0.3 })

    const out = sorted([low, high], 'game')

    expect(out.map(p => p.score)).toEqual([0.7, 0.3])
  })

  test('doubleheader pair: same time, different gameId — gameId tiebreaker keeps the pair separated', () => {
    // Real doubleheaders share gameDate down to the minute (game 2's
    // gameDate is a placeholder until game 1 finishes). gameId is the
    // stable tiebreaker.
    const dh1Pick = makePick({ gameId: 800001, gameDate: '2026-05-04T17:00:00Z', score: 0.4 })
    const dh2Pick = makePick({ gameId: 800002, gameDate: '2026-05-04T17:00:00Z', score: 0.6 })

    const out = sorted([dh2Pick, dh1Pick], 'game')

    // Lower gameId first — the picks for one game are NOT interleaved
    // with the picks for the other.
    expect(out.map(p => p.gameId)).toEqual([800001, 800002])
  })

  test('missing gameDate sinks to the bottom (legacy locked picks)', () => {
    const dated = makePick({ gameId: 100, gameDate: '2026-05-04T17:00:00Z' })
    const undated = makePick({ gameId: 999, gameDate: undefined })

    const out = sorted([undated, dated], 'game')

    // Undated rows should never push real-time games down the list.
    expect(out[0].gameId).toBe(100)
    expect(out[1].gameId).toBe(999)
  })

  test('empty input is a no-op', () => {
    expect(sorted([], 'game')).toEqual([])
  })
})
