import { fetchSchedule } from './mlb-api'
import { fetchLineup } from './lineup'

/**
 * Build the deduplicated set of batter playerIds across all games on the
 * given date's slate. Used by the nightly slate-typical cron.
 *
 * Tolerates partial / estimated lineups — they still expose batter identities,
 * just with lower confidence later.
 */
export async function getSlateBatterIds(date: string): Promise<number[]> {
  const games = await fetchSchedule(date)
  const playerIds = new Set<number>()
  for (const game of games) {
    if (game.status === 'postponed' || game.status === 'final') continue
    const [home, away] = await Promise.all([
      fetchLineup(game.gameId, game.homeTeam.teamId, 'home', date),
      fetchLineup(game.gameId, game.awayTeam.teamId, 'away', date),
    ])
    for (const e of home.entries) playerIds.add(e.player.playerId)
    for (const e of away.entries) playerIds.add(e.player.playerId)
  }
  return [...playerIds]
}
