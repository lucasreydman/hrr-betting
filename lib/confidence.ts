import type { Lineup } from './types'

export interface HardGateInputs {
  gameStatus: 'scheduled' | 'in_progress' | 'final' | 'postponed'
  probableStarterId: number | null
  lineupStatus: Lineup['status'] | null
  expectedPA: number
}

/**
 * Hard gates that, if any fail, the pick is dropped entirely (not even shown
 * as Watching). Returns true if ALL gates pass.
 *
 * `final` games used to be dropped here, which produced a confusing UX: when
 * a game ended, every pick from that game vanished from the live board and
 * didn't reappear until the next morning's settle cron populated /history.
 * Now we keep finalised picks in the data and let the UI mark them as FINAL
 * with the actual HIT/MISS outcome (computed from the boxscore by the
 * ranker). Postponed games still drop — there's no game to settle.
 */
export function passesHardGates(args: HardGateInputs): boolean {
  if (args.gameStatus === 'postponed') return false
  if (args.probableStarterId == null) return false
  if (args.lineupStatus == null) return false
  if (args.expectedPA < 3) return false
  return true
}

// =============================================================================
// Confidence model — factors mirror the data probToday actually uses
// =============================================================================
//
// Design principle: every confidence factor maps to a specific input feeding
// pMatchup. When the corresponding probToday factor is neutralized (returns
// 1.00 — the data isn't being used), the confidence factor pins to 1.00 too.
// No haircuts for absent data.
//
// One intentional opt-out: BvP confidence is a pure linear sample-size
// signal and does NOT pin when probToday BvP is inactive (< 5 AB). It
// reads "how much matchup data do we have" rather than "is the factor
// contributing", which surfaces a useful "we know little here" UX hint
// even on first-time matchups.
//
// Factors (9):
//   lineup            — slot/order data quality, with time-to-pitch absorbed
//   bvp               — career BvP sample-size signal (no gate)
//   pitcher           — current-season K%/BB%/HR%/hardHit% (gate: id≠0 AND ≥3 starts)
//   weather           — Open-Meteo forecast (gate: outdoor + non-neutral)
//   bullpen           — opponent team bullpen ERA (gate: non-null)
//   batterSample      — pTypical's batter rates, with career-prior awareness
//   batterStatcast    — Statcast availability for the batter quality factor
//   opener            — pitcher data relevance (binary)
//   dataFreshness     — system-health proxy (schedule cache age)

export interface ConfidenceInputs {
  lineupStatus: Lineup['status']  // 'confirmed' | 'partial' | 'estimated'

  // BvP: pure sample-size signal (intentionally not gate-aligned).
  bvpAB: number

  // Pitcher inputs feeding the pitcher probToday factor.
  // Factor neutralizes when pitcherActive=false → confidence pins to 1.00.
  pitcherActive: boolean
  pitcherBf: number  // batters faced this season

  // Weather impact magnitude: |hrMult - 1|. 0 means no exposure.
  weatherImpact: number

  // Bullpen sample feeding the bullpen probToday factor.
  bullpenIp: number | null  // null = no bullpen data; factor inactive

  // Time to first pitch (minutes). Absorbed into the lineup factor for
  // unconfirmed lineups (further out = more lineup churn risk).
  timeToFirstPitchMin: number

  // Opener heuristic. Pitcher data is "less relevant" when it won't apply
  // to most of the game (opener strategy: starter throws ~1 IP, bullpen
  // takes over).
  isOpener: boolean

  // Batter sample inputs feeding pTypical via stabilizeRates.
  // pTypical uses career rates as the prior when career PA ≥ 200, so a
  // veteran with low fresh PA but a long career has stable rates.
  batterSeasonPa: number
  batterCareerPa: number

  // Whether Statcast contact metrics (barrel%, hardHit%, xwOBA) are present
  // for this batter. Drives the batterStatcast confidence factor.
  batterStatcastPresent: boolean

  // System-health: schedule cache age.
  maxCacheAgeSec: number
}

