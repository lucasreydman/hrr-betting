/**
 * Compute matchup edge: how much better (or worse) is this player's prob in this
 * specific matchup vs their typical matchup. Floor on pTypical prevents divide-by-zero.
 *
 *   EDGE = pMatchup / max(pTypical, 0.01) − 1
 *
 * Positive: today is better than typical. Negative: today is worse.
 */
export function computeEdge(args: { pMatchup: number; pTypical: number }): number {
  return args.pMatchup / Math.max(args.pTypical, 0.01) - 1
}

/**
 * Compute final score: EDGE multiplied by confidence factor.
 *
 *   SCORE = EDGE × confidence
 */
export function computeScore(args: { edge: number; confidence: number }): number {
  return args.edge * args.confidence
}
