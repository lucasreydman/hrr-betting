'use client'

import { useEffect, useId, useState } from 'react'
import type { Pick, PickInputs } from '@/lib/ranker'
import { getTeamNickname } from '@/lib/team-names'
import { CONFIDENCE_FLOOR_TRACKED, EDGE_FLOORS, PROB_FLOORS } from '@/lib/constants'

/** Per-cell gate-passing helpers. Each returns true when the value clears the
 *  Tracked-tier floor for its respective metric. Used to colour the desktop
 *  + mobile cells green-when-passing, white-when-not. Confidence floor is
 *  shared across rungs; prob and edge floors vary per rung. */
function passesProbFloor(pMatchup: number, rung?: 1 | 2 | 3): boolean {
  return rung != null && pMatchup >= PROB_FLOORS[rung]
}
function passesEdgeFloor(edge: number, rung?: 1 | 2 | 3): boolean {
  return rung != null && edge >= EDGE_FLOORS[rung]
}
function passesConfidenceFloor(confidence: number): boolean {
  return confidence >= CONFIDENCE_FLOOR_TRACKED
}

/**
 * Score → colour gradient. Low scores (just above the display floor of 0.05)
 * read as light blue; high scores (≥ 0.50) read as the same green we use
 * for HIT outcomes. Linear RGB interpolation between sky-300 (#7DD3FC) and
 * hit green (#10B981) — passes through teal/turquoise mid-range.
 *
 * 0.50 is generous as a "max" — typical Tracked plays land 0.15–0.40 — but
 * the saturation stops scaling there so the very top picks max out the
 * green colour.
 */
function scoreColor(score: number): string {
  const t = Math.min(1, Math.max(0, (score - 0.05) / (0.50 - 0.05)))
  const r = Math.round(125 + t * (16 - 125))
  const g = Math.round(211 + t * (185 - 211))
  const b = Math.round(252 + t * (129 - 252))
  return `rgb(${r}, ${g}, ${b})`
}

function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

function signedPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

/**
 * Convert a probability (0-1) into American moneyline odds — the "fair" line a
 * sportsbook would offer at zero juice. Below 50% returns a positive number
 * (underdog), above 50% returns a negative number (favourite). Beating the
 * displayed line means you're getting positive expected value.
 */
function americanOdds(p: number): string {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return '—'
  if (p >= 0.5) {
    const v = Math.round((p / (1 - p)) * 100) * -1
    return `${v}`
  }
  const v = Math.round(((1 - p) / p) * 100)
  return `+${v}`
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

function useTimeUntilFirstPitch(iso: string | undefined): string | null {
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!iso) return
    const target = new Date(iso).getTime()
    if (Number.isNaN(target)) return
    function tick() {
      const ms = target - Date.now()
      if (ms <= 0) {
        setLabel(null)
        return
      }
      const totalSec = Math.floor(ms / 1000)
      const hours = Math.floor(totalSec / 3600)
      const mins = Math.floor((totalSec % 3600) / 60)
      const secs = totalSec % 60
      const pad = (n: number) => n.toString().padStart(2, '0')
      if (hours > 0) {
        setLabel(`first pitch in ${hours}h ${pad(mins)}m ${pad(secs)}s`)
      } else if (mins > 0) {
        setLabel(`first pitch in ${mins}m ${pad(secs)}s`)
      } else {
        setLabel(`first pitch in ${secs}s`)
      }
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [iso])
  return label
}

function LineupBadge({ status, slot }: { status: Pick['lineupStatus']; slot: number }) {
  // confirmed = green, partial = orange, estimated = yellow.
  // Slot number lives inside the pill so the row reads e.g. "estimated #3".
  const cls =
    status === 'confirmed'
      ? 'border-hit/40 bg-hit/10 text-hit'
      : status === 'partial'
      ? 'border-warn/40 bg-warn/10 text-warn'
      : 'border-yellow-400/40 bg-yellow-400/10 text-yellow-300'
  const label = status === 'estimated' ? 'estimated' : status
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider leading-none ${cls}`}
      title={`Lineup ${label}, batting #${slot}`}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums">#{slot}</span>
    </span>
  )
}

function LiveBadge({ inning }: { inning?: Pick['gameInning'] }) {
  const inningLabel = inning ? `${inning.half === 'top' ? 'TOP' : 'BOT'} ${inning.number}` : null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-miss">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-miss animate-pulse"
        aria-hidden="true"
      />
      LIVE
      {inningLabel && (
        <>
          <span className="text-miss/50" aria-hidden="true">·</span>
          <span className="text-miss/90">{inningLabel}</span>
        </>
      )}
    </span>
  )
}

