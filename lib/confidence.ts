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
// Confidence model — strict alignment with what the probability factors use
// =============================================================================
//
// Design principle: every confidence factor mirrors a specific input to the
// probability calculation. When the corresponding probToday factor is
// neutralized (returns 1.00 — the data isn't actually being used), the
// confidence factor pins to 1.00 too. No haircuts for absent data.
//
// Factors:
//   lineup         — slot/order data feeding paCount + bullpen factors
//   bvp            — career BvP signal (probToday gate: ≥5 AB)
//   pitcher        — current-season K%/BB%/HR%/hardHit% (gate: id≠0 AND ≥3 starts)
//   weather        — Open-Meteo forecast (gate: outdoor + fetch succeeded)
//   bullpen        — opponent team bullpen ERA (gate: non-null)
//   batterSample   — batter rates feeding pTypical, with career-prior awareness
//   time           — lineup churn risk (gates on lineup status)
//   opener         — pitcher data relevance (binary)
//   dataFreshness  — system-health proxy (schedule cache age)
//
// 9 factors total (was 8; added bullpen). The design tradeoff: adds one
// factor, removes the prior-season pitcher backfill (the pitcher *factor*
// only uses current-season data, so prior-season backfilling confidence
// was confidence claiming stability the factor itself didn't have).

export interface ConfidenceInputs {
  lineupStatus: Lineup['status']  // 'confirmed' | 'partial' | 'estimated'

  // BvP signal feeding the BvP probToday factor (career AB; gate at ≥5).
  bvpAB: number

  // Pitcher inputs feeding the pitcher probToday factor.
  // Factor neutralizes when pitcherActive=false → confidence pins to 1.00.
  pitcherActive: boolean   // false when pitcher id=0 (TBD) OR recentStarts < 3
  pitcherBf: number        // batters faced this season (drives rate stabilization)

  // Weather impact magnitude: |hrMult - 1|. 0 means the weather model isn't
  // exposed (dome / fetch failed / neutral conditions). Confidence pins to
  // 1.00 at impact ≤ 0.05.
  weatherImpact: number

  // Bullpen sample feeding the bullpen probToday factor.
  // Factor neutralizes when null → confidence pins to 1.00.
  bullpenIp: number | null  // null = no bullpen data; factor inactive
                            // ≥0 = current-season aggregate IP

  // Time to first pitch (minutes). Only matters when lineup is unconfirmed —
  // farther out = more lineup churn risk. Confirmed lineups pin to 1.00.
  timeToFirstPitchMin: number

  // Opener heuristic. Pitcher data is "less relevant" when it won't apply
  // to most of the game (opener strategy: starter throws ~1 IP, bullpen
  // takes over). Distinct from pitcher rate stability — this is a relevance
  // haircut, not a sample-size one.
  isOpener: boolean

  // Batter sample inputs feeding pTypical via stabilizeRates.
  // pTypical uses career rates as the stabilization prior when career PA ≥ 200,
  // so a veteran with low fresh PA but a long career has stable rates. Confidence
  // reflects which prior path was taken.
  batterSeasonPa: number   // batter's PAs this season
  batterCareerPa: number   // batter's career PAs (≥200 → strong prior)

  // System-health: schedule cache age. Drives the dataFreshness factor.
  maxCacheAgeSec: number
}

/** Per-factor breakdown of the confidence multiplier. Product of all nine = `confidence`. */
export interface ConfidenceFactors {
  lineup: number         // 1.00 / 0.85 / 0.70 by lineup status
  bvp: number            // 1.00 below 5 AB (factor neutral); 0.90→1.00 ramp 5-20 AB
  pitcher: number        // 1.00 when pitcher factor inactive; otherwise BF-based ramp
  weather: number        // 1.00 at neutral; 0.90 at ±20% hrMult impact (continuous)
  bullpen: number        // 1.00 when factor inactive; otherwise IP-based ramp
  batterSample: number   // career-prior-aware: vets ramp from 0.92, rookies from 0.85
  time: number           // 1.00 if confirmed; otherwise 1.00→0.95 ramp on time-to-pitch
  opener: number         // 1.00 normal / 0.90 opener (relevance haircut)
  dataFreshness: number  // 1.00 if ≤5 min → 0.90 at ≥30 min, linear
}

/**
 * Compute the per-factor breakdown of the confidence multiplier. Each factor
 * is documented inline with its alignment rationale: when it pins to 1.00,
 * what input it ramps on, and what stabilization point the ramp is calibrated
 * around.
 */
