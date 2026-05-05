'use client'

import { useMemo, useState } from 'react'
import type { Pick } from '@/lib/ranker'
import { PickRow } from './PickRow'
import { EmptyState } from './EmptyState'
import { EDGE_FLOORS, PROB_FLOORS } from '@/lib/constants'
import { buildBoardCsv } from '@/lib/board-csv'
import { slateDateString } from '@/lib/date-utils'
import { BetSettingsProvider, useBetSettings } from './BetSettingsContext'

export type PickWithRung = Pick & { rung: 1 | 2 | 3 }

export type SortKey = 'score' | 'pTypical' | 'pMatchup' | 'edge' | 'confidence' | 'game'

// p̂ = "p-hat", standard stats notation for an estimated probability. Used in
// labels and column headers throughout the board. Object key order also drives
// the `<select>` option order — Default (Kelly score) first, Game second since
// "by game start" is the most-used alternative ordering.
const SORT_LABELS: Record<SortKey, string> = {
  score: 'Default',
  game: 'Game',
  pTypical: 'p̂ typical',
  pMatchup: 'p̂ today',
  edge: 'Edge',
  confidence: 'Confidence',
}

/**
 * Sort comparator. Numeric sort keys (score / pTypical / pMatchup / edge /
 * confidence) sort descending — best on top. The `game` sort groups plays
 * by first pitch (earliest first) so plays from the same game cluster
 * together; within a game, score-descending picks the best bet first.
 *
 * `gameDate` is optional on `Pick` (settled-history rows hydrated from the
 * DB don't carry it), so an undefined gameDate sinks to the bottom rather
 * than crashing on Date.parse(undefined). Same-time picks tiebreak by
 * gameId so a doubleheader pair can't interleave their players, then by
 * score so the top play in each game leads the cluster.
 */
export function comparePicks(a: PickWithRung, b: PickWithRung, sortKey: SortKey): number {
  if (sortKey === 'game') {
    const aTime = a.gameDate ? Date.parse(a.gameDate) : Number.POSITIVE_INFINITY
    const bTime = b.gameDate ? Date.parse(b.gameDate) : Number.POSITIVE_INFINITY
    if (aTime !== bTime) return aTime - bTime
    if (a.gameId !== b.gameId) return a.gameId - b.gameId
    return b.score - a.score
  }
  return b[sortKey] - a[sortKey]
}

// Built from the live constants so the chip tooltips can never drift from the
// actual gate values in lib/constants.ts.
const fmtPct = (n: number) => `${Math.round(n * 100)}%`
const RUNG_TOOLTIPS: Record<1 | 2 | 3, string> = {
  1: `1+ HRR · floor: prob ≥ ${fmtPct(PROB_FLOORS[1])}, edge ≥ ${fmtPct(EDGE_FLOORS[1])}`,
  2: `2+ HRR · floor: prob ≥ ${fmtPct(PROB_FLOORS[2])}, edge ≥ ${fmtPct(EDGE_FLOORS[2])}`,
  3: `3+ HRR · floor: prob ≥ ${fmtPct(PROB_FLOORS[3])}, edge ≥ ${fmtPct(EDGE_FLOORS[3])}`,
}

type GameStatusFilter = 'upcoming' | 'live' | 'settled'

const STATUS_LABELS: Record<GameStatusFilter, string> = {
  upcoming: 'Upcoming',
  live: 'Live',
  settled: 'Settled',
}

const STATUS_TOOLTIPS: Record<GameStatusFilter, string> = {
  upcoming: 'Games that haven\'t started yet (scheduled)',
  live: 'Games currently in progress',
  settled: 'Games that have finished (final)',
}

type BetTypeFilter = 'tracked' | 'other'

const BET_TYPE_LABELS: Record<BetTypeFilter, string> = {
  tracked: 'Tracked',
  other: 'Watching',
}

const BET_TYPE_TOOLTIPS: Record<BetTypeFilter, string> = {
  tracked: 'Picks passing all floors right now (🎯) or already locked (🔒)',
  other: 'Picks below at least one tracked floor (👀). Watching picks for live/final games are dropped automatically.',
}

/** Map a Pick's gameStatus to one of the three filter buckets. */
function bucketForStatus(status: PickWithRung['gameStatus']): GameStatusFilter {
  if (status === 'in_progress') return 'live'
  if (status === 'final') return 'settled'
  // 'scheduled', 'postponed', and undefined all bucket as upcoming — postponed
  // is filtered upstream so we won't actually see it; undefined comes from
  // legacy locked-pick rows hydrated from the DB.
  return 'upcoming'
}

