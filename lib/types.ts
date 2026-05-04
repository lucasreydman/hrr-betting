export type Rung = 1 | 2 | 3
export type Handedness = 'R' | 'L' | 'S'  // S = switch (special handling)
export type Outcome = '1B' | '2B' | '3B' | 'HR' | 'BB' | 'K' | 'OUT'

export interface PlayerRef {
  playerId: number
  fullName: string
  team: string  // 3-letter abbrev
  bats: Handedness
  throws?: Handedness
}

// --- MLB Stats API domain types ---

export interface TeamRef { teamId: number; abbrev: string; name: string }

export interface Game {
  gameId: number
  gameDate: string
  homeTeam: TeamRef
  awayTeam: TeamRef
  venueId: number
  venueName: string
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed'
  /** Live inning state — only populated when status === 'in_progress'. */
  inning?: { half: 'top' | 'bot'; number: number }
}

export interface LineupEntry { slot: number; player: PlayerRef }

export interface Lineup {
  status: 'confirmed' | 'partial' | 'estimated'
  entries: LineupEntry[]  // length 9
}

export interface Boxscore {
  gameId: number
  status: 'final' | 'in_progress' | 'scheduled'
  playerStats: Record<number, PlayerGameStats>  // keyed by playerId
}

export interface PlayerGameStats {
  hits: number
  runs: number
  rbis: number
}

export type OutcomeRates = Record<Outcome, number>

export interface PitcherStats {
  pitcherId: number
  ip: number
  fip: number
  kPct: number
  bbPct: number
  hrPer9: number
  /** HR per batter faced. The pitcher factor compares this against LG_HR_PCT
   * (also HR/BF), so it must be in the same units. Computed as HR/BF where
   * raw stats are available; falls back to LEAGUE_AVG_HR_PCT otherwise. */
  hrPct: number
  vsR?: OutcomeRates
  vsL?: OutcomeRates
}

export interface BatterStats {
  batterId: number
  pa: number
  hits: number
  outcomeRates: OutcomeRates
  vsR?: OutcomeRates
  vsL?: OutcomeRates
}

export interface StartLine { gameDate: string; ip: number }

export interface GameLogEntry {
  gameDate: string
  pa: number
  hits: number
  doubles: number
  triples: number
  homeRuns: number
  walks: number
  strikeouts: number
}

export interface BvPRecord {
  ab: number
  hits: number
  '1B': number
  '2B': number
  '3B': number
  HR: number
  BB: number
  K: number
}

// --- Baseball Savant Statcast metrics ---

export interface BatterStatcast {
  batterId: number
  barrelPct: number      // 0-1
  hardHitPct: number     // 0-1
  xwOBA: number
  xISO: number
  avgExitVelo: number
}

export interface PitcherStatcast {
  pitcherId: number
  barrelsAllowedPct: number
  hardHitPctAllowed: number
  xwOBAAllowed: number
  whiffPct: number
}

// --- Weather data ---

export interface WeatherData {
  tempF: number
  windSpeedMph: number
  windFromDegrees: number  // direction wind is coming FROM (Open-Meteo convention)
  failure: boolean         // true if fetch failed; model factors default to 1.0
  controlled: boolean      // true for roofed/retractable parks where weather is neutralized
}
