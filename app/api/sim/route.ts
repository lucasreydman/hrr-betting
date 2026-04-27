import { NextRequest, NextResponse } from 'next/server'
import { kvGet } from '@/lib/kv'
import { fetchSchedule } from '@/lib/mlb-api'
import { fetchLineup, lineupHash } from '@/lib/lineup'
import { fetchWeather, weatherHash } from '@/lib/weather-api'
import { verifyCronRequest } from '@/lib/cron-auth'

// 10s default — Hobby tier compatible. Each per-game sim runs in its own
// /api/sim/[gameId] invocation; this orchestrator just kicks them off.
export const maxDuration = 10

function getBaseUrl(req: NextRequest): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return new URL(req.url).origin
}

interface PrewarmResult {
  gameId: number
  status: 'kicked' | 'cached' | 'skipped'
  reason?: string
}

/**
 * Prewarm orchestrator. For each of today's games, check if a sim is needed
 * (lineup/weather hash changed since last sim). If so, FIRE-AND-FORGET a fetch
 * to /api/sim/[gameId] — that endpoint runs the 10k-iter Monte Carlo
 * independently within its own 10s budget.
 *
 * The orchestrator returns immediately after dispatching, so it stays under
 * 10s even with 15+ games on the slate.
 *
 * Auth: requires `x-cron-secret` header matching CRON_SECRET env var.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const games = await fetchSchedule(date)
  const baseUrl = getBaseUrl(req)
  const cronSecret = process.env.CRON_SECRET

  const results: PrewarmResult[] = []
  const startMs = Date.now()

  for (const g of games) {
    if (g.status === 'postponed' || g.status === 'final') {
      results.push({ gameId: g.gameId, status: 'skipped', reason: g.status })
      continue
    }

    try {
      const homeLineup = await fetchLineup(g.gameId, g.homeTeam.teamId, 'home', date)
      const awayLineup = await fetchLineup(g.gameId, g.awayTeam.teamId, 'away', date)
      const lH = lineupHash(homeLineup) + ':' + lineupHash(awayLineup)
      const weather = await fetchWeather(g.venueId, g.gameDate)
      const wH = weatherHash(weather)

      const meta = await kvGet<{ lineupHash: string; weatherHash: string; simAt: number }>(`sim-meta:${g.gameId}`)
      if (meta && meta.lineupHash === lH && meta.weatherHash === wH) {
        results.push({ gameId: g.gameId, status: 'cached' })
        continue
      }

      // Fire-and-forget: kick off the per-game sim. Don't await — each game's sim
      // runs independently in its own /api/sim/[gameId] function invocation.
      // Errors are logged on the per-game endpoint side; orchestrator just returns
      // success once it has dispatched.
      const headers: HeadersInit = cronSecret ? { 'x-cron-secret': cronSecret } : {}
      void fetch(`${baseUrl}/api/sim/${g.gameId}?date=${date}`, { headers }).catch(() => {
        // Swallow — the next cron tick will retry if this one failed
      })
      results.push({ gameId: g.gameId, status: 'kicked' })
    } catch (e) {
      results.push({ gameId: g.gameId, status: 'skipped', reason: (e as Error).message })
    }
  }

  return NextResponse.json({
    date,
    elapsed_ms: Date.now() - startMs,
    summary: results,
  })
}
