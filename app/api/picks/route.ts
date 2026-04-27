import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet, kvDel } from '@/lib/kv'
import { rankPicks } from '@/lib/ranker'
import type { PicksResponse } from '@/lib/ranker'

export const revalidate = 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
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
