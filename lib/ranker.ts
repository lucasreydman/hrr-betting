/**
 * lib/ranker.ts
 *
 * Composition layer that calls getPTypical + computeProbToday (closed-form),
 * then assembles ranked picks per rung for the /api/picks endpoint. Per-game
 * sim cache is no longer used — probToday is computed directly from factor
 * functions (pitcher, park, weather, handedness, bullpen, paCount, batter,
 * bvp) applied to the player's pTypical baseline.
 *
 * Live behavior overlays:
 *  - Locked picks (rows present in `locked_picks` for this slate): pinned to
 *    `tier='tracked'` and their lock-time pMatchup/pTypical/edge/confidence/
 *    score are restored, regardless of how live inputs drift.
 *  - Non-locked picks for in-progress / final games: dropped entirely. The
 *    decision window has closed; surfacing post-window noise misleads.
 *
 * Implementation notes:
 *  - hardHitRate falls back to LG_HARD_HIT_RATE when Savant pitcher data
 *    is unavailable (factor goes neutral, not crash).
 *  - timeToFirstPitchMin computed live from game.gameDate.
 *  - expectedPA hardcoded to 4 per player for the hard gates.
 *  - Hard gates evaluated once per game side (not per rung, not per player).
 */

import { computeEdge, computeScore } from './edge'
import { computeConfidenceBreakdown, passesHardGates, type ConfidenceFactors } from './confidence'
import { getPTypical } from './p-typical'
import { computeProbTodayWithBreakdown, type ProbTodayBreakdown } from './prob-today'
import { getLockedPickRowsForDate } from './tracker'
import {
  fetchSchedule,
  fetchProbablePitchers,
  fetchPitcherRecentStarts,
  fetchPitcherSeasonStats,
  fetchBatterSeasonStats,
  fetchBatterCareerStats,
  fetchBvP,
  fetchPeople,
  fetchBoxscore,
  getScheduleAgeSec,
} from './mlb-api'
import { fetchLineup } from './lineup'
import { getHrParkFactorForBatter, getParkVenueName } from './park-factors'
import { fetchWeather, getOutfieldFacingDegrees } from './weather-api'
import { computeWeatherFactors } from './weather-factors'
import { fetchBullpenStats } from './bullpen'
import { getPitcherStatcast, getBatterStatcast } from './savant-api'
import {
  EDGE_FLOORS,
  PROB_FLOORS,
  SCORE_FLOORS_TRACKED,
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
   * starter is TBD or the matchup has never been recorded. Drives both the
   * BvP confidence factor and the BvP probToday factor.
   */
  bvp: BvPRecord | null
  /** Number of the starter's current-season starts available for the IP CDF. */
  pitcherStartCount: number
  /**
   * Whether the pitcher probToday factor is active for this pick. `false`
   * when the starter is TBD (id=0) OR has fewer than 3 current-season starts
   * — both cases produce factor = 1.00 in lib/factors/pitcher.ts. Drives the
   * confidence pitcher factor's pin-to-1.00 behavior under the alignment
   * principle: no pitcher-rate signal contributing → no haircut.
   */
  pitcherActive: boolean
  /** Approximate batters-faced this season, used for the pitcher confidence
   *  ramp. Carleton's BB%/HR% stabilization is at 170 BF; hardHit at 200 BF. */
  pitcherBf: number
  /**
   * Avg innings-pitched per recent start for the opposing starter. Used by
   * the Opener heuristic and surfaced in the math panel for transparency.
   */
  pitcherAvgIp: number
  /** Minutes from now until first pitch. Drives the time-to-pitch confidence factor. */
  timeToFirstPitchMin: number
  /** Schedule-cache age in seconds — drives the dataFreshness confidence factor. */
  scheduleAgeSec: number
  /** Whether the model classified the listed starter as an opener. */
  isOpener: boolean
  /**
   * Magnitude of the weather effect, `|hrMult - 1|`. Drives the weather
   * confidence factor on a continuous ramp (1.00 at ≤0.05, 0.90 at ≥0.20).
   * Pinned at 0 when the venue is controlled (dome) or the forecast fetch
   * failed — both cases mean the model isn't leaning on a forecast at all.
   */
  weatherImpact: number
  /**
   * Human-readable category for the math panel:
   *  · dome        — venue is controlled, weather doesn't enter
   *  · no forecast — Open-Meteo fetch failed, defaulted to neutral
   *  · mild        — outdoor with HR multiplier within ±10% of neutral
   *  · volatile    — outdoor with HR multiplier outside ±10%
   */
  weatherStabilityKind: 'dome' | 'no forecast' | 'mild' | 'volatile'
  /** Batter season PA count — drives the batterSample confidence factor's
   *  current-PA ramp (top-up when career prior is strong, primary signal
   *  when career prior is weak). */
  batterSeasonPa: number
  /** Batter career PA count — used by the batterSample confidence factor to
   *  branch on whether pTypical's stabilizeRates is using a strong career
   *  prior (≥200 career PA) versus league-average fallback. */
  batterCareerPa: number
  /** Opponent bullpen IP this season — drives the bullpen confidence factor.
   *  `null` mirrors the bullpen probToday factor's null-input case (factor
   *  inactive → confidence pins to 1.00). */
  bullpenIp: number | null
  /** The 9-batter lineup the player is part of (slot + name only). */
  lineup: LineupSlotSummary[]
  /** Per-factor breakdown of the confidence multiplier. Product = `confidence`. */
  confidenceFactors: ConfidenceFactors
  /** Per-factor breakdown of the closed-form probToday multiplier product. */
  probTodayFactors: ProbTodayBreakdown['factors']
  /**
   * Batter Statcast snapshot used by the batter-quality factor. `null` when
   * Savant data isn't available for this player. Surfaced in the math panel.
   */
  batterStatcast: { barrelPct: number; hardHitPct: number; xwOBA: number } | null
  /**
   * Opposing starter's season rates and Statcast snapshot. Both feed the
   * pitcher-quality factor and are surfaced in the math panel. `null` when
   * the starter is TBD or stats aren't available. Only `hardHitPctAllowed`
   * is consumed by the factor today; xwOBA / barrel% allowed are fetched
   * but not yet wired in (would partly double-count hard-hit until weights
   * are recalibrated against settled history).
   */
  pitcherSeason: { kPct: number; bbPct: number; hrPer9: number; ip: number } | null
  pitcherStatcast: { hardHitPctAllowed: number } | null
}

