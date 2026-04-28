/**
 * lib/ranker.ts
 *
 * Composition layer that calls getPTypical + computeProbToday (closed-form),
 * then assembles ranked picks per rung for the /api/picks endpoint.
 *
 * Phase 8 change: per-game sim cache is no longer used. probToday is computed
 * directly from factor functions (pitcher, park, weather, handedness, bullpen,
 * paCount) applied to the player's pTypical baseline.
 *
 * V1 simplifications (documented):
 *  - hardHitRate falls back to LG_HARD_HIT_RATE when Savant pitcher data is unavailable
 *  - weatherStable=true, isOpener=false (opener detection deferred to later phase)
 *  - timeToFirstPitchMin computed live from game.gameDate
 *  - expectedPA hardcoded to 4 per player (hard gates only)
 *  - Hard gates evaluated once per game side (not per rung, not per player)
 */

import { computeEdge, computeScore } from './edge'
import { computeConfidenceBreakdown, passesHardGates, type ConfidenceFactors } from './confidence'
import { getPTypical } from './p-typical'
import { computeProbTodayWithBreakdown } from './prob-today'
import {
  fetchSchedule,
  fetchProbablePitchers,
  fetchPitcherRecentStarts,
  fetchPitcherSeasonStats,
  fetchBatterSeasonStats,
  fetchBvP,
  fetchPeople,
} from './mlb-api'
import { fetchLineup } from './lineup'
import { getHrParkFactorForBatter, getParkVenueName } from './park-factors'
import { fetchWeather, getOutfieldFacingDegrees } from './weather-api'
import { computeWeatherFactors } from './weather-factors'
import { fetchBullpenStats } from './bullpen'
import { getPitcherStatcast } from './savant-api'
import {
  EDGE_FLOORS,
  PROB_FLOORS,
  CONFIDENCE_FLOOR_TRACKED,
  DISPLAY_FLOOR_SCORE,
  LG_K_PCT,
  LG_BB_PCT,
  LG_HR_PCT,
  LG_HARD_HIT_RATE,
} from './constants'
import type { Rung, BvPRecord } from './types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single batter's slot + identity, used to surface the surrounding lineup. */
export interface LineupSlotSummary {
  slot: number
  playerId: number
  fullName: string
}

/** Observed conditions + the HR multiplier they produced for the sim. */
export interface PickWeather {
  tempF: number
  windSpeedMph: number
  windFromDegrees: number
  /** Compass bearing the outfield faces (home → CF axis). */
  outfieldFacingDegrees: number
  /**
   * Signed wind component along home → CF axis, mph.
   * + = blowing OUT (helps HR), − = blowing IN (suppresses HR).
   */
  windOutMph: number
  /** HR multiplier applied to the per-PA model after temp + wind compose. */
  hrMult: number
  controlled: boolean
  failure: boolean
}

/** The math inputs that determine `confidence` × `edge` for a single pick. */
export interface PickInputs {
  /** MLB venue ID for the game (lookup key for park factors). */
  venueId: number
  venueName: string
  /** HR park factor applied inside the per-PA model (1.00 = neutral). */
  parkHrFactor: number
  /** Observed weather + the HR multiplier the sim used. */
  weather: PickWeather
  /**
   * Career batter-vs-pitcher line vs *this* opposing starter. `null` when the
   * starter is TBD or the matchup has never been recorded. Drives the BvP
   * confidence factor (0.90–1.00 ramp on `ab`).
   */
  bvp: BvPRecord | null
  /** Number of the starter's recent starts available for the IP CDF. */
  pitcherStartCount: number
  /** Minutes from now until first pitch. Drives the time-to-pitch confidence factor. */
  timeToFirstPitchMin: number
  /** The 9-batter lineup the player is part of (slot + name only). */
  lineup: LineupSlotSummary[]
  /** Per-factor breakdown of the confidence multiplier. Product = `confidence`. */
  confidenceFactors: ConfidenceFactors
}

export interface Pick {
  player: { playerId: number; fullName: string; team: string; bats: 'R' | 'L' | 'S' }
  opponent: { teamId: number; abbrev: string }
  /** The probable / confirmed starter this batter is facing, or TBD when unannounced. */
  opposingPitcher: {
    id: number  // 0 when TBD
    name: string  // "TBD" when id is 0
    status: 'tbd' | 'probable' | 'confirmed'
  }
  gameId: number
  /**
   * ISO timestamp of first pitch (e.g. "2026-04-27T23:05:00Z"). Optional
   * because settled-history rows hydrated from the DB don't carry it (no
   * game_date column on locked_picks/settled_picks). Live picks always
   * have it; UI components must handle the missing case.
   */
  gameDate?: string
  lineupSlot: number
  lineupStatus: 'confirmed' | 'partial' | 'estimated'
  pMatchup: number
  pTypical: number
  edge: number
  confidence: number
  score: number
  tier: 'tracked' | 'watching'
  /**
   * The math inputs that produced confidence × edge, surfaced for the UI's
   * "show me the math" panel. Optional because settled-history rows from the
   * DB don't have these columns.
   */
  inputs?: PickInputs
}

