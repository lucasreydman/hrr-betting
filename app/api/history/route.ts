import { NextResponse } from 'next/server'
import { getSettledPicks, computeRollingMetrics, type SettledPick } from '@/lib/tracker'
import { slateDateString, shiftIsoDate } from '@/lib/date-utils'
import { rowToSettledPick } from '@/lib/history-shared'
import type { Rung } from '@/lib/types'

export interface HistoryResponse {
  allTime: {
    overall: { hits: number; total: number; rate: number }
    perRung: Record<Rung, { hits: number; total: number; rate: number; predictedAvg: number; brier: number }>
  }
  byDate: Array<{ date: string; pickCount: number; hits: number; miss: number; pending: number }>
  /** Settled picks from the most recent 3 slate dates (today + previous 2). */
  recentPicks: SettledPick[]
  /** Total settled-pick count across all time, for the "show all" link. */
  totalSettledCount: number
}

export async function GET(): Promise<NextResponse<HistoryResponse>> {
  // All-time fetch. The headline record reflects every settled pick the
  // tracker has ever produced, not a rolling 30-day window — at this scale
  // (single-user app, low pick volume) the all-time number is more useful
  // and more honest than a window that drops older data.
  const rows = await getSettledPicks()

  // Per-rung aggregations via the pure helper from tracker.ts
  const metricRows = computeRollingMetrics(rows)
  const perRung: HistoryResponse['allTime']['perRung'] = {
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

  // "Recent" = last 3 slate dates (today + 2 previous). slateDateString() − 2
  // is the cutoff: a pick from that date or later qualifies. Rows beyond
  // that live on the dedicated /history/all archive page; the dashboard
  // stays small so it stays fast to skim.
  const recentCutoff = shiftIsoDate(slateDateString(), -2)
  const recentPicks = rows
    .filter(r => r.date >= recentCutoff)
    .map(rowToSettledPick)

  return NextResponse.json({
    allTime: {
      overall: { hits: allHits, total: allTotal, rate: allTotal > 0 ? allHits / allTotal : 0 },
      perRung,
    },
    byDate,
    recentPicks,
    totalSettledCount: rows.length,
  })
}
