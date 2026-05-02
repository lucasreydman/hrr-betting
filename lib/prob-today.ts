import { computePitcherFactor, type PitcherInputs } from './factors/pitcher'
import { computeParkFactor } from './factors/park'
import { computeWeatherFactor } from './factors/weather'
import { computeHandednessFactor } from './factors/handedness'
import { computeBullpenFactor } from './factors/bullpen'
import { computePaCountFactor } from './factors/pa-count'
import { computeBvpFactor } from './factors/bvp'
import { computeBatterFactor } from './factors/batter'
import type { BullpenEraStats } from './bullpen'
import type { Handedness, BvPRecord, BatterStatcast, Outcome } from './types'

export interface ProbTodayInputs {
  probTypical: number
  pitcher: PitcherInputs & { throws?: Handedness }
  venueId: number
  batterHand: 'R' | 'L' | 'S'
  weather: {
    hrMult: number
    controlled: boolean
    failure: boolean
    /** Optional full per-outcome multiplier map. When supplied the weather
     *  factor uses the HRR-weighted multi-outcome composite; otherwise
     *  falls back to the dampened HR-only formula. */
    factors?: Partial<Record<Outcome, number>>
  }
  bullpen: BullpenEraStats | null
  lineupSlot: number
  bvp: BvPRecord | null
  batterStatcast: BatterStatcast | null
}

export interface ProbTodayBreakdown {
  probToday: number
  factors: {
    pitcher: number
    park: number
    weather: number
    handedness: number
    bullpen: number
    paCount: number
    bvp: number
    batter: number
  }
}

/**
 * Closed-form probToday via **odds-ratio composition** (NOT raw-probability
 * multiplication).
 *
 * Why: each factor (pitcher, park, weather, ...) represents a multiplier on
 * the underlying per-PA outcome rate, not on the cumulative probability of
 * "HRR ≥ k over a full game." If we multiplied a probability of 0.70 by a
 * factor of 1.5, we'd get 1.05 — clamped to 0.999 — which is nonsense.
 *
 * Odds-ratio composition is the standard fix:
 *   odds_today = odds_typical × Π factors
 *   probToday  = odds_today / (1 + odds_today)
 *
 * This keeps probabilities monotonic in the factor product but bounded
 * below 1, regardless of how many factors compound. A factor product of
 * 2.0 lifts a 70% prob to ~82% (not 99.9%); a factor product of 5 lifts
 * 70% to ~92%. Behaves sensibly at the extremes.
 *
 * Note: the factor product is also clamped to [0.25, 4.0] as a safety
 * rail against bad data (e.g. an outlier pitcher rate from a tiny sample
 * shouldn't be allowed to drive a 6× ratio swing on its own).
 */
export function computeProbTodayWithBreakdown(args: ProbTodayInputs): ProbTodayBreakdown {
  // TTO is applied per-PA inside the offline sim that builds pTypical
  // (see lib/p-typical.ts:applyTto). No TTO factor at request time —
  // doubling it would double-count the penalty.
  const factors = {
    pitcher: computePitcherFactor({ pitcher: args.pitcher }),
    park: computeParkFactor({ venueId: args.venueId, batterHand: args.batterHand }),
    weather: computeWeatherFactor(args.weather),
    handedness: computeHandednessFactor({
      batterHand: args.batterHand,
      pitcherThrows: args.pitcher.throws ?? 'R',
    }),
    bullpen: computeBullpenFactor({ bullpen: args.bullpen, lineupSlot: args.lineupSlot }),
    paCount: computePaCountFactor({ probTypical: args.probTypical, slot: args.lineupSlot }),
    bvp: computeBvpFactor({ bvp: args.bvp }),
    batter: computeBatterFactor({ statcast: args.batterStatcast }),
  }

  const factorProduct = clamp(
    factors.pitcher *
      factors.park *
      factors.weather *
      factors.handedness *
      factors.bullpen *
      factors.paCount *
      factors.bvp *
      factors.batter,
    0.25,
    4.0,
  )

  const pBase = clamp(args.probTypical, 0.001, 0.999)
  const oddsTypical = pBase / (1 - pBase)
  const oddsToday = oddsTypical * factorProduct
  const probToday = clamp(oddsToday / (1 + oddsToday), 0.001, 0.999)

  return { probToday, factors }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

export function computeProbToday(args: ProbTodayInputs): number {
  return computeProbTodayWithBreakdown(args).probToday
}
