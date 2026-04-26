'use client'

interface StatusBannerProps {
  refreshedAt: string
  meta: { gamesTotal: number; gamesWithSim: number; gamesWithoutSim: number[] }
  totalTracked: number
}

export function StatusBanner({ refreshedAt, meta, totalTracked }: StatusBannerProps) {
  const refreshedDate = new Date(refreshedAt)
  const minAgo = Math.floor((Date.now() - refreshedDate.getTime()) / 60_000)
  const warming = meta.gamesWithoutSim.length > 0

  return (
    <div className="px-4 py-3 bg-card/30 border border-border rounded-lg text-sm font-mono">
      <span className="text-tracked font-semibold">🔥 {totalTracked} tracked</span>
      <span className="text-ink-muted ml-3">across all rungs</span>
      <span className="text-ink-muted mx-3">·</span>
      <span className="text-ink-muted">
        {meta.gamesWithSim}/{meta.gamesTotal} games simmed
        {warming && <span className="text-amber-500 ml-2">({meta.gamesWithoutSim.length} warming)</span>}
      </span>
      <span className="text-ink-muted mx-3">·</span>
      <span className="text-ink-muted">
        refreshed {minAgo === 0 ? 'just now' : `${minAgo}m ago`}
      </span>
    </div>
  )
}
