/**
 * POST /api/sim/typical
 *
 * Two modes:
 *  - { mode: 'full' } → orchestrator: enumerates active batters, fans out one
 *    fire-and-forget HTTPS call per batter (mode 'player'). Returns immediately.
 *  - { mode: 'player', playerId } → run 20k-iter MC for one batter, write
 *    typical:v1:{playerId}. ~10s wall time.
 *
 * Auth: x-cron-secret header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { computeTypicalOffline } from '@/lib/p-typical'
import { kvSet } from '@/lib/kv'
import { verifyCronRequest } from '@/lib/cron-auth'

export const maxDuration = 10
const TYPICAL_TTL = 14 * 24 * 60 * 60

interface PlayerBody { mode: 'player'; playerId: number; season?: number }
interface FullBody { mode: 'full'; season?: number }
type Body = PlayerBody | FullBody

function selfBaseUrl(): string {
  const v = process.env.VERCEL_URL
  if (v) return `https://${v}`
  return `http://localhost:${process.env.PORT ?? '3000'}`
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body || (body.mode !== 'full' && body.mode !== 'player')) {
    return NextResponse.json({ error: 'invalid mode' }, { status: 400 })
  }

  if (body.mode === 'player') {
    if (!Number.isInteger(body.playerId) || body.playerId <= 0) {
      return NextResponse.json({ error: 'invalid playerId' }, { status: 400 })
    }
    try {
      const result = await computeTypicalOffline({
        playerId: body.playerId,
        season: body.season,
      })
      await kvSet(`typical:v1:${body.playerId}`, result, TYPICAL_TTL)
      return NextResponse.json({
        mode: 'player',
        playerIds: [body.playerId],
        computedAt: result.computedAt,
        errors: [],
      })
    } catch (err) {
      return NextResponse.json({
        mode: 'player',
        playerIds: [body.playerId],
        computedAt: Date.now(),
        errors: [String((err as Error).message ?? err)],
      }, { status: 500 })
    }
  }

  // mode 'full': orchestrate. Lazy import so missing module doesn't break the route.
  let playerIds: number[] = []
  try {
    const { getActiveBatterIds } = await import('@/lib/active-batters')
    playerIds = await getActiveBatterIds(body.season ?? new Date().getFullYear())
  } catch {
    playerIds = []
  }

  const cronSecret = req.headers.get('x-cron-secret') ?? ''
  const base = selfBaseUrl()
  for (const pid of playerIds) {
    void fetch(`${base}/api/sim/typical`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': cronSecret },
      body: JSON.stringify({ mode: 'player', playerId: pid }),
      cache: 'no-store',
    }).catch(() => undefined)
  }

  return NextResponse.json({
    mode: 'full',
    playerIds,
    computedAt: Date.now(),
    errors: [],
  })
}
