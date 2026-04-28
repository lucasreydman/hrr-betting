import { computePitcherFactor, type PitcherInputs } from './factors/pitcher'
import { computeParkFactor } from './factors/park'
import { computeWeatherFactor } from './factors/weather'
import { computeHandednessFactor } from './factors/handedness'
import { computeBullpenFactor } from './factors/bullpen'
import { computePaCountFactor } from './factors/pa-count'
import type { BullpenEraStats } from './bullpen'
import type { Handedness } from './types'

export interface ProbTodayInputs {
  probTypical: number
  pitcher: PitcherInputs & { throws?: Handedness }
  venueId: number
  batterHand: 'R' | 'L' | 'S'
  weather: { hrMult: number; controlled: boolean; failure: boolean }
  bullpen: BullpenEraStats | null
  lineupSlot: number
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
  }
}

/**
 * Closed-form probToday: probTypical × bounded factor multipliers.
 * Each factor is in roughly [0.5, 2.0]; clamping keeps the product in [0.001, 0.999].
 *
 * Returns the breakdown for the "explain this pick" UI panel and for
 * downstream callers that don't need the breakdown.
 */
export function computeProbTodayWithBreakdown(args: ProbTodayInputs): ProbTodayBreakdown {
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
  }
  const product =
    args.probTypical *
    factors.pitcher *
    factors.park *
    factors.weather *
    factors.handedness *
    factors.bullpen *
    factors.paCount
  const probToday = Math.min(0.999, Math.max(0.001, product))
  return { probToday, factors }
}

export function computeProbToday(args: ProbTodayInputs): number {
  return computeProbTodayWithBreakdown(args).probToday
}
