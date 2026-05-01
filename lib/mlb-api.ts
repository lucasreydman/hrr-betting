/**
 * lib/mlb-api.ts
 *
 * Unified MLB Stats API adapter for hits-runs-rbis.
 *
 * All public functions apply a 6-hour KV cache (keyed by inputs) with a
 * live-fetch fallback on miss.  fetchPlayerSlotFrequency uses a 24-hour TTL
 * because iterating a full season's game log is expensive.
 *
 * Ported and adapted from:
 *  - yrfi/lib/mlb-api.ts  — pitcher stats, FIP helpers, linescore
 *  - bvp-betting/lib/mlb-api.ts — schedule, BvP, boxscore, lineup history
 *  - bvp-betting/lib/lineup-estimation.ts — estimated lineup construction
 */

import { kvGet, kvSet } from './kv'
import { slateDateString } from './date-utils'
import type {
  Game,
  TeamRef,
  Lineup,
  LineupEntry,
  PlayerRef,
  Boxscore,
  PlayerGameStats,
  PitcherStats,
  BatterStats,
  BullpenStats,
  OutcomeRates,
  StartLine,
  GameLogEntry,
  BvPRecord,
  Handedness,
} from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MLB_BASE = 'https://statsapi.mlb.com/api/v1'

/**
 * Long cache TTL: 6 hours. Used by data that genuinely doesn't change for the
 * rest of the day once observed — confirmed lineups (stable post-posting) and
 * finalised boxscores (game over, stats locked).
 */
const TTL_6H = 6 * 60 * 60

/** Long cache TTL for expensive season-aggregation calls: 24 hours */
const TTL_24H = 24 * 60 * 60

/**
 * Daily-refresh TTL: 1 hour. Used for season-cumulative data (pitcher/batter
 * season stats, BvP, recent starts, bullpen aggregates, batter game logs) and
 * for probable-pitcher announcements. These all move during the day — stats
 * tick after games finalise, BvP grows when a matchup occurs, probables get
 * announced/scratched. 1h is short enough that the slate-prep cron at 4am ET
 * always sees fresh overnight stats and any intraday changes land within the
 * hour, while still keeping per-request work bounded.
 */
const TTL_DAILY = 60 * 60

/**
 * Short TTL for the schedule. Schedule rows include `game.status` which flips
 * scheduled → in_progress → final throughout the day; that flip drives pitcher
 * status (probable → confirmed) and gating in the ranker. 2 min matches the
 * refresh-cron cadence so each cron tick sees fresh status.
 */
const TTL_SCHEDULE = 2 * 60

/**
 * Short TTL for *unfinalised* lineups (estimated / partial). Once an MLB lineup
 * is fully posted (status: confirmed) it doesn't change for the rest of the
 * game, so confirmed rows still get the long 6h TTL — but estimated and partial
 * rows must turn over fast so we pick up the real lineup as soon as the team
 * posts it.
 */
const TTL_LINEUP_PENDING = 2 * 60

const LEAGUE_AVG_FIP = 4.05
const LEAGUE_AVG_K_PCT = 0.222
const LEAGUE_AVG_BB_PCT = 0.082
const LEAGUE_AVG_HR_PER9 = 1.28
/** FIP constant (2023-era) */
const FIP_CONSTANT = 3.1

/** League-average outcome rates used as fallback across the board */
const LEAGUE_AVG_OUTCOME_RATES: OutcomeRates = {
  '1B': 0.148,
  '2B': 0.046,
  '3B': 0.005,
  HR:   0.034,
  BB:   0.082,
  K:    0.222,
  OUT:  0.463,
}

const SKIP_STATES = new Set(['Postponed', 'Cancelled', 'Suspended'])

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Parse MLB's fractional innings-pitched string (e.g. "85.2" = 85⅔ IP).
 * The decimal digit is outs (0–2), so .1 = 1 out = ⅓ inning.
 */
function parseIP(ip: string): number {
  const [whole, frac = '0'] = ip.split('.')
  return parseInt(whole, 10) + parseInt(frac, 10) / 3
}

/** Derive the current MLB season from a calendar year (spring training starts ~Feb). */
function seasonForYear(year: number): number {
  return year  // MLB seasons match calendar year
}

/** Current season based on today's date. */
function currentSeason(): number {
  return seasonForYear(new Date().getFullYear())
}

/**
 * Shift a YYYY-MM-DD date string by `days` (can be negative).
 */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Compute innings-pitched-based FIP.
 * Returns LEAGUE_AVG_FIP when ip === 0.
 */
function calcFip(hr: number, bb: number, hbp: number, so: number, ip: number): number {
  if (ip === 0) return LEAGUE_AVG_FIP
  return (13 * hr + 3 * (bb + hbp) - 2 * so) / ip + FIP_CONSTANT
}

/**
 * Derive outcome rates from raw counting stats.
 * PA = AB + BB + HBP + SF (approximation — MLB API doesn't always surface SF).
 */
function ratesFromCounts(opts: {
  pa: number
  hits: number
  doubles: number
  triples: number
  homeRuns: number
  baseOnBalls: number
  strikeOuts: number
  hitByPitch?: number
}): OutcomeRates {
  const { pa, hits, doubles, triples, homeRuns, baseOnBalls, strikeOuts, hitByPitch = 0 } = opts
  if (pa === 0) return { ...LEAGUE_AVG_OUTCOME_RATES }
  const singles = Math.max(0, hits - doubles - triples - homeRuns)
  const bb = baseOnBalls + hitByPitch
  const out = Math.max(0, pa - hits - bb - strikeOuts)
  return {
    '1B': singles / pa,
    '2B': doubles / pa,
    '3B': triples / pa,
    HR:   homeRuns / pa,
    BB:   bb / pa,
    K:    strikeOuts / pa,
    OUT:  out / pa,
  }
}

// ---------------------------------------------------------------------------
// Raw MLB API shape types (private — not exported)
// ---------------------------------------------------------------------------

interface RawScheduleGame {
  gamePk: number
  gameDate: string
  status: { detailedState: string; abstractGameState: string }
  venue: { id: number; name: string }
  teams: {
    home: {
      team: { id: number; name: string; abbreviation?: string }
      probablePitcher?: { id: number; fullName: string }
    }
    away: {
      team: { id: number; name: string; abbreviation?: string }
      probablePitcher?: { id: number; fullName: string }
    }
  }
  lineups?: {
    homePlayers?: Array<{ id: number; fullName?: string }>
    awayPlayers?: Array<{ id: number; fullName?: string }>
  }
  linescore?: {
    currentInning?: number
    inningHalf?: string  // "Top" | "Bottom" (raw API casing)
  }
  // Doubleheader fields. `doubleHeader`: 'N' none, 'Y' traditional, 'S' split.
  // `gameNumber` is 1 or 2 within a doubleheader, omitted otherwise. Both used
  // by `dedupeGamesByMatchup` below — see that function for why.
  gameNumber?: number
  doubleHeader?: string
}

