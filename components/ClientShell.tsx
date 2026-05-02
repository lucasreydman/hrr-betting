'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import type { PicksResponse } from '@/lib/ranker'
import { Board, type PickWithRung } from './Board'
import { StatusBanner } from './StatusBanner'
import { SimWarmingProgress } from './SimWarmingProgress'

/** "Saturday, May 2nd, 2026" style label — long-form day-of-week, full month
 *  name, ordinal day, four-digit year. Friendlier than ISO at-a-glance. */
function prettyDate(date: string): string {
  // Anchor at noon UTC so the formatted weekday/month doesn't drift across timezones.
  const d = new Date(`${date}T12:00:00Z`)
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })
  const month = d.toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' })
  const day = d.getUTCDate()
  const year = d.getUTCFullYear()
  return `${weekday}, ${month} ${day}${ordinalSuffix(day)}, ${year}`
}

/** "1st" / "2nd" / "3rd" / "4th" suffix for English ordinals. The 11/12/13
 *  exception is the only quirk worth handling; everything else follows the
 *  last-digit pattern. */
function ordinalSuffix(n: number): string {
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

/** How often to re-fetch /api/picks while the tab is visible. The server-side
 *  picks cache is also 60 s, so within-window polls are cheap (cache hits) and
 *  the user sees fresh data within ≤1 min of the cron warming a new sim. */
const POLL_INTERVAL_MS = 60_000

export function ClientShell({ initialPicks }: { initialPicks: PicksResponse }) {
  const [picks, setPicks] = useState<PicksResponse>(initialPicks)
  const [error, setError] = useState<string | null>(null)
  // The slate date is fixed for the lifetime of the page — we don't navigate
  // between dates; the server picks today's slate (ET 3 AM rollover) on each
  // request via slateDateString().
  const date = initialPicks.date

  const refetch = useCallback(async () => {
    try {
      // No ?date param — server uses slateDateString() so the slate rolls
      // over correctly without us hard-coding "today" on the client.
      const res = await fetch('/api/picks')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: PicksResponse = await res.json()
      setPicks(data)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // Periodic poll while the tab is visible. Pausing while hidden saves
  // bandwidth + battery on phones; the visibility-change listener below
  // catches up immediately when the user returns.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    const id = setInterval(tick, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refetch])

  // Refetch immediately when the tab regains focus or the network reconnects
  // — covers the "I left this tab open overnight" and "I just came back from
  // a meeting" cases where the user expects current data without waiting up
  // to a full poll interval.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', refetch)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', refetch)
    }
  }, [refetch])

  const totalTracked =
    picks.rung1.filter(p => p.tier === 'tracked').length +
    picks.rung2.filter(p => p.tier === 'tracked').length +
    picks.rung3.filter(p => p.tier === 'tracked').length

  // Flatten the rung-keyed response into a single list, annotating each pick
  // with its rung so the Board can show a rung badge and filter by it.
  const allPicks = useMemo<PickWithRung[]>(
    () => [
      ...picks.rung1.map(p => ({ ...p, rung: 1 as const })),
      ...picks.rung2.map(p => ({ ...p, rung: 2 as const })),
      ...picks.rung3.map(p => ({ ...p, rung: 3 as const })),
    ],
    [picks],
  )

  return (
    <main className="mx-auto max-w-screen-2xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Today&apos;s Board</h1>
        <p className="text-sm text-ink-muted">
          Hits + Runs + RBIs prop picks ranked by Kelly bet fraction × confidence.
          Slate updates automatically every minute. Click the{' '}
          <span aria-hidden="true" className="font-mono text-ink">▾</span>{' '}
          on any row for expanded details.
        </p>
        <div className="font-mono text-sm text-ink">
          {prettyDate(date)}
        </div>

      </header>

      <StatusBanner
        refreshedAt={picks.refreshedAt}
        meta={picks.meta}
        totalTracked={totalTracked}
        onRefresh={async () => {
          // POST to /api/refresh (Phase 6 will implement the route; until then
          // the button gracefully shows the 404 error state).
          const res = await fetch('/api/refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ scope: 'today' }),
          })
          if (!res.ok && res.status !== 404) {
            throw new Error(`HTTP ${res.status}`)
          }
          // Always refetch picks after refresh attempt so stale data is cleared.
          await refetch()
        }}
      />

      {/* Auto-hides when 100% warmed; prominent when there are missing sims. */}
      <SimWarmingProgress meta={picks.meta} refreshedAt={picks.refreshedAt} />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-miss/40 bg-miss/5 px-4 py-3 text-sm text-miss"
        >
          <span className="font-medium">Couldn&apos;t refresh picks.</span>{' '}
          <span className="text-miss/80">{error}</span>
          <span className="ml-2 text-miss/70">Will retry automatically.</span>
        </div>
      )}

      <Board picks={allPicks} />
    </main>
  )
}
