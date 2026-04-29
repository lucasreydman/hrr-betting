'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import type { PicksResponse } from '@/lib/ranker'
import { Board, type PickWithRung } from './Board'
import { StatusBanner } from './StatusBanner'
import { SimWarmingProgress } from './SimWarmingProgress'

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

        <details className="group rounded-lg border border-border bg-card/20 text-sm">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-ink-muted hover:text-ink">
            <span>How to read this board</span>
            <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="space-y-2 border-t border-border/50 px-3 py-3 text-ink-muted">
            <p>
              Each row is one prop bet — a single batter at a single rung. The board
              ranks every available bet across all games, with the highest-conviction
              plays at the top.
            </p>
            <ul className="space-y-1 text-xs">
              <li>
                <span className="font-mono text-ink">Bet</span> — rung tier:
                <span className="ml-1">1+ HRR (most likely), 2+ HRR (mid), 3+ HRR (long shot).</span>
                A batter can show up at multiple rungs.
              </li>
              <li>
                <span className="font-mono text-ink">Batter</span> — name, batting hand,
                and lineup-status pill (<span className="text-hit">confirmed</span> /
                <span className="text-warn"> partial</span> /
                <span className="text-yellow-300"> estimated</span>) with batting-order slot.
              </li>
              <li>
                <span className="font-mono text-ink">Pitcher</span> — opposing starter, throws
                hand, and confirmation status.
              </li>
              <li>
                <span className="font-mono text-ink">Game</span> — matchup, first pitch local
                time, countdown / <span className="text-miss">LIVE</span> / FINAL.
              </li>
              <li>
                <span className="font-mono text-ink">p̂<sub>typical</sub></span> — estimated
                probability of the bet hitting in this batter&apos;s <em>typical</em> matchup
                (his baseline, from a 20k-iteration Monte Carlo). Shown as % over the fair
                American odds.
              </li>
              <li>
                <span className="font-mono text-ink">p̂<sub>today</sub></span> — estimated
                probability of the bet hitting <em>today</em>, after applying the pitcher,
                park, weather, handedness, bullpen, and PA-count adjustments. If a sportsbook
                offers worse than this fair line, you&apos;re getting positive EV.
              </li>
              <li>
                <span className="font-mono text-ink">Edge</span> — how much better today is
                than typical: <span className="font-mono">p̂<sub>today</sub> ÷ p̂<sub>typical</sub> − 1</span>.
                Positive = unusually favorable matchup.
              </li>
              <li>
                <span className="font-mono text-ink">Conf</span> — confidence multiplier
                (lineup confirmation, BvP sample size, pitcher start sample, weather stability,
                time-to-first-pitch, opener-risk).
              </li>
              <li>
                <span className="font-mono text-ink">Score</span> —
                <span className="font-mono"> edge × confidence</span>. The default sort.
                Higher score = stronger play, accounting for both edge and how reliable the
                inputs are. <span className="text-tracked">🔥 Tracked</span> rows clear all
                rung floors; everything below is &ldquo;Other plays.&rdquo;
              </li>
            </ul>
          </div>
        </details>
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