export interface Pick {
  player: { playerId: number; fullName: string; team: string; teamId: number; bats: 'R' | 'L' | 'S' }
  /** Whether the player's team is the home side. */
  isHome: boolean
  opponent: { teamId: number; abbrev: string }
  /** The probable / confirmed starter this batter is facing, or TBD when unannounced. */
  opposingPitcher: {
    id: number  // 0 when TBD
    name: string  // "TBD" when id is 0
    status: 'tbd' | 'probable' | 'confirmed'
    /** Pitcher throws hand. Undefined for TBD starters or legacy locked-pick rows. */
    throws?: 'R' | 'L' | 'S'
  }
  gameId: number
  /** Live game state — drives the LIVE / FINAL indicator in the UI. */
  gameStatus?: 'scheduled' | 'in_progress' | 'final' | 'postponed'
  /** Live inning info — only present when gameStatus === 'in_progress'. */
  gameInning?: { half: 'top' | 'bot'; number: number }
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
   * True when the pick has already been snapshotted into `locked_picks`
   * for this slate by `/api/lock`. The live ranker treats a locked pick
   * as `tracked` regardless of current real-time confidence AND restores
   * its lock-time top-line numbers — once a pick is frozen, neither
   * weather updates, schedule-cache drift, nor post-game boxscore data
   * can move pMatchup/pTypical/edge/confidence/score on the live board.
   * Undefined / false for picks whose lock window hasn't fired yet
   * (lock fires at ≤ 30 min before first pitch).
   */
  wasLocked?: boolean
  /**
   * Live-settled outcome for picks whose game has finalised. Populated by
   * the ranker after the main score loop, by fetching the boxscore and
   * comparing the player's actual HRR total to the rung. Undefined for
   * non-final games.
   */
  outcome?: 'HIT' | 'MISS' | 'PENDING'
  /** Player's actual HRR total from the boxscore, when known. */
  actualHRR?: number
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
    /**
     * Maximum age (in seconds) of each class of cached input data used to
     * compute this response. 0 = data freshly fetched or not yet wired.
     * TODO: wire real values from the data adapters once cache-age headers land.
     */
    cacheAges: {
      lineupMaxSec: number
      weatherMaxSec: number
      probableMaxSec: number
      typicalMaxSec: number
    }
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
    args.pMatchup >= PROB_FLOORS[args.rung] &&
    args.score >= SCORE_FLOORS_TRACKED[args.rung]
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

