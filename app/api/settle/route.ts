import { NextRequest, NextResponse } from 'next/server'
import { settlePicks } from '@/lib/tracker'
import { verifyCronRequest } from '@/lib/cron-auth'
import { pacificDateString, shiftIsoDate, isValidIsoDate } from '@/lib/date-utils'

// Settle reads boxscores for ~5-15 picks. Each fetch is ~200-500ms; even with
// 20 picks we're under 10s.
export const maxDuration = 10

/**
 * Cron endpoint: 3 AM Pacific (10 AM UTC).
 * Settle the previous day's Tracked picks by pulling boxscores.
 *
 * "Previous day" = yesterday in Pacific time, computed via the IANA tz database
 * so PDT/PST and DST transitions are handled correctly (the previous fixed
 * `-8h` offset was right at 10 UTC by coincidence, but wrong for any other
 * cron firing time and would silently break if the schedule were shifted).
 *
 * Optional ?date=YYYY-MM-DD override for manual replays. Auth: requires
 * `x-cron-secret` header matching CRON_SECRET env var.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const dateParam = new URL(req.url).searchParams.get('date')
  if (dateParam !== null && !isValidIsoDate(dateParam)) {
    return NextResponse.json({ error: 'invalid date — expected YYYY-MM-DD' }, { status: 400 })
  }

  const targetDate = dateParam ?? shiftIsoDate(pacificDateString(), -1)
  const result = await settlePicks(targetDate)
  return NextResponse.json({ date: targetDate, ...result })
}
