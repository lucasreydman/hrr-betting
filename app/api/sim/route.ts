import { NextRequest, NextResponse } from 'next/server'
import { kvGet } from '@/lib/kv'
import { fetchSchedule } from '@/lib/mlb-api'
import { fetchLineup, lineupHash } from '@/lib/lineup'
import { fetchWeather, weatherHash } from '@/lib/weather-api'

export const maxDuration = 60

function getBaseUrl(req: NextRequest): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return new URL(req.url).origin
}

interface PrewarmResult {
  gameId: number
  status: 'simmed' | 'cached' | 'failed' | 'skipped'
  reason?: string
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const games = await fetchSchedule(date)
  const baseUrl = getBaseUrl(req)

  const results: PrewarmResult[] = []

  // Sequential to avoid stampeding KV / external APIs.
  // Bound: if we've used > 50s of the 60s budget, skip remaining games (next cron picks them up).
  const startMs = Date.now()
  const BUDGET_MS = 50_000

  for (const g of games) {
    if (Date.now() - startMs > BUDGET_MS) {
      results.push({ gameId: g.gameId, status: 'skipped', reason: 'budget exhausted' })
      continue
    }

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

      // Cache miss — call the per-game sim endpoint
      const r = await fetch(`${baseUrl}/api/sim/${g.gameId}?date=${date}`)
      if (!r.ok) {
        results.push({ gameId: g.gameId, status: 'failed', reason: `HTTP ${r.status}` })
        continue
      }
      results.push({ gameId: g.gameId, status: 'simmed' })
    } catch (e) {
      results.push({ gameId: g.gameId, status: 'failed', reason: (e as Error).message })
    }
  }

  return NextResponse.json({
    date,
    elapsed_ms: Date.now() - startMs,
    summary: results,
  })
}
