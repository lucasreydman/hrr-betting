import type { Pick } from '@/lib/ranker'

type PickWithRung = Pick & { rung: 1 | 2 | 3 }

/**
 * Flat one-row-per-pick CSV serialization of the live board, including
 * every input the model used to produce each pick. The output is wide
 * (~60 columns) on purpose: it has to be self-contained enough that a
 * reader looking only at the CSV can reconstruct what the model saw and
 * spot per-factor anomalies without round-tripping back to the live UI.
 *
 * All numeric fields keep full precision (no premature rounding) — error
 * triage often hinges on the 5th decimal, e.g. a confidence factor that
 * looks like 0.85 in the UI but is actually 0.8499 and wouldn't pass the
 * 0.85 floor.
 */

const HEADERS = [
  // Identity
  'slate_date',
  'game_id',
  'first_pitch_iso',
  'venue_id',
  'venue_name',
  'game_status',
  'inning_half',
  'inning_number',
  'batter_id',
  'batter_name',
  'batter_team',
  'batter_bats',
  'is_home',
  'opponent_team_id',
  'opponent_abbrev',
  'lineup_slot',
  'lineup_status',
  'pitcher_id',
  'pitcher_name',
  'pitcher_status',
  'pitcher_throws',
  'rung',
  'tier',
  'was_locked',
  'outcome',
  'actual_hrr',
  // Top-line numbers
  'p_typical',
  'p_matchup',
  'edge',
  'confidence',
  'score',
  // probToday factors (8)
  'pf_pitcher',
  'pf_park',
  'pf_weather',
  'pf_handedness',
  'pf_bullpen',
  'pf_paCount',
  'pf_bvp',
  'pf_batter',
  // Confidence factors (9)
  'cf_lineup',
  'cf_bvp',
  'cf_pitcher',
  'cf_weather',
  'cf_bullpen',
  'cf_batterSample',
  'cf_batterStatcast',
  'cf_opener',
  'cf_dataFreshness',
  // Inputs — park / weather
  'park_hr_factor',
  'weather_temp_f',
  'weather_wind_mph',
  'weather_wind_from_deg',
  'weather_outfield_deg',
  'weather_wind_out_mph',
  'weather_hr_mult',
  'weather_controlled',
  'weather_failure',
  'weather_stability_kind',
  'weather_impact',
  // Inputs — BvP
  'bvp_ab',
  'bvp_h',
  'bvp_hr',
  'bvp_bb',
  'bvp_k',
  // Inputs — pitcher
  'pitcher_start_count',
  'pitcher_active',
  'pitcher_bf',
  'pitcher_avg_ip',
  'is_opener',
  'pitcher_k_pct',
  'pitcher_bb_pct',
  'pitcher_hr_per9',
  'pitcher_ip',
  'pitcher_hard_hit_allowed',
  // Inputs — batter
  'batter_season_pa',
  'batter_career_pa',
  'batter_barrel_pct',
  'batter_hard_hit_pct',
  'batter_xwoba',
  // Inputs — misc
  'bullpen_ip',
  'time_to_first_pitch_min',
  'schedule_age_sec',
] as const

type CellValue = string | number | boolean | null | undefined

/** RFC 4180-ish escape: wrap in quotes if the value contains a comma,
 *  quote, or newline, doubling any embedded quotes. Numbers/booleans pass
 *  through unquoted. null/undefined → empty string. */
function escapeCell(v: CellValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    return String(v)
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const s = String(v)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function pickToRow(pick: PickWithRung, slateDate: string): CellValue[] {
  const inputs = pick.inputs
  const w = inputs?.weather
  const cf = inputs?.confidenceFactors
  const pf = inputs?.probTodayFactors
  const bvp = inputs?.bvp
  const ps = inputs?.pitcherSeason
  const bs = inputs?.batterStatcast
  const psc = inputs?.pitcherStatcast

  return [
    slateDate,
    pick.gameId,
    pick.gameDate,
    inputs?.venueId,
    inputs?.venueName,
    pick.gameStatus,
    pick.gameInning?.half,
    pick.gameInning?.number,
    pick.player.playerId,
    pick.player.fullName,
    pick.player.team,
    pick.player.bats,
    pick.isHome,
    pick.opponent.teamId,
    pick.opponent.abbrev,
    pick.lineupSlot,
    pick.lineupStatus,
    pick.opposingPitcher.id,
    pick.opposingPitcher.name,
    pick.opposingPitcher.status,
    pick.opposingPitcher.throws,
    pick.rung,
    pick.tier,
    pick.wasLocked ?? false,
    pick.outcome,
    pick.actualHRR,
    // Top-line
    pick.pTypical,
    pick.pMatchup,
    pick.edge,
    pick.confidence,
    pick.score,
    // probToday factors
    pf?.pitcher,
    pf?.park,
    pf?.weather,
    pf?.handedness,
    pf?.bullpen,
    pf?.paCount,
    pf?.bvp,
    pf?.batter,
    // Confidence factors
    cf?.lineup,
    cf?.bvp,
    cf?.pitcher,
    cf?.weather,
    cf?.bullpen,
    cf?.batterSample,
    cf?.batterStatcast,
    cf?.opener,
    cf?.dataFreshness,
    // Park / weather inputs
    inputs?.parkHrFactor,
    w?.tempF,
    w?.windSpeedMph,
    w?.windFromDegrees,
    w?.outfieldFacingDegrees,
    w?.windOutMph,
    w?.hrMult,
    w?.controlled,
    w?.failure,
    inputs?.weatherStabilityKind,
    inputs?.weatherImpact,
    // BvP inputs
    bvp?.ab,
    bvp?.hits,
    bvp?.HR,
    bvp?.BB,
    bvp?.K,
    // Pitcher inputs
    inputs?.pitcherStartCount,
    inputs?.pitcherActive,
    inputs?.pitcherBf,
    inputs?.pitcherAvgIp,
    inputs?.isOpener,
    ps?.kPct,
    ps?.bbPct,
    ps?.hrPer9,
    ps?.ip,
    psc?.hardHitPctAllowed,
    // Batter inputs
    inputs?.batterSeasonPa,
    inputs?.batterCareerPa,
    bs?.barrelPct,
    bs?.hardHitPct,
    bs?.xwOBA,
    // Misc
    inputs?.bullpenIp,
    inputs?.timeToFirstPitchMin,
    inputs?.scheduleAgeSec,
  ]
}

/**
 * Build the full CSV string for a list of picks. Header row first, then
 * one row per pick. Caller is responsible for ordering — pass the exact
 * slice the user is looking at on the board so the CSV mirrors the UI.
 */
export function buildBoardCsv(picks: PickWithRung[], slateDate: string): string {
  const rows: string[] = [HEADERS.join(',')]
  for (const pick of picks) {
    rows.push(pickToRow(pick, slateDate).map(escapeCell).join(','))
  }
  return rows.join('\r\n') + '\r\n'
}

export const BOARD_CSV_HEADERS = HEADERS
