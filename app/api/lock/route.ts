import { NextRequest, NextResponse } from 'next/server'
import { fetchSchedule } from '@/lib/mlb-api'
import { shouldLock, snapshotLockedPicks } from '@/lib/tracker'
import { verifyCronRequest } from '@/lib/cron-auth'
import { slateDateString, isValidIsoDate } from '@/lib/date-utils'
import { kvGet } from '@/lib/kv'
import { rankPicks, type PicksResponse } from '@/lib/ranker'
import { processLockNotifications } from '@/lib/discord'
import type { Game } from '@/lib/types'

/**
 * Read picks:current cache or fall back to a fresh `rankPicks(date)` call.
 *
 * The picks-current cache has a 30s TTL and is populated only by /api/picks
 * page hits (not by /api/refresh, which invalidates without repopulating).
 * On a quiet evening with no live viewers the cache is almost always empty
 * when the lock cron fires — and the pre-fix version of snapshotLockedPicks
 * silently returned 0, meaning the entire slate's tracked picks never landed
 * in locked_picks and the next morning's settle had nothing to write.
 *
 * This helper lives in the lock route (not in `lib/tracker.ts`) so the
 * settle function bundle stays small — pulling rankPicks into tracker would
 * drag the entire ranker dependency tree (mlb-api, factors, weather, sim
 * baseline reads) into the settle cold-start, which has been observed to
 * 500 the function before it can even respond.
 */
async function readOrComputePicks(date: string): Promise<PicksResponse> {
  const cached = await kvGet<PicksResponse>(`picks:current:${date}`)
  if (cached) return cached
  return rankPicks(date)
}

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

  const url = new URL(req.url)
  const dateParam = url.searchParams.get('date')
  if (dateParam !== null && !isValidIsoDate(dateParam)) {
    return NextResponse.json({ error: 'invalid date — expected YYYY-MM-DD' }, { status: 400 })
  }
  const date = dateParam ?? slateDateString()
  const force = url.searchParams.get('force') === '1'
  const now = Date.now()

  // ?force=1 bypasses the shouldLock gate and snapshots immediately. Used to
  // recover slates whose lock cron silently dropped picks (e.g. the bug where
  // an empty picks-current cache caused snapshotLockedPicks to bail with 0).
  // Operator-only — same auth as the cron path.
  if (force) {
    const current = await readOrComputePicks(date)
    const result = await snapshotLockedPicks({ date, current })
    const games = await fetchSchedule(date).catch(() => [] as Game[])
    const discord = await processLockNotifications({ date, gamesForLookup: games, currentPicks: current })
    return NextResponse.json({ date, status: 'forced', ...result, discord })
  }

  const games = await fetchSchedule(date)
  if (games.length === 0) {
    return NextResponse.json({ date, status: 'no-games' })
  }

  // shouldLock now gates only on time-to-first-pitch (≤30 min). No lineup
  // fetch required at the route level — when we DO snapshot, snapshotLockedPicks
  // gets a fresh PicksResponse via readOrComputePicks which fetches lineups
  // inside rankPicks. Used to fan out home-lineup fetches per game just for
  // the gate; that's now dead weight, removed for faster cron cycles.
  const lockable = games.filter(g => g.status !== 'postponed' && g.status !== 'final')

  const anyShouldLock = lockable.some(g => {
    const firstPitch = new Date(g.gameDate).getTime()
    return shouldLock({ now, firstPitch })
  })

  if (!anyShouldLock) {
    return NextResponse.json({ date, status: 'no-lock', games: games.length })
  }

  const current = await readOrComputePicks(date)
  const result = await snapshotLockedPicks({ date, current })
  // Discord notifications run after the snapshot. Notifier reads the
  // `discord_notified_at IS NULL` queue, so it picks up rows newly inserted
  // by THIS snapshot and any rows from previous cron runs that failed to
  // post. No-op when the env var is unset or Supabase is unavailable.
  const discord = await processLockNotifications({ date, gamesForLookup: games, currentPicks: current })
  return NextResponse.json({ date, status: 'locked', ...result, discord })
}
