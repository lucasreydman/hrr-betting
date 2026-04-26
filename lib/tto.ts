import { TTO_MULTIPLIERS } from './constants'
import type { Outcome } from './types'

/**
 * Returns per-outcome multipliers applied to BATTER rates while facing the starter
 * at this index (1st, 2nd, 3rd, 4th time through the order).
 *
 * V1: returns league-average multipliers from constants. Pitcher-specific TTO splits
 * (Task 14 stretch) require Statcast pitch-by-pitch data — defer until needed.
 *
 * Cache key (when implemented): pitcher-tto:{pitcherId}:YYYY-MM-DD (7d TTL).
 */
export async function getTtoMultipliers(args: {
  pitcherId: number
  ttoIndex: 1 | 2 | 3 | 4
}): Promise<Record<Outcome, number>> {
  // TODO: when pitcher Statcast pitch-level data is wired up, fetch
  //   pitcher's per-TTO outcome rates and divide by their 1st-TTO baseline.
  //   For pitchers with < 5 starts, fall back to league avg (this v1 path).
  return { ...TTO_MULTIPLIERS[String(args.ttoIndex) as '1' | '2' | '3' | '4'] }
}
