'use client'

import type { Pick } from '@/lib/ranker'

export function PickRow({ pick }: { pick: Pick }) {
  const isTracked = pick.tier === 'tracked'
  return (
    <div className={`grid grid-cols-12 gap-2 px-3 py-2 border-b border-border/50 hover:bg-card/50 ${isTracked ? 'bg-card/30' : ''}`}>
      <div className="col-span-1 text-tracked font-mono text-sm">
        {isTracked ? '🔥' : ''}
      </div>
      <div className="col-span-3">
        <div className="font-medium">{pick.player.fullName}</div>
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
        <div>{(pick.pMatchup * 100).toFixed(1)}%</div>
        <div className="text-xs text-ink-muted">vs {(pick.pTypical * 100).toFixed(1)}%</div>
      </div>
      <div className="col-span-2 text-right font-mono text-sm">
        <div className={pick.edge >= 0 ? 'text-accent' : 'text-ink-muted'}>
          {pick.edge >= 0 ? '+' : ''}{(pick.edge * 100).toFixed(0)}%
        </div>
        <div className="text-xs text-ink-muted">edge</div>
      </div>
      <div className="col-span-2 text-right font-mono text-sm">
        <div>{(pick.confidence * 100).toFixed(0)}%</div>
        <div className="text-xs text-ink-muted">conf</div>
      </div>
      <div className="col-span-2 text-right font-mono">
        <div className="text-lg font-semibold">{pick.score.toFixed(2)}</div>
        <div className="text-xs text-ink-muted">score</div>
      </div>
    </div>
  )
}
