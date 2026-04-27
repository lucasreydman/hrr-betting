'use client'

import { useEffect, useState } from 'react'
import type { PicksResponse } from '@/lib/ranker'

interface Props {
  meta: PicksResponse['meta']
  /** Server-side timestamp when the picks payload was assembled (ISO string). */
  refreshedAt: string
}

/**
 * Sim-warming progress banner. Renders **only** when at least one game on the
 * slate doesn't yet have a sim cache entry. Hidden once everything is warmed.
 *
 * Visual:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Warming sims · 7 of 15 remaining                       53%   │
 *   │ Picks for these games will appear automatically as the       │
 *   │ simulations complete (typically within a minute or two).     │
 *   │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  next refresh 27 s │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The countdown is computed from `refreshedAt + 60 s` so it stays consistent
 * with the actual poll interval in ClientShell. Computed in a useEffect so
 * server / client renders don't disagree on the current second.
 */
export function SimWarmingProgress({ meta, refreshedAt }: Props) {
  const total = meta.gamesTotal
  const done = meta.gamesWithSim
  const remaining = meta.gamesWithoutSim.length

  // Live-updating "next refresh in Xs" countdown. Derived from refreshedAt so
  // it survives re-renders without drifting. We update once per second.
  const [secondsTilRefresh, setSecondsTilRefresh] = useState<number | null>(null)
  useEffect(() => {
    const compute = () => {
      const ageMs = Date.now() - new Date(refreshedAt).getTime()
      const remainingMs = Math.max(0, 60_000 - ageMs)
      setSecondsTilRefresh(Math.ceil(remainingMs / 1000))
    }
    compute()
    const id = setInterval(compute, 1000)
    return () => clearInterval(id)
  }, [refreshedAt])

  // Hide when nothing is warming, or the response shape is degenerate.
  if (total === 0 || remaining === 0) return null

  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const countdownLabel = secondsTilRefresh === null ? '' : `next refresh in ${secondsTilRefresh}s`

  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="space-y-3 rounded-lg border border-warn/40 bg-warn/5 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-ink">
          Warming sims ·{' '}
          <span className="text-warn">
            {remaining} of {total} remaining
          </span>
        </p>
        <span className="font-mono text-sm tabular-nums text-ink-muted">
          {pct}%
        </span>
      </div>
      <p className="text-xs text-ink-muted">
        Picks for these games will appear automatically as their simulations complete —
        typically within a minute or two of the next cron warm-up.
      </p>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-border/40"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`${done} of ${total} sims complete (${pct}%)`}
      >
        <div
          className="h-full rounded-full bg-tracked transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
        {/* Subtle pulse stripe on the *unfilled* portion so the bar visually
            communicates "still working". CSS-only — no JS animation. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 right-0 animate-[pulse_1.8s_ease-in-out_infinite] bg-tracked/0"
          style={{ marginLeft: `${pct}%` }}
        >
          <div className="h-full w-full bg-gradient-to-r from-transparent via-warn/15 to-transparent" />
        </div>
      </div>
      {secondsTilRefresh !== null && (
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
          {countdownLabel}
        </p>
      )}
    </section>
  )
}
