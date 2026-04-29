// lib/team-names.ts
// MLB team ID → nickname (the part of the team name after the city).
// IDs come from the MLB Stats API and are stable.
export const TEAM_NICKNAMES: Record<number, string> = {
  108: 'Angels',        109: 'Diamondbacks', 110: 'Orioles',
  111: 'Red Sox',       112: 'Cubs',         113: 'Reds',
  114: 'Guardians',     115: 'Rockies',      116: 'Tigers',
  117: 'Astros',        118: 'Royals',       119: 'Dodgers',
  120: 'Nationals',     121: 'Mets',         133: 'Athletics',
  134: 'Pirates',       135: 'Padres',       136: 'Mariners',
  137: 'Giants',        138: 'Cardinals',    139: 'Rays',
  140: 'Rangers',       141: 'Blue Jays',    142: 'Twins',
  143: 'Phillies',      144: 'Braves',       145: 'White Sox',
  146: 'Marlins',       147: 'Yankees',      158: 'Brewers',
}

export function getTeamNickname(teamId: number): string {
  return TEAM_NICKNAMES[teamId] ?? `Team ${teamId}`
}
