import { NextRequest, NextResponse } from 'next/server'
import { fetchSchedule } from '@/lib/mlb-api'
import { fetchLineup } from '@/lib/lineup'
import { shouldLock, snapshotLockedPicks } from '@/lib/tracker'
import { verifyCronRequest } from '@/lib/cron-auth'
import { pacificDateString, isValidIsoDate } from '@/lib/date-utils'

export const maxDuration = 10

/**
 * Cron endpoint: every 5 min during slate hours.
 * For today's slate (Pacific), check if lock trigger fires. If yes, snapshot Tracked picks.
 *
 * Slate boundary is Pacific, NOT UTC: late-night PT games cross midnight UTC
 * mid-slate, so a UTC "today" call after 00:00 UTC during the back half of the
 * slate would point at tomorrow's MLB date and miss in-progress lock windows.
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
  const date = dateParam ?? pacificDateString()
  const now = Date.now()

  const games = await fetchSchedule(date)
  if (games.length === 0) {
    return NextResponse.json({ date, status: 'no-games' })
  }

  // For each game, check if its lock condition is met. If ANY game is past its
  // lock trigger, snapshot the per-date Tracked picks (covers all games).
  let anyShouldLock = false
  for (const g of games) {
    if (g.status === 'postponed' || g.status === 'final') continue
    const firstPitch = new Date(g.gameDate).getTime()

    // Use the home lineup as the lineup-status signal — both teams' lineups
    // typically confirm together. Asymmetric scratch/IL situations (home
    // confirms, away doesn't) will lock based on home's status; that's
    // defensible because (a) the 30 min force-lock fires regardless, and
    // (b) the snapshot is per-date, so picks for both sides get captured.
    const homeLineup = await fetchLineup(g.gameId, g.homeTeam.teamId, 'home', date)
    if (shouldLock({ now, firstPitch, lineupStatus: homeLineup.status })) {
      anyShouldLock = true
      break
    }
  }

  if (!anyShouldLock) {
    return NextResponse.json({ date, status: 'no-lock', games: games.length })
  }

  const result = await snapshotLockedPicks(date)
  return NextResponse.json({ date, status: 'locked', ...result })
}
