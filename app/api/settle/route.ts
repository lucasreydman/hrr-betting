import { NextRequest, NextResponse } from 'next/server'
import { settlePicks } from '@/lib/tracker'
import { verifyCronRequest } from '@/lib/cron-auth'

// Settle reads boxscores for ~5-15 picks. Each fetch is ~200-500ms; even with
// 20 picks we're under 10s.
export const maxDuration = 10

/**
 * Cron endpoint: 3 AM Pacific (10 AM UTC).
 * Settle the previous day's Tracked picks by pulling boxscores.
 *
 * Auth: requires `x-cron-secret` header matching CRON_SECRET env var.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // "Previous day" = yesterday in Pacific time
  const now = new Date()
  // Compute Pacific date — Vercel runs in UTC; PT is UTC-7 or -8
  // Use a simple offset (close enough for daily cron purposes)
  const pacificMs = now.getTime() - 8 * 60 * 60 * 1000
  const pacificDate = new Date(pacificMs)
  pacificDate.setUTCDate(pacificDate.getUTCDate() - 1)
  const yesterdayDate = pacificDate.toISOString().slice(0, 10)

  const result = await settlePicks(yesterdayDate)
  return NextResponse.json({ date: yesterdayDate, ...result })
}
