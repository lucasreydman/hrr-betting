'use client'

import { useMemo, useState } from 'react'
import type { Pick } from '@/lib/ranker'
import { PickRow } from './PickRow'
import { EmptyState } from './EmptyState'

export type PickWithRung = Pick & { rung: 1 | 2 | 3 }

type SortKey = 'score' | 'pMatchup' | 'edge' | 'confidence' | 'pTypical'

// p̂ = "p-hat", standard stats notation for an estimated probability. Used in
// labels and column headers throughout the board.
const SORT_LABELS: Record<SortKey, string> = {
  score: 'Score',
  pMatchup: 'p̂ today',
  edge: 'Edge',
  confidence: 'Confidence',
  pTypical: 'p̂ typical',
}

const RUNG_TOOLTIPS: Record<1 | 2 | 3, string> = {
  1: '1+ HRR · floor: prob ≥ 85%, edge ≥ 10%',
  2: '2+ HRR · floor: prob ≥ 55%, edge ≥ 30%',
  3: '3+ HRR · floor: prob ≥ 20%, edge ≥ 60%',
}

const TOTAL_CAP = 50

export function Board({ picks }: { picks: PickWithRung[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [enabledRungs, setEnabledRungs] = useState<Set<1 | 2 | 3>>(new Set([1, 2, 3]))
  const [trackedOnly, setTrackedOnly] = useState(false)

  const filtered = useMemo(
    () => picks.filter(p => enabledRungs.has(p.rung) && (!trackedOnly || p.tier === 'tracked')),
    [picks, enabledRungs, trackedOnly],
  )

  const trackedAll = useMemo(
    () => filtered.filter(p => p.tier === 'tracked').sort((a, b) => b[sortKey] - a[sortKey]),
    [filtered, sortKey],
  )
  const watchingAll = useMemo(
    () => filtered.filter(p => p.tier === 'watching').sort((a, b) => b[sortKey] - a[sortKey]),
    [filtered, sortKey],
  )

  // Cap the entire board at TOTAL_CAP rows. Tracked rows take priority — they
  // fill slots first, then watching takes whatever's left.
  const tracked = useMemo(() => trackedAll.slice(0, TOTAL_CAP), [trackedAll])
  const watching = useMemo(
    () => watchingAll.slice(0, Math.max(0, TOTAL_CAP - tracked.length)),
    [watchingAll, tracked.length],
  )
  const totalShown = tracked.length + watching.length

  // Don't allow zero rungs — keeps the board from going empty in a confusing way.
  const toggleRung = (r: 1 | 2 | 3) => {
    setEnabledRungs(prev => {
      const next = new Set(prev)
      if (next.has(r)) {
        if (next.size > 1) next.delete(r)
      } else {
        next.add(r)
      }
      return next
    })
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card/20" aria-label="Picks board">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border bg-card/50 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-ink-muted">Rung</span>
          {([1, 2, 3] as const).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => toggleRung(r)}
              title={RUNG_TOOLTIPS[r]}
              aria-pressed={enabledRungs.has(r)}
              className={
                'rounded border px-2 py-0.5 font-mono text-xs tabular-nums transition-colors ' +
                (enabledRungs.has(r)
                  ? 'border-tracked/60 bg-tracked/10 text-tracked'
                  : 'border-border bg-card/30 text-ink-muted hover:bg-card/60')
              }
            >
              {r}+
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTrackedOnly(v => !v)}
            aria-pressed={trackedOnly}
            className={
              'ml-2 rounded border px-2 py-0.5 font-mono text-xs tabular-nums transition-colors ' +
              (trackedOnly
                ? 'border-tracked/60 bg-tracked/10 text-tracked'
                : 'border-border bg-card/30 text-ink-muted hover:bg-card/60')
            }
          >
            🔥 Tracked only
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-[11px] tabular-nums text-ink-muted">
            {totalShown} {totalShown === 1 ? 'play' : 'plays'}
          </span>
          <label className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-ink-muted">Sort by</span>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="rounded border border-border bg-card/50 px-2 py-1 font-mono text-xs text-ink"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {/* Column headers — desktop only. Mirrors the 10-column grid in PickRow. */}
      <div
        className="hidden sm:grid sm:grid-cols-[0.7fr_1.6fr_1.4fr_1.2fr_0.85fr_0.85fr_0.7fr_0.7fr_0.6fr_0.3fr] sm:gap-3 sm:border-b sm:border-border sm:bg-card/30 sm:px-4 sm:py-2"
        aria-hidden="true"
      >
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Bet</div>
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Batter</div>
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Pitcher</div>
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Game</div>
        <div className="text-right text-[11px] tracking-wider text-ink-muted">
          p̂<sub className="text-[9px]">typical</sub>
        </div>
        <div className="text-right text-[11px] tracking-wider text-ink-muted">
          p̂<sub className="text-[9px]">today</sub>
        </div>
        <div className="text-right text-[11px] uppercase tracking-wider text-ink-muted">Edge</div>
        <div className="text-right text-[11px] uppercase tracking-wider text-ink-muted">Conf</div>
        <div className="text-right text-[11px] uppercase tracking-wider text-ink-muted">Score</div>
        <div></div>
      </div>

      {tracked.map((p, i) => (
        <PickRow key={`t-${p.rung}-${p.gameId}-${p.player.playerId}-${i}`} pick={p} rung={p.rung} />
      ))}

      {watching.length > 0 && tracked.length > 0 && (
        <div className="border-y border-border/50 bg-card/10 px-4 py-1.5 text-xs uppercase tracking-wider text-ink-muted">
          Other plays · solid matchups outside the tracked tier
        </div>
      )}

      {watching.map((p, i) => (
        <PickRow key={`w-${p.rung}-${p.gameId}-${p.player.playerId}-${i}`} pick={p} rung={p.rung} />
      ))}

      {tracked.length === 0 && watching.length === 0 && (
        <div className="p-4 sm:p-6">
          <EmptyState
            title="No picks match these filters"
            description="Loosen the rung filter or turn off 'Tracked only'."
          />
        </div>
      )}
    </section>
  )
}
