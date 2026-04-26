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

export interface BullpenStats {
  highLeverage: { fip: number; kPct: number; bbPct: number; hrPer9: number; vsR: OutcomeRates; vsL: OutcomeRates }
  rest:         { fip: number; kPct: number; bbPct: number; hrPer9: number; vsR: OutcomeRates; vsL: OutcomeRates }
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
