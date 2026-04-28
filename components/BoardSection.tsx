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
        <div className="min-w-0 space-y-0.5">
          <h2 id={`board-rung-${rung}`} className="text-lg font-semibold tracking-tight sm:text-xl">
            {rung}+ HRR
          </h2>
          <p className="text-xs text-ink-muted">{RUNG_HINTS[rung]}</p>
        </div>
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

      {/* Column headers — desktop only. Uses a visually-styled row that mirrors
          the 7-column grid in PickRow. aria-hidden because PickRow cells aren't
          in a semantic <table> (they're divs for expand/collapse); screen readers
          get column context from visible labels inside each row instead. */}
      <div
        className="hidden sm:grid sm:grid-cols-[2fr_1.2fr_1fr_1fr_0.8fr_0.8fr_0.8fr] sm:gap-3 sm:border-b sm:border-border sm:bg-card/30 sm:px-4 sm:py-2"
        aria-hidden="true"
      >
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Player</div>
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Game</div>
        <div className="text-right text-[11px] uppercase tracking-wider text-ink-muted">Prob. Typical</div>
        <div className="text-right text-[11px] uppercase tracking-wider text-ink-muted">Prob. Today</div>
        <div className="text-right text-[11px] uppercase tracking-wider text-ink-muted">Edge</div>
        <div className="text-right text-[11px] uppercase tracking-wider text-ink-muted">Conf</div>
        <div className="text-right text-[11px] uppercase tracking-wider text-ink-muted">Score</div>
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
