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

export interface ConfidenceInputs {
  lineupStatus: Lineup['status']  // 'confirmed' | 'partial' | 'estimated'
  bvpAB: number  // career at-bats vs starter (0 if no BvP)
  pitcherStartCount: number  // current-season starts available for IP CDF
  /**
   * Optional: prior-season regular-season start count for the same pitcher.
   * Folds into the sample-size confidence ramp so an established starter
   * isn't pinned at the 0.90 floor on April 5 just because they've only
   * thrown 1 current-season start. The exact weighting lives in
   * `computeConfidenceBreakdown`:
   *
   *     effectiveStarts = currentStarts × 1.5 + min(5, priorStarts)
   *
   * Current-season starts weigh 1.5× because fresh form is the better
   * signal for confidence; the prior-season cap of 5 means a bygone year
   * can lift a veteran off the rookie floor (~×0.93 with 0 fresh starts)
   * but cannot single-handedly reach the 1.00 ceiling — a veteran still
   * needs ≥4 fresh starts to fully neutralise the haircut. Defaults to 0
   * when omitted (current-season-only behaviour).
   */
  priorSeasonStartsCount?: number
  weatherImpact: number  // |hrMult - 1|. 0 means no exposure (dome, failed
                         // forecast, or neutral conditions). Bigger = more
                         // exposure to forecast error.
  isOpener: boolean  // bullpen-after-opener is harder to predict
  timeToFirstPitchMin: number  // time until first pitch (min); closer = more confident
  batterSeasonPa: number  // batter's PAs this season (0 = no data yet)
  /**
   * Optional: prior-season plate-appearance total for the same batter.
   * Folds into the sample-size confidence ramp so a known-regular veteran
   * isn't pinned at the 0.85 floor in early April just because they've
   * only logged 12 fresh PAs. Capped at 100 inside the math (parallel to
   * the pitcher-start backfill design): historical volume earns a real
   * lift but cannot reach the ceiling alone — current-season anchors.
   * Defaults to 0 when omitted (current-season-only behaviour).
   */
  priorSeasonPa?: number
  maxCacheAgeSec: number  // age of the freshest-out-of-date upstream cache (seconds)
}

/** Per-factor breakdown of the confidence multiplier. Product of all eight = `confidence`. */
export interface ConfidenceFactors {
  lineup: number       // 1.00 / 0.85 / 0.70 by lineup status
  bvp: number          // 1.00 below 5 AB (no signal), then 0.90→1.00 ramp
                       // from 5 to 20 AB. Aligns with probToday BvP threshold.
  pitcherStart: number // 0.90–1.00 ramp from 3 to 10 effective starts
                       // (current × 1.5 + min(5, prior season))
  weather: number      // 1.00 at neutral; ramps to 0.90 at ±20% hrMult impact
  time: number         // 1.00 if lineup is confirmed; otherwise ramps from
                       // 1.00 (≤30 min out) to 0.95 (≥6 hrs out)
  opener: number       // 1.00 normal / 0.90 opener
  sampleSize: number   // 0.85 floor → 1.00 ceiling on effective PA
                       // (current × 1.5 + min(100, prior season))
  dataFreshness: number // 1.00 if ≤5 min stale → 0.90 if ≥30 min, linear
}

/**
 * Compute the per-factor breakdown of the confidence multiplier. Used by the
 * UI to explain *why* a pick has the confidence it does — e.g. "estimated
 * lineup × 0.70, pitcher 4-start sample × 0.91". `computeConfidence` returns
 * just the product; this returns the components.
 */
