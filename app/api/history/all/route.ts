import { NextResponse } from 'next/server'
import { getSettledPicks, type SettledPick } from '@/lib/tracker'
import { rowToSettledPick } from '@/lib/history-shared'

export interface HistoryAllResponse {
  picks: SettledPick[]
  total: number
}

/**
 * Returns every settled pick the tracker has ever produced, newest-first.
 * Used by `/history/all` (the full archive page).
 *
 * No aggregation, no rolling-window cutoff — just the raw list. The dashboard
 * `/api/history` route handles roll-ups and the recent-picks slice; this
 * endpoint is the bulk export.
 */
export async function GET(): Promise<NextResponse<HistoryAllResponse>> {
  const rows = await getSettledPicks()
  const picks = rows.map(rowToSettledPick)
  return NextResponse.json({ picks, total: picks.length })
}