  // Schedule cache age — feeds the confidence `dataFreshness` factor below.
  // null means "unknown freshness" (no meta record yet); we pass 0 in that
  // case so the factor is neutral, not penalising for missing telemetry.
  // Locked-pick overlay: pulls FULL rows for every pick that's already
  // been snapshotted into `locked_picks` this slate. We use the rows for
  // a two-part overlay on the live response:
  //   1. tier = 'tracked' is forced regardless of current floors
  //   2. p_matchup / p_typical / edge / confidence / score are restored
  //      to their lock-time values so the displayed top-line numbers
  //      don't drift after the pick was committed.
  // The math panel's factor breakdown still shows LIVE values (factors
  // aren't stored in locked_picks), so the reader can see what's changed
  // since lock — but the final probability/edge/confidence are pinned.
  const [scheduleAgeSec, lockedRows] = await Promise.all([
    getScheduleAgeSec(date).then(age => age ?? 0),
    getLockedPickRowsForDate(date),
  ])

  // Separate accumulators per rung (avoids adding `rung` to the public Pick type)
  const rung1Picks: Pick[] = []
  const rung2Picks: Pick[] = []
  const rung3Picks: Pick[] = []

  // Process all games in parallel. The previous serial `for (const game of
  // games)` made wall-clock time = sum(per-game times); parallelising drops
  // it to max(per-game times). Critical for /api/refresh staying under
  // Vercel's 10s gateway timeout once finalised games started feeding the
  // pipeline (a slate with 9 finals × ~500ms serial = 4.5s of pure waiting).
  const perGameResults = await Promise.all(
    games
      .filter(g => g.status !== 'postponed')
      .map(async game => {
    const localR1: Pick[] = []
    const localR2: Pick[] = []
    const localR3: Pick[] = []

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

    // The confidence "weather" factor is a continuous ramp on |hrMult - 1|:
    // 1.00 at neutral conditions, 0.90 at ±20% impact (see lib/confidence.ts).
    // Two cases pin to 0 (no exposure to forecast error):
    //  · the venue is controlled (dome / closed roof) — weather doesn't enter
    //  · the forecast fetch failed — model already neutralised hrMult to 1.0,
    //    so a confidence ding would be double-counting
    const weatherImpact =
      weatherData.controlled || weatherData.failure
        ? 0
        : Math.abs(weatherResult.hrMult - 1)
    const weatherStabilityKind: PickInputs['weatherStabilityKind'] =
      weatherData.controlled
        ? 'dome'
        : weatherData.failure
          ? 'no forecast'
          : weatherImpact < 0.10
            ? 'mild'
            : 'volatile'

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
      homePitcherPriorSeason,
      awayPitcherPriorSeason,
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
      // Prior-season pitcher stats. Feeds the pitcher factor's cold-start
      // fallback (current < 3 starts → stabilize against last year's rates
      // instead of league avg) and the opener detection's reliever-history
      // path (pitcher who was predominantly a reliever last year and is
      // "starting" today is almost certainly an opener).
      probables.home > 0 ? fetchPitcherSeasonStats(probables.home, season - 1).catch(() => null) : Promise.resolve(null),
      probables.away > 0 ? fetchPitcherSeasonStats(probables.away, season - 1).catch(() => null) : Promise.resolve(null),
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
        isHome,
        sidePassesGates: passesHardGates({
          gameStatus: game.status,
          probableStarterId: opposingStarterId > 0 ? opposingStarterId : 1,
          lineupStatus: lineup.status,
          expectedPA: 4,
        }),
      }
    })