export function computeConfidenceBreakdown(args: ConfidenceInputs): {
  factors: ConfidenceFactors
  product: number
} {
  const lineup =
    args.lineupStatus === 'confirmed' ? 1.00 :
    args.lineupStatus === 'partial' ? 0.85 : 0.70
  // BvP confidence aligns with the probToday BvP factor's activation
  // threshold (lib/factors/bvp.ts:BVP_MIN_AB = 5). Below 5 AB the probToday
  // factor is pinned at 1.00 — there's no BvP signal feeding the
  // probability — so the confidence factor takes no haircut either.
  // Penalising "no data" used to ding every pick in a brand-new matchup
  // (pitcher facing a team for the first time) by a flat 10pp.
  //
  // The discontinuity at AB=5 is intentional: it reflects the underlying
  // model phase change. ≤4 AB: model ignores BvP → confidence neutral.
  // ≥5 AB: model leans on a small sample → confidence dings, ramps back
  // to 1.00 as sample grows toward 20 AB.
  const bvp = args.bvpAB < 5
    ? 1.00
    : Math.min(1.0, 0.90 + ((args.bvpAB - 5) / 15) * 0.10)
  // Effective sample size for the pitcher confidence ramp.
  //
  //   effectiveStarts = currentStarts × 1.5 + min(5, priorStarts)
  //
  // Two intentional shaping choices:
  //  · **Current weighted 1.5×** — fresh form is the more relevant signal
  //    for *today's* read. Y-o-y correlation for pitcher rates (K%, BB%,
  //    HR%) is roughly 0.5–0.7, so a prior start is worth ~0.67 of a
  //    current start; the 1.5 weight on current is the inverse of that.
  //    A rookie now reaches the 1.00 ceiling at ~7 fresh starts instead
  //    of 10, in line with when BB%/HR% empirically stabilize.
  //  · **Prior capped at 5** — historical volume earns a real cold-start
  //    boost (a veteran with 0 fresh starts reads ~0.93 instead of the
  //    0.90 rookie floor) but cannot reach the ceiling alone. A veteran
  //    needs at least 4 fresh starts to fully neutralise the haircut,
  //    keeping current form anchored as the primary signal.
  //
  // Floor at ≤3 effective, ceiling at ≥10 effective, linear in between.
  const priorStarts = Math.max(0, args.priorSeasonStartsCount ?? 0)
  const effectiveStarts = args.pitcherStartCount * 1.5 + Math.min(5, priorStarts)
  const pitcherStart =
    effectiveStarts >= 10 ? 1.0 :
    effectiveStarts <= 3 ? 0.90 :
    0.90 + ((effectiveStarts - 3) / 7) * 0.10
  // Continuous ramp on |hrMult - 1|. Below 0.05 (essentially neutral) the
  // factor pins at 1.00; above 0.20 (Coors-cold or Wrigley-gale territory)
  // it pins at the 0.90 floor; in between it tracks the magnitude linearly.
  // Replaces the old boolean step at 0.10 — see commit history for rationale.
  const weather =
    args.weatherImpact <= 0.05 ? 1.0 :
    args.weatherImpact >= 0.20 ? 0.90 :
    1.0 - ((args.weatherImpact - 0.05) / 0.15) * 0.10
  // Confirmed lineup pins time to 1.0 — the main thing time-to-pitch was
  // proxying (lineup churn) is already locked. Late scratches still happen
  // but are too rare to warrant a global haircut on every confirmed pick.
  // For estimated/partial lineups, ramp from 1.00 (≤30 min) to 0.95 (≥6 hrs):
  // farther out = more time for the projected lineup to be wrong.
  const time =
    args.lineupStatus === 'confirmed' ? 1.0 :
    args.timeToFirstPitchMin <= 30 ? 1.0 :
    args.timeToFirstPitchMin >= 360 ? 0.95 :
    1.0 - ((args.timeToFirstPitchMin - 30) / 330) * 0.05
  const opener = args.isOpener ? 0.90 : 1.0
  // Sample-size confidence with prior-season PA backfill — same shape as
  // pitcherStart above:
  //
  //   effectivePA = currentPA × 1.5 + min(100, priorPA)
  //
  // Current-season PAs weigh 1.5× because fresh form is the better signal
  // (y-o-y batter rate correlation is ~0.4–0.7, parallel to pitcher).
  // Prior cap of 100 PA (50 % of the 200-PA stabilization point) means a
  // 0-fresh-PA veteran reads ~×0.925 (clear lift from the rookie 0.85
  // floor) but a true rookie still floors. Veterans need ≥67 fresh PAs
  // to fully reach the 1.00 ceiling — ~3 weeks of regular play, fast
  // enough that the cold-start window closes naturally as the season
  // gets going.
  const currentPA = Math.max(0, args.batterSeasonPa)
  const priorPA = Math.max(0, args.priorSeasonPa ?? 0)
  const effectivePA = currentPA * 1.5 + Math.min(100, priorPA)
  const sampleSize = Math.min(1.0, Math.max(0.85, 0.85 + 0.15 * Math.min(1, effectivePA / 200)))
  const dataFreshness =
    args.maxCacheAgeSec <= 5 * 60 ? 1.0 :
    args.maxCacheAgeSec >= 30 * 60 ? 0.90 :
    1.0 - ((args.maxCacheAgeSec - 5 * 60) / (25 * 60)) * 0.10

  const factors: ConfidenceFactors = { lineup, bvp, pitcherStart, weather, time, opener, sampleSize, dataFreshness }
  const product = lineup * bvp * pitcherStart * weather * time * opener * sampleSize * dataFreshness
  return { factors, product }
}

/**
 * Graded confidence multiplier in [0.55, 1.00] (typical range).
 * Each input contributes a multiplier; the product is the final confidence.
 *
 * Implementation delegates to `computeConfidenceBreakdown` so there's a
 * single source of truth for the per-factor math.
 */
export function computeConfidence(args: ConfidenceInputs): number {
  return computeConfidenceBreakdown(args).product
}
