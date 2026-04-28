import { kvGet, kvSet } from './kv'
import { fetchTeamBullpenStats } from './mlb-api'
import type { Handedness, OutcomeRates } from './types'

export interface BullpenEraStats {
  era: number
  ip: number
}

const BULLPEN_CACHE_TTL = 6 * 60 * 60  // 6 hours

/**
 * Fetch a team's bullpen ERA + IP from MLB Stats API. Returns null on
 * unknown team / API failure. Cached 6h under `bullpen:v1:{teamId}:{season}`.
 */
export async function fetchBullpenStats(
  teamId: number,
  season: number,
): Promise<BullpenEraStats | null> {
  if (teamId <= 0) return null

  const cacheKey = `bullpen:v1:${teamId}:${season}`
  const cached = await kvGet<BullpenEraStats>(cacheKey)
  if (cached) return cached

  try {
    const url =
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats` +
      `?stats=season&group=pitching&season=${season}&sportId=1&gameType=R`
    const res = await fetch(url, { next: { revalidate: BULLPEN_CACHE_TTL } })
    if (!res.ok) return null
    const json = (await res.json()) as {
      stats?: Array<{ splits?: Array<{ stat?: { era?: string; inningsPitched?: string; gamesStarted?: number } }> }>
    }
    const splits = json.stats?.[0]?.splits ?? []
    let weightedEra = 0
    let totalIp = 0
    for (const s of splits) {
      const stat = s.stat
      if (!stat || (stat.gamesStarted ?? 0) > 0) continue  // skip starters
      const ipNum = parseFloat(stat.inningsPitched ?? '0')
      const eraNum = parseFloat(stat.era ?? '0')
      if (Number.isFinite(ipNum) && ipNum > 0) {
        weightedEra += eraNum * ipNum
        totalIp += ipNum
      }
    }
    const result: BullpenEraStats = totalIp > 0
      ? { era: weightedEra / totalIp, ip: totalIp }
      : { era: 4.2, ip: 0 }
    await kvSet(cacheKey, result, BULLPEN_CACHE_TTL)
    return result
  } catch {
    return null
  }
}

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