export function computeConfidenceBreakdown(args: ConfidenceInputs): {
  factors: ConfidenceFactors
  product: number
} {
  // ── 1. Lineup ────────────────────────────────────────────────────────────
  // Tiered haircut on slot/order data quality. Used by paCount + bullpen
  // factors via slot. confirmed = full data, partial = some lineup data,
  // estimated = inferred from 14-day batting-order history.
  const lineup =
    args.lineupStatus === 'confirmed' ? 1.00 :
    args.lineupStatus === 'partial' ? 0.85 : 0.70

  // ── 2. BvP ───────────────────────────────────────────────────────────────
  // Aligned with probToday BvP factor activation (lib/factors/bvp.ts:46).
  // Below 5 career AB, the probToday factor returns 1.00 — no BvP signal
  // contributes to pMatchup. Confidence haircut would be penalising for
  // data we'd already chosen not to use, so pin to 1.00.
  // At ≥5 AB the factor activates with a small sample; confidence ramps
  // from 0.90 (just-activated) to 1.00 (20+ AB, well-sampled).
  const bvp = args.bvpAB < 5
    ? 1.00
    : Math.min(1.0, 0.90 + ((args.bvpAB - 5) / 15) * 0.10)

  // ── 3. Pitcher ───────────────────────────────────────────────────────────
  // Aligned with pitcher factor activation (lib/factors/pitcher.ts:31-32):
  // factor returns 1.00 when id=0 (TBD) OR recentStarts < 3. In those cases
  // no pitcher rate signal feeds pMatchup → confidence pins to 1.00.
  //
  // When active, ramp on batters-faced. Carleton stabilization sample sizes
  // for the rates the factor uses:
  //   K%       70 BF
  //   BB%      170 BF
  //   HR%      170 BF
  //   hardHit% 200 BF
  // Use 200 BF as the "fully sampled" threshold (largest of the four — the
  // most-binding constraint). 50 BF (~3 starts) is the activation floor.
  let pitcher: number
  if (!args.pitcherActive) {
    pitcher = 1.00
  } else {
    // Linear ramp 50 BF → 200 BF (~3 starts → ~12 starts on a 4-IP-per-start average).
    const t = Math.max(0, Math.min(1, (args.pitcherBf - 50) / 150))
    pitcher = 0.90 + t * 0.10
  }

  // ── 4. Weather ───────────────────────────────────────────────────────────
  // Continuous ramp on |hrMult - 1|. Pinned to 0 by the ranker for domes /
  // failed forecasts (the weather factor itself returns 1.00 there → no
  // weather signal feeds pMatchup → confidence pins to 1.00 via the ≤0.05
  // floor). Above 0.05 impact, ramp linearly to 0.90 at ±20%.
  const weather =
    args.weatherImpact <= 0.05 ? 1.0 :
    args.weatherImpact >= 0.20 ? 0.90 :
    1.0 - ((args.weatherImpact - 0.05) / 0.15) * 0.10

  // ── 5. Bullpen ───────────────────────────────────────────────────────────
  // NEW factor (was unmonitored). Aligned with bullpen factor activation
  // (lib/factors/bullpen.ts): factor returns 1.00 when bullpen is null.
  //
  // When active, ramp on cumulative IP. The bullpen factor stabilizes at
  // 150 IP (STABILIZATION_BULLPEN_IP), so use that as the "fully sampled"
  // threshold. Smaller range than other factors (5pp) because the bullpen
  // factor's clamp ([0.85, 1.15]) caps its impact.
  let bullpen: number
  if (args.bullpenIp == null) {
    bullpen = 1.00
  } else {
    // Linear ramp 0 IP → 150 IP. Floor at 0.95.
    const t = Math.max(0, Math.min(1, args.bullpenIp / 150))
    bullpen = 0.95 + t * 0.05
  }

  // ── 6. Batter sample (career-prior-aware) ───────────────────────────────
  // pTypical's stabilizeRates uses career rates as the prior when career
  // PA ≥ 200 (lib/p-typical.ts:88). When the prior is strong, the rates
  // feeding pTypical are stable regardless of how few fresh PAs the batter
  // has — current-season rates barely shift the career anchor.
  //
  // So branch:
  //   ≥200 career PA: ramp from 0.92 floor → 1.00 at 100+ current PA
  //                   (career anchor + small current-season top-up)
  //   <200 career PA: ramp from 0.85 floor → 1.00 at 200+ current PA
  //                   (no useful prior; current PA is the only signal)
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

  // ── 7. Time to pitch ────────────────────────────────────────────────────
  // Confirmed lineup → 1.00 (the thing time-to-pitch was proxying for is
  // already locked). For unconfirmed lineups, ramp 1.00 (≤30 min) → 0.95
  // (≥6 hrs out). Lineup churn risk grows with how far we're projecting.
  const time =
    args.lineupStatus === 'confirmed' ? 1.0 :
    args.timeToFirstPitchMin <= 30 ? 1.0 :
    args.timeToFirstPitchMin >= 360 ? 0.95 :
    1.0 - ((args.timeToFirstPitchMin - 30) / 330) * 0.05

  // ── 8. Opener ────────────────────────────────────────────────────────────
  // Relevance haircut, NOT data quality. The pitcher factor's data may be
  // stable, but if the bullpen pitches most of the game the pitcher's stats
  // don't apply to most of the matchup. 0.90 reflects this directly.
  const opener = args.isOpener ? 0.90 : 1.0

  // ── 9. Data freshness ────────────────────────────────────────────────────
  // System-health proxy. Schedule has the shortest TTL of any cache (2 min)
  // and drives lineup/probables/status downstream — its age is the best
  // single proxy for "is the slate-refresh cron actually running?"
  const dataFreshness =
    args.maxCacheAgeSec <= 5 * 60 ? 1.0 :
    args.maxCacheAgeSec >= 30 * 60 ? 0.90 :
    1.0 - ((args.maxCacheAgeSec - 5 * 60) / (25 * 60)) * 0.10

  const factors: ConfidenceFactors = {
    lineup, bvp, pitcher, weather, bullpen, batterSample, time, opener, dataFreshness,
  }
  const product =
    lineup * bvp * pitcher * weather * bullpen * batterSample * time * opener * dataFreshness
  return { factors, product }
}

/**
 * Graded confidence multiplier in [0.55, 1.00] (typical range).
 * Each input contributes a multiplier; the product is the final confidence.
 */
export function computeConfidence(args: ConfidenceInputs): number {
  return computeConfidenceBreakdown(args).product
}
