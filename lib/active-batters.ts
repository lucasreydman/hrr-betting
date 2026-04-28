import { kvGet, kvSet } from './kv'

const TTL = 12 * 60 * 60  // 12h

/**
 * Build the list of active MLB batter playerIds for the given season —
 * 40-man roster minus pitchers. Used by /api/sim/typical {mode: 'full'}.
 */
export async function getActiveBatterIds(season: number): Promise<number[]> {
  const cacheKey = `active-batters:v1:${season}`
  const cached = await kvGet<number[]>(cacheKey)
  if (cached) return cached

  const ids = new Set<number>()

  let teamIds: number[]
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Y`, { next: { revalidate: TTL } })
    if (!res.ok) return []
    const json = (await res.json()) as { teams?: Array<{ id: number }> }
    teamIds = (json.teams ?? []).map(t => t.id)
  } catch {
    return []
  }

  const rosters = await Promise.all(teamIds.map(async tid => {
    try {
      const res = await fetch(
        `https://statsapi.mlb.com/api/v1/teams/${tid}/roster?rosterType=40Man`,
        { next: { revalidate: TTL } },
      )
      if (!res.ok) return [] as number[]
      const json = (await res.json()) as {
        roster?: Array<{ person?: { id: number }; position?: { abbreviation?: string } }>
      }
      return (json.roster ?? [])
        .filter(r => r.position?.abbreviation && r.position.abbreviation !== 'P')
        .map(r => r.person?.id ?? 0)
        .filter(id => id > 0)
    } catch {
      return []
    }
  }))
  for (const arr of rosters) for (const id of arr) ids.add(id)

  const result = [...ids].sort((a, b) => a - b)
  await kvSet(cacheKey, result, TTL)
  return result
}
