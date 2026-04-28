/**
 * POST /api/refresh
 *
 * Forces a fresh recompute of today's picks. Called by:
 *  1. Browser RefreshButton (no auth in dev, requires CRON_SECRET in prod)
 *  2. Every-2-min slate-refresh cron during slate hours
 *
 * Behaviour:
 *  - Invalidate `picks:current:{date}` so the next /api/picks read recomputes
 *  - Run rankPicks() to produce a fresh payload
 *  - Return the picks
 *
 * Note: upstream caches (lineup, weather, probables) age out via their own TTLs.
 * The ranker reads them fresh on each call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { rankPicks } from '@/lib/ranker'
import { kvDel } from '@/lib/kv'
import { verifyCronRequest } from '@/lib/cron-auth'
import { slateDateString, isValidIsoDate } from '@/lib/date-utils'

export const maxDuration = 10

interface RefreshBody {
  scope?: 'today' | 'specific-game'
  gameId?: number
  date?: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth: cron secret OR dev bypass (handled inside verifyCronRequest).
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: RefreshBody = {}
  try {
    body = (await req.json()) as RefreshBody
  } catch {
    // Empty body is OK
  }

  if (body.date && !isValidIsoDate(body.date)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 })
  }
  const date = body.date ?? slateDateString()

  // Invalidate the picks aggregator cache. Upstream caches (lineup, weather,
  // probables) age out on their own TTLs and refresh inside ranker as needed.
  await kvDel(`picks:current:${date}`)

  try {
    const picks = await rankPicks(date)
    return NextResponse.json({
      date,
      refreshedAt: new Date().toISOString(),
      picks,
      partialFailures: [],
    })
  } catch (e) {
    return NextResponse.json({
      error: 'upstream failure',
      details: [String((e as Error).message ?? e)],
    }, { status: 503 })
  }
}
