'use client'

import type { Pick } from '@/lib/ranker'

export function PickRow({ pick }: { pick: Pick }) {
  const isTracked = pick.tier === 'tracked'

  // Tracked picks: bold amber accent — these are the actual betting candidates.
  // Watching picks: subtle row, just informational.
  const rowClasses = isTracked
    ? 'grid grid-cols-12 gap-2 px-3 py-2 border-b border-border/50 bg-tracked/10 border-l-4 border-l-tracked hover:bg-tracked/15 ring-1 ring-tracked/30'
    : 'grid grid-cols-12 gap-2 px-3 py-2 border-b border-border/50 hover:bg-card/50'

  return (
    <div className={rowClasses}>
      <div className="col-span-1 font-mono text-sm">
        {isTracked && <span className="text-tracked text-base">🔥</span>}
      </div>
      <div className="col-span-3">
        <div className={isTracked ? 'font-semibold text-ink' : 'font-medium'}>{pick.player.fullName}</div>
        <div className="text-xs text-ink-muted leading-tight">
          {pick.player.team} vs {pick.opponent.abbrev} · slot {pick.lineupSlot}
          {pick.lineupStatus === 'estimated' && <span className="ml-1 text-amber-500">(est)</span>}
          {pick.lineupStatus === 'partial' && <span className="ml-1 text-amber-500">(partial)</span>}
        </div>
        <div className="text-xs text-ink-muted leading-tight">
          P: {pick.opposingPitcher.name}
          {pick.opposingPitcher.status === 'tbd' && <span className="ml-1 text-amber-500">TBD</span>}
          {pick.opposingPitcher.status === 'probable' && <span className="ml-1 text-ink-muted">(probable)</span>}
          {pick.opposingPitcher.status === 'confirmed' && <span className="ml-1 text-hit">(confirmed)</span>}
        </div>
      </div>
      <div className="col-span-2 text-right font-mono text-sm">
        <div className={isTracked ? 'font-semibold' : ''}>{(pick.pMatchup * 100).toFixed(1)}%</div>
        <div className="text-xs text-ink-muted">vs {(pick.pTypical * 100).toFixed(1)}%</div>
      </div>
      <div className="col-span-2 text-right font-mono text-sm">
        <div className={pick.edge >= 0 ? 'text-accent' : 'text-ink-muted'}>
          {pick.edge >= 0 ? '+' : ''}{(pick.edge * 100).toFixed(0)}%
        </div>
        <div className="text-xs text-ink-muted">edge</div>
      </div>
      <div className="col-span-2 text-right font-mono text-sm">
        <div className={isTracked ? 'font-semibold text-hit' : ''}>{(pick.confidence * 100).toFixed(0)}%</div>
        <div className="text-xs text-ink-muted">conf</div>
      </div>
      <div className="col-span-2 text-right font-mono">
        <div className={`${isTracked ? 'text-tracked text-xl' : 'text-lg'} font-semibold`}>{(pick.score * 100).toFixed(1)}</div>
        <div className="text-xs text-ink-muted">score</div>
      </div>
    </div>
  )
}
