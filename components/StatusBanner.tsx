'use client'

import { useEffect, useState } from 'react'
import type { PicksResponse } from '@/lib/ranker'
import { RefreshButton } from './RefreshButton'

interface StatusBannerProps {
  refreshedAt: string
  meta: PicksResponse['meta']
  totalTracked: number
  onRefresh: () => Promise<void>
}

interface StatChipProps {
  label: string
  value: string
  tone?: 'neutral' | 'tracked' | 'warn'
  ariaLabel?: string
}

function StatChip({ label, value, tone = 'neutral', ariaLabel }: StatChipProps) {
  const valueClass =
    tone === 'tracked'
      ? 'text-tracked'
      : tone === 'warn'
        ? 'text-warn'
        : 'text-ink'
  return (
    <div
      className="flex items-baseline gap-2 rounded-md border border-border bg-card/40 px-3 py-2"
      aria-label={ariaLabel}
    >
      <span className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</span>
      <span className={`font-mono text-sm ${valueClass}`}>{value}</span>
    </div>
  )
}

/** "Xs ago" / "Xm ago" label that re-renders every second. */
function FreshnessLabel({ refreshedAt }: { refreshedAt: string }) {
  const [secAgo, setSecAgo] = useState<number | null>(null)

  useEffect(() => {
    const compute = () => {
      const ms = Date.now() - new Date(refreshedAt).getTime()
      setSecAgo(Math.max(0, Math.floor(ms / 1_000)))
    }
    compute()
    const id = setInterval(compute, 1_000)
    return () => clearInterval(id)
  }, [refreshedAt])

  if (secAgo === null) return <span className="font-mono text-sm text-ink">…</span>
  if (secAgo < 60) return <span className="font-mono text-sm text-ink">{secAgo}s ago</span>
  const min = Math.floor(secAgo / 60)
  return <span className="font-mono text-sm text-ink">{min}m ago</span>
}

/** Live HH:MM:SS clock that ticks every second. SSR-safe via the null guard. */
function CurrentTimeLabel() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    const tick = () => setNow(new Date())
    tick()
    const id = setInterval(tick, 1_000)
    return () => clearInterval(id)
  }, [])

  if (now === null) return <span className="font-mono text-sm text-ink">…</span>
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return <span className="font-mono text-sm text-ink tabular-nums">{`${hh}:${mm}:${ss}`}</span>
}

export function StatusBanner({ refreshedAt, meta, totalTracked, onRefresh }: StatusBannerProps) {
  const states = meta.gameStates
  const showProgress = states && (states.inProgress > 0 || states.final > 0)
  // Order: upcoming → live → settled (mirrors the chronological flow of a slate).
  // Uses "settled" terminology for finals to match the filter chip below.
  // Zero-count buckets are omitted so the pill stays compact ("15 settled" not
  // "0 upcoming · 0 live · 15 settled").
  const progressValue = states
    ? [
        states.scheduled > 0 ? `${states.scheduled} upcoming` : null,
        states.inProgress > 0 ? `${states.inProgress} live` : null,
        states.final > 0 ? `${states.final} settled` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: slate metadata pills */}
      <div
        className="flex flex-wrap items-stretch gap-2"
        aria-label="Slate status"
      >
        <StatChip
          label="Games today"
          value={`${meta.gamesTotal}`}
          tone="neutral"
          ariaLabel={`${meta.gamesTotal} games on slate`}
        />
        <StatChip
          label="Tracked bets"
          value={`${totalTracked}`}
          tone="tracked"
          ariaLabel={`${totalTracked} tracked picks across all rungs`}
        />
        {showProgress && (
          <StatChip
            label="Slate status"
            value={progressValue}
            tone={states.inProgress > 0 ? 'tracked' : 'neutral'}
            ariaLabel={`Slate progress: ${progressValue}`}
          />
        )}
      </div>

      {/* Right: current time + freshness indicator + refresh button */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-baseline gap-2 rounded-md border border-border bg-card/40 px-3 py-2"
          aria-label="Current time"
        >
          <span className="text-[11px] uppercase tracking-wider text-ink-muted">Now</span>
          <CurrentTimeLabel />
        </div>
        <div
          className="flex items-baseline gap-2 rounded-md border border-border bg-card/40 px-3 py-2"
          aria-label="Data freshness"
        >
          <span className="text-[11px] uppercase tracking-wider text-ink-muted">Updated</span>
          <FreshnessLabel refreshedAt={refreshedAt} />
        </div>
        <RefreshButton onRefresh={onRefresh} />
      </div>
    </div>
  )
}
