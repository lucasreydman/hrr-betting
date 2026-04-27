'use client'

import { useEffect, useState, useCallback, useTransition } from 'react'
import type { PicksResponse } from '@/lib/ranker'
import { BoardSection } from './BoardSection'
import { StatusBanner } from './StatusBanner'

function todayPacificDateString(): string {
  // Pacific date: rough offset (UTC-8 in PST, UTC-7 in PDT). Off by an hour
  // during DST transitions, but for date display this is fine.
  const now = new Date()
  const pacificMs = now.getTime() - 7 * 60 * 60 * 1000  // PDT-leaning
  return new Date(pacificMs).toISOString().slice(0, 10)
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function relativeLabel(date: string, today: string): string {
  if (date === today) return "Today's slate"
  if (date === shiftDate(today, 1)) return "Tomorrow's slate"
  if (date === shiftDate(today, -1)) return "Yesterday's slate"
  return 'Slate'
}

export function ClientShell({ initialPicks }: { initialPicks: PicksResponse }) {
  const [picks, setPicks] = useState<PicksResponse>(initialPicks)
  const [date, setDate] = useState<string>(initialPicks.date)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const today = todayPacificDateString()

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

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">HRR Betting</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateToDate(shiftDate(date, -1))}
            disabled={isPending}
            className="px-3 py-1.5 border border-border rounded text-sm font-mono hover:bg-card/50 disabled:opacity-50"
            aria-label="Previous day"
          >
            ←
          </button>
          <div className="flex-1 text-center">
            <div className="text-sm text-ink-muted">{relativeLabel(date, today)}</div>
            <div className="font-mono text-base">{date}</div>
          </div>
          <button
            onClick={() => navigateToDate(shiftDate(date, 1))}
            disabled={isPending}
            className="px-3 py-1.5 border border-border rounded text-sm font-mono hover:bg-card/50 disabled:opacity-50"
            aria-label="Next day"
          >
            →
          </button>
          {date !== today && (
            <button
              onClick={() => navigateToDate(today)}
              disabled={isPending}
              className="px-3 py-1.5 border border-border rounded text-sm font-mono hover:bg-card/50 disabled:opacity-50"
            >
              Today
            </button>
          )}
        </div>
      </header>

      <StatusBanner refreshedAt={picks.refreshedAt} meta={picks.meta} totalTracked={totalTracked} />

      {error && (
        <div className="px-4 py-3 border border-miss/40 rounded-lg text-miss text-sm">
          Refresh error: {error}
        </div>
      )}

      <div className="space-y-6">
        <BoardSection rung={1} picks={picks.rung1} />
        <BoardSection rung={2} picks={picks.rung2} />
        <BoardSection rung={3} picks={picks.rung3} />
      </div>

      <footer className="pt-8 text-center text-xs text-ink-muted">
        <a href="/methodology" className="hover:text-accent">methodology</a>
        <span className="mx-2">·</span>
        <a href="/history" className="hover:text-accent">history</a>
      </footer>
    </main>
  )
}
