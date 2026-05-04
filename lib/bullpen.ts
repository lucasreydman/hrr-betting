import { kvGet, kvSet } from './kv'

export interface BullpenEraStats {
  era: number
  ip: number
}

const BULLPEN_CACHE_TTL = 6 * 60 * 60  // 6 hours

/**
 * Fetch a team's bullpen ERA + IP from MLB Stats API. Returns null on
 * unknown team / API failure. Cached 6h under `bullpen:v2:{teamId}:{season}`.
 *
 * Read by `lib/factors/bullpen.ts` to scale opponent-bullpen quality by the
 * batter's slot-share of bullpen exposure.
 *
 * Endpoint history: the v1 prefix used `/teams/{id}/stats?stats=season`,
 * which returns ONE team-level split with the team's combined pitching
 * stats (gamesStarted equals total team starts, never zero). The
 * "skip starters" filter then excluded the only entry, totalIp came back
 * 0, and every team scored as league-average (factor 1.00 always). v2
 * uses the league-wide /stats endpoint filtered by team with
 * playerPool=ALL, which returns one split per pitcher — letting the
 * gamesStarted == 0 filter actually identify relievers.
 */
export async function fetchBullpenStats(
  teamId: number,
  season: number,
): Promise<BullpenEraStats | null> {
  if (teamId <= 0) return null

  const cacheKey = `bullpen:v2:${teamId}:${season}`
  const cached = await kvGet<BullpenEraStats>(cacheKey)
  if (cached) return cached

  try {
    const url =
      `https://statsapi.mlb.com/api/v1/stats` +
      `?stats=season&group=pitching&season=${season}&sportId=1&gameType=R` +
      `&teamId=${teamId}&playerPool=ALL&limit=200`
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