export interface PicksResponse {
  date: string
  refreshedAt: string   // ISO timestamp
  rung1: Pick[]         // sorted by score desc
  rung2: Pick[]
  rung3: Pick[]
  meta: {
    gamesTotal: number
    fromCache: boolean
    /**
     * Game-state breakdown for the slate. Sums to gamesTotal modulo `postponed`,
     * which is excluded everywhere else in the pipeline. Surfaced in the
     * StatusBanner so users can see slate progress at a glance — useful as
     * games tip off and finish over the course of the day.
     */
    gameStates: { scheduled: number; inProgress: number; final: number; postponed: number }
  }
}

// ---------------------------------------------------------------------------
// classifyTier
// ---------------------------------------------------------------------------

export function classifyTier(args: {
  rung: Rung
  edge: number
  pMatchup: number
  confidence: number
  score: number
}): 'tracked' | 'watching' | null {
  if (
    args.confidence >= CONFIDENCE_FLOOR_TRACKED &&
    args.edge >= EDGE_FLOORS[args.rung] &&
    args.pMatchup >= PROB_FLOORS[args.rung]
  ) {
    return 'tracked'
  }
  if (args.score >= DISPLAY_FLOOR_SCORE) return 'watching'
  return null  // dropped
}

// ---------------------------------------------------------------------------
// rankPicks
// ---------------------------------------------------------------------------