function FinalBadge({ outcome, actualHRR }: { outcome?: Pick['outcome']; actualHRR?: number }) {
  if (outcome === 'HIT') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-hit">
        FINAL
        <span className="text-hit/60" aria-hidden="true">·</span>
        <span aria-hidden="true">✓</span>
        <span>HIT{actualHRR != null ? ` (${actualHRR})` : ''}</span>
      </span>
    )
  }
  if (outcome === 'MISS') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-miss">
        FINAL
        <span className="text-miss/60" aria-hidden="true">·</span>
        <span aria-hidden="true">✗</span>
        <span>MISS{actualHRR != null ? ` (${actualHRR})` : ''}</span>
      </span>
    )
  }
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
      FINAL{outcome === 'PENDING' ? ' · pending' : ''}
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
      title="Starting pitcher confirmed"
      aria-label="Starting pitcher confirmed"
    >
      CONFIRMED SP
    </span>
  )
}

/** Section header inside the expanded panel. */
function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">{title}</h3>
      {children}
    </section>
  )
}

/** Two-column "label · value" row; values right-aligned and monospace. */
function KV({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/20 py-0.5 last:border-b-0">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-right font-mono text-xs tabular-nums text-ink">{children}</span>
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

function MathPanel({ pick, rung, localTime }: { pick: Pick; rung?: 1 | 2 | 3; localTime: ReturnType<typeof useLocalTime> }) {
  const inputs = pick.inputs
  const isTracked = pick.tier === 'tracked'

  // Always-available math (depends only on Pick fields):
  const edgeFloor = 0.01
  const numer = Math.max(pick.pMatchup, edgeFloor)
  const denom = Math.max(pick.pTypical, edgeFloor)
  const numerFloored = pick.pMatchup < edgeFloor
  const denomFloored = pick.pTypical < edgeFloor

  // Detect "no real data" Statcast — the parser falls back to 0s on
  // missing CSV columns, so a record full of zeros is indistinguishable
  // from a missing record. Treat both the same.
  const statcast = inputs?.batterStatcast
  const hasRealStatcast =
    !!statcast && (statcast.barrelPct > 0 || statcast.hardHitPct > 0 || statcast.xwOBA > 0)

  return (
    <div className="px-3 py-4 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:px-4">
      {/* ── Left column ────────────────────────────────────────────────── */}
      <div className="space-y-4">
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
            <KV label="Pitcher hand">
              <span className="text-ink">{pick.opposingPitcher.throws ?? '—'}</span>
              <span className="ml-1 text-[10px] uppercase tracking-wider text-ink-muted">vs {pick.player.bats}</span>
            </KV>
            <KV label={<>Pitcher form <span className="text-ink-muted/70">(avg IP)</span></>}>
              <span className="text-ink">{inputs.pitcherAvgIp.toFixed(1)} IP</span>
              {inputs.isOpener && (
                <span className="ml-2 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-warn">
                  opener
                </span>
              )}
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
              <KV label="Temperature">{inputs.weather.tempF}°F</KV>
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
                  <span className="min-w-0 truncate">{b.fullName}</span>
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
          <KV label="At-bats">{inputs.bvp?.ab ?? 0}</KV>
          <KV label="Hits / HR">
            {inputs.bvp?.hits ?? 0} / {inputs.bvp?.HR ?? 0}
          </KV>
          <KV label="BB / K">
            {inputs.bvp?.BB ?? 0} / {inputs.bvp?.K ?? 0}
          </KV>
          <KV label="Batting avg">
            {(inputs.bvp && inputs.bvp.ab > 0
              ? inputs.bvp.hits / inputs.bvp.ab
              : 0
            ).toFixed(3)}
          </KV>
        </PanelSection>
      )}

      {inputs && (
        <PanelSection title="Batter Statcast (season)">
          <KV label="Barrel %">
            {(((hasRealStatcast && statcast?.barrelPct) || 0) * 100).toFixed(1)}%
          </KV>
          <KV label="Hard-hit %">
            {(((hasRealStatcast && statcast?.hardHitPct) || 0) * 100).toFixed(1)}%
          </KV>
          <KV label="xwOBA">
            {((hasRealStatcast && statcast?.xwOBA) || 0).toFixed(3)}
          </KV>
        </PanelSection>
      )}

      {inputs && (
        <PanelSection title="Starting pitcher (season)">
          <KV label="K % / BB %">
            {((inputs.pitcherSeason?.kPct ?? 0) * 100).toFixed(1)}%
            {' / '}
            {((inputs.pitcherSeason?.bbPct ?? 0) * 100).toFixed(1)}%
          </KV>
          <KV label="HR / 9">
            {(inputs.pitcherSeason?.hrPer9 ?? 0).toFixed(2)}
          </KV>
          <KV label="IP">
            {(inputs.pitcherSeason?.ip ?? 0).toFixed(1)}
          </KV>
          <KV label="Hard-hit allowed">
            {((inputs.pitcherStatcast?.hardHitPctAllowed ?? 0) * 100).toFixed(1)}%
          </KV>
        </PanelSection>
      )}
      </div>

      {/* ── Right column: math producing the score ────────────────────── */}
      <div className="mt-4 space-y-4 sm:mt-0">
      {inputs && (
        <PanelSection title="p̂ today factor breakdown">
          <p className="font-mono text-[11px] leading-relaxed text-ink-muted">
            p̂<sub>today</sub> = odds(p̂<sub>typical</sub>) × Π factors → probability. TTO is baked into p̂<sub>typical</sub>.
          </p>
          <KV label="Pitcher quality">
            <FactorCell factor={inputs.probTodayFactors.pitcher} />
          </KV>
          <KV label="Park composite">
            <FactorCell factor={inputs.probTodayFactors.park} />
          </KV>
          <KV label="Weather (HRR-weighted)">
            <FactorCell factor={inputs.probTodayFactors.weather} />
          </KV>
          <KV label="Handedness">
            <FactorCell factor={inputs.probTodayFactors.handedness} />
          </KV>
          <KV label="Opp. bullpen">
            <FactorCell factor={inputs.probTodayFactors.bullpen} />
          </KV>
          <KV label={<>PA count <span className="text-ink-muted/70">(slot {pick.lineupSlot})</span></>}>
            <FactorCell factor={inputs.probTodayFactors.paCount} />
          </KV>
          <KV label={<>BvP <span className="text-ink-muted/70">({inputs.bvp?.ab ?? 0} AB)</span></>}>
            <FactorCell factor={inputs.probTodayFactors.bvp} />
          </KV>
          <KV label="Batter quality">
            <FactorCell factor={inputs.probTodayFactors.batter} />
          </KV>
          <KV label="= p̂ today">
            <span className="font-semibold text-ink">{pct(pick.pMatchup, 2)}</span>
            <span className="ml-2 text-[11px] text-ink-muted">
              from {pct(pick.pTypical, 2)} typical
            </span>
          </KV>
        </PanelSection>
      )}

      <PanelSection title="Edge">
        <p className="font-mono text-[11px] text-ink-muted">
          edge = max(p̂_today, 1%) ÷ max(p̂_typical, 1%) − 1
        </p>
        <KV label={<>p̂ today <span className="text-ink-muted/70">— this game</span></>}>
          {pct(pick.pMatchup, 2)}
          {numerFloored && <span className="ml-1 text-warn">→ floor {pct(edgeFloor, 0)}</span>}
        </KV>
        <KV label={<>p̂ typical <span className="text-ink-muted/70">— player baseline</span></>}>
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
            confidence = product of 8 factors
          </p>
          <KV label={<>Lineup <span className="text-ink-muted/70">({pick.lineupStatus})</span></>}>
            <MultCell value={inputs.confidenceFactors.lineup} />
          </KV>
          <KV label={<>BvP sample <span className="text-ink-muted/70">({inputs.bvp?.ab ?? 0} AB)</span></>}>
            <MultCell value={inputs.confidenceFactors.bvp} />
          </KV>
          <KV label={<>Pitcher sample <span className="text-ink-muted/70">({inputs.pitcherStartCount} starts)</span></>}>
            <MultCell value={inputs.confidenceFactors.pitcherStart} />
          </KV>
          <KV
            label={
              <>
                Weather{' '}
                <span className="text-ink-muted/70">
                  ({inputs.weatherStable
                    ? `stable, ${inputs.weatherStabilityKind}`
                    : 'volatile'})
                </span>
              </>
            }
          >
            <MultCell value={inputs.confidenceFactors.weather} />
          </KV>
          <KV label={<>Time to pitch <span className="text-ink-muted/70">({inputs.timeToFirstPitchMin} min)</span></>}>
            <MultCell value={inputs.confidenceFactors.time} />
          </KV>
          <KV label={<>Opener <span className="text-ink-muted/70">({inputs.isOpener ? 'yes' : 'no'})</span></>}>
            <MultCell value={inputs.confidenceFactors.opener} />
          </KV>
          <KV label={<>Batter sample <span className="text-ink-muted/70">({inputs.batterSeasonPa} PA)</span></>}>
            <MultCell value={inputs.confidenceFactors.sampleSize} />
          </KV>
          <KV label={<>Data freshness <span className="text-ink-muted/70">({inputs.scheduleAgeSec}s)</span></>}>
            <MultCell value={inputs.confidenceFactors.dataFreshness} />
          </KV>
          <KV label="= Confidence">
            <span className="font-semibold text-ink">{pct(pick.confidence, 1)}</span>
          </KV>
        </PanelSection>
      )}

      <PanelSection title="Score">
        <p className="font-mono text-[11px] leading-relaxed text-ink-muted">
          score = (p̂<sub>today</sub> − p̂<sub>typical</sub>) ÷ (1 − p̂<sub>typical</sub>) × confidence
          <span className="ml-1 text-ink-muted/70">(Kelly × conf, ×100 for display)</span>
        </p>
        <KV label="Kelly fraction">
          <span className="text-ink">
            {(((pick.pMatchup - pick.pTypical) / Math.max(1 - pick.pTypical, 0.01)) * 100).toFixed(1)}%
          </span>
          <span className="ml-2 text-[11px] text-ink-muted">
            ({pct(pick.pMatchup, 1)} − {pct(pick.pTypical, 1)}) ÷ {pct(1 - pick.pTypical, 1)}
          </span>
        </KV>
        <KV label="× Confidence">
          <span className="text-ink">{pct(pick.confidence, 1)}</span>
        </KV>
        <KV label="= Score">
          <span className={isTracked ? 'font-semibold text-tracked' : 'font-semibold text-ink'}>
            {(pick.score * 100).toFixed(1)}
          </span>
          <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-muted">
            ({isTracked ? '🎯 Tracked' : 'Other play'})
          </span>
        </KV>
        {rung != null && (
          <>
            <KV label={<>Floors <span className="text-ink-muted/70">(for {rung}+)</span></>}>
              <span className="font-mono text-[11px] text-ink-muted">
                p̂ ≥ {pct(PROB_FLOORS[rung], 0)} · edge ≥ {(EDGE_FLOORS[rung] * 100).toFixed(0)}% · conf ≥ {pct(CONFIDENCE_FLOOR_TRACKED, 0)}
              </span>
            </KV>
            <KV label="Status">
              <span className="font-mono text-[11px]">
                <span className={passesProbFloor(pick.pMatchup, rung) ? 'text-hit' : 'text-warn'}>
                  p̂ {passesProbFloor(pick.pMatchup, rung) ? '✓' : '✗'}
                </span>
                <span className="text-ink-muted"> · </span>
                <span className={passesEdgeFloor(pick.edge, rung) ? 'text-hit' : 'text-warn'}>
                  edge {passesEdgeFloor(pick.edge, rung) ? '✓' : '✗'}
                </span>
                <span className="text-ink-muted"> · </span>
                <span className={passesConfidenceFloor(pick.confidence) ? 'text-hit' : 'text-warn'}>
                  conf {passesConfidenceFloor(pick.confidence) ? '✓' : '✗'}
                </span>
              </span>
            </KV>
          </>
        )}
      </PanelSection>
      </div>
    </div>
  )
}

