import { NextResponse } from 'next/server'
import { getSettledPicks, computeRollingMetrics, type SettledPick } from '@/lib/tracker'
import { slateDateString, shiftIsoDate } from '@/lib/date-utils'
import type { Rung } from '@/lib/types'
import type { SettledPickRow } from '@/lib/db'

export interface HistoryResponse {
  rolling30Day: {
    overall: { hits: number; total: number; rate: number }
    perRung: Record<Rung, { hits: number; total: number; rate: number; predictedAvg: number; brier: number }>
  }
  byDate: Array<{ date: string; pickCount: number; hits: number; miss: number; pending: number }>
  recentPicks: SettledPick[]
}

function rowToSettledPick(row: SettledPickRow): SettledPick {
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

export async function GET(): Promise<NextResponse<HistoryResponse>> {
  // Anchor the rolling window on the slate date (ET, 3 AM rollover) — the
  // same boundary used everywhere else in the app — so the window doesn't
  // shift by a day during late-night ET hours when UTC today != slate today.
  const since = shiftIsoDate(slateDateString(), -30)

  // ONE query (Supabase) or one fallback iteration (KV) — replaces 30 sequential KV gets
  const rows = await getSettledPicks({ sinceDate: since })

  // Per-rung aggregations via the pure helper from tracker.ts
  const metricRows = computeRollingMetrics(rows)
  const perRung: HistoryResponse['rolling30Day']['perRung'] = {
    1: { hits: 0, total: 0, rate: 0, predictedAvg: 0, brier: 0 },
    2: { hits: 0, total: 0, rate: 0, predictedAvg: 0, brier: 0 },
    3: { hits: 0, total: 0, rate: 0, predictedAvg: 0, brier: 0 },
  }
  for (const m of metricRows) {
    perRung[m.rung] = {
      hits: m.hits,
      total: m.total,
      rate: m.rate,
      predictedAvg: m.predicted_avg,
      brier: m.brier,
    }
  }

  // Overall: sum across rungs (only non-PENDING rows already filtered in computeRollingMetrics)
  const allHits = perRung[1].hits + perRung[2].hits + perRung[3].hits
  const allTotal = perRung[1].total + perRung[2].total + perRung[3].total

  // By-date summary for the chart (ascending date order)
  const byDateMap = new Map<string, { hits: number; miss: number; pending: number; pickCount: number }>()
  for (const r of rows) {
    const entry = byDateMap.get(r.date) ?? { hits: 0, miss: 0, pending: 0, pickCount: 0 }
    entry.pickCount++
    if (r.outcome === 'HIT') entry.hits++
    else if (r.outcome === 'MISS') entry.miss++
    else entry.pending++
    byDateMap.set(r.date, entry)
  }
  const byDate = Array.from(byDateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stats]) => ({ date, ...stats }))

  // Most recent 50 picks (rows already come sorted by date desc from getSettledPicks)
  const recentPicks = rows.slice(0, 50).map(rowToSettledPick)

  return NextResponse.json({
    rolling30Day: {
      overall: { hits: allHits, total: allTotal, rate: allTotal > 0 ? allHits / allTotal : 0 },
      perRung,
    },
    byDate,
    recentPicks,
  })
}
