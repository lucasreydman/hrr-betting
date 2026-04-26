import { NextResponse } from 'next/server'
import { fetchSchedule } from '@/lib/mlb-api'
import { fetchLineup } from '@/lib/lineup'
import { shouldLock, snapshotLockedPicks } from '@/lib/tracker'

export const maxDuration = 30

/**
 * Cron endpoint: every 5 min during slate hours.
 * For today's date, check if lock trigger fires. If yes, snapshot Tracked picks.
 *
 * NB: The picks snapshot is per-date, not per-game. Once we fire the lock for today,
 * the snapshot captures all currently-Tracked picks. Subsequent cron runs no-op.
 */
export async function GET(): Promise<NextResponse> {
  const date = new Date().toISOString().slice(0, 10)
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
    // confirm together typically.
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