interface RawScheduleResponse {
  dates?: Array<{ games?: RawScheduleGame[] }>
}

interface RawPitcherStat {
  homeRuns: number
  baseOnBalls: number
  hitByPitch: number
  strikeOuts: number
  inningsPitched: string
  battersFaced: number
  era?: string
}

interface RawBatterStat {
  plateAppearances: number
  atBats: number
  hits: number
  doubles: number
  triples: number
  homeRuns: number
  baseOnBalls: number
  strikeOuts: number
  hitByPitch?: number
}

interface RawPlayerSplitEntry<T> {
  split?: { code?: string }
  stat: T
}

interface RawStatsResponse<T> {
  stats?: Array<{ splits?: RawPlayerSplitEntry<T>[] }>
}

interface RawGameLogEntry {
  date?: string
  stat: {
    plateAppearances?: number
    atBats?: number
    hits?: number
    doubles?: number
    triples?: number
    homeRuns?: number
    baseOnBalls?: number
    strikeOuts?: number
    hitByPitch?: number
    sacFlies?: number
    inningsPitched?: string
  }
}

interface RawBoxscorePlayer {
  person?: { id: number; fullName?: string }
  stats?: {
    batting?: {
      hits?: number
      runs?: number
      rbi?: number
    }
  }
  battingOrder?: string
  position?: { code?: string; abbreviation?: string }
}

interface RawBoxscoreTeam {
  team?: { id: number; name?: string; abbreviation?: string }
  players?: Record<string, RawBoxscorePlayer>
  batters?: Array<number | { id: number }>
}

interface RawBoxscoreResponse {
  teams?: {
    home?: RawBoxscoreTeam
    away?: RawBoxscoreTeam
  }
  gameData?: {
    status?: {
      abstractGameState?: string
    }
  }
}

interface RawGameLogPitcherStat {
  date?: string
  stat: {
    inningsPitched?: string
  }
}

type RelieverStats = {
  id: number
  appearances: number
  ip: number
  fip: number
  kPct: number
  bbPct: number
  hrPer9: number
}

// ---------------------------------------------------------------------------
// Status mapping helpers
// ---------------------------------------------------------------------------

function mapGameStatus(raw: RawScheduleGame): Game['status'] {
  const state = raw.status.abstractGameState
  const detail = raw.status.detailedState
  if (SKIP_STATES.has(detail)) return 'postponed'
  if (state === 'Final') return 'final'
  if (state === 'Live') return 'in_progress'
  return 'scheduled'
}

// Status priority used by `dedupeGamesByMatchup`. Higher wins so we keep the
// "most progressed" record when MLB returns multiple entries for the same
// matchup (resumed games, schedule artifacts, postponement remnants).
const STATUS_PRIORITY: Record<Game['status'], number> = {
  in_progress: 4,
  final: 3,
  scheduled: 2,
  postponed: 1,
}

/**
 * Collapse multiple schedule entries that describe the same physical game.
 *
 * MLB Stats occasionally returns two `gamePk`s for one matchup — most often
 * after a postponement+reschedule, after a suspended-game resumption, or
 * during transient API blips. Without dedupe, both entries propagate
 * identical-input picks (same player, same opposing pitcher, same park,
 * same factors) so the board renders the same play twice with only the
 * `gameDate` differing by a few minutes. Real doubleheaders are *not*
 * collapsed: they have distinct `gameNumber` values (1 and 2), so the
 * composite key keeps them apart.
 *
 * Dedupe key: `(homeTeamId, awayTeamId, gameNumber ?? 1)`. Within a
 * collision, prefer (1) the most-progressed status, then (2) the latest
 * `gameDate` (newest reschedule wins), then (3) the highest `gamePk`
 * (newest record id wins). Each tiebreaker is deterministic so the output
 * order doesn't depend on input ordering.
 */