export async function rankPicks(date: string): Promise<PicksResponse> {
  const games = await fetchSchedule(date)
  const gamesTotal = games.length
  const season = parseInt(date.slice(0, 4), 10)

  // Separate accumulators per rung (avoids adding `rung` to the public Pick type)
  const rung1Picks: Pick[] = []
  const rung2Picks: Pick[] = []
  const rung3Picks: Pick[] = []

  for (const game of games) {
    // Skip terminal game states — no point building picks
    if (game.status === 'postponed' || game.status === 'final') continue

    // Fetch lineups + probable pitchers in parallel
    const [homeLineup, awayLineup, probables] = await Promise.all([
      fetchLineup(game.gameId, game.homeTeam.teamId, 'home', date),
      fetchLineup(game.gameId, game.awayTeam.teamId, 'away', date),
      fetchProbablePitchers(game.gameId),
    ])

    // Compute time to first pitch (in minutes from now). Used as a confidence input.
    const firstPitchMs = new Date(game.gameDate).getTime()
    const timeToFirstPitchMin = Math.max(0, Math.round((firstPitchMs - Date.now()) / 60000))

    // Park venue name for surfacing on each pick (the actual per-batter
    // HR factor is resolved inside the per-pick loop below, since FG's
    // park factors are per-handedness).
    const venueName = getParkVenueName(game.venueId)

    // Per-game weather: fetched once, reused across all 18 picks.
    const outfieldFacingDeg = getOutfieldFacingDegrees(game.venueId)
    const weatherData = await fetchWeather(game.venueId, game.gameDate)
    const weatherResult = computeWeatherFactors({
      weather: weatherData,
      outfieldFacingDegrees: outfieldFacingDeg,
    })
    const pickWeather = {
      tempF: weatherData.tempF,
      windSpeedMph: weatherData.windSpeedMph,
      windFromDegrees: weatherData.windFromDegrees,
      outfieldFacingDegrees: outfieldFacingDeg,
      windOutMph: weatherResult.outComponentMph,
      hrMult: weatherResult.hrMult,
      controlled: weatherData.controlled,
      failure: weatherData.failure,
    }

    // Pre-compute lineup summaries (one per side).
    const homeLineupSummary: LineupSlotSummary[] = homeLineup.entries.map(e => ({
      slot: e.slot, playerId: e.player.playerId, fullName: e.player.fullName,
    }))
    const awayLineupSummary: LineupSlotSummary[] = awayLineup.entries.map(e => ({
      slot: e.slot, playerId: e.player.playerId, fullName: e.player.fullName,
    }))

    // Fetch each probable pitcher's recent-starts count + name in parallel.
    // Also fetch season stats (kPct, bbPct, hrPct, bf) and Savant hardHitRate.
    const pitcherIds = [probables.home, probables.away].filter(id => id > 0)
    const [
      homePitcherStarts,
      awayPitcherStarts,
      pitcherPeople,
      homePitcherSeasonStats,
      awayPitcherSeasonStats,
      homePitcherSavant,
      awayPitcherSavant,
      homeBullpenStats,
      awayBullpenStats,
    ] = await Promise.all([
      probables.home > 0 ? fetchPitcherRecentStarts(probables.home, 10, season).catch(() => []) : Promise.resolve([]),
      probables.away > 0 ? fetchPitcherRecentStarts(probables.away, 10, season).catch(() => []) : Promise.resolve([]),
      pitcherIds.length > 0 ? fetchPeople(pitcherIds) : Promise.resolve(new Map()),
      probables.home > 0 ? fetchPitcherSeasonStats(probables.home, season).catch(() => null) : Promise.resolve(null),
      probables.away > 0 ? fetchPitcherSeasonStats(probables.away, season).catch(() => null) : Promise.resolve(null),
      probables.home > 0 ? getPitcherStatcast(probables.home, season).catch(() => null) : Promise.resolve(null),
      probables.away > 0 ? getPitcherStatcast(probables.away, season).catch(() => null) : Promise.resolve(null),
      // Bullpen for each side: home batters face away bullpen, away batters face home bullpen.
      fetchBullpenStats(game.awayTeam.teamId, season).catch(() => null),
      fetchBullpenStats(game.homeTeam.teamId, season).catch(() => null),
    ])

    const pitcherNames = new Map<number, string>()
    for (const [id, ref] of pitcherPeople) pitcherNames.set(id, ref.fullName)

    // Hard gates evaluated per-side below (lineupStatus is per-side).
    const sides = [
      { lineup: homeLineup, opponent: game.awayTeam, isHome: true },
      { lineup: awayLineup, opponent: game.homeTeam, isHome: false },
    ] as const

    const sideJobs = sides.map(({ lineup, opponent, isHome }) => {
      const opposingStarterId = isHome ? probables.away : probables.home
      return {
        lineup,
        opponent,
        sidePassesGates: passesHardGates({
          gameStatus: game.status,
          probableStarterId: opposingStarterId > 0 ? opposingStarterId : 1,
          lineupStatus: lineup.status,
          expectedPA: 4,
        }),
      }
    })

    // Resolve all P_typical lookups across both sides in parallel.
    const playerJobs = sideJobs.flatMap(({ lineup, opponent, sidePassesGates }) =>
      lineup.entries.map(entry => ({ entry, lineup, opponent, sidePassesGates }))
    )

    // P_typical + per-batter BvP + per-batter season stats (for batterSeasonPa).
    const [pTypicalResults, bvpResults, batterSeasonResults] = await Promise.all([
      Promise.all(playerJobs.map(({ entry }) => getPTypical({ playerId: entry.player.playerId }))),
      Promise.all(playerJobs.map(({ entry, lineup }) => {
        const onHome = lineup === homeLineup
        const opposingStarterId = onHome ? probables.away : probables.home
        if (opposingStarterId <= 0) return Promise.resolve(null)  // unknown starter → no BvP
        return fetchBvP(entry.player.playerId, opposingStarterId).catch(() => null)
      })),
      Promise.all(playerJobs.map(({ entry }) =>
        fetchBatterSeasonStats(entry.player.playerId, season).catch(() => null)
      )),
    ])

    for (let i = 0; i < playerJobs.length; i++) {
      const { entry, lineup, opponent, sidePassesGates } = playerJobs[i]
      const pTypicalResult = pTypicalResults[i]
      const bvp = bvpResults[i]
      const batterSeason = batterSeasonResults[i]

      const player = entry.player

      // Per-side pitcher context
      const onHome = lineup === homeLineup
      const opposingStarterStartCount = onHome ? awayPitcherStarts.length : homePitcherStarts.length
      const opposingStarterId = onHome ? probables.away : probables.home
      const opposingPitcherSeasonStats = onHome ? awayPitcherSeasonStats : homePitcherSeasonStats
      const opposingPitcherSavant = onHome ? awayPitcherSavant : homePitcherSavant
      // Home batters face away bullpen, away batters face home bullpen.
      const opposingBullpen = onHome ? homeBullpenStats : awayBullpenStats

      // Build PitcherInputs — fall back to league-average rates when data unavailable.
      // This gives pitcherFactor = 1.0 (conservative, not a crash).
      const pitcherBf = opposingPitcherSeasonStats?.ip
        ? Math.round(opposingPitcherSeasonStats.ip * 4.3)  // ~4.3 BF/IP
        : 0
      const pitcherInputs = {
        id: opposingStarterId > 0 ? opposingStarterId : 0,
        kPct: opposingPitcherSeasonStats?.kPct ?? LG_K_PCT,
        bbPct: opposingPitcherSeasonStats?.bbPct ?? LG_BB_PCT,
        hrPct: opposingPitcherSeasonStats
          ? (opposingPitcherSeasonStats.hrPer9 / 9)  // hrPer9 → hrPct (per BF approx)
          : LG_HR_PCT,
        hardHitRate: opposingPitcherSavant?.hardHitPctAllowed ?? LG_HARD_HIT_RATE,
        bf: pitcherBf,
        recentStarts: opposingStarterStartCount,
        throws: opposingStarterId > 0
          ? (pitcherPeople.get(opposingStarterId)?.throws ?? 'R')
          : 'R',
      }

      // Pitcher throws hand (for handedness factor in computeProbToday)
      const opposingPitcherStatus: 'tbd' | 'probable' | 'confirmed' =
        opposingStarterId <= 0
          ? 'tbd'
          : game.status === 'in_progress'
            ? 'confirmed'
            : 'probable'

      const batterSeasonPa = batterSeason?.pa ?? 0

      const { factors: confidenceFactors, product: confidence } = computeConfidenceBreakdown({
        lineupStatus: lineup.status,
        bvpAB: bvp?.ab ?? 0,
        pitcherStartCount: opposingStarterStartCount,
        weatherStable: true,
        isOpener: false,
        timeToFirstPitchMin,
        batterSeasonPa,
        maxCacheAgeSec: 0,  // neutral — cache ages not tracked per-call
      })

      const inputs: PickInputs = {
        venueId: game.venueId,
        venueName: venueName !== 'Unknown park' ? venueName : game.venueName,
        parkHrFactor: getHrParkFactorForBatter(game.venueId, player.bats),
        weather: pickWeather,
        bvp,
        pitcherStartCount: opposingStarterStartCount,
        timeToFirstPitchMin,
        lineup: onHome ? homeLineupSummary : awayLineupSummary,
        confidenceFactors,
      }

      for (const rung of [1, 2, 3] as Rung[]) {
        const pTyp = pTypicalResult.atLeast[rung] ?? 0

        // Closed-form probToday replaces per-game sim cache lookup.
        const probTodayResult = computeProbTodayWithBreakdown({
          probTypical: pTyp,
          pitcher: pitcherInputs,
          venueId: game.venueId,
          batterHand: player.bats,
          weather: {
            hrMult: weatherResult.hrMult,
            controlled: weatherData.controlled,
            failure: weatherData.failure,
          },
          bullpen: opposingBullpen,
          lineupSlot: entry.slot,
        })
        const pMatchup = probTodayResult.probToday  // kept as pMatchup to avoid renaming Pick type

        const edge = computeEdge({ pMatchup, pTypical: pTyp })
        const score = computeScore({ edge, confidence })

        if (!sidePassesGates) continue

        const tier = classifyTier({ rung, edge, pMatchup, confidence, score })
        if (tier === null) continue

        const pick: Pick = {
          player: {
            playerId: player.playerId,
            fullName: player.fullName,
            team: player.team,
            bats: player.bats,
          },
          opponent: { teamId: opponent.teamId, abbrev: opponent.abbrev },
          opposingPitcher: {
            id: opposingStarterId > 0 ? opposingStarterId : 0,
            name: opposingStarterId > 0 ? (pitcherNames.get(opposingStarterId) ?? `P ${opposingStarterId}`) : 'TBD',
            status: opposingPitcherStatus,
          },
          gameId: game.gameId,
          gameDate: game.gameDate,
          lineupSlot: entry.slot,
          lineupStatus: lineup.status,
          pMatchup,
          pTypical: pTyp,
          edge,
          confidence,
          score,
          tier,
          inputs,
        }

        if (rung === 1) rung1Picks.push(pick)
        else if (rung === 2) rung2Picks.push(pick)
        else rung3Picks.push(pick)
      }
    }
  }

  const byScoreDesc = (a: Pick, b: Pick) => b.score - a.score

  // Tally game states for the slate-progress chip in the status banner.
  const gameStates = { scheduled: 0, inProgress: 0, final: 0, postponed: 0 }
  for (const g of games) {
    if (g.status === 'scheduled') gameStates.scheduled++
    else if (g.status === 'in_progress') gameStates.inProgress++
    else if (g.status === 'final') gameStates.final++
    else if (g.status === 'postponed') gameStates.postponed++
  }

  return {
    date,
    refreshedAt: new Date().toISOString(),
    rung1: rung1Picks.sort(byScoreDesc),
    rung2: rung2Picks.sort(byScoreDesc),
    rung3: rung3Picks.sort(byScoreDesc),
    meta: {
      gamesTotal,
      fromCache: false,
      gameStates,
    },
  }
}