    // Resolve all P_typical lookups across both sides in parallel.
    const playerJobs = sideJobs.flatMap(({ lineup, opponent, isHome, sidePassesGates }) =>
      lineup.entries.map(entry => ({ entry, lineup, opponent, isHome, sidePassesGates }))
    )

    // P_typical + per-batter BvP + per-batter season stats + per-batter Statcast.
    // All four are independent reads against the slate-aligned cache layer, so
    // running them in parallel keeps the per-game block close to one round-trip
    // even with the additional Savant lookup.
    const [
      pTypicalResults,
      bvpResults,
      batterSeasonResults,
      batterStatcastResults,
      batterCareerResults,
    ] = await Promise.all([
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
      Promise.all(playerJobs.map(({ entry }) =>
        getBatterStatcast(entry.player.playerId, season).catch(() => null)
      )),
      // Career PA — drives the batterSample confidence factor's "do we have
      // a strong career prior" branch. fetchBatterCareerStats is cached 30
      // days on success, 5 minutes on failure, so this only hits MLB Stats
      // once per batter per month in steady state. Same data is used by
      // p-typical to choose the stabilization prior, so the model and the
      // confidence factor are reading the same career signal.
      Promise.all(playerJobs.map(({ entry }) =>
        fetchBatterCareerStats(entry.player.playerId).catch(() => null)
      )),
    ])

