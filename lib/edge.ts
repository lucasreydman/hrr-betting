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
 * Compute the betting score for a play. Uses a Kelly-fraction formulation so
 * the score answers "how much would I bet on this at fair-typical odds,
 * weighted by data quality" — a directly actionable bet-quality ranking.
 *
 *   KELLY = (pMatchup − pTypical) / (1 − pTypical)        // bankroll fraction
 *   SCORE = KELLY × confidence
 *
 * Why Kelly over EDGE × confidence:
 *  · Relative EDGE = (p_today / p_typical − 1) scales with rarity, so 3+ HRR
 *    longshots (p_typical ≈ 10%) trivially produce huge edges and dominate any
 *    cross-rung ranking. Kelly's denominator (1 − p_typical) flips the bias —
 *    high-prob plays where you can win a lot of bets get rewarded, and
 *    long-shot variance gets penalised the way a bankroll model would.
 *  · The score has a clean betting interpretation: SCORE × 100 ≈ "Kelly says
 *    bet this many percent of bankroll at fair-typical odds, scaled by how
 *    much we trust the inputs."
 *
 * Edge cases:
 *  · pTypical ≥ 1 would divide by zero. Floor (1 − pTypical) at 0.01 — a player
 *    with effectively-certain typical hit rate is a non-event for the model.
 *  · pMatchup < pTypical produces a negative Kelly fraction, which we preserve
 *    so unfavorable matchups sort below favorable ones.
 */
export function computeScore(args: {
  pMatchup: number
  pTypical: number
  confidence: number
}): number {
  const denom = Math.max(1 - args.pTypical, 0.01)
  const kelly = (args.pMatchup - args.pTypical) / denom
  return kelly * args.confidence
}
