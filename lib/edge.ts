/**
 * Compute matchup edge: how much better (or worse) is this player's prob in this
 * specific matchup vs their typical matchup.
 *
 *   EDGE = max(pMatchup, ε) / max(pTypical, ε) − 1   where ε = 0.01
 *
 * Both numerator and denominator are floored at ε. The pTypical floor prevents
 * divide-by-zero; the pMatchup floor keeps the edge symmetric for very rare
 * events (without it, e.g. pMatchup=0.05, pTypical=0.001 would return +400%
 * even though both probabilities are tiny). With the symmetric floor, that
 * pair returns +400 / +0% along the same scale as common-event edges.
 *
 * Positive: today is better than typical. Negative: today is worse.
 */
const EDGE_FLOOR = 0.01

export function computeEdge(args: { pMatchup: number; pTypical: number }): number {
  const num = Math.max(args.pMatchup, EDGE_FLOOR)
  const den = Math.max(args.pTypical, EDGE_FLOOR)
  return num / den - 1
}

/**
 * Compute final score: EDGE multiplied by confidence factor.
 *
 *   SCORE = EDGE × confidence
 */
export function computeScore(args: { edge: number; confidence: number }): number {
  return args.edge * args.confidence
}
