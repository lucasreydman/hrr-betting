import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet, kvDel } from '@/lib/kv'
import { rankPicks } from '@/lib/ranker'
import type { PicksResponse } from '@/lib/ranker'
import { pacificDateString, isValidIsoDate } from '@/lib/date-utils'

export const revalidate = 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const dateParam = url.searchParams.get('date')
  if (dateParam !== null && !isValidIsoDate(dateParam)) {
    // Validate before letting an attacker-controlled value flow into MLB API URLs / cache keys.
    return NextResponse.json({ error: 'invalid date — expected YYYY-MM-DD' }, { status: 400 })
  }
  const date = dateParam ?? pacificDateString()
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
  await kvSet(cacheKey, ranked, 5 * 60)  // 5-min TTL
  return NextResponse.json({ ...ranked, meta: { ...ranked.meta, fromCache: false } })
}
