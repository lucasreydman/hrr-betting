/**
 * Shared mapper for history routes — converts a Supabase `settled_picks`
 * row into the `SettledPick` shape used by the UI. Lives outside `route.ts`
 * so multiple history endpoints (`/api/history`, `/api/history/all`) can
 * reuse it without circular re-export trickery.
 */

import type { SettledPickRow } from './db'
import type { SettledPick } from './tracker'

export function rowToSettledPick(row: SettledPickRow): SettledPick {
  return {
    player: {
      playerId: row.player_id,
      fullName: row.player_name,
      team: row.player_team,
      // teamId 0 = sentinel for settled history rows that predate the teamId schema.
      teamId: 0,
      bats: row.player_bats,
    },
    // isHome false = sentinel; UI falls back to abbreviation for teamId=0 picks.
    isHome: false,
    opponent: { teamId: row.opponent_team_id, abbrev: row.opponent_abbrev },
    // Settled history doesn't carry the opposing-pitcher metadata; use 'confirmed'
    // since the game is settled. Future schema migration can add these columns.
    opposingPitcher: { id: 0, name: 'unknown', status: 'confirmed' },
    gameId: row.game_id,
    rung: row.rung,
    date: row.date,
    lineupSlot: row.lineup_slot,
    lineupStatus: row.lineup_status,
    pMatchup: row.p_matchup,
    pTypical: row.p_typical,
    edge: row.edge,
    confidence: row.confidence,
    score: row.score,
    tier: 'tracked',
    outcome: row.outcome,
    actualHRR: row.actual_hrr ?? undefined,
  }
}
