'use client'

import { useEffect, useState, useCallback } from 'react'
import type { PicksResponse } from '@/lib/ranker'
import { BoardSection } from './BoardSection'
import { StatusBanner } from './StatusBanner'

/** "Sat, Apr 27" style label — friendlier than ISO at-a-glance. */
function prettyDate(date: string): string {
  // Anchor at noon UTC so the formatted weekday/month doesn't drift across timezones.
  const d = new Date(`${date}T12:00:00Z`)
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
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

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Today&apos;s board</h1>
        <p className="text-sm text-ink-muted">
          Hits + Runs + RBIs prop picks ranked by matchup edge × confidence.
          Slate updates automatically every minute.
        </p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-sm">
          <span className="text-ink">{prettyDate(date)}</span>
          <span className="text-ink-muted">{date}</span>
          <span className="text-[11px] uppercase tracking-wider text-ink-muted">slate</span>
        </div>
      </header>

      <StatusBanner refreshedAt={picks.refreshedAt} meta={picks.meta} totalTracked={totalTracked} />

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

      <div className="space-y-6">
        <BoardSection rung={1} picks={picks.rung1} />
        <BoardSection rung={2} picks={picks.rung2} />
        <BoardSection rung={3} picks={picks.rung3} />
      </div>
    </main>
  )
}
