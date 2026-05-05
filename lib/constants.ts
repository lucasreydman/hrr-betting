// Math constants for the HRR betting model.
// Most values here are placeholders that will be calibrated from settled-pick history
// after ~30 days of forward-tracked data. See docs/superpowers/specs section 11.

import type { Outcome, Rung } from './types'

// Russell Carleton's empirical stabilization sample sizes (in PAs).
// Used by lib/stabilization.ts to compute the regression weight against the prior.
// Smaller numbers stabilize faster (less noise), so they need less shrinkage early.
export const STABILIZATION_PA: Record<string, number> = {
  k: 60,
  bb: 120,
  hr: 170,
  '1b': 600,
  '2b': 700,
  '3b': 800,
  babip: 800,
  obp: 460,
  slg: 320,
}

// Approximate league-average outcome rates per PA (recalibrate from real data later).
// Used as the prior in stabilizeRates and as the offline-sim's league-avg lineup.
export const LEAGUE_AVG_RATES: Record<Outcome, number> = {
  '1B': 0.143,
  '2B': 0.045,
  '3B': 0.005,
  HR: 0.030,
  BB: 0.085,
  K: 0.225,
  OUT: 0.467,
}

// TTO (times-through-the-order) per-outcome multipliers applied to BATTER rates
// while facing the starter. Indexed by PA-against-starter (1..4). Values > 1 =
// batter benefit; < 1 = pitcher benefit. League-avg fallback values grounded
// in published TTO research (Mitchel Lichtman et al.); will be recalibrated
// against settled history once enough data exists.
//
// Read by lib/factors/tto.ts to compose a single HRR-weighted multiplier.
export const TTO_MULTIPLIERS: Record<'1' | '2' | '3' | '4', Record<Outcome, number>> = {
  '1': { '1B': 1.00, '2B': 1.00, '3B': 1.00, HR: 1.00, BB: 1.00, K: 1.00, OUT: 1.00 },
  '2': { '1B': 1.04, '2B': 1.05, '3B': 1.05, HR: 1.08, BB: 1.03, K: 0.98, OUT: 1.00 },
  '3': { '1B': 1.10, '2B': 1.15, '3B': 1.15, HR: 1.25, BB: 1.08, K: 0.94, OUT: 1.00 },
  '4': { '1B': 1.13, '2B': 1.20, '3B': 1.20, HR: 1.35, BB: 1.10, K: 0.92, OUT: 1.00 },
}

// Period-aware blend weights for stabilized season vs L30 vs L15 rates.
// Early season favors stabilized (sample is still small); late season favors recent.
export function blendWeights(month: number): { season: number; l30: number; l15: number } {
  if (month <= 4) return { season: 0.70, l30: 0.20, l15: 0.10 }
  if (month <= 6) return { season: 0.60, l30: 0.25, l15: 0.15 }
  return { season: 0.50, l30: 0.30, l15: 0.20 }
}

// Tracked tier floors per rung (placeholders — recalibrate after ~30 days
// of post-pitcher-fix settled history accumulates; the 2026-04-26 → 2026-05-03
// pre-fix sample was contaminated by the broken bullpen + pitcher factors).
//
// Four gates — a pick is Tracked iff ALL of these clear:
//   confidence ≥ CONFIDENCE_FLOOR_TRACKED
//   edge       ≥ EDGE_FLOORS[rung]
//   p_matchup  ≥ PROB_FLOORS[rung]
//   score      ≥ SCORE_FLOORS_TRACKED[rung]
//
// Symmetric design on the first three: as the rung gets harder, we accept
// lower absolute probability but demand higher relative edge.
//   · 1+ (easy):     prob 0.80 / edge 0.10 — "high confidence, doesn't need a steal"
//   · 2+ (moderate): prob 0.60 / edge 0.20 — "decent chance + decent value"
//   · 3+ (hard):     prob 0.40 / edge 0.30 — "longshot, but only at real value"
//
// History: the original 0.85/0.55/0.20 prob and 0.10/0.30/0.60 edge values
// were calibrated against a buggy model that pegged the pitcher factor at
// its 2.0 cap on ~72% of picks (see lib/mlb-api.ts hrPct fix). After the
// fix, the model output deflated proportionally and no slate had any
// tracked picks under the old floors. These values restore meaningful
// daily volume while keeping the "high-conviction" semantic.
export const EDGE_FLOORS: Record<Rung, number> = { 1: 0.10, 2: 0.20, 3: 0.30 }
export const PROB_FLOORS: Record<Rung, number> = { 1: 0.80, 2: 0.60, 3: 0.40 }

