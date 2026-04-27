'use client'

import { useEffect, useState } from 'react'

interface StatusBannerProps {
  refreshedAt: string
  meta: { gamesTotal: number; gamesWithSim: number; gamesWithoutSim: number[] }
  totalTracked: number
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

export function StatusBanner({ refreshedAt, meta, totalTracked }: StatusBannerProps) {
  // Computing relative time (Date.now()) on first render would cause an SSR/CSR
  // hydration mismatch — server and client compute it at different instants.
  // Compute after mount and refresh every 30 s so the label stays accurate.
  const [minAgo, setMinAgo] = useState<number | null>(null)
  useEffect(() => {
    const compute = () => {
      const ms = Date.now() - new Date(refreshedAt).getTime()
      setMinAgo(Math.max(0, Math.floor(ms / 60_000)))
    }
    compute()
    const id = setInterval(compute, 30_000)
    return () => clearInterval(id)
  }, [refreshedAt])

  const warming = meta.gamesWithoutSim.length > 0
  const refreshedLabel =
    minAgo === null ? '…' : minAgo === 0 ? 'just now' : `${minAgo}m ago`

  return (
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
      <StatChip
        label="Refreshed"
        value={refreshedLabel}
      />
    </div>
  )
}
