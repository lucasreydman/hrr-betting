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
        className="inline-flex items-center rounded border border-hit/40 bg-hit/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider leading-none text-hit"
        title="Lineup confirmed"
        aria-label="Lineup confirmed"
      >
        ✓ confirmed
      </span>
    )
  }
  if (status === 'partial') {
    return (
      <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warn">
        partial
      </span>
    )
  }
  return (
    <span className="rounded border border-border-strong/70 bg-border/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
      est.
    </span>
  )
}

function PitcherBadge({ status }: { status: Pick['opposingPitcher']['status'] }) {
  if (status === 'tbd') {
    return (
      <span className="rounded border border-border-strong/70 bg-border/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
        TBD
      </span>
    )
  }
  if (status === 'probable') {
    return (
      <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
        PROBABLE
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center rounded border border-hit/40 bg-hit/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider leading-none text-hit"
      title="Pitcher confirmed"
      aria-label="Pitcher confirmed"
    >
      CONFIRMED
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
          score = edge × confidence
          <span className="ml-1 text-ink-muted/70">(displayed ×100 for readability)</span>
        </p>
        <KV label="= Score">
          <span className={isTracked ? 'font-semibold text-tracked' : 'text-ink'}>
            {(pick.score * 100).toFixed(1)}
          </span>
          <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-muted">
            ({isTracked ? '🔥 Tracked' : 'Other play'})
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

  // Derive AWAY @ HOME matchup string. pick.opponent.abbrev is always the
  // opposing team. pick.player.team is the player's team.
  // We don't have an explicit home/away flag, so we use the convention that
  // the player's team is listed second when home, first when away. The existing
  // data shape exposes pick.opponent.abbrev but not home/away; mirror the
  // previous layout which shows "TEAM vs OPP" — we keep that ordering here
  // but format as "PLAYER_TEAM @ OPP" (treating player as away) if no flag
  // available. Preserve original behaviour: show opponent at right.
  const gameMatchup = pick.gameDate
    ? `${pick.player.team} @ ${pick.opponent.abbrev}`
    : `${pick.player.team} vs ${pick.opponent.abbrev}`

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
      {/* ── Desktop row (sm+): 7-column table cells ────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={toggle}
        onKeyDown={onKeyDown}
        className={'w-full cursor-pointer px-3 py-3 text-left transition-colors sm:px-4 ' + rowFill}
      >
        {/* Desktop: 7-column grid */}
        <div className="hidden sm:grid sm:grid-cols-[2fr_1.2fr_1fr_1fr_0.8fr_0.8fr_0.8fr] sm:items-center sm:gap-3">
          {/* PLAYER */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isTracked && <span className="text-tracked" aria-hidden="true">🔥</span>}
              <span className={'min-w-0 break-words font-semibold text-ink'}>
                {pick.player.fullName}
              </span>
              <span className="shrink-0 rounded bg-card-elevated px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink-muted">
                #{pick.lineupSlot}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
              <span>{pick.player.bats}</span>
              <span className="text-ink-muted/50" aria-hidden="true">·</span>
              <LineupBadge status={pick.lineupStatus} />
            </div>
            <div className="mt-0.5 text-xs text-ink-muted">
              vs {pick.opposingPitcher.name}
            </div>
            <div className="mt-0.5 flex items-center gap-1">
              <PitcherBadge status={pick.opposingPitcher.status} />
            </div>
          </div>

          {/* GAME */}
          <div className="min-w-0">
            <div className="font-mono text-xs tabular-nums text-ink">
              {gameMatchup}
            </div>
            {pick.gameDate && (
              <time
                dateTime={pick.gameDate}
                className="block font-mono text-xs tabular-nums text-ink-muted"
              >
                {localTime?.short ?? ' '}
              </time>
            )}
          </div>

          {/* PROB. TYPICAL */}
          <div className="text-right">
            <span className="font-mono text-sm tabular-nums text-ink">
              {pct(pick.pTypical, 1)}
            </span>
          </div>

          {/* PROB. TODAY */}
          <div className="text-right">
            <span className={'font-mono text-sm tabular-nums ' + (isTracked ? 'font-semibold text-ink' : 'text-ink')}>
              {pct(pick.pMatchup, 1)}
            </span>
          </div>

          {/* EDGE */}
          <div className="text-right">
            <span className={'font-mono text-sm tabular-nums ' + (pick.edge >= 0 ? 'text-accent' : 'text-ink-muted')}>
              {signedPct(pick.edge)}
            </span>
          </div>

          {/* CONF */}
          <div className="text-right">
            <span className={'font-mono text-sm tabular-nums ' + (isTracked ? 'font-semibold text-hit' : 'text-ink')}>
              {pct(pick.confidence, 0)}
            </span>
          </div>

          {/* SCORE */}
          <div className="text-right">
            <div
              className={
                'font-mono tabular-nums ' +
                (isTracked
                  ? 'text-base font-semibold text-tracked'
                  : 'text-base font-semibold text-ink')
              }
            >
              {pick.score.toFixed(3)}
            </div>
            <span
              aria-hidden="true"
              className={'block text-right text-[10px] text-ink-muted/60 transition-transform ' + (expanded ? 'rotate-180' : '')}
            >
              ▾
            </span>
          </div>
        </div>

        {/* Mobile: stacked card layout */}
        <div className="sm:hidden">
          <div className="flex items-center gap-2">
            {isTracked && <span className="text-tracked" aria-hidden="true">🔥</span>}
            <span className="min-w-0 break-words font-semibold text-ink">
              {pick.player.fullName}
            </span>
            <span className="shrink-0 rounded bg-card-elevated px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink-muted">
              #{pick.lineupSlot}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
            <span>{pick.player.bats}</span>
            <span className="text-ink-muted/50" aria-hidden="true">·</span>
            <LineupBadge status={pick.lineupStatus} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs text-ink-muted">
            <span className="font-mono">{gameMatchup}</span>
            {pick.gameDate && localTime && (
              <>
                <span className="text-ink-muted/50" aria-hidden="true">·</span>
                <time dateTime={pick.gameDate} className="font-mono tabular-nums">
                  {localTime.short}
                </time>
              </>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
            <span>vs {pick.opposingPitcher.name}</span>
            <PitcherBadge status={pick.opposingPitcher.status} />
          </div>

          {/* Mobile metrics */}
          <div className="mt-2 border-t border-border/30 pt-2">
            <div className="flex justify-between text-xs">
              <span className="text-ink-muted">Typical</span>
              <span className="font-mono tabular-nums text-ink">{pct(pick.pTypical, 1)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ink-muted">Today</span>
              <span className={'font-mono tabular-nums ' + (isTracked ? 'font-semibold text-ink' : 'text-ink')}>{pct(pick.pMatchup, 1)}</span>
            </div>
            <div className="mt-1 flex gap-4 text-xs">
              <div className="flex items-baseline gap-1">
                <span className="text-ink-muted">Edge</span>
                <span className={'font-mono tabular-nums ' + (pick.edge >= 0 ? 'text-accent' : 'text-ink-muted')}>{signedPct(pick.edge)}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-ink-muted">Conf</span>
                <span className={'font-mono tabular-nums ' + (isTracked ? 'font-semibold text-hit' : 'text-ink')}>{pct(pick.confidence, 0)}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-ink-muted">Score</span>
                <span className={'font-mono tabular-nums ' + (isTracked ? 'font-semibold text-tracked' : 'text-ink')}>{pick.score.toFixed(3)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded math panel */}
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
