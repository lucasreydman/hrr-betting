import { NextRequest, NextResponse } from 'next/server'
import { fetchSchedule } from '@/lib/mlb-api'
import { fetchLineup } from '@/lib/lineup'
import { shouldLock, snapshotLockedPicks } from '@/lib/tracker'
import { verifyCronRequest } from '@/lib/cron-auth'
import { slateDateString, isValidIsoDate } from '@/lib/date-utils'

export const maxDuration = 10

/**
 * Cron endpoint: every 5 min during slate hours.
 * For today's slate (ET, 3 AM rollover), check if any game's lock window has
 * opened. If yes, snapshot any Tracked picks that haven't been locked yet.
 *
 * Slate boundary is Eastern with 3 AM rollover (the standard DFS / sportsbook
 * convention) — late-night Pacific games that finish past midnight ET still
 * belong to the same slate, so the cron correctly locks them in their
 * lock-window even when the calendar UTC date has rolled over.
 *
 * Insert-only semantics (see lib/tracker.ts:snapshotLockedPicks): once a pick
 * is locked it stays frozen, but a later cron pass DOES add new picks that
 * became Tracked since (e.g. when a 9 PM start's lineup confirms after the
 * 5 PM cron already locked early-game picks). This was a real bug before —
 * staggered slates dropped late-game picks entirely.
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
  const date = dateParam ?? slateDateString()
  const now = Date.now()

  const games = await fetchSchedule(date)
  if (games.length === 0) {
    return NextResponse.json({ date, status: 'no-games' })
  }

  // Fan out the home-lineup fetches in parallel so a 15-game slate doesn't
  // pay 15× sequential MLB API roundtrips just to decide whether to lock.
  // The home lineup is used as the lineup-status signal for both sides —
  // they typically confirm together; asymmetric scratch/IL is rare and the
  // 30-min forced fallback covers that edge anyway.
  const lockable = games.filter(g => g.status !== 'postponed' && g.status !== 'final')
  const homeLineups = await Promise.all(
    lockable.map(g =>
      fetchLineup(g.gameId, g.homeTeam.teamId, 'home', date).catch(() => null),
    ),
  )

  const anyShouldLock = lockable.some((g, i) => {
    const homeLineup = homeLineups[i]
    if (!homeLineup) return false
    const firstPitch = new Date(g.gameDate).getTime()
    return shouldLock({ now, firstPitch, lineupStatus: homeLineup.status })
  })

  if (!anyShouldLock) {
    return NextResponse.json({ date, status: 'no-lock', games: games.length })
  }

  const result = await snapshotLockedPicks(date)
  return NextResponse.json({ date, status: 'locked', ...result })
}
