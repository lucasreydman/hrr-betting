'use client'

import { useEffect, useState, useCallback } from 'react'
import type { PicksResponse } from '@/lib/ranker'
import { BoardSection } from './BoardSection'
import { StatusBanner } from './StatusBanner'

export function ClientShell({ initialPicks }: { initialPicks: PicksResponse }) {
  const [picks, setPicks] = useState<PicksResponse>(initialPicks)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/picks?date=${initialPicks.date}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: PicksResponse = await res.json()
      setPicks(data)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [initialPicks.date])

  useEffect(() => {
    const id = setInterval(refresh, 5 * 60 * 1000)  // 5 min
    return () => clearInterval(id)
  }, [refresh])

  const totalTracked = picks.rung1.filter(p => p.tier === 'tracked').length +
                       picks.rung2.filter(p => p.tier === 'tracked').length +
                       picks.rung3.filter(p => p.tier === 'tracked').length

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">HRR Betting</h1>
        <div className="text-ink-muted text-sm">
          Today&apos;s slate · {picks.date}
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
