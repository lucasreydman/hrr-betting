'use client'

import type { Pick } from '@/lib/ranker'
import { PickRow } from './PickRow'
import { EmptyState } from './EmptyState'

const RUNG_HINTS: Record<1 | 2 | 3, string> = {
  1: 'Most playable rung. Floor: prob ≥ 85%, edge ≥ 10%.',
  2: 'Mid-conviction tier. Floor: prob ≥ 55%, edge ≥ 30%.',
  3: 'Long-shot tier. Floor: prob ≥ 20%, edge ≥ 60%.',
}

export function BoardSection({ rung, picks }: { rung: 1 | 2 | 3; picks: Pick[] }) {
  const tracked = picks.filter(p => p.tier === 'tracked')
  const watching = picks.filter(p => p.tier === 'watching')
  const trackedCount = tracked.length

  return (
    <section
      aria-labelledby={`board-rung-${rung}`}
      className="overflow-hidden rounded-lg border border-border bg-card/20"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border bg-card/50 px-3 py-3 sm:px-4">
        {/* Hint text wraps below the title on narrow viewports so a 3-rung
            section header never overflows. */}
        <div className="min-w-0 space-y-0.5">
          <h2 id={`board-rung-${rung}`} className="text-lg font-semibold tracking-tight sm:text-xl">
            {rung}+ HRR
          </h2>
          <p className="text-xs text-ink-muted">{RUNG_HINTS[rung]}</p>
        </div>
        {/* Counts wrap in their own group on a tight header; `gap-x-3` between
            tracked + watching replaces the previous `ml-3` (which couldn't wrap). */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-xs sm:text-sm">
          {trackedCount > 0 ? (
            <span className="text-tracked">
              <span aria-hidden="true">🔥</span> {trackedCount} tracked
            </span>
          ) : (
            <span className="text-ink-muted">no tracked picks</span>
          )}
          {watching.length > 0 && (
            <span className="text-ink-muted">{watching.length} watching</span>
          )}
        </div>
      </header>

      {/* Column header — desktop only. Mobile uses a card-style PickRow. */}
      <div
        className="hidden grid-cols-12 gap-2 border-b border-border bg-card/30 px-4 py-2 text-xs uppercase tracking-wider text-ink-muted sm:grid"
        aria-hidden="true"
      >
        <div className="col-span-1"></div>
        <div className="col-span-4">Player</div>
        <div className="col-span-2 text-right">Prob (today / typical)</div>
        <div className="col-span-2 text-right">Edge</div>
        <div className="col-span-1 text-right">Conf</div>
        <div className="col-span-2 text-right">Score</div>
      </div>

      {tracked.map((p, i) => (
        <PickRow key={`t-${p.gameId}-${p.player.playerId}-${i}`} pick={p} />
      ))}

      {watching.length > 0 && tracked.length > 0 && (
        <div className="border-y border-border/50 bg-card/10 px-4 py-1.5 text-xs uppercase tracking-wider text-ink-muted">
          Watching · not tracked, shown for transparency
        </div>
      )}

      {watching.map((p, i) => (
        <PickRow key={`w-${p.gameId}-${p.player.playerId}-${i}`} pick={p} />
      ))}

      {tracked.length === 0 && watching.length === 0 && (
        <div className="p-4 sm:p-6">
          <EmptyState
            title="No picks for this rung"
            description="Either no game is on the slate yet, or the model didn't find anything above the floor today."
          />
        </div>
      )}
    </section>
  )
}
