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
