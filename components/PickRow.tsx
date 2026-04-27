'use client'

import type { Pick } from '@/lib/ranker'

function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

function signedPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(0)}%`
}

/**
 * Plain-language summary of which confidence multipliers are in play. Used
 * as a `title` (native tooltip) on the Conf cell so a curious user can hover
 * to see why a confidence value is what it is — no new UI surface, no JS deps.
 */
function confidenceSummary(pick: Pick): string {
  const lines: string[] = [`Confidence: ${(pick.confidence * 100).toFixed(0)}%`]
  lines.push('')
  lines.push(`Lineup: ${pick.lineupStatus}`)
  lines.push(
    pick.opposingPitcher.status === 'tbd'
      ? 'Pitcher: TBD (penalises confidence)'
      : `Pitcher: ${pick.opposingPitcher.name} (${pick.opposingPitcher.status})`,
  )
  lines.push('')
  lines.push('Multipliers (typical):')
  lines.push('• confirmed lineup ×1.00 / partial ×0.85 / estimated ×0.70')
  lines.push('• BvP sample size 0–20 AB → 0.90×–1.00×')
  lines.push('• pitcher start sample 3–10 → 0.90×–1.00×')
  lines.push('• stable weather ×1.00 / volatile ×0.90')
  lines.push('• opener ×0.90')
  return lines.join('\n')
}

function LineupBadge({ status }: { status: Pick['lineupStatus'] }) {
  if (status === 'confirmed') return null
  return (
    <span className="ml-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warn">
      {status === 'estimated' ? 'est' : 'partial'}
    </span>
  )
}

function PitcherBadge({ status }: { status: Pick['opposingPitcher']['status'] }) {
  if (status === 'tbd') {
    return (
      <span className="ml-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warn">
        TBD
      </span>
    )
  }
  if (status === 'probable') {
    return (
      <span className="ml-1 text-[11px] uppercase tracking-wider text-ink-muted">
        probable
      </span>
    )
  }
  return (
    <span className="ml-1 text-[11px] uppercase tracking-wider text-hit">
      confirmed
    </span>
  )
}

export function PickRow({ pick }: { pick: Pick }) {
  const isTracked = pick.tier === 'tracked'

  // Tracked picks get a strong amber accent + left border; watching picks
  // stay quiet so the eye lands on tracked first.
  const containerClasses = isTracked
    ? 'border-l-4 border-l-tracked bg-tracked/10 ring-1 ring-inset ring-tracked/20 hover:bg-tracked/15'
    : 'hover:bg-card/40'

  return (
    <article
      className={
        'grid grid-cols-12 items-center gap-2 border-b border-border/50 px-3 py-3 transition-colors sm:gap-3 sm:px-4 ' +
        containerClasses
      }
    >
      {/* Tracked indicator — desktop column 1, mobile inline */}
      <div className="col-span-1 hidden font-mono text-base sm:block" aria-hidden="true">
        {isTracked && <span className="text-tracked">🔥</span>}
      </div>

      {/* Player + meta — `min-w-0` so flex/grid children can actually shrink
          and `break-words` so a long surname doesn't break out of the card on
          a 320 px viewport. */}
      <div className="col-span-12 min-w-0 sm:col-span-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="sm:hidden" aria-hidden="true">
            {isTracked ? <span className="text-tracked">🔥</span> : null}
          </span>
          <span
            className={
              'min-w-0 break-words ' +
              (isTracked ? 'font-semibold text-ink' : 'font-medium text-ink')
            }
          >
            {pick.player.fullName}
          </span>
          {isTracked && (
            <span className="sr-only">Tracked pick</span>
          )}
        </div>
        <div className="mt-0.5 text-xs leading-tight text-ink-muted">
          <span>
            {pick.player.team} <span className="text-ink-muted/70">vs</span> {pick.opponent.abbrev}
          </span>
          <span className="mx-1.5 text-ink-muted/50" aria-hidden="true">·</span>
          <span>slot {pick.lineupSlot}</span>
          <LineupBadge status={pick.lineupStatus} />
        </div>
        <div className="mt-0.5 break-words text-xs leading-tight text-ink-muted">
          <span className="text-ink-muted/80">P:</span> {pick.opposingPitcher.name}
          <PitcherBadge status={pick.opposingPitcher.status} />
        </div>
      </div>

      {/* Stats grid — mobile shows compact 4-column row of metrics; desktop slots into the table.
          `min-w-0` lets the cells shrink instead of forcing the row to overflow. */}
      <div className="col-span-12 grid min-w-0 grid-cols-4 gap-2 text-right font-mono text-sm sm:col-span-7 sm:grid-cols-7 sm:items-center sm:gap-3">
        {/* Prob */}
        <div className="min-w-0 sm:col-span-2">
          <div className={'tabular-nums ' + (isTracked ? 'font-semibold text-ink' : 'text-ink')}>
            {pct(pick.pMatchup, 1)}
          </div>
          <div className="text-[11px] tabular-nums text-ink-muted">vs {pct(pick.pTypical, 1)}</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted/80 sm:hidden">
            prob
          </div>
        </div>

        {/* Edge */}
        <div className="min-w-0 sm:col-span-2">
          <div className={'tabular-nums ' + (pick.edge >= 0 ? 'text-accent' : 'text-ink-muted')}>
            {signedPct(pick.edge)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted/80">edge</div>
        </div>

        {/* Confidence — native tooltip explains the multiplier breakdown */}
        <div
          className="min-w-0 cursor-help sm:col-span-1"
          title={confidenceSummary(pick)}
        >
          <div className={'tabular-nums ' + (isTracked ? 'font-semibold text-hit' : 'text-ink')}>
            {pct(pick.confidence, 0)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted/80">conf</div>
        </div>

        {/* Score — keep readable on a 320 px viewport: scale up at sm, but stay
            tight on the smallest screens where 4 metric cells share ~280 px. */}
        <div className="min-w-0 sm:col-span-2">
          <div
            className={
              'tabular-nums ' +
              (isTracked
                ? 'text-base font-semibold text-tracked sm:text-xl'
                : 'text-base font-semibold text-ink sm:text-lg')
            }
          >
            {(pick.score * 100).toFixed(1)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted/80">score</div>
        </div>
      </div>
    </article>
  )
}
