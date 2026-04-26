'use client'

import type { Pick } from '@/lib/ranker'
import { PickRow } from './PickRow'

export function BoardSection({ rung, picks }: { rung: 1 | 2 | 3; picks: Pick[] }) {
  const tracked = picks.filter(p => p.tier === 'tracked')
  const watching = picks.filter(p => p.tier === 'watching')
  const trackedCount = tracked.length

  return (
    <section className="border border-border rounded-lg overflow-hidden bg-card/20">
      <header className="px-4 py-3 border-b border-border bg-card/50 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">{rung}+ HRR</h2>
        <div className="text-sm text-ink-muted font-mono">
          {trackedCount > 0
            ? <span className="text-tracked">🔥 {trackedCount} tracked</span>
            : <span>no tracked picks</span>}
          {watching.length > 0 && <span className="ml-3">{watching.length} watching</span>}
        </div>
      </header>

      {/* Header row */}
      <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-border bg-card/30 text-xs uppercase tracking-wider text-ink-muted">
        <div className="col-span-1"></div>
        <div className="col-span-3">Player</div>
        <div className="col-span-2 text-right">Prob (today / typical)</div>
        <div className="col-span-2 text-right">Edge</div>
        <div className="col-span-2 text-right">Conf</div>
        <div className="col-span-2 text-right">Score</div>
      </div>

      {/* Tracked first, then watching */}
      {tracked.map((p, i) => <PickRow key={`t-${p.gameId}-${p.player.playerId}-${i}`} pick={p} />)}
      {watching.length > 0 && tracked.length > 0 && (
        <div className="px-4 py-1 text-xs text-ink-muted bg-card/10 border-y border-border/50">
          Watching (not tracked, shown for transparency):
        </div>
      )}
      {watching.map((p, i) => <PickRow key={`w-${p.gameId}-${p.player.playerId}-${i}`} pick={p} />)}

      {tracked.length === 0 && watching.length === 0 && (
        <div className="px-4 py-8 text-center text-ink-muted">
          No picks for this rung — slate may be weak today.
        </div>
      )}
    </section>
  )
}
