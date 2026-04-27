import { fetchTeamBullpenStats } from './mlb-api'
import type { Handedness, OutcomeRates } from './types'

/**
 * Get high-leverage / rest tier rates for a team's bullpen, against a specific
 * batter handedness. Reads from the MLB-API adapter (Task 6) which classifies
 * tiers via FIP-rank fallback (top ~3-4 by FIP = high-leverage) until Savant pLI
 * integration is wired up.
 */
export async function getBullpenTiers(args: {
  teamId: number
  batterHand: Handedness
}): Promise<{ highLeverage: OutcomeRates; rest: OutcomeRates }> {
  const stats = await fetchTeamBullpenStats(args.teamId)
  const handKey = args.batterHand === 'L' ? 'vsL' : 'vsR'  // S → vsR by default (rare)
  return {
    highLeverage: stats.highLeverage[handKey],
    rest: stats.rest[handKey],
  }
}

/**
 * Returns the fraction of bullpen weight applied to the high-leverage tier
 * for a given PA index (the rest = 1 - this).
 *
 * Late-game PAs (4th+ AB) almost always face a setup/closer; mid-game (3rd PA
 * after starter pulled) is mixed; early PAs that somehow reach bullpen face
 * mid-relief most of the time.
 */
export function weightForPA(paIndex: number): number {
  if (paIndex <= 2) return 0.10
  if (paIndex === 3) return 0.45
  return 0.85  // 4th+ PA → almost always high-leverage. Capped here, not at 1.0,
               // so an extra-inning sequence still leaves a 15% chance of low-lev.
}
