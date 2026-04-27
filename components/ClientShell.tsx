'use client'

import { useEffect, useState, useCallback, useTransition } from 'react'
import type { PicksResponse } from '@/lib/ranker'
import { BoardSection } from './BoardSection'
import { StatusBanner } from './StatusBanner'
import { pacificDateString, shiftIsoDate } from '@/lib/date-utils'

const todayPacificDateString = () => pacificDateString()
const shiftDate = shiftIsoDate

function relativeLabel(date: string, today: string): string {
  if (date === today) return "Today's slate"
  if (date === shiftDate(today, 1)) return "Tomorrow's slate"
  if (date === shiftDate(today, -1)) return "Yesterday's slate"
  return 'Slate'
}

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

export function ClientShell({ initialPicks }: { initialPicks: PicksResponse }) {
  const [picks, setPicks] = useState<PicksResponse>(initialPicks)
  const [date, setDate] = useState<string>(initialPicks.date)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const today = todayPacificDateString()
  const tomorrow = shiftDate(today, 1)
  const atForwardLimit = date >= tomorrow  // Can't navigate past tomorrow — sims/lineups not useful that far out

  const fetchForDate = useCallback(async (targetDate: string, opts: { nocache?: boolean } = {}) => {
    try {
      const url = `/api/picks?date=${targetDate}${opts.nocache ? '&nocache=1' : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: PicksResponse = await res.json()
      setPicks(data)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // Auto-refresh every 5 min for the current date
  useEffect(() => {
    const id = setInterval(() => fetchForDate(date), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [date, fetchForDate])

  const navigateToDate = (newDate: string) => {
    startTransition(() => {
      setDate(newDate)
      void fetchForDate(newDate)
    })
  }

  const totalTracked = picks.rung1.filter(p => p.tier === 'tracked').length +
                       picks.rung2.filter(p => p.tier === 'tracked').length +
                       picks.rung3.filter(p => p.tier === 'tracked').length

  // Shared button base — consistent height, focus ring, disabled state.
  const navBtn =
    'inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-border ' +
    'bg-card/40 px-3 text-sm font-mono text-ink transition-colors ' +
    'hover:bg-card hover:border-border-strong ' +
    'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-card/40 disabled:hover:border-border'

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      <header className="space-y-4">
        <div>
          {/* `text-2xl` on phones so a 30 px headline doesn't dominate a 320 px screen. */}
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Today&apos;s board</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Hits + Runs + RBIs prop picks ranked by matchup edge × confidence.
          </p>
        </div>

        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/30 p-2"
          role="group"
          aria-label="Slate date navigation"
        >
          <button
            type="button"
            onClick={() => navigateToDate(shiftDate(date, -1))}
            disabled={isPending}
            className={navBtn}
            aria-label="Previous day"
          >
            <span aria-hidden="true">←</span>
          </button>

          {/* The center column truncates so a long pretty-date label can't push the
              forward arrow off the row. Pretty + ISO are stacked on phones to keep
              the row tall enough to read both. */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-2 text-center">
            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              {relativeLabel(date, today)}
            </span>
            <span className="flex max-w-full flex-wrap items-baseline justify-center gap-x-2 truncate font-mono text-sm text-ink sm:text-base">
              <span className="truncate">{prettyDate(date)}</span>
              <span className="truncate text-ink-muted">{date}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => navigateToDate(shiftDate(date, 1))}
            disabled={isPending || atForwardLimit}
            className={navBtn}
            aria-label="Next day"
            title={atForwardLimit ? 'Forward preview is capped at +1 day — lineups and starters too uncertain further out' : 'Next day'}
          >
            <span aria-hidden="true">→</span>
          </button>

          {date !== today && (
            <button
              type="button"
              onClick={() => navigateToDate(today)}
              disabled={isPending}
              className={navBtn + ' px-4'}
            >
              Today
            </button>
          )}
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
        </div>
      )}

      <div
        className={
          'space-y-6 transition-opacity ' +
          (isPending ? 'opacity-60' : 'opacity-100')
        }
        aria-busy={isPending}
      >
        <BoardSection rung={1} picks={picks.rung1} />
        <BoardSection rung={2} picks={picks.rung2} />
        <BoardSection rung={3} picks={picks.rung3} />
      </div>
    </main>
  )
}