export function dedupeGamesByMatchup(
  games: Array<Game & { gameNumber?: number }>,
): Game[] {
  const byKey = new Map<string, Game & { gameNumber?: number }>()
  for (const g of games) {
    const key = `${g.homeTeam.teamId}:${g.awayTeam.teamId}:${g.gameNumber ?? 1}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, g)
      continue
    }
    const a = STATUS_PRIORITY[g.status] ?? 0
    const b = STATUS_PRIORITY[existing.status] ?? 0
    if (a > b) { byKey.set(key, g); continue }
    if (a < b) continue
    // Status tie → newer gameDate wins
    const aDate = Date.parse(g.gameDate)
    const bDate = Date.parse(existing.gameDate)
    if (aDate > bDate) { byKey.set(key, g); continue }
    if (aDate < bDate) continue
    // Date tie → higher gamePk wins (newest record id)
    if (g.gameId > existing.gameId) byKey.set(key, g)
  }
  // Strip the temporary `gameNumber` field — it's only needed for the dedupe
  // key, not part of the public Game type.
  return [...byKey.values()].map(g => {
    const out = { ...g }
    delete out.gameNumber
    return out
  })
}

function toTeamRef(t: { id: number; name: string; abbreviation?: string }): TeamRef {
  return { teamId: t.id, abbrev: t.abbreviation ?? t.name.slice(0, 3).toUpperCase(), name: t.name }
}

// ---------------------------------------------------------------------------
// Public: fetchSchedule
// ---------------------------------------------------------------------------

/**
 * Fetch all non-postponed MLB games for `date` (YYYY-MM-DD).
 * Hydrates probable pitchers and lineups in one call.
 * 6-hour KV cache.
 */
export async function fetchSchedule(date: string): Promise<Game[]> {
  // v4: dedupeGamesByMatchup collapses MLB-side schedule duplicates (same
  // matchup, two gamePks, gameDates differ by minutes — usually a
  // postponement+reschedule artifact). Bumped from v3 to evict any cached
  // pre-dedupe lists holding the duplicate.
  // Earlier bumps: v2 = TTL 6h → 2min so stale game.status didn't serve
  // for hours; v3 = added optional `inning` for live games.
  const cacheKey = `hrr:schedule:v4:${date}`
  const cached = await kvGet<Game[]>(cacheKey)
  if (cached) return cached

  const url = `${MLB_BASE}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,lineups,linescore`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return []

  const data: RawScheduleResponse = await res.json()
  const rawGames: RawScheduleGame[] = data.dates?.[0]?.games ?? []

  const mapped: Array<Game & { gameNumber?: number }> = rawGames
    .filter(g => !SKIP_STATES.has(g.status?.detailedState))
    .map(g => {
      const status = mapGameStatus(g)
      const inningRaw = g.linescore
      const inning =
        status === 'in_progress' && inningRaw?.currentInning && inningRaw?.inningHalf
          ? {
              half: (inningRaw.inningHalf.toLowerCase().startsWith('top') ? 'top' : 'bot') as 'top' | 'bot',
              number: inningRaw.currentInning,
            }
          : undefined
      return {
        gameId:    g.gamePk,
        gameDate:  g.gameDate,
        homeTeam:  toTeamRef(g.teams.home.team),
        awayTeam:  toTeamRef(g.teams.away.team),
        venueId:   g.venue.id,
        venueName: g.venue.name,
        status,
        ...(inning ? { inning } : {}),
        // Carried only for the dedupe key; stripped from the Game returned.
        ...(g.gameNumber ? { gameNumber: g.gameNumber } : {}),
      }
    })

  const games = dedupeGamesByMatchup(mapped)

  await kvSet(cacheKey, games, TTL_SCHEDULE)
  return games
}

// ---------------------------------------------------------------------------
// Public: fetchProbablePitchers
// ---------------------------------------------------------------------------

/**
 * Return the home and away probable pitcher IDs for `gameId`.
 * Derived from the schedule hydration — returns 0 when not yet announced.
 * 6-hour KV cache.
 */
export async function fetchProbablePitchers(
  gameId: number,
): Promise<{ home: number; away: number }> {
  const cacheKey = `hrr:probables:${gameId}`
  const cached = await kvGet<{ home: number; away: number }>(cacheKey)
  if (cached) return cached

  // Try a targeted game endpoint to avoid fetching the full schedule
  const url = `${MLB_BASE}/schedule?sportId=1&gamePk=${gameId}&hydrate=probablePitcher`
  const res = await fetch(url, { cache: 'no-store' })
  // Not cached on failure — { home: 0, away: 0 } is a sentinel, not a fallback;
  // retrying immediately is correct here since the caller can re-fetch on the next request.
  if (!res.ok) return { home: 0, away: 0 }

  const data: RawScheduleResponse = await res.json()
  const game = data.dates?.[0]?.games?.[0]

  const result = {
    home: game?.teams.home.probablePitcher?.id ?? 0,
    away: game?.teams.away.probablePitcher?.id ?? 0,
  }

  await kvSet(cacheKey, result, TTL_DAILY)
  return result
}

// ---------------------------------------------------------------------------
// Private helpers: lineup construction
// ---------------------------------------------------------------------------

/** Stub PlayerRef used when we only have a player ID from the schedule lineups. */
function stubPlayerRef(id: number, fullName?: string, teamAbbrev?: string): PlayerRef {
  return {
    playerId: id,
    fullName: fullName ?? `Player ${id}`,
    team:     teamAbbrev ?? '???',
    bats:     'R',  // unknown — caller should hydrate if needed
  }
}

/**
 * Batch-fetch people info (name, team, bats) for a list of player IDs.
 * Hits MLB Stats `/people?personIds=...&hydrate=currentTeam` (one call for up to ~100 IDs).
 * Returns a Map keyed by playerId. Per-ID 24h KV cache; only un-cached IDs hit the network.
 */
export async function fetchPeople(playerIds: number[]): Promise<Map<number, PlayerRef>> {
  const result = new Map<number, PlayerRef>()
  if (playerIds.length === 0) return result

  const uniqueIds = Array.from(new Set(playerIds.filter(id => id > 0)))
  const uncached: number[] = []

  // Cache check (per-ID so this works across games on the same slate)
  for (const id of uniqueIds) {
    const cached = await kvGet<PlayerRef>(`hrr:person:${id}`)
    if (cached) {
      result.set(id, cached)
    } else {
      uncached.push(id)
    }
  }

  if (uncached.length === 0) return result

  // Single request for all uncached IDs
  const url = `${MLB_BASE}/people?personIds=${uncached.join(',')}&hydrate=currentTeam`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return result  // graceful degradation — leave stubs in place

  interface RawPerson {
    id: number
    fullName?: string
    batSide?: { code?: string }
    pitchHand?: { code?: string }
    currentTeam?: { id?: number; name?: string; abbreviation?: string }
  }
  const data = (await res.json()) as { people?: RawPerson[] }
  const people = data.people ?? []

  for (const p of people) {
    if (!p.id) continue
    const bats: Handedness = p.batSide?.code === 'L' ? 'L' : p.batSide?.code === 'S' ? 'S' : 'R'
    // pitchHand only present for pitchers — leave undefined for position players
    // so the field's presence in the cache reliably signals "this is a pitcher".
    const throwsCode = p.pitchHand?.code
    const throws: Handedness | undefined =
      throwsCode === 'L' ? 'L' : throwsCode === 'S' ? 'S' : throwsCode === 'R' ? 'R' : undefined
    const team = p.currentTeam?.abbreviation ?? p.currentTeam?.name?.slice(0, 3).toUpperCase() ?? '???'
    const ref: PlayerRef = {
      playerId: p.id,
      fullName: p.fullName ?? `Player ${p.id}`,
      team,
      bats,
      ...(throws ? { throws } : {}),
    }
    result.set(p.id, ref)
    await kvSet(`hrr:person:${p.id}`, ref, TTL_24H)
  }

  return result
}

/**
 * Enrich a Lineup's entries with real fullName/team/bats by batch-fetching
 * the MLB people endpoint. Mutates the entries in-place and returns the lineup.
 */
async function enrichLineup(lineup: Lineup, teamAbbrevFallback: string): Promise<Lineup> {
  const ids = lineup.entries.map(e => e.player.playerId)
  const people = await fetchPeople(ids)
  for (const entry of lineup.entries) {
    const real = people.get(entry.player.playerId)
    if (real) {
      // Prefer real data; keep teamAbbrevFallback if currentTeam was '???'
      entry.player = {
        ...entry.player,
        fullName: real.fullName,
        team:     real.team !== '???' ? real.team : teamAbbrevFallback,
        bats:     real.bats,
      }
    }
  }
  return lineup
}

/**
 * Build a Lineup from a confirmed ordered list of player IDs (e.g. from boxscore.batters).
 * Slots are 1-indexed.
 */
function buildConfirmedLineup(ids: number[], teamAbbrev: string): Lineup {
  const entries: LineupEntry[] = ids.slice(0, 9).map((id, i) => ({
    slot:   i + 1,
    player: stubPlayerRef(id, undefined, teamAbbrev),
  }))
  return {
    status:  entries.length >= 9 ? 'confirmed' : 'partial',
    entries: entries.slice(0, 9),
  }
}

// ---------------------------------------------------------------------------
// Public: fetchLineup
// ---------------------------------------------------------------------------

/**
 * Fetch the lineup for one side of a game.
 *
 * Strategy (in priority order):
 *  1. Boxscore `batters` field — confirmed, available at first pitch
 *  2. Schedule `lineups.homePlayers` / `lineups.awayPlayers` — pre-game confirmation
 *  3. Recent batting-order history from the previous 14 days — estimated
 *
 * Status field reflects which tier succeeded:
 *  - 'confirmed'  → boxscore or schedule lineups (≥9 players)
 *  - 'partial'    → schedule lineups present but < 9 players
 *  - 'estimated'  → built from historical batting-order data
 *
 * Cache key: `hrr:lineup:{gameId}:{teamId}:{side}` — date is implicitly part of
 * the key because each MLB `gameId` belongs to exactly one calendar date. This
 * also holds for doubleheaders, which MLB assigns *distinct* gamePks (one for
 * each game of the pair), so two same-day games against the same opponent
 * still cache independently. If MLB ever changes that convention, add `date`
 * to the cache key explicitly.
 *
 * 6-hour KV cache.
 */
export async function fetchLineup(
  gameId:   number,
  teamId:   number,
  side:     'home' | 'away',
  date?:    string,
): Promise<Lineup> {
  // `v3:` bump (was v2) — forces re-fetch of all lineups cached with the prior
  // uniform 6h TTL, which kept estimated/partial rows stuck for hours after the
  // real lineup posted. New writes use a status-aware TTL: confirmed → 6h,
  // pending (partial/estimated) → 2 min so transitions land fast.
  const cacheKey = `hrr:lineup:v3:${gameId}:${teamId}:${side}`
  const cached = await kvGet<Lineup>(cacheKey)
  if (cached) return cached

  let teamAbbrevForCache = '???'

  // --- Tier 1: live boxscore batters ---
  const boxUrl = `${MLB_BASE}/game/${gameId}/boxscore`
  const boxRes = await fetch(boxUrl, { cache: 'no-store' })
  if (boxRes.ok) {
    const boxData: RawBoxscoreResponse = await boxRes.json()
    const teamData = boxData.teams?.[side]
    const teamAbbrev = teamData?.team?.abbreviation ?? '???'
    teamAbbrevForCache = teamAbbrev
    const rawBatters = teamData?.batters ?? []
    const ids = rawBatters
      .map((b: number | { id: number }) => (typeof b === 'number' ? b : b.id))
      .filter(Boolean)
    if (ids.length >= 9) {
      const lineup = await enrichLineup(buildConfirmedLineup(ids, teamAbbrev), teamAbbrev)
      await kvSet(cacheKey, lineup, TTL_6H)
      return lineup
    }
  }

  // --- Tier 2: schedule lineups hydration ---
  const schedUrl = `${MLB_BASE}/schedule?sportId=1&gamePk=${gameId}&hydrate=lineups`
  const schedRes = await fetch(schedUrl, { cache: 'no-store' })
  if (schedRes.ok) {
    const schedData: RawScheduleResponse = await schedRes.json()
    const game = schedData.dates?.[0]?.games?.[0]
    const schedulePlayers = side === 'home'
      ? (game?.lineups?.homePlayers ?? [])
      : (game?.lineups?.awayPlayers ?? [])
    if (schedulePlayers.length >= 9) {
      const entries: LineupEntry[] = schedulePlayers.slice(0, 9).map((p, i) => ({
        slot:   i + 1,
        player: stubPlayerRef(p.id, p.fullName),
      }))
      const lineup = await enrichLineup({ status: 'confirmed', entries }, teamAbbrevForCache)
      await kvSet(cacheKey, lineup, TTL_6H)
      return lineup
    }
    if (schedulePlayers.length > 0) {
      const entries: LineupEntry[] = schedulePlayers.slice(0, 9).map((p, i) => ({
        slot:   i + 1,
        player: stubPlayerRef(p.id, p.fullName),
      }))
      const lineup = await enrichLineup({ status: 'partial', entries }, teamAbbrevForCache)
      // Partial lineups will become confirmed soon — short TTL so we pick that up fast.
      await kvSet(cacheKey, lineup, TTL_LINEUP_PENDING)
      return lineup
    }
  }

  // --- Tier 3: estimated from recent batting-order history ---
  const targetDate = date ?? new Date().toISOString().slice(0, 10)
  const estimated = await enrichLineup(
    await buildEstimatedLineupForTeam(teamId, targetDate),
    teamAbbrevForCache,
  )
  // Estimated lineups should turn over fast — the team will post a real lineup
  // and we want to pick it up within minutes, not hours.
  await kvSet(cacheKey, estimated, TTL_LINEUP_PENDING)
  return estimated
}

/**
 * Build an estimated 9-man lineup from recent batting-order history for `teamId`.
 * Looks back 14 days, uses up to 6 recent games, ranks players by:
 *  1. Number of recent starts (descending)
 *  2. Median lineup slot (ascending)
 *  3. Career PA (descending) — used as tiebreaker; we skip fetching it here
 */
async function buildEstimatedLineupForTeam(
  teamId:      number,
  targetDate:  string,
): Promise<Lineup> {
  const endDate   = shiftDate(targetDate, -1)
  const startDate = shiftDate(endDate, -14)
  const url = `${MLB_BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${startDate}&endDate=${endDate}&hydrate=lineups`
  const res = await fetch(url, { cache: 'no-store' })

  if (!res.ok) {
    // Not cached on failure — estimated lineups change frequently; retry-immediately is correct.
    return { status: 'estimated', entries: [] }
  }

  const data: RawScheduleResponse = await res.json()
  const allGames = (data.dates ?? [])
    .flatMap(d => d.games ?? [])
    .filter(g => !SKIP_STATES.has(g.status?.detailedState))
    .sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime())

  const positions = new Map<number, number[]>()
  let usedGames = 0

  for (const game of allGames) {
    if (usedGames >= 6) break
    const gameSide =
      game.teams.home.team.id === teamId ? 'home'
      : game.teams.away.team.id === teamId ? 'away'
      : null
    if (!gameSide) continue

    const lineupPlayers = gameSide === 'home'
      ? (game.lineups?.homePlayers ?? [])
      : (game.lineups?.awayPlayers ?? [])
    if (lineupPlayers.length < 8) continue

    usedGames++
    lineupPlayers.slice(0, 9).forEach((player, idx) => {
      const slots = positions.get(player.id) ?? []
      slots.push(idx + 1)
      positions.set(player.id, slots)
    })
  }

  // Rank candidates by recent appearance count (most starts first), then by
  // their *most-frequent* slot (mode) ascending so leadoff types come before
  // bottom-of-order types when counts tie.
  const candidates = [...positions.entries()]
    .sort(([aId, aSlots], [bId, bSlots]) => {
      if (bSlots.length !== aSlots.length) return bSlots.length - aSlots.length
      const aMode = modeSlot(aSlots)
      const bMode = modeSlot(bSlots)
      if (aMode !== bMode) return aMode - bMode
      return aId - bId
    })
    .slice(0, 9)

  // Greedy slot assignment with collision handling. Each candidate prefers
  // their mode-slot (the integer they batted in most often). If that slot is
  // already taken by a higher-ranked candidate, pick the closest *unused*
  // slot 1-9. This guarantees:
  //   1. Slots are always integers in [1,9] — never 4.5 or other fractions.
  //   2. No two players share a slot.
  //   3. The most-confident player gets first pick at their preferred slot.
  const usedSlots = new Set<number>()
  const entries: LineupEntry[] = []
  for (const [id, slots] of candidates) {
    let preferred = modeSlot(slots)
    if (usedSlots.has(preferred)) {
      // Find the closest unused integer slot 1-9. Ties prefer the lower slot.
      let bestSlot = -1
      let bestDist = Infinity
      for (let s = 1; s <= 9; s++) {
        if (usedSlots.has(s)) continue
        const d = Math.abs(s - preferred)
        if (d < bestDist || (d === bestDist && bestSlot === -1)) {
          bestSlot = s
          bestDist = d
        }
      }
      if (bestSlot === -1) continue  // shouldn't happen with 9 candidates
      preferred = bestSlot
    }
    usedSlots.add(preferred)
    entries.push({ slot: preferred, player: stubPlayerRef(id) })
  }

  // Re-sort by slot for a consistent batting order
  entries.sort((a, b) => a.slot - b.slot)

  return { status: 'estimated', entries }
}

/**
 * Return the most-frequent slot (mode) for a list of historical slot
 * appearances. Ties are broken by the *lower* slot — a player split between
 * slot 4 and slot 5 with equal frequency is more likely to leadoff that pair.
 *
 * Returns 9 (bottom of order) for an empty list as a safe default.
 */
function modeSlot(slots: number[]): number {
  if (slots.length === 0) return 9
  const counts = new Map<number, number>()
  for (const s of slots) counts.set(s, (counts.get(s) ?? 0) + 1)
  let bestSlot = slots[0]
  let bestCount = 0
  for (const [slot, count] of counts) {
    if (count > bestCount || (count === bestCount && slot < bestSlot)) {
      bestSlot = slot
      bestCount = count
    }
  }
  return bestSlot
}

// ---------------------------------------------------------------------------
// Public: fetchBoxscore
// ---------------------------------------------------------------------------

/**
 * Fetch the boxscore for `gameId`.
 * Returns hits, runs, and RBIs per player (keyed by playerId).
 * Used by the settle route to record final stat lines.
 *
 * TTL policy is status-aware (the live ranker now reads boxscores during
 * the slate, not just the post-game settle cron):
 *  - **final**:        6h — stable, doesn't change
 *  - **in_progress**:  2 min — must turn over fast so we catch the
 *                       final transition (otherwise picks stay stuck on
 *                       FINAL · pending for hours after the game ends)
 *  - **scheduled**:    5 min — pre-game lookups, refresh quickly once
 *                       first pitch lands
 *  - **HTTP error**:   5 min fallback — so callers don't hammer a flapping
 *                       endpoint, but recovers fast once the API comes back
 *
 * The differing TTLs aren't contradictions — they answer different questions
 * about how stale "stale" actually is for each game state.
 */
export async function fetchBoxscore(gameId: number): Promise<Boxscore> {
  const cacheKey = `hrr:boxscore:${gameId}`
  const cached = await kvGet<Boxscore>(cacheKey)
  if (cached) return cached

  const url = `${MLB_BASE}/game/${gameId}/boxscore`
  const res = await fetch(url, { cache: 'no-store' })

  if (!res.ok) {
    // Cache the empty fallback with a short TTL so callers don't hammer a broken endpoint,
    // but it expires quickly enough to pick up data once the game starts.
    const fallback: Boxscore = { gameId, status: 'scheduled', playerStats: {} }
    await kvSet(cacheKey, fallback, 5 * 60)
    return fallback
  }

  const data: RawBoxscoreResponse = await res.json()

  const playerStats: Record<number, PlayerGameStats> = {}
  for (const sideKey of ['home', 'away'] as const) {
    const players = data.teams?.[sideKey]?.players ?? {}
    for (const [key, player] of Object.entries(players)) {
      const id = Number(key.replace('ID', ''))
      if (!id) continue
      const batting = (player as RawBoxscorePlayer).stats?.batting
      if (!batting) continue
      playerStats[id] = {
        hits: batting.hits  ?? 0,
        runs: batting.runs  ?? 0,
        rbis: batting.rbi   ?? 0,
      }
    }
  }

  // Derive status from the API's abstractGameState field
  const rawStatus = data.gameData?.status?.abstractGameState
  const status: Boxscore['status'] =
    rawStatus === 'Final'   ? 'final'       :
    rawStatus === 'Live'    ? 'in_progress' :
                              'scheduled'

  const result: Boxscore = { gameId, status, playerStats }
  // Status-aware TTL — see TTL policy block above. Crucial: an in_progress
  // boxscore must NOT be cached for 6h, or every pick from a finished game
  // will read the stale in-progress entry and stay on FINAL · pending until
  // the cache expires.
  const ttlSec =
    status === 'final'       ? TTL_6H :
    status === 'in_progress' ? 2 * 60 :
                               5 * 60
  await kvSet(cacheKey, result, ttlSec)
  return result
}

// ---------------------------------------------------------------------------
// Public: fetchPitcherSeasonStats
// ---------------------------------------------------------------------------

/**
 * Fetch a pitcher's season stat line and derive FIP, K%, BB%, HR/9.
 * Falls back to league averages when the pitcher has insufficient data.
 * 6-hour KV cache.
 */
export async function fetchPitcherSeasonStats(
  pitcherId: number,
  season:    number,
): Promise<PitcherStats> {
  // Slate-aligned: data freezes for the entire slate (3am ET → next 3am ET) so
  // mid-game stat updates don't shift previously-given plays.
  const cacheKey = `hrr:pitcher:season:${pitcherId}:${season}:${slateDateString()}`
  const cached = await kvGet<PitcherStats>(cacheKey)
  if (cached) return cached

  const url = `${MLB_BASE}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`
  const res = await fetch(url, { cache: 'no-store' })

  if (!res.ok) {
    const result = fallbackPitcherStats(pitcherId)
    await kvSet(cacheKey, result, 5 * 60)
    return result
  }

  const data: RawStatsResponse<RawPitcherStat> = await res.json()
  const stat: RawPitcherStat | null = data.stats?.[0]?.splits?.[0]?.stat ?? null

  if (!stat) {
    const result = fallbackPitcherStats(pitcherId)
    await kvSet(cacheKey, result, TTL_24H)
    return result
  }

  const ip = parseIP(stat.inningsPitched)
  const bf = stat.battersFaced ?? 0

  const result: PitcherStats = {
    pitcherId,
    ip,
    fip:     calcFip(stat.homeRuns, stat.baseOnBalls, stat.hitByPitch, stat.strikeOuts, ip),
    kPct:    bf > 0 ? stat.strikeOuts / bf : LEAGUE_AVG_K_PCT,
    bbPct:   bf > 0 ? stat.baseOnBalls / bf : LEAGUE_AVG_BB_PCT,
    hrPer9:  ip > 0 ? (stat.homeRuns * 9) / ip : LEAGUE_AVG_HR_PER9,
  }

  await kvSet(cacheKey, result, TTL_24H)
  return result
}

function fallbackPitcherStats(pitcherId: number): PitcherStats {
  return {
    pitcherId,
    ip:     0,
    fip:    LEAGUE_AVG_FIP,
    kPct:   LEAGUE_AVG_K_PCT,
    bbPct:  LEAGUE_AVG_BB_PCT,
    hrPer9: LEAGUE_AVG_HR_PER9,
  }
}

// ---------------------------------------------------------------------------
// Public: fetchPitcherRecentStarts
// ---------------------------------------------------------------------------

/**
 * Fetch the last `n` starts for a pitcher in the current season.
 * Returns an array of { gameDate, ip } sorted newest-first.
 * Used by starter-share (Task 15) to build an IP CDF.
 * 6-hour KV cache.
 */
export async function fetchPitcherRecentStarts(
  pitcherId: number,
  n:         number,
  season?:   number,
): Promise<StartLine[]> {
  const s = season ?? currentSeason()
  // Slate-aligned: today's start (if any) gets baked into the slate's snapshot
  // and doesn't shift mid-game.
  const cacheKey = `hrr:pitcher:starts:${pitcherId}:${s}:${n}:${slateDateString()}`
  const cached = await kvGet<StartLine[]>(cacheKey)
  if (cached) return cached

  const url = `${MLB_BASE}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${s}`
  const res = await fetch(url, { cache: 'no-store' })

  if (!res.ok) {
    await kvSet(cacheKey, [], TTL_24H)
    return []
  }

  const data = await res.json() as { stats?: Array<{ splits?: RawGameLogPitcherStat[] }> }
  const splits: RawGameLogPitcherStat[] = data.stats?.[0]?.splits ?? []

  const starts: StartLine[] = splits
    .filter(s => {
      const ipStr = s.stat.inningsPitched ?? '0'
      return parseIP(ipStr) > 0  // exclude relief appearances (0 IP entries)
    })
    .map(s => ({
      gameDate: s.date ?? '',
      ip: parseIP(s.stat.inningsPitched ?? '0'),
    }))
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate))
    .slice(0, n)

  await kvSet(cacheKey, starts, TTL_24H)
  return starts
}

// ---------------------------------------------------------------------------
// Public: fetchBatterSeasonStats
// ---------------------------------------------------------------------------

/**
 * Fetch a batter's season stat line and derive outcome rates.
 * Outcome rates are derived from full-season counting stats.
 * 6-hour KV cache.
 */
export async function fetchBatterSeasonStats(
  batterId: number,
  season:   number,
): Promise<BatterStats> {
  // Slate-aligned: a batter's season totals tick during their game today; we
  // freeze the morning snapshot for the whole slate so plays don't shift mid-game.
  const cacheKey = `hrr:batter:season:${batterId}:${season}:${slateDateString()}`
  const cached = await kvGet<BatterStats>(cacheKey)
  if (cached) return cached

  const url = `${MLB_BASE}/people/${batterId}/stats?stats=season&group=hitting&season=${season}`
  const res = await fetch(url, { cache: 'no-store' })

  if (!res.ok) {
    const result = fallbackBatterStats(batterId)
    await kvSet(cacheKey, result, 5 * 60)
    return result
  }

  const data: RawStatsResponse<RawBatterStat> = await res.json()
  const stat: RawBatterStat | null = data.stats?.[0]?.splits?.[0]?.stat ?? null

  if (!stat || stat.plateAppearances === 0) {
    const result = fallbackBatterStats(batterId)
    await kvSet(cacheKey, result, TTL_24H)
    return result
  }

  const result: BatterStats = {
    batterId,
    pa:    stat.plateAppearances,
    hits:  stat.hits,
    outcomeRates: ratesFromCounts({
      pa:           stat.plateAppearances,
      hits:         stat.hits,
      doubles:      stat.doubles,
      triples:      stat.triples,
      homeRuns:     stat.homeRuns,
      baseOnBalls:  stat.baseOnBalls,
      strikeOuts:   stat.strikeOuts,
      hitByPitch:   stat.hitByPitch,
    }),
  }

  await kvSet(cacheKey, result, TTL_24H)
  return result
}

function fallbackBatterStats(batterId: number): BatterStats {
  return {
    batterId,
    pa:           0,
    hits:         0,
    outcomeRates: { ...LEAGUE_AVG_OUTCOME_RATES },
  }
}

// ---------------------------------------------------------------------------
// Public: fetchBatterGameLog
// ---------------------------------------------------------------------------

/**
 * Fetch a batter's game-by-game log for a season.
 * Used by p-typical (Task 12) to compute L15/L30 rolling averages.
 * Results are sorted newest-first.
 * 6-hour KV cache.
 */
export async function fetchBatterGameLog(
  batterId: number,
  season:   number,
): Promise<GameLogEntry[]> {
  // Slate-aligned for the same reason as fetchBatterSeasonStats — today's
  // gamelog tick mid-game shouldn't shift previously-given plays.
  const cacheKey = `hrr:batter:gamelog:${batterId}:${season}:${slateDateString()}`
  const cached = await kvGet<GameLogEntry[]>(cacheKey)
  if (cached) return cached

  const url = `${MLB_BASE}/people/${batterId}/stats?stats=gameLog&group=hitting&season=${season}`
  const res = await fetch(url, { cache: 'no-store' })

  if (!res.ok) {
    await kvSet(cacheKey, [], TTL_24H)
    return []
  }

  const data = await res.json() as { stats?: Array<{ splits?: RawGameLogEntry[] }> }
  const splits: RawGameLogEntry[] = data.stats?.[0]?.splits ?? []

  const entries: GameLogEntry[] = splits
    .map(s => {
      const st = s.stat
      const ab     = st.atBats ?? 0
      const bb     = st.baseOnBalls ?? 0
      const hbp    = st.hitByPitch ?? 0
      const sf     = st.sacFlies ?? 0
      const hits   = st.hits ?? 0
      const so     = st.strikeOuts ?? 0
      // Prefer the API's PA when present; fall back to AB + BB + HBP + SF
      // (true PA definition; the previous fallback of AB + BB undercounted by
      // ~3% by ignoring HBP and sac flies).
      const pa     = st.plateAppearances ?? (ab + bb + hbp + sf)
      return {
        gameDate:   s.date ?? '',
        pa,
        hits,
        doubles:    st.doubles    ?? 0,
        triples:    st.triples    ?? 0,
        homeRuns:   st.homeRuns   ?? 0,
        walks:      bb,
        strikeouts: so,
      }
    })
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate))

  await kvSet(cacheKey, entries, TTL_24H)
  return entries
}

// ---------------------------------------------------------------------------
// Public: fetchTeamBullpenStats
// ---------------------------------------------------------------------------

/**
 * Fetch aggregate bullpen stats for a team, split into high-leverage and rest tiers.
 *
 * ## Leverage-tier classification
 *
 * MLB Stats API does not expose per-reliever leverage index (pLI) directly.
 * Baseball Savant does, but Savant integration is deferred to a later task.
 *
 * v1 uses the following proxy (in priority order):
 *
 * 1. **FIP proxy (primary):** Among relievers with ≥10 appearances, rank by FIP ascending.
 *    Top 3–4 pitchers by FIP = high-leverage tier.
 *    Rationale: managers tend to deploy their best relievers in high-leverage spots.
 *
 * This intentionally avoids the inning-count proxy because MLB Stats season game-log
 * endpoints don't surface per-game leverage states — that would require iterating
 * every game log entry, which is prohibitively expensive.
 *
 * When Savant integration (next task) is available, replace with pLI threshold ≥ 1.2.
 *
 * 6-hour KV cache.
 */
export async function fetchTeamBullpenStats(
  teamId: number,
  season?: number,
): Promise<BullpenStats> {
  const s = season ?? currentSeason()
  // Slate-aligned: bullpen aggregates tick after each game; freezing per slate
  // keeps mid-game changes from shifting previously-given plays.
  const cacheKey = `hrr:bullpen:${teamId}:${s}:${slateDateString()}`
  const cached = await kvGet<BullpenStats>(cacheKey)
  if (cached) return cached

  const url = `${MLB_BASE}/teams/${teamId}/stats?stats=season&group=pitching&season=${s}&sportId=1`
  const res = await fetch(url, { cache: 'no-store' })

  if (!res.ok) {
    const result = fallbackBullpenStats()
    await kvSet(cacheKey, result, TTL_24H)
    return result
  }

  const data = await res.json() as {
    stats?: Array<{
      splits?: Array<{
        player?: { id: number; fullName?: string }
        stat: {
          gamesPlayed?: number
          gamesStarted?: number
          homeRuns?: number
          baseOnBalls?: number
          hitByPitch?: number
          strikeOuts?: number
          inningsPitched?: string
          battersFaced?: number
        }
      }>
    }>
  }

  const splits = data.stats?.[0]?.splits ?? []

  const relievers: RelieverStats[] = splits
    .filter(split => {
      const st = split.stat
      const starts = st.gamesStarted ?? 0
      const games  = st.gamesPlayed  ?? 0
      // Reliever = more relief appearances than starts, ≥10 total appearances
      return (games - starts) >= 10 && starts < games * 0.5
    })
    .map(split => {
      const st  = split.stat
      const ip  = parseIP(st.inningsPitched ?? '0')
      const bf  = st.battersFaced ?? 0
      const hr  = st.homeRuns     ?? 0
      const bb  = st.baseOnBalls  ?? 0
      const hbp = st.hitByPitch   ?? 0
      const so  = st.strikeOuts   ?? 0
      return {
        id:          split.player?.id ?? 0,
        appearances: st.gamesPlayed ?? 0,
        ip,
        fip:    calcFip(hr, bb, hbp, so, ip),
        kPct:   bf > 0 ? so / bf : LEAGUE_AVG_K_PCT,
        bbPct:  bf > 0 ? bb / bf : LEAGUE_AVG_BB_PCT,
        hrPer9: ip > 0 ? (hr * 9) / ip : LEAGUE_AVG_HR_PER9,
      }
    })
    .sort((a, b) => a.fip - b.fip)  // ascending FIP: best pitchers first

  if (relievers.length === 0) {
    const result = fallbackBullpenStats()
    await kvSet(cacheKey, result, TTL_24H)
    return result
  }

  const highLevN = Math.min(4, Math.max(3, Math.ceil(relievers.length * 0.25)))
  const highLev  = relievers.slice(0, highLevN)
  const rest     = relievers.slice(highLevN)

  function aggregateTier(tier: RelieverStats[]): BullpenStats['highLeverage'] {
    if (tier.length === 0) {
      return {
        fip:    LEAGUE_AVG_FIP,
        kPct:   LEAGUE_AVG_K_PCT,
        bbPct:  LEAGUE_AVG_BB_PCT,
        hrPer9: LEAGUE_AVG_HR_PER9,
        vsR:    { ...LEAGUE_AVG_OUTCOME_RATES },
        vsL:    { ...LEAGUE_AVG_OUTCOME_RATES },
      }
    }
    // IP-weighted averages
    const totalIp = tier.reduce((acc, r) => acc + r.ip, 0)
    const w = (stat: keyof RelieverStats) =>
      totalIp > 0
        ? tier.reduce((acc, r) => acc + (r[stat] as number) * r.ip, 0) / totalIp
        : (tier.reduce((acc, r) => acc + (r[stat] as number), 0) / tier.length)

    const fip    = w('fip')
    const kPct   = w('kPct')
    const bbPct  = w('bbPct')
    const hrPer9 = w('hrPer9')

    // v1: vsR/vsL splits not available from this endpoint without per-split calls.
    // Derive approximate splits by applying league-average L/R adjustments.
    // Savant integration (next task) will replace with real splits.
    const vsR = buildApproxSplit(fip, kPct, bbPct, hrPer9, 'R')
    const vsL = buildApproxSplit(fip, kPct, bbPct, hrPer9, 'L')
    return { fip, kPct, bbPct, hrPer9, vsR, vsL }
  }

  const result: BullpenStats = {
    highLeverage: aggregateTier(highLev),
    rest:         aggregateTier(rest.length > 0 ? rest : relievers),
  }

  await kvSet(cacheKey, result, TTL_24H)
  return result
}

/**
 * Build approximate vs-R / vs-L outcome rates from aggregate stats.
 * Uses league-average platoon adjustments as a rough proxy until Savant splits are available.
 *
 * League-average platoon factors (rough 2023 empirical):
 *  vs-R batters: K slightly higher, BB slightly lower, HR slightly lower
 *  vs-L batters: K slightly lower, BB slightly higher, HR slightly higher
 */
function buildApproxSplit(
  _fip:   number,
  kPct:   number,
  bbPct:  number,
  hrPer9: number,
  hand:   'R' | 'L',
): OutcomeRates {
  const kAdj    = hand === 'R' ?  0.01 : -0.01
  const bbAdj   = hand === 'R' ? -0.005 : 0.005
  const hrAdj   = hand === 'R' ? -0.002 : 0.002

  const adjK    = Math.max(0, kPct  + kAdj)
  const adjBB   = Math.max(0, bbPct + bbAdj)
  const adjHR   = Math.max(0, (hrPer9 / 9) + hrAdj)

  // Rough hit rate: overall OBP minus BB minus HBP ≈ BABIP component
  const hitRate   = 0.240  // approximate league-avg hit/PA
  const singlesR  = hitRate - adjHR - 0.046 - 0.005  // subtract 2B, 3B, HR rates
  const outR      = Math.max(0, 1 - adjK - adjBB - adjHR - hitRate)

  const rates: OutcomeRates = {
    '1B': Math.max(0, singlesR),
    '2B': 0.046,
    '3B': 0.005,
    HR:   adjHR,
    BB:   adjBB,
    K:    adjK,
    OUT:  outR,
  }

  // Normalise so rates sum to 1
  const sum = Object.values(rates).reduce((a, b) => a + b, 0)
  if (sum > 0) {
    for (const key of Object.keys(rates) as (keyof OutcomeRates)[]) {
      rates[key] /= sum
    }
  }

  return rates
}

function fallbackBullpenStats(): BullpenStats {
  const tier = {
    fip:    LEAGUE_AVG_FIP,
    kPct:   LEAGUE_AVG_K_PCT,
    bbPct:  LEAGUE_AVG_BB_PCT,
    hrPer9: LEAGUE_AVG_HR_PER9,
    vsR:    { ...LEAGUE_AVG_OUTCOME_RATES },
    vsL:    { ...LEAGUE_AVG_OUTCOME_RATES },
  }
  return { highLeverage: tier, rest: { ...tier } }
}

// ---------------------------------------------------------------------------
// Public: fetchBvP
// ---------------------------------------------------------------------------

/**
 * Fetch batter-vs-pitcher career totals.
 * Returns null-safe defaults (0 AB) when the matchup has never occurred.
 * 6-hour KV cache.
 */
export async function fetchBvP(
  batterId:  number,
  pitcherId: number,
): Promise<BvPRecord> {
  // Slate-aligned: BvP record updates with each PA against this pitcher today.
  // Freezing per slate keeps the morning's snapshot stable so the play given
  // before first pitch doesn't shift mid-game when ABs accumulate.
  const cacheKey = `hrr:bvp:${batterId}:${pitcherId}:${slateDateString()}`
  const cached = await kvGet<BvPRecord>(cacheKey)
  if (cached) return cached

  const url = `${MLB_BASE}/people/${batterId}/stats?stats=vsPlayerTotal&opposingPlayerId=${pitcherId}&group=hitting`
  const res = await fetch(url, { cache: 'no-store' })

  const empty: BvPRecord = { ab: 0, hits: 0, '1B': 0, '2B': 0, '3B': 0, HR: 0, BB: 0, K: 0 }

  if (!res.ok) {
    await kvSet(cacheKey, empty, TTL_24H)
    return empty
  }

  const data = await res.json() as {
    stats?: Array<{
      splits?: Array<{
        stat: {
          atBats:      number
          hits:        number
          doubles:     number
          triples:     number
          homeRuns:    number
          baseOnBalls: number
          strikeOuts:  number
          hitByPitch?: number
        }
      }>
    }>
  }

  const split = data.stats?.[0]?.splits?.[0]
  if (!split) {
    await kvSet(cacheKey, empty, TTL_24H)
    return empty
  }

  const s = split.stat
  const singles = Math.max(0, s.hits - s.doubles - s.triples - s.homeRuns)
  const result: BvPRecord = {
    ab:   s.atBats,
    hits: s.hits,
    '1B': singles,
    '2B': s.doubles,
    '3B': s.triples,
    HR:   s.homeRuns,
    BB:   s.baseOnBalls + (s.hitByPitch ?? 0),
    K:    s.strikeOuts,
  }

  await kvSet(cacheKey, result, TTL_24H)
  return result
}

// ---------------------------------------------------------------------------
// Public: fetchPlayerSlotFrequency
// ---------------------------------------------------------------------------

/**
 * Compute the historical lineup-slot distribution for a player in a given season.
 *
 * Iterates every game log entry for the season, inspects the lineup for each
 * game the player appeared in as a starter (batting order present, not a
 * pinch-hit appearance), and counts how many times they batted in each slot.
 *
 * Returns a normalized fraction map, e.g. `{ 4: 0.80, 3: 0.20 }`.
 * Returns an empty object when the player has no lineup data for the season.
 *
 * Implementation note:
 *  MLB Stats game-log endpoint (`stats=gameLog&group=hitting`) returns per-game
 *  splits that include a `battingOrder` field when lineup data is available.
 *  We parse that field (a 3-digit string like "400" → slot 4) rather than
 *  making individual game-level calls, which would be prohibitively expensive.
 *
 * 24-hour KV cache — this is expensive and changes rarely during the season.
 */
export async function fetchPlayerSlotFrequency(
  playerId: number,
  season:   number,
): Promise<Record<number, number>> {
  const cacheKey = `hrr:slotfreq:${playerId}:${season}`
  const cached = await kvGet<Record<number, number>>(cacheKey)
  if (cached) return cached

  const url = `${MLB_BASE}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}`
  const res = await fetch(url, { cache: 'no-store' })

  if (!res.ok) {
    await kvSet(cacheKey, {}, TTL_24H)
    return {}
  }

  const data = await res.json() as {
    stats?: Array<{
      splits?: Array<{
        stat: { plateAppearances?: number }
        battingOrder?: string  // e.g. "400" → slot 4, or absent for PH
        isHome?: boolean
        date?: string
      }>
    }>
  }

  const splits = data.stats?.[0]?.splits ?? []
  const slotCounts: Record<number, number> = {}

  for (const split of splits) {
    const orderStr = split.battingOrder
    if (!orderStr) continue  // pinch-hit or no lineup data
    // MLB batting-order is a 3-char string: "100" = slot 1, "400" = slot 4
    const slot = parseInt(orderStr[0], 10)
    if (slot < 1 || slot > 9) continue
    // Exclude pinch-hit appearances (batting order ends in non-zero, e.g. "401" = PH for #4 slot)
    const isPinchHit = orderStr.length >= 3 && orderStr[2] !== '0'
    if (isPinchHit) continue
    slotCounts[slot] = (slotCounts[slot] ?? 0) + 1
  }

  const total = Object.values(slotCounts).reduce((a, b) => a + b, 0)
  const freq: Record<number, number> = {}
  if (total > 0) {
    for (const [slot, count] of Object.entries(slotCounts)) {
      freq[Number(slot)] = count / total
    }
  }

  await kvSet(cacheKey, freq, TTL_24H)
  return freq
}

// ---------------------------------------------------------------------------
// Re-export parseIP for callers that need it (e.g. starter-share)
// ---------------------------------------------------------------------------

export { parseIP }