// Per-rung universe quotas. Total cap = 30. Tracked plays for a rung always
// show (no cap on tracked); watching plays for that rung fill up to the quota.
// Without this, Kelly's variance penalty would erase 3+ HRR longshots from the
// board entirely — the rung filter chip would be permanently empty.
const RUNG_QUOTAS: Record<1 | 2 | 3, number> = {
  1: 15,
  2: 10,
  3: 5,
}

/**
 * Settings bar — bankroll input + Kelly-fraction selector. Mounted at the
 * top of the board, inside the BetSettings provider so changes here
 * immediately re-render every PickRow's wager-cell calculation.
 *
 * Settings are persisted via the provider's localStorage hooks; this
 * component just reads/writes through the context.
 */
function BetSettingsBar({ picks }: { picks: PickWithRung[] }) {
  const { bankroll, kellyMultiplier, setBankroll, setKellyMultiplier } = useBetSettings()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 bg-card/20 px-3 py-2 sm:px-4">
      <span className="text-[11px] uppercase tracking-wider text-ink-muted">Bet sizing</span>
      <label className="flex items-center gap-2">
        <span className="text-[11px] text-ink-muted">Bankroll</span>
        <span className="text-xs text-ink-muted">$</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={50}
          value={bankroll}
          onChange={e => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n >= 0) setBankroll(n)
          }}
          className="w-24 rounded border border-border bg-card/50 px-2 py-1 font-mono text-xs tabular-nums text-ink focus:border-tracked/60 focus:outline-none"
          aria-label="Bankroll in dollars"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-[11px] text-ink-muted">Kelly Fraction</span>
        <select
          value={kellyMultiplier}
          onChange={e => setKellyMultiplier(Number(e.target.value))}
          className="rounded border border-border bg-card/50 px-2 py-1 font-mono text-xs text-ink"
          aria-label="Kelly fraction multiplier"
        >
          <option value={0.125}>Eighth</option>
          <option value={0.25}>Quarter</option>
          <option value={0.5}>Half</option>
          <option value={1}>Full</option>
        </select>
      </label>
      <ExportCsvButton picks={picks} />
    </div>
  )
}