function RungBadge({ rung }: { rung: 1 | 2 | 3 }) {
  // Progressively deeper blue from 1+ → 3+ to give the rare-rung pills a
  // visual weight cue. All three remain readable on the dark card background.
  const cls =
    rung === 1
      ? 'border-sky-300/40 bg-sky-300/10 text-sky-300'
      : rung === 2
      ? 'border-sky-400/50 bg-sky-400/15 text-sky-400'
      : 'border-blue-500/60 bg-blue-500/20 text-blue-400'
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider leading-none ${cls}`}
      title={`Targeting ${rung}+ HRR rung`}
    >
      {rung}+ HRR
    </span>
  )
}

export function PickRow({ pick, rung }: { pick: Pick; rung?: 1 | 2 | 3 }) {
  const isTracked = pick.tier === 'tracked'
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const localTime = useLocalTime(pick.gameDate)
  const firstPitchCountdown = useTimeUntilFirstPitch(pick.gameDate)

  // Derive "Away at Home" matchup string using team nicknames.
  // Falls back to abbreviation format for locked picks (teamId === 0 sentinel).
  let gameMatchup: string
  if (pick.player.teamId === 0) {
    // Legacy locked pick — no teamId available; use abbreviations.
    gameMatchup = pick.gameDate
      ? `${pick.player.team} @ ${pick.opponent.abbrev}`
      : `${pick.player.team} vs ${pick.opponent.abbrev}`
  } else {
    const homeName = pick.isHome
      ? getTeamNickname(pick.player.teamId)
      : getTeamNickname(pick.opponent.teamId)
    const awayName = pick.isHome
      ? getTeamNickname(pick.opponent.teamId)
      : getTeamNickname(pick.player.teamId)
    gameMatchup = `${awayName} @ ${homeName}`
  }

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
        {/* Desktop: 10-column grid (bet · batter · pitcher · game · p.typ · p.today · edge · conf · score · caret) */}
        <div className="hidden sm:grid sm:grid-cols-[0.7fr_1.55fr_1.35fr_1.15fr_0.85fr_0.85fr_0.8fr_1fr_0.6fr_0.3fr] sm:items-center sm:gap-3">
          {/* BET — rung badge + tracked target */}
          <div className="flex min-w-0 items-center gap-1.5">
            {rung && <RungBadge rung={rung} />}
            {isTracked && <span className="text-tracked" aria-hidden="true">🎯</span>}
          </div>

          {/* BATTER — name + hand + lineup-status-with-slot pill */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className={'min-w-0 break-words font-semibold text-ink'}>
                {pick.player.fullName}
              </span>
              <span className="text-xs text-ink-muted">{pick.player.bats}</span>
            </div>
            <div className="mt-0.5">
              <LineupBadge status={pick.lineupStatus} slot={pick.lineupSlot} />
            </div>
          </div>

          {/* PITCHER — name + throws-hand + status badge */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="break-words text-sm text-ink">
                {pick.opposingPitcher.name}
              </span>
              {pick.opposingPitcher.throws && (
                <span className="text-xs text-ink-muted">{pick.opposingPitcher.throws}</span>
              )}
            </div>
            <div className="mt-0.5">
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
            {pick.gameStatus === 'in_progress' ? (
              <LiveBadge inning={pick.gameInning} />
            ) : pick.gameStatus === 'final' ? (
              <FinalBadge outcome={pick.outcome} actualHRR={pick.actualHRR} />
            ) : firstPitchCountdown ? (
              <span className="block text-[10px] text-ink-muted/70">
                {firstPitchCountdown}
              </span>
            ) : null}
          </div>

          {/* PROB. TYPICAL — % over American odds. Light blue marks it as
              the baseline/context column rather than a gate-passing column. */}
          <div className="text-center">
            <div className="font-mono text-sm tabular-nums text-sky-300">
              {pct(pick.pTypical, 1)}
            </div>
            <div className="font-mono text-[10px] tabular-nums text-ink-muted">
              {americanOdds(pick.pTypical)}
            </div>
          </div>

          {/* PROB. TODAY — % over American odds. Green when ≥ rung's prob floor. */}
          <div className="text-center">
            <div
              className={
                'font-mono text-sm tabular-nums ' +
                (passesProbFloor(pick.pMatchup, rung) ? 'font-semibold text-hit' : 'text-ink')
              }
            >
              {pct(pick.pMatchup, 1)}
            </div>
            <div className="font-mono text-[10px] tabular-nums text-ink-muted">
              {americanOdds(pick.pMatchup)}
            </div>
          </div>

          {/* EDGE — green when ≥ rung's edge floor. */}
          <div className="text-center">
            <span
              className={
                'font-mono text-sm tabular-nums ' +
                (passesEdgeFloor(pick.edge, rung) ? 'font-semibold text-hit' : 'text-ink')
              }
            >
              {signedPct(pick.edge)}
            </span>
          </div>

          {/* CONF — green when ≥ confidence floor (0.85). */}
          <div className="text-center">
            <span
              className={
                'font-mono text-sm tabular-nums ' +
                (passesConfidenceFloor(pick.confidence) ? 'font-semibold text-hit' : 'text-ink')
              }
            >
              {pct(pick.confidence, 1)}
            </span>
          </div>

          {/* SCORE — ×100 with one decimal. Gradient blue → green by score
              intensity (sky-300 at the floor, hit-green at the top). */}
          <div className="text-center">
            <div
              className="font-mono text-base font-semibold tabular-nums"
              style={{ color: scoreColor(pick.score) }}
            >
              {(pick.score * 100).toFixed(1)}
            </div>
          </div>

          {/* CARET — dedicated 8th column so score numbers don't shift */}
          <div className="flex items-center justify-center">
            <span
              aria-hidden="true"
              className={'text-sm text-ink-muted/60 transition-transform ' + (expanded ? 'rotate-180' : '')}
            >
              ▾
            </span>
          </div>
        </div>

        {/* Mobile: stacked card layout */}
        <div className="sm:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words font-semibold text-ink">
              {pick.player.fullName}
            </span>
            {rung && <RungBadge rung={rung} />}
            {isTracked && <span className="text-tracked" aria-hidden="true">🎯</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
            <span>{pick.player.bats}</span>
            <span className="text-ink-muted/50" aria-hidden="true">·</span>
            <LineupBadge status={pick.lineupStatus} slot={pick.lineupSlot} />
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
            {pick.gameStatus === 'in_progress' && (
              <>
                <span className="text-ink-muted/50" aria-hidden="true">·</span>
                <LiveBadge inning={pick.gameInning} />
              </>
            )}
            {pick.gameStatus === 'final' && (
              <>
                <span className="text-ink-muted/50" aria-hidden="true">·</span>
                <FinalBadge outcome={pick.outcome} actualHRR={pick.actualHRR} />
              </>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
            <span>vs {pick.opposingPitcher.name}</span>
            {pick.opposingPitcher.throws && <span>{pick.opposingPitcher.throws}</span>}
            <PitcherBadge status={pick.opposingPitcher.status} />
          </div>

          {/* Mobile metrics */}
          <div className="mt-2 border-t border-border/30 pt-2">
            <div className="flex justify-between text-xs">
              <span className="text-ink-muted">Typical</span>
              <span className="font-mono tabular-nums text-sky-300">
                {pct(pick.pTypical, 1)} <span className="text-[10px] text-ink-muted">/ {americanOdds(pick.pTypical)}</span>
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ink-muted">Today</span>
              <span
                className={
                  'font-mono tabular-nums ' +
                  (passesProbFloor(pick.pMatchup, rung) ? 'font-semibold text-hit' : 'text-ink')
                }
              >
                {pct(pick.pMatchup, 1)} <span className="text-[10px] text-ink-muted">/ {americanOdds(pick.pMatchup)}</span>
              </span>
            </div>
            <div className="mt-1 flex gap-4 text-xs">
              <div className="flex items-baseline gap-1">
                <span className="text-ink-muted">Edge</span>
                <span
                  className={
                    'font-mono tabular-nums ' +
                    (passesEdgeFloor(pick.edge, rung) ? 'font-semibold text-hit' : 'text-ink')
                  }
                >
                  {signedPct(pick.edge)}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-ink-muted">Conf</span>
                <span
                  className={
                    'font-mono tabular-nums ' +
                    (passesConfidenceFloor(pick.confidence) ? 'font-semibold text-hit' : 'text-ink')
                  }
                >
                  {pct(pick.confidence, 1)}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-ink-muted">Score</span>
                <span
                  className="font-mono font-semibold tabular-nums"
                  style={{ color: scoreColor(pick.score) }}
                >
                  {(pick.score * 100).toFixed(1)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded math panel — uses the grid-rows trick to animate smoothly
          from height: 0 → auto. Outer grid transitions grid-template-rows;
          inner div is min-h-0 + overflow-hidden so content doesn't peek. */}
      <div
        id={panelId}
        className={
          'grid transition-[grid-template-rows] duration-300 ease-out ' +
          (expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')
        }
        aria-hidden={!expanded}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-border/40 bg-bg-soft/60">
            <MathPanel pick={pick} rung={rung} localTime={localTime} />
          </div>
        </div>
      </div>
    </article>
  )
}

// Re-export PickInputs via a type-only side-channel so consumers don't
// need to import from lib/ranker directly when they're already using PickRow.
export type { PickInputs }
