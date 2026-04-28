import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet, kvDel } from '@/lib/kv'
import { rankPicks } from '@/lib/ranker'
import type { PicksResponse } from '@/lib/ranker'
import { slateDateString, isValidIsoDate } from '@/lib/date-utils'

// Revalidate the route's framework cache every 30 s so client polls within
// that window can hit the lightweight server cache below; longer would
// delay the propagation of a fresh slate-refresh cache to the user.
export const revalidate = 30

/** Server-side picks cache TTL (seconds). Tuned so a fresh slate-refresh
 *  (every 2 min by the cron) is reflected user-side within ≤30 s. */
const PICKS_CACHE_TTL_S = 30

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const dateParam = url.searchParams.get('date')
  if (dateParam !== null && !isValidIsoDate(dateParam)) {
    // Validate before letting an attacker-controlled value flow into MLB API URLs / cache keys.
    return NextResponse.json({ error: 'invalid date — expected YYYY-MM-DD' }, { status: 400 })
  }
  // Default: today's slate (ET 3 AM rollover). The client doesn't navigate
  // dates anymore — the URL param remains for debugging / manual replays.
  const date = dateParam ?? slateDateString()
  const nocache = url.searchParams.get('nocache') === '1'

  const cacheKey = `picks:current:${date}`

  if (nocache) {
    await kvDel(cacheKey)
  } else {
    const cached = await kvGet<PicksResponse>(cacheKey)
    if (cached) {
      return NextResponse.json({ ...cached, meta: { ...cached.meta, fromCache: true } })
    }
  }

  const ranked = await rankPicks(date)
  await kvSet(cacheKey, ranked, PICKS_CACHE_TTL_S)
  return NextResponse.json({ ...ranked, meta: { ...ranked.meta, fromCache: false } })
}
