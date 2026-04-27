import { NextRequest, NextResponse } from 'next/server'
import { fetchSchedule } from '@/lib/mlb-api'
import { verifyCronRequest } from '@/lib/cron-auth'

export const maxDuration = 10

interface SimGameSummary {
  gameId: number
  status: 'eligible' | 'skipped'
  reason?: string
}

/**
 * Lists today's MLB games. Used by GitHub Actions cron to know which game IDs
 * to fan out to /api/sim/[gameId]. Each per-game endpoint does its own
 * cache check (lineup + weather hash) so this orchestrator stays minimal.
 *
 * The previous version of this route used a fire-and-forget pattern
 * (`void fetch(...)` from server) — that doesn't survive Vercel function
 * termination, so kicked sims never actually completed. Moving the
 * iteration to GitHub Actions where each curl is its own independent
 * Vercel function invocation with a full 10s budget.
 *
 * Auth: requires `x-cron-secret` header matching CRON_SECRET env var.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const games = await fetchSchedule(date)

  const summary: SimGameSummary[] = games.map(g => {
    if (g.status === 'postponed' || g.status === 'final') {
      return { gameId: g.gameId, status: 'skipped', reason: g.status }
    }
    return { gameId: g.gameId, status: 'eligible' }
  })

  return NextResponse.json({ date, summary })
}
