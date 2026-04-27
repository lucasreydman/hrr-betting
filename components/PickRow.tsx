'use client'

import { useEffect, useId, useState } from 'react'
import type { Pick, PickInputs } from '@/lib/ranker'

function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

function signedPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(0)}%`
}

/**
 * Format an ISO timestamp into the *user's* local time. We can't compute
 * this during render and have it stay stable across hydration: the server
 * runs in UTC, the user's browser doesn't. We render a placeholder on the
 * server / first paint, then swap to the localised string after mount.
 *
 * The new react-hooks/set-state-in-effect rule warns about this pattern as a
 * potential cause of cascading renders; here it's a one-time mount effect
 * with a stable result, so the warning is a false positive — we silence it
 * with a justified disable comment.
 */
function useLocalTime(iso: string | undefined) {
  const [t, setT] = useState<{ short: string; full: string } | null>(null)
  useEffect(() => {
    if (!iso) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync of browser-only Intl output (user TZ), not a cascading re-render
      setT(null)
      return
    }
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return
    setT({
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
    })
  }, [iso])
  return t
}

function LineupBadge({ status }: { status: Pick['lineupStatus'] }) {
  if (status === 'confirmed') {
    return (
      <span
        className="ml-1 inline-flex items-center rounded border border-hit/40 bg-hit/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider leading-none text-hit"
        title="Lineup confirmed"
        aria-label="Lineup confirmed"
      >
        ✓
      </span>
    )
  }
  return (
    <span className="ml-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warn">
      {status === 'estimated' ? 'est' : 'partial'}
    </span>
  )
}

function PitcherBadge({ status }: { status: Pick['opposingPitcher']['status'] }) {
  if (status === 'tbd') {
    return (
      <span className="ml-1 rounded border border-border-strong/70 bg-border/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
        TBD
      </span>
    )
  }
  if (status === 'probable') {
    return (
      <span className="ml-1 rounded border border-hit/40 bg-hit/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-hit">
        prob
      </span>
    )
  }
  return (
    <span
      className="ml-1 inline-flex items-center rounded border border-hit/40 bg-hit/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider leading-none text-hit"
      title="Pitcher confirmed"
      aria-label="Pitcher confirmed"
    >
      ✓
    </span>
  )
}

/** Section header inside the expanded panel. */
function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">{title}</h3>
      {children}
    </section>
  )
}

/** Two-column "label · value" row; values right-aligned and monospace. */
function KV({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/30 py-1 last:border-b-0">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-right font-mono text-sm tabular-nums text-ink">{children}</span>
    </div>
  )
}

/** A multiplicative factor (×1.07 ↑ / ×0.93 ↓ / ×1.00). Coloured by direction. */
function FactorCell({ factor }: { factor: number }) {
  if (factor > 1.005) return <span className="text-tracked">×{factor.toFixed(2)} ↑</span>
  if (factor < 0.995) return <span className="text-accent">×{factor.toFixed(2)} ↓</span>
  return <span className="text-ink-muted">×{factor.toFixed(2)}</span>
}

/** Confidence multiplier — neutral if 1.00, warn-amber otherwise. */
function MultCell({ value, ideal = 1.0 }: { value: number; ideal?: number }) {
  const isIdeal = Math.abs(value - ideal) < 0.001
  return (
    <span className={isIdeal ? 'text-ink' : 'text-warn'}>
      ×{value.toFixed(2)}
    </span>
  )
}

/** 16-point compass label for a "wind FROM" bearing. */
function compassPoint(deg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const normalized = ((deg % 360) + 360) % 360
  const idx = Math.round(normalized / 22.5) % 16
  return points[idx]
}

/** Plain-language summary of the wind component along the home → CF axis. */
function windDirectionLabel(outMph: number): { text: string; tone: 'in' | 'out' | 'cross' } {
  const abs = Math.abs(outMph)
  if (abs < 1) return { text: 'crosswind', tone: 'cross' }
  if (outMph > 0) return { text: `+${outMph.toFixed(1)} mph out`, tone: 'out' }
  return { text: `${outMph.toFixed(1)} mph in`, tone: 'in' }
}

function MathPanel({ pick, localTime }: { pick: Pick; localTime: ReturnType<typeof useLocalTime> }) {
  const inputs = pick.inputs
  const isTracked = pick.tier === 'tracked'

  // Always-available math (depends only on Pick fields):
  const edgeFloor = 0.01
  const numer = Math.max(pick.pMatchup, edgeFloor)
  const denom = Math.max(pick.pTypical, edgeFloor)
  const numerFloored = pick.pMatchup < edgeFloor
  const denomFloored = pick.pTypical < edgeFloor

  return (
    <div className="space-y-6 px-4 py-5 sm:grid sm:grid-cols-2 sm:gap-x-8 sm:gap-y-6 sm:space-y-0 sm:px-5">
      {/* ── Left column: game / context inputs ─────────────────────────── */}
      <PanelSection title="Matchup">
        <KV label="First pitch">
          {localTime ? (
            <time dateTime={pick.gameDate}>{localTime.full}</time>
          ) : pick.gameDate ? (
            // Server / first paint: show the raw ISO so the row never appears
            // empty before the client localiser swaps in.
            <span className="text-ink-muted">{pick.gameDate.replace('T', ' ').replace('Z', ' UTC')}</span>
          ) : (
            <span className="text-ink-muted">—</span>
          )}
        </KV>
        {inputs && (
          <>
            <KV label="Park">
              <span className="text-ink">{inputs.venueName}</span>
            </KV>
            <KV label={<>Park HR <span className="text-ink-muted/70">({pick.player.bats})</span></>}>
              <FactorCell factor={inputs.parkHrFactor} />
            </KV>
          </>
        )}
      </PanelSection>

      {inputs && (
        <PanelSection title="Weather">
          {inputs.weather.controlled ? (
            <p className="text-xs text-ink-muted">Roof closed — neutral 1.00 across all outcomes.</p>
          ) : inputs.weather.failure ? (
            <p className="text-xs text-ink-muted">Forecast unavailable — weather defaulted to neutral.</p>
          ) : (
            <>
              <KV label="Temperature">
                {inputs.weather.tempF}°F
              </KV>
              <KV label="Wind">
                {inputs.weather.windSpeedMph} mph from {compassPoint(inputs.weather.windFromDegrees)}
              </KV>
              <KV label="Out toward CF">
                {(() => {
                  const w = windDirectionLabel(inputs.weather.windOutMph)
                  const cls =
                    w.tone === 'out' ? 'text-tracked' :
                    w.tone === 'in' ? 'text-accent' : 'text-ink-muted'
                  return <span className={cls}>{w.text}</span>
                })()}
              </KV>
              <KV label="Weather HR">
                <FactorCell factor={inputs.weather.hrMult} />
              </KV>
            </>
          )}
        </PanelSection>
      )}

      <PanelSection title={`Lineup · slot ${pick.lineupSlot} · ${pick.lineupStatus}`}>
        {inputs?.lineup && inputs.lineup.length > 0 ? (
          <ol className="space-y-0.5 font-mono text-xs">
            {inputs.lineup.map(b => {
              const here = b.playerId === pick.player.playerId
              return (
                <li
                  key={`${b.slot}-${b.playerId}`}
                  className={
                    'flex items-baseline gap-2 ' +
                    (here ? 'text-ink' : 'text-ink-muted')
                  }
                >
                  <span className="w-4 shrink-0 text-right tabular-nums">{b.slot}.</span>
                  <span className="min-w-0 truncate">
                    {b.fullName}
                  </span>
                  {here && (
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-tracked">this pick</span>
                  )}
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="text-xs text-ink-muted">Lineup not surfaced.</p>
        )}
      </PanelSection>

      {inputs && (
        <PanelSection title="Career vs this pitcher (BvP)">
          {inputs.bvp && inputs.bvp.ab > 0 ? (
            <>
              <KV label="At-bats">{inputs.bvp.ab}</KV>
              <KV label="Hits / HR">
                {inputs.bvp.hits} / {inputs.bvp.HR}
              </KV>
              <KV label="BB / K">
                {inputs.bvp.BB} / {inputs.bvp.K}
              </KV>
              <KV label="Avg">
                {(inputs.bvp.hits / inputs.bvp.ab).toFixed(3)}
              </KV>
            </>
          ) : (
            <p className="text-xs text-ink-muted">
              {pick.opposingPitcher.status === 'tbd'
                ? 'Opposing starter is TBD — no BvP record yet.'
                : 'No prior plate appearances vs this pitcher.'}
            </p>
          )}
        </PanelSection>
      )}

      {/* ── Right column: math producing the score ────────────────────── */}
      <PanelSection title="Edge">
        <p className="font-mono text-[11px] text-ink-muted">
          edge = max(P_matchup, 1%) ÷ max(P_typical, 1%) − 1
        </p>
        <KV label={<>P matchup <span className="text-ink-muted/70">— this game</span></>}>
          {pct(pick.pMatchup, 2)}
          {numerFloored && <span className="ml-1 text-warn">→ floor {pct(edgeFloor, 0)}</span>}
        </KV>
        <KV label={<>P typical <span className="text-ink-muted/70">— player baseline</span></>}>
          {pct(pick.pTypical, 2)}
          {denomFloored && <span className="ml-1 text-warn">→ floor {pct(edgeFloor, 0)}</span>}
        </KV>
        <KV label="= Edge">
          <span className={pick.edge >= 0 ? 'text-accent' : 'text-ink-muted'}>
            {signedPct(pick.edge)}
          </span>
          <span className="ml-2 text-[11px] text-ink-muted">
            ({pct(numer, 1)} ÷ {pct(denom, 1)} − 1)
          </span>
        </KV>
      </PanelSection>

      {inputs && (
        <PanelSection title="Confidence">
          <p className="font-mono text-[11px] text-ink-muted">
            confidence = product of 6 factors
          </p>
          <KV label={<>Lineup <span className="text-ink-muted/70">({pick.lineupStatus})</span></>}>
            <MultCell value={inputs.confidenceFactors.lineup} />
          </KV>
          <KV label={<>BvP <span className="text-ink-muted/70">({inputs.bvp?.ab ?? 0} AB)</span></>}>
            <MultCell value={inputs.confidenceFactors.bvp} />
          </KV>
          <KV label={<>Pitcher sample <span className="text-ink-muted/70">({inputs.pitcherStartCount} starts)</span></>}>
            <MultCell value={inputs.confidenceFactors.pitcherStart} />
          </KV>
          <KV label="Weather stable">
            <MultCell value={inputs.confidenceFactors.weather} />
          </KV>
          <KV label={<>Time to pitch <span className="text-ink-muted/70">({inputs.timeToFirstPitchMin} min)</span></>}>
            <MultCell value={inputs.confidenceFactors.time} />
          </KV>
          <KV label="Opener">
            <MultCell value={inputs.confidenceFactors.opener} />
          </KV>
          <KV label="= Confidence">
            <span className="text-ink">{pct(pick.confidence, 0)}</span>
          </KV>
        </PanelSection>
      )}

      <PanelSection title="Score">
        <p className="font-mono text-[11px] text-ink-muted">
          score = edge × confidence × 100
        </p>
        <KV label="= Score">
          <span className={isTracked ? 'font-semibold text-tracked' : 'text-ink'}>
            {(pick.score * 100).toFixed(1)}
          </span>
          <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-muted">
            ({isTracked ? '🔥 Tracked' : 'Watching'})
          </span>
        </KV>
        <p className="text-[11px] text-ink-muted">
          {signedPct(pick.edge)} × {pct(pick.confidence, 0)} × 100 = {(pick.score * 100).toFixed(1)}
        </p>
      </PanelSection>
    </div>
  )
}

export function PickRow({ pick }: { pick: Pick }) {
  const isTracked = pick.tier === 'tracked'
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const localTime = useLocalTime(pick.gameDate)

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

        {/* Player + meta */}
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
            {isTracked && <span className="sr-only">Tracked pick</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0 text-xs leading-tight text-ink-muted">
            <span>
              {pick.player.team} <span className="text-ink-muted/70">vs</span> {pick.opponent.abbrev}
            </span>
            {pick.gameDate && (
              <>
                <span className="text-ink-muted/50" aria-hidden="true">·</span>
                {/* Empty placeholder before mount so the layout doesn't jump
                    when the localised time appears post-hydration. */}
                <time
                  dateTime={pick.gameDate}
                  className="font-mono tabular-nums text-ink-subtle"
                >
                  {localTime?.short ?? '     '}
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

        {/* Stats grid */}
        <div className="col-span-12 grid min-w-0 grid-cols-4 gap-2 text-right font-mono text-sm sm:col-span-7 sm:grid-cols-7 sm:items-center sm:gap-3">
          <div className="min-w-0 sm:col-span-2">
            <div className={'tabular-nums ' + (isTracked ? 'font-semibold text-ink' : 'text-ink')}>
              {pct(pick.pMatchup, 1)}
            </div>
            <div className="text-[11px] tabular-nums text-ink-muted">vs {pct(pick.pTypical, 1)}</div>
            <div className="text-[10px] uppercase tracking-wider text-ink-muted/80 sm:hidden">
              prob
            </div>
          </div>

          <div className="min-w-0 sm:col-span-2">
            <div className={'tabular-nums ' + (pick.edge >= 0 ? 'text-accent' : 'text-ink-muted')}>
              {signedPct(pick.edge)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-muted/80">edge</div>
          </div>

          <div className="min-w-0 sm:col-span-1">
            <div className={'tabular-nums ' + (isTracked ? 'font-semibold text-hit' : 'text-ink')}>
              {pct(pick.confidence, 0)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-muted/80">conf</div>
          </div>

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
                className={'inline-block transition-transform ' + (expanded ? 'rotate-180' : '')}
              >
                ▾
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded math panel — only the values that actually feed the score
          (no redundancy with the summary row). */}
      {expanded && (
        <div id={panelId} className="border-t border-border/40 bg-bg-soft/60">
          <MathPanel pick={pick} localTime={localTime} />
        </div>
      )}
    </article>
  )
}

// Re-export PickInputs via a type-only side-channel so consumers don't
// need to import from lib/ranker directly when they're already using PickRow.
export type { PickInputs }
