import { NextRequest, NextResponse } from 'next/server'
import { fetchBvP } from '@/lib/mlb-api'
import { kvGet } from '@/lib/kv'
import { verifyCronRequest } from '@/lib/cron-auth'

/**
 * Admin diagnostic endpoint: returns the BvP record + cached state for a
 * specific (batterId, pitcherId) pair. Used to verify the production fetchBvP
 * path is actually pulling career data.
 *
 * Usage: GET /api/admin/bvp?b=650490&p=676440  (with x-cron-secret header)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const batterId = parseInt(url.searchParams.get('b') ?? '0', 10)
  const pitcherId = parseInt(url.searchParams.get('p') ?? '0', 10)

  if (!Number.isInteger(batterId) || batterId <= 0 || !Number.isInteger(pitcherId) || pitcherId <= 0) {
    return NextResponse.json({ error: 'need ?b=<batterId>&p=<pitcherId> (positive integers)' }, { status: 400 })
  }

  const cacheKey = `hrr:bvp:${batterId}:${pitcherId}`
  const cached = await kvGet<unknown>(cacheKey)
  const fresh = await fetchBvP(batterId, pitcherId)

  return NextResponse.json({
    batterId,
    pitcherId,
    cacheKey,
    cachedBeforeFetch: cached,
    freshAfterFetch: fresh,
  })
}