/** Per-factor breakdown of the confidence multiplier. Product of all nine = `confidence`. */
export interface ConfidenceFactors {
  lineup: number         // tiered base × time-to-pitch absorption
  bvp: number            // pure sample-size signal: 0.90 at 0 AB → 1.00 at ≥20 AB
  pitcher: number        // 1.00 when pitcher factor inactive; otherwise BF-based ramp
  weather: number        // 1.00 at neutral; 0.90 at ±20% hrMult impact (continuous)
  bullpen: number        // 1.00 when factor inactive; otherwise IP-based ramp
  batterSample: number   // career-prior-aware: vets ramp from 0.92, rookies from 0.85
  batterStatcast: number // 1.00 when Statcast present; 0.96 when missing for a vet
  opener: number         // 1.00 normal / 0.90 opener (relevance haircut)
  dataFreshness: number  // 1.00 if ≤5 min → 0.90 at ≥30 min, linear
}

/**
 * Compute the per-factor breakdown of the confidence multiplier. Each factor
 * is documented inline with its alignment rationale: when it pins to 1.00,
 * what input it ramps on, and what stabilization point the ramp targets.
 */
export function computeConfidenceBreakdown(args: ConfidenceInputs): {
  factors: ConfidenceFactors
  product: number
} {
  // ── 1. Lineup (with time-to-pitch absorbed) ─────────────────────────────
  // Tiered base on slot/order data quality. For unconfirmed lineups, the
  // base is multiplied by a time-to-pitch component that captures lineup
  // churn risk (further from first pitch = more time for the projected
  // lineup to be wrong). Confirmed lineups get the full base — late
  // scratches are too rare to warrant a global time haircut.
  //
  // Replaces the previous separate `time` factor. Folding time into lineup
  // makes the math panel single-row and removes the redundant overlap that
  // existed when both factors said "we're not sure about the lineup."
  const lineupBase =
    args.lineupStatus === 'confirmed' ? 1.00 :
    args.lineupStatus === 'partial' ? 0.85 : 0.70
  const lineupTimeMult =
    args.lineupStatus === 'confirmed' ? 1.0 :
    args.timeToFirstPitchMin <= 30 ? 1.0 :
    args.timeToFirstPitchMin >= 360 ? 0.95 :
    1.0 - ((args.timeToFirstPitchMin - 30) / 330) * 0.05
  const lineup = lineupBase * lineupTimeMult

  // ── 2. BvP (intentional alignment opt-out) ───────────────────────────────
  // Pure sample-size signal: linear ramp from 0.90 at 0 AB to 1.00 at 20+
  // AB. Reads independently of whether the probToday BvP factor is active
  // (gate at ≥5 AB on that side). The framing here is "how much historical
  // matchup data do we have?" — surfaces "we have very little context for
  // this batter-pitcher pairing" as a UX signal even when the model isn't
  // moving pMatchup on BvP.
  const bvp = Math.min(1.0, 0.90 + (Math.max(0, args.bvpAB) / 20) * 0.10)

  // ── 3. Pitcher rates ─────────────────────────────────────────────────────
  // Aligned with pitcher factor activation. When inactive → pin to 1.00.
  // When active, ramp on batters-faced. 200 BF = the largest of the rate
  // stabilization sample sizes the factor uses (Carleton: K% 70, BB%/HR%
  // 170, hardHit% 200 BF) — the most-binding constraint.
  let pitcher: number
  if (!args.pitcherActive) {
    pitcher = 1.00
  } else {
    const t = Math.max(0, Math.min(1, (args.pitcherBf - 50) / 150))
    pitcher = 0.90 + t * 0.10
  }

  // ── 4. Weather ───────────────────────────────────────────────────────────
  // Continuous ramp on |hrMult - 1|. ≤0.05 impact (essentially neutral) →
  // 1.00. ≥0.20 impact (Coors-cold or Wrigley-gale territory) → 0.90.
  // Pinned to 0 by the ranker for domes / failed forecasts, so those cases
  // hit the 1.00 floor naturally via the ≤0.05 branch.
  const weather =
    args.weatherImpact <= 0.05 ? 1.0 :
    args.weatherImpact >= 0.20 ? 0.90 :
    1.0 - ((args.weatherImpact - 0.05) / 0.15) * 0.10

  // ── 5. Bullpen ───────────────────────────────────────────────────────────
  // Aligned with bullpen factor activation. Null → pin to 1.00. Active →
  // ramp on cumulative IP, with the Carleton-style stabilization point of
  // 150 IP as the ceiling. 5pp range (smaller than other factors) because
  // the bullpen factor's clamp [0.85, 1.15] caps its impact on pMatchup.
  let bullpen: number
  if (args.bullpenIp == null) {
    bullpen = 1.00
  } else {
    const t = Math.max(0, Math.min(1, args.bullpenIp / 150))
    bullpen = 0.95 + t * 0.05
  }

  // ── 6. Batter sample (career-prior-aware) ───────────────────────────────
  // pTypical's stabilizeRates uses career rates as the prior when career PA
  // ≥ 200 (lib/p-typical.ts:88). When the prior is strong, the rates feeding
  // pTypical are stable regardless of how few fresh PAs the batter has.
  //   ≥ 200 career PA: ramp from 0.92 floor → 1.00 at 100+ current PA
  //   <  200 career PA: ramp from 0.85 floor → 1.00 at 200+ current PA
  const currentPA = Math.max(0, args.batterSeasonPa)
  const careerPA = Math.max(0, args.batterCareerPa)
  let batterSample: number
  if (careerPA >= 200) {
    const t = Math.max(0, Math.min(1, currentPA / 100))
    batterSample = 0.92 + t * 0.08
  } else {
    const t = Math.max(0, Math.min(1, currentPA / 200))
    batterSample = 0.85 + t * 0.15
  }

  // ── 7. Batter Statcast availability ─────────────────────────────────────
  // The batter quality probToday factor (lib/factors/batter.ts) returns
  // 1.00 when Statcast is missing — factor inactive, no signal contributing.
  // Under strict alignment, this would mean confidence 1.00 regardless of
  // missing data. But missing Statcast for a player who should have it
  // (vet with ≥200 career PA) is unusual and worth surfacing as a small
  // confidence haircut. Rookies (career PA < 200) without Statcast is
  // normal and gets no haircut.
  //
  // 4pp range (smallest factor in the model) reflects that the batter
  // quality factor itself is heavily damped (clamped [0.95, 1.05]).
  let batterStatcast: number
  if (args.batterStatcastPresent) {
    batterStatcast = 1.00
  } else if (careerPA >= 200) {
    batterStatcast = 0.96  // vet-no-Statcast = small ding for unusual missing data
  } else {
    batterStatcast = 1.00  // rookie-no-Statcast = normal, no ding
  }

  // ── 8. Opener ────────────────────────────────────────────────────────────
  // Relevance haircut, NOT data quality. Pitcher rate data may be stable,
  // but if the bullpen pitches most of the game the pitcher's stats don't
  // apply to most of the matchup.
  const opener = args.isOpener ? 0.90 : 1.0

  // ── 9. Data freshness ────────────────────────────────────────────────────
  // System-health proxy via schedule-cache age (the canonical 2-min-TTL
  // live-state cache). If the slate-refresh cron stops, schedule age grows
  // and confidence smoothly drops toward 0.90.
  const dataFreshness =
    args.maxCacheAgeSec <= 5 * 60 ? 1.0 :
    args.maxCacheAgeSec >= 30 * 60 ? 0.90 :
    1.0 - ((args.maxCacheAgeSec - 5 * 60) / (25 * 60)) * 0.10

  const factors: ConfidenceFactors = {
    lineup, bvp, pitcher, weather, bullpen, batterSample, batterStatcast, opener, dataFreshness,
  }
  const product =
    lineup * bvp * pitcher * weather * bullpen * batterSample * batterStatcast * opener * dataFreshness
  return { factors, product }
}

/**
 * Graded confidence multiplier in [0.5, 1.00] (typical range).
 * Each input contributes a multiplier; the product is the final confidence.
 */
export function computeConfidence(args: ConfidenceInputs): number {
  return computeConfidenceBreakdown(args).product
}
