import { NextRequest, NextResponse } from 'next/server'
import { settlePicks } from '@/lib/tracker'
import { verifyCronRequest } from '@/lib/cron-auth'
import { slateDateString, shiftIsoDate, isValidIsoDate } from '@/lib/date-utils'
import { processSettleDigest } from '@/lib/discord'

// Settle reads boxscores for ~5-15 picks. Each fetch is ~200-500ms; even with
// 20 picks we're under 10s.
export const maxDuration = 10

/**
 * Cron endpoint: 3:15 AM ET (7:15 UTC), the smallest safe gap after the
 * 3 AM ET slate rollover. Earlier risks a late-night PT game still being
 * in_progress; later means yesterday's results don't appear in /history
 * until well into the next day.
 *
 * Settles the previous slate's Tracked picks by pulling boxscores.
 *
 * "Previous slate" = the ET-3AM slate one day before today's. The cron fires
 * after the rollover boundary (3:15 AM ET > 3 AM ET), so `slateDateString()`
 * returns today's slate and we shift back one day to settle yesterday's.
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

  const targetDate = dateParam ?? shiftIsoDate(slateDateString(), -1)
  const result = await settlePicks(targetDate)
  // Daily Discord digest. KV-flagged so manual re-dispatches don't double-post.
  // No-op when DISCORD_WEBHOOK_URL is unset or Supabase is unavailable.
  const discord = await processSettleDigest({ date: targetDate })
  return NextResponse.json({ date: targetDate, ...result, discord })
}