    for (let i = 0; i < playerJobs.length; i++) {
      const { entry, lineup, opponent, isHome, sidePassesGates } = playerJobs[i]
      const pTypicalResult = pTypicalResults[i]
      const bvp = bvpResults[i]
      const batterSeason = batterSeasonResults[i]
      const batterStatcast = batterStatcastResults[i]
      const batterCareer = batterCareerResults[i]

      const player = entry.player

      // Per-side pitcher context
      const onHome = lineup === homeLineup
      const opposingStarts = onHome ? awayPitcherStarts : homePitcherStarts
      const opposingStarterStartCount = opposingStarts.length
      const opposingStarterId = onHome ? probables.away : probables.home
      const opposingPitcherSeasonStats = onHome ? awayPitcherSeasonStats : homePitcherSeasonStats
      const opposingPitcherSavant = onHome ? awayPitcherSavant : homePitcherSavant
      const opposingPitcherPriorSeason = onHome ? awayPitcherPriorSeason : homePitcherPriorSeason
      // Home batters face away bullpen, away batters face home bullpen.
      const opposingBullpen = onHome ? homeBullpenStats : awayBullpenStats

      // Opener detection — two paths:
      //  1. **In-season pattern**: ≥ 3 current-season starts averaging < 2 IP.
      //     Catches established opener strategies (Tampa-style / Houston-style).
      //  2. **Reliever-history**: pitcher was predominantly a reliever last
      //     season AND current-season usage is consistent with opener pattern
      //     (either no fresh starts yet, or fresh starts also averaging short).
      //     Catches the "first opener game of the season for a known reliever"
      //     case the in-season pattern can't see yet (needs 3 starts to fire).
      //
      // Why the in-season-IP guard on path 2: a former reliever (e.g., Payton
      // Tolle in 2025) who's been moved to the rotation in 2026 will have
      // GS/G < 0.5 last year but be pitching 5+ IP today. Without the guard,
      // the prior-season role would override the obvious current-season
      // starter behavior. With the guard, we only fire on path 2 when
      // current-season usage doesn't contradict the historical role.
      //
      // Free-data limit: MLB Stats doesn't expose a beat-reporter "this is
      // an opener game" flag. The two heuristics cover ~80% of opener
      // strategies using cached data we already pull; the remaining ~20%
      // (true rookie called up to start a bullpen game with no prior-season
      // role data) needs a paid feed to detect cleanly. Acceptable miss rate.
      const avgIp = opposingStarts.length > 0
        ? opposingStarts.reduce((acc, s) => acc + (s.ip || 0), 0) / opposingStarts.length
        : 0
      const inSeasonOpener = opposingStarts.length >= 3 && avgIp < 2.0
      const priorSeasonGS = opposingPitcherPriorSeason?.gamesStarted ?? 0
      const priorSeasonG = opposingPitcherPriorSeason?.gamesPlayed ?? 0
      // ≥ 5 prior-season games guards against tiny-sample false positives
      // (a pitcher with 1 G / 0 GS in 2025 is likely a rookie callup, not a
      // career reliever). 0.5 is the conventional reliever/starter cutoff.
      const priorSeasonRelieverFlag =
        priorSeasonG >= 5 && priorSeasonGS / priorSeasonG < 0.5
      // Current-season behavior consistent with opener: either no fresh
      // starts (can't contradict role yet) OR fresh starts averaging < 3 IP
      // (consistent with opener-length outings). 3.0 IP is the threshold —
      // a true opener throws 1-2 IP; a regular starter throws 5-6+; the gap
      // around 3 is small and rare in practice.
      const currentLooksLikeOpener =
        opposingStarts.length === 0 || avgIp < 3.0
      const isOpener =
        inSeasonOpener ||
        (priorSeasonRelieverFlag && opposingStarterStartCount < 3 && currentLooksLikeOpener)

      // Build PitcherInputs — fall back to league-average rates when data unavailable.
      // This gives pitcherFactor = 1.0 (conservative, not a crash).
      const pitcherBf = opposingPitcherSeasonStats?.ip
        ? Math.round(opposingPitcherSeasonStats.ip * 4.3)  // ~4.3 BF/IP
        : 0
      // Prior-season BF for the pitcher factor's cold-start fallback. ~50 BF
      // (~12 starts) is the activation threshold inside computePitcherFactor;
      // we always pass the data and let the factor decide whether to use it.
      const priorSeasonBf = opposingPitcherPriorSeason?.ip
        ? Math.round(opposingPitcherPriorSeason.ip * 4.3)
        : 0
      const pitcherInputs = {
        id: opposingStarterId > 0 ? opposingStarterId : 0,
        kPct: opposingPitcherSeasonStats?.kPct ?? LG_K_PCT,
        bbPct: opposingPitcherSeasonStats?.bbPct ?? LG_BB_PCT,
        // hrPct is HR per BF (matches LG_HR_PCT units). Computed correctly
        // in mlb-api.ts:fetchPitcherSeasonStats from raw HR + BF; the v1 of
        // this code did `hrPer9 / 9` which gave HR/inning instead, pegging
        // every pitcher at the 2.0 quality cap.
        hrPct: opposingPitcherSeasonStats?.hrPct ?? LG_HR_PCT,
        hardHitRate: opposingPitcherSavant?.hardHitPctAllowed ?? LG_HARD_HIT_RATE,
        bf: pitcherBf,
        recentStarts: opposingStarterStartCount,
        // Cold-start fallback: when current-season has < 3 starts AND we
        // have ≥50 prior-season BF, pitcher factor stabilises against
        // prior-season rates instead of league avg. See lib/factors/pitcher.ts.
        ...(opposingPitcherPriorSeason && priorSeasonBf >= 50
          ? {
              priorSeason: {
                kPct: opposingPitcherPriorSeason.kPct,
                bbPct: opposingPitcherPriorSeason.bbPct,
                hrPct: opposingPitcherPriorSeason.hrPct,
                hardHitRate: LG_HARD_HIT_RATE,  // prior-season Savant hardHit not fetched; use league avg
                bf: priorSeasonBf,
              },
            }
          : {}),
        throws: opposingStarterId > 0
          ? (pitcherPeople.get(opposingStarterId)?.throws ?? 'R')
          : 'R',
      }

      // Opposing pitcher is "confirmed" when any of these signals fire:
      //   1. Game is in_progress / final — pitcher has actually started
      //   2. The pitcher's own team has posted their lineup card (manager
      //      filed a batting order against the announced pitcher → locked in)
      //   3. The opposing team has posted their lineup card (manager
      //      committed to facing this specific pitcher → locked in)
      //   4. The game is in Pre-Game / Warmup state (within ~30 min of first
      //      pitch, late changes don't happen)
      //
      // Why so many signals: MLB Stats API doesn't expose a beat-reporter-
      // grade "confirmed" flag like Yahoo or Rotowire. Lineup posting is the
      // strongest signal we have, but it lags real-world confirmation by
      // 30–60 min. Using either lineup card + the imminent-game state
      // closes most of the gap.
      const homeLineupConfirmed = homeLineup.status === 'confirmed'
      const awayLineupConfirmed = awayLineup.status === 'confirmed'
      const eitherLineupConfirmed = homeLineupConfirmed || awayLineupConfirmed
      const gameImminent = timeToFirstPitchMin <= 30
      const opposingPitcherStatus: 'tbd' | 'probable' | 'confirmed' =
        opposingStarterId <= 0
          ? 'tbd'
          : game.status === 'in_progress' || game.status === 'final'
            ? 'confirmed'
            : eitherLineupConfirmed || gameImminent
              ? 'confirmed'
              : 'probable'

      const batterSeasonPa = batterSeason?.pa ?? 0
      const batterCareerPa = batterCareer?.pa ?? 0

      // Pitcher activation: factor produces a non-1.00 value when we have
      // any usable rate signal — either ≥3 current-season starts (normal
      // path) OR ≥50 BF of prior-season data (cold-start fallback). The
      // ranker mirrors the gate inside lib/factors/pitcher.ts so the
      // confidence factor's pin-when-inactive behavior stays in sync.
      const pitcherHasPriorSeasonRates =
        (opposingPitcherPriorSeason?.ip ?? 0) * 4.3 >= 50
      const pitcherActive =
        opposingStarterId > 0 &&
        (opposingStarterStartCount >= 3 || pitcherHasPriorSeasonRates)

      // Detect "real Statcast data" — the parser returns null when the
      // player isn't in the Savant CSV; for borderline cases (recent
      // callups before Savant syndicates them) the record may exist with
      // all-zero fields. Treat all-zero as not-present.
      const batterStatcastPresent =
        !!batterStatcast &&
        (batterStatcast.barrelPct > 0 ||
         batterStatcast.hardHitPct > 0 ||
         batterStatcast.xwOBA > 0)

      const { factors: confidenceFactors, product: confidence } = computeConfidenceBreakdown({
        lineupStatus: lineup.status,
        bvpAB: bvp?.ab ?? 0,
        pitcherActive,
        pitcherBf,
        weatherImpact,
        bullpenIp: opposingBullpen?.ip ?? null,
        timeToFirstPitchMin,
        isOpener,
        batterSeasonPa,
        batterCareerPa,
        batterStatcastPresent,
        maxCacheAgeSec: scheduleAgeSec,
      })

      // Per-batter shared inputs. probTodayFactors is added per-rung below.
      const baseInputs: Omit<PickInputs, 'probTodayFactors'> = {
        venueId: game.venueId,
        venueName: venueName !== 'Unknown park' ? venueName : game.venueName,
        parkHrFactor: getHrParkFactorForBatter(game.venueId, player.bats),
        weather: pickWeather,
        bvp,
        pitcherStartCount: opposingStarterStartCount,
        pitcherActive,
        pitcherBf,
        pitcherAvgIp: avgIp,
        timeToFirstPitchMin,
        scheduleAgeSec,
        isOpener,
        weatherImpact,
        weatherStabilityKind,
        batterSeasonPa,
        batterCareerPa,
        bullpenIp: opposingBullpen?.ip ?? null,
        lineup: onHome ? homeLineupSummary : awayLineupSummary,
        confidenceFactors,
        batterStatcast: batterStatcast
          ? {
              barrelPct: batterStatcast.barrelPct,
              hardHitPct: batterStatcast.hardHitPct,
              xwOBA: batterStatcast.xwOBA,
            }
          : null,
        pitcherSeason: opposingPitcherSeasonStats
          ? {
              kPct: opposingPitcherSeasonStats.kPct,
              bbPct: opposingPitcherSeasonStats.bbPct,
              hrPer9: opposingPitcherSeasonStats.hrPer9,
              ip: opposingPitcherSeasonStats.ip,
            }
          : null,
        pitcherStatcast: opposingPitcherSavant
          ? { hardHitPctAllowed: opposingPitcherSavant.hardHitPctAllowed }
          : null,
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
            factors: weatherResult.factors,
          },
          bullpen: opposingBullpen,
          lineupSlot: entry.slot,
          bvp,
          batterStatcast,
        })
        const inputs: PickInputs = { ...baseInputs, probTodayFactors: probTodayResult.factors }
        const pMatchup = probTodayResult.probToday  // kept as pMatchup to avoid renaming Pick type

        const edge = computeEdge({ pMatchup, pTypical: pTyp })
        const score = computeScore({ pMatchup, pTypical: pTyp, confidence })

        if (!sidePassesGates) continue

        // Locked-pick overlay: once a pick has been written into
        // `locked_picks` by /api/lock for this slate, both its tier
        // AND its top-line numbers (p_matchup, p_typical, edge,
        // confidence, score) are pinned to the lock-time values. The
        // user sees the same probability/edge/confidence they committed
        // to at lock-time, even as live inputs drift. The probability
        // factor breakdown in the math panel still shows live values
        // (factors aren't stored in locked_picks) so the reader can
        // see what's changed — but the final numbers don't move.
        const lockKey = `${game.gameId}:${player.playerId}:${rung}`
        const lockedRow = lockedRows.get(lockKey)
        const wasLocked = !!lockedRow

        // Locked-pick numeric overlay: prefer the snapshot values when
        // the pick is locked. classifyTier still runs against the LIVE
        // values to determine baseTier (informational; overridden when
        // wasLocked), but the displayed Pick reflects the locked state.
        const finalPMatchup = lockedRow?.p_matchup ?? pMatchup
        const finalPTypical = lockedRow?.p_typical ?? pTyp
        const finalEdge = lockedRow?.edge ?? edge
        const finalConfidence = lockedRow?.confidence ?? confidence
        const finalScore = lockedRow?.score ?? score

        const baseTier = classifyTier({ rung, edge, pMatchup, confidence, score })

        // Post-first-pitch handling:
        //
        //  · Locked picks → tier='tracked' (frozen, badge 🔒). Settlement
        //    uses the locked snapshot regardless of how live data drifts.
        //
        //  · Non-locked picks → DROPPED entirely once the game is live.
        //    The lock window already passed; if a pick wasn't committed
        //    during it, surfacing post-game gymnastics (boxscore stats
        //    pushing confidence over the floor, schedule-cache shifts,
        //    etc.) just adds noise. The user's decision-window has
        //    closed for any pick that didn't lock.
        //
        // Pre-first-pitch: classifyTier as normal — picks can be 🎯 or 👀
        // depending on whether they currently meet the tracked floors.
        const gameIsLive = game.status === 'in_progress' || game.status === 'final'
        if (gameIsLive && !wasLocked) continue

        const tier: 'tracked' | 'watching' | null = wasLocked ? 'tracked' : baseTier
        if (tier === null) continue

        const pick: Pick = {
          player: {
            playerId: player.playerId,
            fullName: player.fullName,
            team: player.team,
            teamId: isHome ? game.homeTeam.teamId : game.awayTeam.teamId,
            bats: player.bats,
          },
          isHome,
          opponent: { teamId: opponent.teamId, abbrev: opponent.abbrev },
          opposingPitcher: {
            id: opposingStarterId > 0 ? opposingStarterId : 0,
            name: opposingStarterId > 0 ? (pitcherNames.get(opposingStarterId) ?? `P ${opposingStarterId}`) : 'TBD',
            status: opposingPitcherStatus,
            ...(opposingStarterId > 0 && pitcherPeople.get(opposingStarterId)?.throws
              ? { throws: pitcherPeople.get(opposingStarterId)!.throws }
              : {}),
          },
          gameId: game.gameId,
          gameStatus: game.status,
          ...(game.inning ? { gameInning: game.inning } : {}),
          gameDate: game.gameDate,
          lineupSlot: entry.slot,
          lineupStatus: lineup.status,
          pMatchup: finalPMatchup,
          pTypical: finalPTypical,
          edge: finalEdge,
          confidence: finalConfidence,
          score: finalScore,
          tier,
          ...(wasLocked ? { wasLocked: true } : {}),
          inputs,
        }

        if (rung === 1) localR1.push(pick)
        else if (rung === 2) localR2.push(pick)
        else localR3.push(pick)
      }
    }

    return { r1: localR1, r2: localR2, r3: localR3 }
      }),
  )

  for (const { r1, r2, r3 } of perGameResults) {
    rung1Picks.push(...r1)
    rung2Picks.push(...r2)
    rung3Picks.push(...r3)
  }

  const byScoreDesc = (a: Pick, b: Pick) => b.score - a.score

  // Live-settle picks for final games. Closes the lifecycle gap between
  // game-end and the daily settle cron at 3:15 AM ET — picks now show ✓ HIT
  // or ✗ MISS on the live board the moment the boxscore is final, instead of
  // disappearing for the rest of the slate.
  const finalGameIds = new Set(games.filter(g => g.status === 'final').map(g => g.gameId))
  if (finalGameIds.size > 0) {
    const allPicks: Pick[] = [...rung1Picks, ...rung2Picks, ...rung3Picks]
    const finalPicks = allPicks.filter(p => finalGameIds.has(p.gameId))
    if (finalPicks.length > 0) {
      const distinctGameIds = [...new Set(finalPicks.map(p => p.gameId))]
      const boxByGame = new Map<number, Awaited<ReturnType<typeof fetchBoxscore>>>()
      await Promise.all(
        distinctGameIds.map(async gid => {
          try {
            boxByGame.set(gid, await fetchBoxscore(gid))
          } catch {
            // Boxscore unavailable — leave outcome undefined; UI shows FINAL with no badge.
          }
        }),
      )
      // Need rung context for the HIT/MISS comparison; iterate per-rung arrays.
      const rungArrays: Array<[Rung, Pick[]]> = [[1, rung1Picks], [2, rung2Picks], [3, rung3Picks]]
      for (const [rung, arr] of rungArrays) {
        for (const pick of arr) {
          if (!finalGameIds.has(pick.gameId)) continue
          const box = boxByGame.get(pick.gameId)
          if (!box || box.status !== 'final') {
            pick.outcome = 'PENDING'
            continue
          }
          const stats = box.playerStats[pick.player.playerId]
          if (!stats) {
            // Player didn't appear in the boxscore (didn't bat). Counts as a MISS
            // — the rung threshold (≥1 HRR) wasn't reached.
            pick.outcome = 'MISS'
            pick.actualHRR = 0
            continue
          }
          const hrr = stats.hits + stats.runs + stats.rbis
          pick.actualHRR = hrr
          pick.outcome = hrr >= rung ? 'HIT' : 'MISS'
        }
      }
    }
  }

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
      // TODO: wire real cache ages from data adapters once cache-age headers land.
      cacheAges: { lineupMaxSec: 0, weatherMaxSec: 0, probableMaxSec: 0, typicalMaxSec: 0 },
    },
  }
}