function ExportCsvButton({ picks }: { picks: PickWithRung[] }) {
  const onClick = () => {
    const date = slateDateString()
    const csv = buildBoardCsv(picks, date)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.href = url
    a.download = `hrr-board-${date}-${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={picks.length === 0}
      title="Download every pick on the board (with full inputs + factor breakdowns) as a CSV. One row per pick, ~60 columns wide — paste back to the assistant for error triage."
      className="ml-auto rounded border border-border bg-card/50 px-2 py-1 font-mono text-[11px] text-ink hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={`Export ${picks.length} picks to CSV`}
    >
      Export CSV ({picks.length})
    </button>
  )
}

function BoardContents({ picks }: { picks: PickWithRung[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [enabledRungs, setEnabledRungs] = useState<Set<1 | 2 | 3>>(new Set([1, 2, 3]))
  const [enabledStatuses, setEnabledStatuses] = useState<Set<GameStatusFilter>>(
    new Set(['upcoming', 'live', 'settled']),
  )
  const [enabledTypes, setEnabledTypes] = useState<Set<BetTypeFilter>>(
    new Set(['tracked', 'other']),
  )

  // The "universe" is built per-rung with a guaranteed minimum slot count for
  // each (RUNG_QUOTAS). Tracked plays always make the cut — never capped —
  // and watching plays fill any remaining slots up to the rung's quota,
  // sorted by score. Without per-rung quotas, Kelly scoring (which heavily
  // penalises longshot variance) would shut 3+ HRR plays out of the board
  // entirely, since their Kelly scores rarely beat 1+/2+ tracked plays.
  // Universe membership is stable across filter toggles and sort changes;
  // filters only narrow what's *visible* from it.
  const universe = useMemo(() => {
    const result: PickWithRung[] = []
    for (const rung of [1, 2, 3] as const) {
      const rungPicks = picks.filter(p => p.rung === rung)
      const trackedAll = rungPicks
        .filter(p => p.tier === 'tracked')
        .sort((a, b) => b.score - a.score)
      const watchingAll = rungPicks
        .filter(p => p.tier === 'watching')
        .sort((a, b) => b.score - a.score)
      const remainingSlots = Math.max(0, RUNG_QUOTAS[rung] - trackedAll.length)
      result.push(...trackedAll, ...watchingAll.slice(0, remainingSlots))
    }
    return result
  }, [picks])

  const visible = useMemo(
    () =>
      universe.filter(
        p =>
          enabledRungs.has(p.rung) &&
          enabledStatuses.has(bucketForStatus(p.gameStatus)) &&
          enabledTypes.has(p.tier === 'tracked' ? 'tracked' : 'other'),
      ),
    [universe, enabledRungs, enabledStatuses, enabledTypes],
  )

  const tracked = useMemo(
    () => visible.filter(p => p.tier === 'tracked').sort((a, b) => comparePicks(a, b, sortKey)),
    [visible, sortKey],
  )
  const watching = useMemo(
    () => visible.filter(p => p.tier === 'watching').sort((a, b) => comparePicks(a, b, sortKey)),
    [visible, sortKey],
  )

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

  const toggleStatus = (s: GameStatusFilter) => {
    setEnabledStatuses(prev => {
      const next = new Set(prev)
      if (next.has(s)) {
        if (next.size > 1) next.delete(s)
      } else {
        next.add(s)
      }
      return next
    })
  }

  const toggleType = (t: BetTypeFilter) => {
    setEnabledTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) {
        if (next.size > 1) next.delete(t)
      } else {
        next.add(t)
      }
      return next
    })
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card/20" aria-label="Picks board">
      <BetSettingsBar picks={visible} />
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
              {r}+ HRR
            </button>
          ))}
          <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-muted">Game</span>
          {(['upcoming', 'live', 'settled'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              title={STATUS_TOOLTIPS[s]}
              aria-pressed={enabledStatuses.has(s)}
              className={
                'rounded border px-2 py-0.5 font-mono text-xs tabular-nums transition-colors ' +
                (enabledStatuses.has(s)
                  ? 'border-tracked/60 bg-tracked/10 text-tracked'
                  : 'border-border bg-card/30 text-ink-muted hover:bg-card/60')
              }
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
          <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-muted">Bet type</span>
          {(['tracked', 'other'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              title={BET_TYPE_TOOLTIPS[t]}
              aria-pressed={enabledTypes.has(t)}
              className={
                'rounded border px-2 py-0.5 font-mono text-xs tabular-nums transition-colors ' +
                (enabledTypes.has(t)
                  ? 'border-tracked/60 bg-tracked/10 text-tracked'
                  : 'border-border bg-card/30 text-ink-muted hover:bg-card/60')
              }
            >
              {BET_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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

      {/* Column headers — desktop only. Mirrors the 11-column grid in PickRow.
          Score column sits between Confidence and Wager: it's the 4th and final
          tracked-tier gate (Kelly-weighted conviction, per-rung floor). */}
      <div
        className="hidden sm:grid sm:grid-cols-[0.7fr_1.5fr_1.3fr_1.1fr_0.8fr_0.8fr_0.75fr_0.95fr_0.7fr_1.2fr_0.3fr] sm:gap-3 sm:border-b sm:border-border sm:bg-card/30 sm:px-4 sm:py-2"
        aria-hidden="true"
      >
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Bet</div>
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Batter</div>
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Starting Pitcher</div>
        <div className="text-[11px] uppercase tracking-wider text-ink-muted">Game</div>
        <div className="text-center text-[11px] tracking-wider text-ink-muted">
          p̂<sub className="text-[9px]">typical</sub>
        </div>
        <div className="text-center text-[11px] tracking-wider text-ink-muted">
          p̂<sub className="text-[9px]">today</sub>
        </div>
        <div className="text-center text-[11px] uppercase tracking-wider text-ink-muted">Edge</div>
        <div className="text-center text-[11px] uppercase tracking-wider text-ink-muted">Confidence</div>
        <div className="text-center text-[11px] uppercase tracking-wider text-ink-muted">Score</div>
        <div className="text-center text-[11px] uppercase tracking-wider text-ink-muted">Wager</div>
        <div></div>
      </div>

      {tracked.map((p, i) => (
        <PickRow key={`t-${p.rung}-${p.gameId}-${p.player.playerId}-${i}`} pick={p} rung={p.rung} />
      ))}

      {watching.length > 0 && tracked.length > 0 && (
        <div className="border-y border-border/50 bg-card/10 px-4 py-1.5 text-xs uppercase tracking-wider text-ink-muted">
          👀 Watching · below at least one tracked floor right now
        </div>
      )}

      {watching.map((p, i) => (
        <PickRow key={`w-${p.rung}-${p.gameId}-${p.player.playerId}-${i}`} pick={p} rung={p.rung} />
      ))}

      {tracked.length === 0 && watching.length === 0 && (
        <div className="p-4 sm:p-6">
          <EmptyState
            title="No picks match these filters"
            description="Loosen the rung, game, or bet-type filters."
          />
        </div>
      )}
    </section>
  )
}

/**
 * Public Board — wraps the inner contents in the BetSettings provider so
 * the bankroll + Kelly settings are available to BetSettingsBar (top of
 * board) and to every PickRow's wager cell.
 */
export function Board({ picks }: { picks: PickWithRung[] }) {
  return (
    <BetSettingsProvider>
      <BoardContents picks={picks} />
    </BetSettingsProvider>
  )
}
