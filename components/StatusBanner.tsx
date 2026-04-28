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

export function StatusBanner({ refreshedAt, meta, totalTracked, onRefresh }: StatusBannerProps) {
  const warming = meta.gamesWithoutSim.length > 0

  const states = meta.gameStates
  const showProgress = states && (states.inProgress > 0 || states.final > 0)
  const progressValue = states
    ? [
        states.final > 0 ? `${states.final} final` : null,
        states.inProgress > 0 ? `${states.inProgress} live` : null,
        states.scheduled > 0 ? `${states.scheduled} upcoming` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap items-stretch gap-2"
        aria-label="Slate status"
      >
        <StatChip
          label="Tracked"
          value={`${totalTracked}`}
          tone="tracked"
          ariaLabel={`${totalTracked} tracked picks across all rungs`}
        />
        <StatChip
          label="Sims"
          value={`${meta.gamesWithSim} / ${meta.gamesTotal}`}
          tone={warming ? 'warn' : 'neutral'}
          ariaLabel={`${meta.gamesWithSim} of ${meta.gamesTotal} games simmed`}
        />
        {warming && (
          <StatChip
            label="Warming"
            value={`${meta.gamesWithoutSim.length}`}
            tone="warn"
            ariaLabel={`${meta.gamesWithoutSim.length} games warming`}
          />
        )}
        {showProgress && (
          <StatChip
            label="Slate"
            value={progressValue}
            tone={states.inProgress > 0 ? 'tracked' : 'neutral'}
            ariaLabel={`Slate progress: ${progressValue}`}
          />
        )}
        {/* Freshness chip with live second counter */}
        <div
          className="flex items-baseline gap-2 rounded-md border border-border bg-card/40 px-3 py-2"
          aria-label="Data freshness"
        >
          <span className="text-[11px] uppercase tracking-wider text-ink-muted">Updated</span>
          <FreshnessLabel refreshedAt={refreshedAt} />
        </div>
      </div>
      <div className="flex items-center">
        <RefreshButton onRefresh={onRefresh} />
      </div>
    </div>
  )
}