// Per-rung score floors — the conviction-thinning gate added 2026-05-05.
//
// The first three floors are individually-rung-conviction gates, but they
// don't speak to whether a pick is a *good Kelly bet*. On a hot slate (e.g.
// Coors with a weak starter) a single player can clear all three floors
// at every rung simultaneously, which produces 30+ tracked picks of which
// only the top 5–10 represent meaningful conviction. The score floor cuts
// the borderline tail uniformly using Kelly-weighted score.
//
// Per-rung tuning is necessary because Kelly's variance penalty compresses
// scores hardest at the longshot end:
//   · 1+ scores: ~0.30–0.40 typical → floor 0.25
//   · 2+ scores: ~0.20–0.34 typical → floor 0.20
//   · 3+ scores: ~0.13–0.28 typical → floor 0.15
//
// A flat floor would produce roughly equal counts per rung but never let
// a 3+ longshot through unless it's truly elite. Per-rung floors preserve
// 3+/2+ presence on slates where they're genuinely the best Kelly bet for
// that variance class while still cutting the marginal tail.
//
// Calibrated against the 2026-05-04 slate (33 tracked → expected ~17 with
// these floors). Recalibrate via npm run recalibrate after 30 days of
// settled history accumulate.
export const SCORE_FLOORS_TRACKED: Record<Rung, number> = { 1: 0.25, 2: 0.20, 3: 0.15 }

// Display floor: a pick is shown in the "Other plays" section if SCORE >= this.
// SCORE = Kelly fraction × confidence (post-2026-04-29 switch from EDGE × conf
// — see lib/edge.ts:computeScore). Kelly scales differently than the old
// relative-edge formula:
//   · A 1+ HRR play with p_typical=0.75 / p_today=0.85 / conf=0.90 → SCORE ≈ 0.36
//   · A 3+ HRR longshot with p_typical=0.10 / p_today=0.18 / conf=0.80 → SCORE ≈ 0.07
// 0.05 is the new floor — "Kelly says bet at least 5% of bankroll, weighted by
// confidence." Below that, the play is too marginal to feature outside Tracked.
// Recalibrate against settled history once available — see lib/tracker.ts.
export const DISPLAY_FLOOR_SCORE = 0.05

// Minimum confidence for a pick to be Tracked.
//
// Re-tuned 2026-05-04 alongside the confidence-alignment refactor and a
// follow-up that opted BvP out of strict alignment (BvP confidence is now
// a pure linear sample-size signal: 0.90 at 0 AB → 1.00 at ≥20 AB,
// regardless of whether the probToday BvP factor is active below 5 AB).
//
// The alignment refactor lifted typical confidence ~5–9pp by pinning
// several factors to 1.00 when their probability counterpart was
// neutralised (TBD pitcher, dome weather, null bullpen) and adding career-
// prior awareness to the batter-sample factor. The BvP follow-up brought
// median confidence back down because ~83% of picks have <5 BvP AB and
// now take the 10pp 0-AB haircut.
//
// Empirically observed median on the 2026-05-04 slate after both changes:
// 0.79. Floor sits at 0.85 — back to the original — which catches roughly
// the top quartile of picks by confidence on a typical slate. Will be
// tuned against settled history once npm run recalibrate has ≥30 days of
// data.
export const CONFIDENCE_FLOOR_TRACKED = 0.85

// League-average pitcher rates (recalibration target). 2025 MLB averages.
export const LG_K_PCT = 0.225 // K / BF
export const LG_BB_PCT = 0.085 // BB / BF
export const LG_HR_PCT = 0.030 // HR / BF
export const LG_HARD_HIT_RATE = 0.395 // hard-hit balls / BIP

// League-average team bullpen ERA (recalibration target).
export const LG_BULLPEN_ERA = 4.20

// Pitcher stabilization sample sizes (BF, batters faced).
export const STABILIZATION_BF: Record<string, number> = {
  k: 70,
  bb: 170,
  hr: 170,
  hardHit: 200,
}

// Bullpen stabilization sample size (IP).
export const STABILIZATION_BULLPEN_IP = 150

// Expected PA per game by lineup slot (1-9). Empirical league means.
export const expectedPAByLineupSlot: Record<number, number> = {
  1: 4.65,
  2: 4.55,
  3: 4.45,
  4: 4.30,
  5: 4.20,
  6: 4.10,
  7: 4.00,
  8: 3.90,
  9: 3.80,
}

// Average PA across all slots (weighted by frequency).
export const LG_PA_PER_GAME = 4.20

// Share of PAs faced against bullpen by lineup slot (empirical).
// Top-of-order sees less bullpen because they bat earlier in the game.
export const paShareVsBullpenBySlot: Record<number, number> = {
  1: 0.18,
  2: 0.20,
  3: 0.22,
  4: 0.24,
  5: 0.26,
  6: 0.27,
  7: 0.28,
  8: 0.29,
  9: 0.30,
}
