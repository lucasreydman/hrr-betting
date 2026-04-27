'use client'

import { useId, useState } from 'react'
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

/**
 * Format an ISO timestamp into the *user's* local time. `Intl.DateTimeFormat`
 * uses the runtime's timezone — so on the server (typically UTC) we'll render
 * UTC text, and the client will re-render with the user's actual TZ on
 * hydration. The mismatch is intentional and silenced via the `suppressHydrationWarning`
 * prop on the rendering <time> element; this keeps the formatting purely
 * derivational (no useEffect / cascading setState) and avoids a flash of
 * empty content while we wait to mount.
 */
function formatLocalTime(iso: string | undefined): { short: string; full: string } | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return {
    short: d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
    full: d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
  }
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

/** A small row in the expanded detail panel — left label, right value. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/40 py-1.5 last:border-b-0">
      <dt className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="text-right font-mono text-sm text-ink">{children}</dd>
    </div>
  )
}

export function PickRow({ pick }: { pick: Pick }) {
  const isTracked = pick.tier === 'tracked'
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const localTime = formatLocalTime(pick.gameDate)

  // Tracked-pick visual accent: amber left-border lives on the outer <article>
  // so it extends through both the summary row and the expanded panel (visual
  // continuity). The inner row keeps the fill + ring + hover lift only.
  const rowFill = isTracked
    ? 'bg-tracked/10 ring-1 ring-inset ring-tracked/20 hover:bg-tracked/15'
    : 'hover:bg-card/40'

  const toggle = () => setExpanded(v => !v)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  return (
    <article className={'border-b border-border/50 ' + (isTracked ? 'border-l-4 border-l-tracked' : '')}>
      {/* The clickable summary row. We use role=button rather than a <button>
          element so the existing 12-col grid layout (and its nested children)
          stays valid HTML — buttons can't legally contain interactive descendants
          like the `cursor-help` confidence cell with its title-tooltip. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={toggle}
        onKeyDown={onKeyDown}
        className={
          'grid w-full cursor-pointer grid-cols-12 items-center gap-2 px-3 py-3 text-left transition-colors sm:gap-3 sm:px-4 ' +
          rowFill
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
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0 text-xs leading-tight text-ink-muted">
            <span>
              {pick.player.team} <span className="text-ink-muted/70">vs</span> {pick.opponent.abbrev}
            </span>
            {localTime && pick.gameDate && (
              <>
                <span className="text-ink-muted/50" aria-hidden="true">·</span>
                {/* suppressHydrationWarning — server renders the host's TZ,
                    client renders the user's TZ; React tolerates the swap. */}
                <time
                  dateTime={pick.gameDate}
                  suppressHydrationWarning
                  className="font-mono tabular-nums text-ink-subtle"
                >
                  {localTime.short}
                </time>
              </>
            )}
            <span className="text-ink-muted/50" aria-hidden="true">·</span>
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

          {/* Confidence — native tooltip explains the multiplier breakdown.
              `onClick` stops propagation so clicking the cell doesn't toggle
              the row when the user actually wanted to read the tooltip. */}
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
            <div className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wider text-ink-muted/80">
              <span>score</span>
              <span
                aria-hidden="true"
                className={
                  'inline-block transition-transform ' +
                  (expanded ? 'rotate-180' : '')
                }
              >
                ▾
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded detail panel — every field on the Pick object presented in a
          tidy two-column list. Renders inside the row's outer <article> so it
          inherits the tracked left-border accent. */}
      {expanded && (
        <div
          id={panelId}
          className="border-t border-border/40 bg-bg-soft/60 px-4 py-4 sm:px-5"
        >
          <dl className="grid grid-cols-1 gap-x-8 gap-y-0 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-[11px] uppercase tracking-wider text-ink-muted">
                Game
              </h3>
              <DetailRow label="First pitch">
                {localTime && pick.gameDate ? (
                  <time dateTime={pick.gameDate} suppressHydrationWarning>
                    {localTime.full}
                  </time>
                ) : (
                  <span className="text-ink-muted">{pick.gameDate ?? '—'}</span>
                )}
              </DetailRow>
              <DetailRow label="Matchup">
                {pick.player.team} <span className="text-ink-muted">vs</span> {pick.opponent.abbrev}
              </DetailRow>
              <DetailRow label="MLB game ID">{pick.gameId}</DetailRow>
            </div>

            <div>
              <h3 className="mb-1 mt-4 text-[11px] uppercase tracking-wider text-ink-muted sm:mt-0">
                Player
              </h3>
              <DetailRow label="Name">{pick.player.fullName}</DetailRow>
              <DetailRow label="Bats">
                {pick.player.bats === 'S' ? 'Switch' : pick.player.bats === 'L' ? 'Left' : 'Right'}
              </DetailRow>
              <DetailRow label="Lineup slot">
                {pick.lineupSlot}
                <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-muted">
                  ({pick.lineupStatus})
                </span>
              </DetailRow>
            </div>

            <div>
              <h3 className="mb-1 mt-4 text-[11px] uppercase tracking-wider text-ink-muted">
                Opposing pitcher
              </h3>
              <DetailRow label="Name">
                {pick.opposingPitcher.name}
              </DetailRow>
              <DetailRow label="Status">
                <span
                  className={
                    pick.opposingPitcher.status === 'tbd'
                      ? 'text-warn'
                      : pick.opposingPitcher.status === 'confirmed'
                        ? 'text-hit'
                        : 'text-ink-muted'
                  }
                >
                  {pick.opposingPitcher.status}
                </span>
              </DetailRow>
            </div>

            <div>
              <h3 className="mb-1 mt-4 text-[11px] uppercase tracking-wider text-ink-muted">
                Model output
              </h3>
              <DetailRow label="P (matchup)">{pct(pick.pMatchup, 1)}</DetailRow>
              <DetailRow label="P (typical)">{pct(pick.pTypical, 1)}</DetailRow>
              <DetailRow label="Edge">
                <span className={pick.edge >= 0 ? 'text-accent' : 'text-ink-muted'}>
                  {signedPct(pick.edge)}
                </span>
              </DetailRow>
              <DetailRow label="Confidence">
                {pct(pick.confidence, 0)}
              </DetailRow>
              <DetailRow label="Score">
                <span className={isTracked ? 'font-semibold text-tracked' : 'text-ink'}>
                  {(pick.score * 100).toFixed(1)}
                </span>
              </DetailRow>
              <DetailRow label="Tier">
                <span className={isTracked ? 'text-tracked' : 'text-ink-muted'}>
                  {isTracked ? '🔥 Tracked' : 'Watching'}
                </span>
              </DetailRow>
            </div>
          </dl>
        </div>
      )}
    </article>
  )
}
