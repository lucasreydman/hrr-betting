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

// Display floor: a pick is Watching (shown but not tracked) if SCORE >= this.
// Calibrated for v1 confidence values (typically 0.50-0.65 for estimated
// lineups + early-season pitcher samples). A SCORE of 0.02 with conf ~0.55
// implies EDGE > ~0.04 — i.e. picks the model thinks are at least slightly
// better than the player's typical matchup. Bump higher post-launch when
// the model's confidence factor is fully wired up and saturates closer to 1.0.
export const DISPLAY_FLOOR_SCORE = 0.02

// Minimum confidence for a pick to be Tracked.
export const CONFIDENCE_FLOOR_TRACKED = 0.85

// League-average Statcast metrics used as denominators for log-5 ratios.
export const LG_BARREL_PCT = 0.075
export const LG_HARD_HIT_PCT = 0.395
export const LG_WHIFF_PCT = 0.245
