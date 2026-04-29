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
// Used as the log-5 baseline in lib/per-pa.ts.
export const LEAGUE_AVG_RATES: Record<Outcome, number> = {
  '1B': 0.143,
  '2B': 0.045,
  '3B': 0.005,
  HR: 0.030,
  BB: 0.085,
  K: 0.225,
  OUT: 0.467,
}

// TTO (times-through-the-order) multipliers applied to BATTER outcome rates while
// facing the starter. Values > 1 = batter benefit; < 1 = pitcher benefit. League-avg
// fallback when pitcher-specific Statcast splits are unavailable.
// Outcome keys must match the `Outcome` type.
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

// Tracked tier floors per rung (placeholders, recalibrate after ~30 days).
// A pick is Tracked only if confidence >= CONFIDENCE_FLOOR_TRACKED AND
// EDGE >= EDGE_FLOORS[rung] AND P_matchup >= PROB_FLOORS[rung].
export const EDGE_FLOORS: Record<Rung, number> = { 1: 0.10, 2: 0.30, 3: 0.60 }
export const PROB_FLOORS: Record<Rung, number> = { 1: 0.85, 2: 0.55, 3: 0.20 }

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
export const CONFIDENCE_FLOOR_TRACKED = 0.85

// League-average Statcast metrics used as denominators for log-5 ratios.
export const LG_BARREL_PCT = 0.075
export const LG_HARD_HIT_PCT = 0.395
export const LG_WHIFF_PCT = 0.245

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
