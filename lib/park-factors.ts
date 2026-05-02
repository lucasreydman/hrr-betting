/**
 * 2025 park factors, sourced from FanGraphs Guts! (`/tools/guts`).
 *
 *  - Hit-type factors (1B / 2B / 3B / HR) come from `type=pfh` (per-handedness).
 *  - K (SO) and BB factors come from `type=pf` (handedness-blended;
 *    FanGraphs doesn't publish K/BB per-handedness because the park effect
 *    on those outcomes is small and effectively non-handed).
 *  - All values are FanGraphs' "halved" form (100 = neutral, applied to a
 *    full-season line). Stored here on the 1.00 scale (i.e. divided by 100).
 *
 * Read at request time by `lib/factors/park.ts` to build a single composite
 * park multiplier (50% hit, 25% run, 25% HR), which then enters the
 * closed-form `probToday` factor product.
 *
 * Switch hitters get the average of L and R per hit-type — pragmatic v1
 * choice; a finer model would weight by the pitcher's handedness for that PA.
 *
 * To find a venue ID:
 *   GET https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=venue
 */

import type { Outcome } from './types'

interface PerHandedness { L: number; R: number }

interface ParkFactorEntry {
  /** Human-readable venue name; surfaced on the /api/picks pick detail panel. */
  name: string
  '1B': PerHandedness
  '2B': PerHandedness
  '3B': PerHandedness
  HR:   PerHandedness
  /** No handedness split — same factor for all batters. */
  BB: number
  K:  number
}

// 2025 FanGraphs Guts! data, MLB-Stats venueId-keyed.
// Hit types from /tools/guts?type=pfh   (1B/2B/3B/HR by L/R)
// K + BB from   /tools/guts?type=pf     (SO column → K, BB column)
// Values divided by 100 for use as direct multipliers.
const PARK_FACTORS_2025: Record<number, ParkFactorEntry> = {
  1: {  // Angel Stadium (LAA)
    name: 'Angel Stadium',
    '1B': { L: 0.99, R: 1.01 },
    '2B': { L: 0.95, R: 0.97 },
    '3B': { L: 1.01, R: 1.00 },
    HR:   { L: 1.07, R: 1.04 },
    BB: 1.00, K: 1.00,
  },
  2: {  // Oriole Park at Camden Yards (BAL)
    name: 'Oriole Park at Camden Yards',
    '1B': { L: 1.03, R: 1.03 },
    '2B': { L: 0.95, R: 0.98 },
    '3B': { L: 0.91, R: 1.20 },
    HR:   { L: 1.06, R: 0.94 },
    BB: 1.00, K: 0.97,
  },
  3: {  // Fenway Park (BOS)
    name: 'Fenway Park',
    '1B': { L: 1.04, R: 1.05 },
    '2B': { L: 1.18, R: 1.04 },
    '3B': { L: 1.14, R: 1.19 },
    HR:   { L: 0.95, R: 1.01 },
    BB: 1.03, K: 1.01,
  },
  4: {  // Guaranteed Rate Field (CWS)
    name: 'Guaranteed Rate Field',
    '1B': { L: 1.00, R: 1.00 },
    '2B': { L: 0.94, R: 0.98 },
    '3B': { L: 0.84, R: 0.90 },
    HR:   { L: 1.08, R: 1.03 },
    BB: 0.99, K: 1.01,
  },
  5: {  // Progressive Field (CLE)
    name: 'Progressive Field',
    '1B': { L: 1.00, R: 1.01 },
    '2B': { L: 0.99, R: 1.03 },
    '3B': { L: 0.82, R: 0.95 },
    HR:   { L: 1.03, R: 0.96 },
    BB: 1.00, K: 1.01,
  },
  7: {  // Kauffman Stadium (KC)
    name: 'Kauffman Stadium',
    '1B': { L: 1.03, R: 1.03 },
    '2B': { L: 1.07, R: 1.08 },
    '3B': { L: 1.28, R: 1.18 },
    HR:   { L: 0.92, R: 0.96 },
    BB: 1.03, K: 1.01,
  },
  10: {  // Oakland Coliseum (OAK / Athletics)
    name: 'Oakland Coliseum',
    '1B': { L: 1.00, R: 1.03 },
    '2B': { L: 1.06, R: 1.07 },
    '3B': { L: 1.05, R: 0.91 },
    HR:   { L: 1.04, R: 1.02 },
    BB: 1.00, K: 1.03,
  },
  12: {  // Tropicana Field (TB) — dome
    name: 'Tropicana Field',
    '1B': { L: 1.00, R: 1.07 },
    '2B': { L: 0.96, R: 0.96 },
    '3B': { L: 0.82, R: 1.00 },
    HR:   { L: 1.00, R: 1.08 },
    BB: 1.02, K: 1.00,
  },
  14: {  // Rogers Centre (TOR) — retractable
    name: 'Rogers Centre',
    '1B': { L: 0.97, R: 0.98 },
    '2B': { L: 1.05, R: 0.99 },
    '3B': { L: 0.88, R: 0.90 },
    HR:   { L: 0.97, R: 1.05 },
    BB: 1.00, K: 0.99,
  },
  15: {  // Chase Field (ARI) — retractable
    name: 'Chase Field',
    '1B': { L: 1.02, R: 1.03 },
    '2B': { L: 1.04, R: 1.05 },
    '3B': { L: 1.19, R: 1.20 },
    HR:   { L: 0.88, R: 0.92 },
    BB: 1.03, K: 0.99,
  },
  17: {  // Wrigley Field (CHC)
    name: 'Wrigley Field',
    '1B': { L: 1.02, R: 0.99 },
    '2B': { L: 0.99, R: 0.93 },
    '3B': { L: 1.29, R: 0.96 },
    HR:   { L: 0.97, R: 1.01 },
    BB: 1.00, K: 0.99,
  },
  19: {  // Coors Field (COL)
    name: 'Coors Field',
    '1B': { L: 1.08, R: 1.09 },
    '2B': { L: 1.08, R: 1.13 },
    '3B': { L: 1.28, R: 1.42 },
    HR:   { L: 1.05, R: 1.08 },
    BB: 1.07, K: 1.02,
  },
  22: {  // Dodger Stadium (LAD)
    name: 'Dodger Stadium',
    '1B': { L: 0.98, R: 0.95 },
    '2B': { L: 0.98, R: 0.98 },
    '3B': { L: 0.88, R: 0.81 },
    HR:   { L: 1.07, R: 1.12 },
    BB: 0.98, K: 0.97,
  },
  31: {  // PNC Park (PIT)
    name: 'PNC Park',
    '1B': { L: 1.02, R: 1.02 },
    '2B': { L: 1.07, R: 1.03 },
    '3B': { L: 0.92, R: 1.05 },
    HR:   { L: 0.95, R: 0.91 },
    BB: 1.01, K: 1.01,
  },
  32: {  // American Family Field (MIL) — retractable
    name: 'American Family Field',
    '1B': { L: 0.94, R: 0.97 },
    '2B': { L: 0.95, R: 0.97 },
    '3B': { L: 1.07, R: 1.00 },
    HR:   { L: 1.05, R: 1.02 },
    BB: 0.96, K: 1.01,
  },
  680: {  // T-Mobile Park (SEA)
    name: 'T-Mobile Park',
    '1B': { L: 0.95, R: 0.95 },
    '2B': { L: 0.93, R: 0.93 },
    '3B': { L: 0.75, R: 0.84 },
    HR:   { L: 0.93, R: 0.98 },
    BB: 0.97, K: 0.97,
  },
  2392: {  // Minute Maid Park (HOU) — retractable
    name: 'Minute Maid Park',
    '1B': { L: 1.01, R: 0.97 },
    '2B': { L: 1.01, R: 0.98 },
    '3B': { L: 1.29, R: 0.99 },
    HR:   { L: 1.02, R: 1.02 },
    BB: 0.99, K: 1.00,
  },
  2394: {  // Comerica Park (DET)
    name: 'Comerica Park',
    '1B': { L: 1.01, R: 1.01 },
    '2B': { L: 0.99, R: 1.03 },
    '3B': { L: 1.43, R: 0.96 },
    HR:   { L: 0.95, R: 0.98 },
    BB: 0.99, K: 1.02,
  },
  2395: {  // Oracle Park (SF)
    name: 'Oracle Park',
    '1B': { L: 1.00, R: 1.02 },
    '2B': { L: 1.02, R: 1.01 },
    '3B': { L: 1.06, R: 1.15 },
    HR:   { L: 0.91, R: 0.90 },
    BB: 1.04, K: 0.97,
  },
  2602: {  // Great American Ball Park (CIN)
    name: 'Great American Ball Park',
    '1B': { L: 1.01, R: 1.02 },
    '2B': { L: 1.00, R: 1.02 },
    '3B': { L: 0.90, R: 0.78 },
    HR:   { L: 1.17, R: 1.14 },
    BB: 0.99, K: 1.02,
  },
  2680: {  // Petco Park (SD)
    name: 'Petco Park',
    '1B': { L: 0.97, R: 0.97 },
    '2B': { L: 0.97, R: 0.94 },
    '3B': { L: 0.83, R: 0.89 },
    HR:   { L: 1.01, R: 1.00 },
    BB: 0.98, K: 1.00,
  },
  2681: {  // Citizens Bank Park (PHI)
    name: 'Citizens Bank Park',
    '1B': { L: 1.00, R: 0.99 },
    '2B': { L: 0.95, R: 1.00 },
    '3B': { L: 1.09, R: 0.96 },
    HR:   { L: 1.08, R: 1.04 },
    BB: 0.99, K: 1.00,
  },
  2889: {  // Busch Stadium (STL)
    name: 'Busch Stadium',
    '1B': { L: 1.00, R: 1.01 },
    '2B': { L: 0.96, R: 1.00 },
    '3B': { L: 0.84, R: 0.94 },
    HR:   { L: 0.94, R: 0.94 },
    BB: 1.01, K: 0.97,
  },
  3289: {  // Citi Field (NYM)
    name: 'Citi Field',
    '1B': { L: 0.98, R: 0.98 },
    '2B': { L: 0.98, R: 0.93 },
    '3B': { L: 0.85, R: 0.91 },
    HR:   { L: 0.97, R: 1.01 },
    BB: 0.97, K: 1.02,
  },
  3309: {  // Nationals Park (WSH)
    name: 'Nationals Park',
    '1B': { L: 1.03, R: 0.99 },
    '2B': { L: 1.01, R: 0.99 },
    '3B': { L: 0.93, R: 1.02 },
    HR:   { L: 0.99, R: 1.03 },
    BB: 1.00, K: 0.98,
  },
  3312: {  // Target Field (MIN)
    name: 'Target Field',
    '1B': { L: 1.01, R: 0.99 },
    '2B': { L: 1.02, R: 1.06 },
    '3B': { L: 0.93, R: 0.91 },
    HR:   { L: 1.02, R: 0.96 },
    BB: 0.99, K: 1.03,
  },
  3313: {  // Yankee Stadium (NYY)
    name: 'Yankee Stadium',
    '1B': { L: 0.97, R: 0.97 },
    '2B': { L: 0.95, R: 0.96 },
    '3B': { L: 0.85, R: 0.86 },
    HR:   { L: 1.07, R: 1.04 },
    BB: 0.98, K: 1.01,
  },
  4169: {  // loanDepot park (MIA) — retractable
    name: 'loanDepot park',
    '1B': { L: 1.02, R: 1.00 },
    '2B': { L: 1.00, R: 1.01 },
    '3B': { L: 1.13, R: 1.04 },
    HR:   { L: 1.01, R: 0.94 },
    BB: 1.02, K: 1.02,
  },
  4705: {  // Truist Park (ATL)
    name: 'Truist Park',
    '1B': { L: 1.02, R: 0.99 },
    '2B': { L: 0.97, R: 0.99 },
    '3B': { L: 0.91, R: 1.11 },
    HR:   { L: 0.99, R: 0.97 },
    BB: 1.01, K: 0.99,
  },
  5325: {  // Globe Life Field (TEX) — retractable
    name: 'Globe Life Field',
    '1B': { L: 0.99, R: 0.96 },
    '2B': { L: 1.01, R: 0.99 },
    '3B': { L: 0.89, R: 0.96 },
    HR:   { L: 1.05, R: 0.99 },
    BB: 0.99, K: 1.00,
  },
}

/** Pick the appropriate handedness factor for a batter. Switch hitters average L+R. */
function forBatter(hand: PerHandedness, bats: 'R' | 'L' | 'S'): number {
  if (bats === 'L') return hand.L
  if (bats === 'R') return hand.R
  return (hand.L + hand.R) / 2
}

/**
 * Returns the 7-outcome park-factor map for a batter at a given venue.
 * Hit types (1B/2B/3B/HR) use FanGraphs' per-handedness columns; BB and K
 * use the handedness-blended numbers (FG doesn't publish those by hand).
 * OUT is always neutral (1.0); the per-PA model renormalises after applying.
 *
 * Unknown venues fall back to neutral 1.00 across the board.
 */
export function getParkFactorsForBatter(
  venueId: number,
  bats: 'R' | 'L' | 'S',
): Record<Outcome, number> {
  const e = PARK_FACTORS_2025[venueId]
  if (!e) {
    return { '1B': 1, '2B': 1, '3B': 1, HR: 1, BB: 1, K: 1, OUT: 1 }
  }
  return {
    '1B': forBatter(e['1B'], bats),
    '2B': forBatter(e['2B'], bats),
    '3B': forBatter(e['3B'], bats),
    HR:   forBatter(e.HR, bats),
    BB:   e.BB,
    K:    e.K,
    OUT:  1,
  }
}

/** Returns true if park factor data exists for this venue. */
export function hasParkData(venueId: number): boolean {
  return venueId in PARK_FACTORS_2025
}

/**
 * Hit park factor for a batter at a venue (weighted 1B/2B/3B/HR by hit frequency).
 * Weights: 1B 60%, 2B 25%, 3B 10%, HR 5% (approximate MLB hit-type distribution).
 * Unknown venues return 1.
 */
export function getHitParkFactorForBatter(
  venueId: number,
  bats: 'R' | 'L' | 'S',
): number {
  const e = PARK_FACTORS_2025[venueId]
  if (!e) return 1
  return (
    0.60 * forBatter(e['1B'], bats) +
    0.25 * forBatter(e['2B'], bats) +
    0.10 * forBatter(e['3B'], bats) +
    0.05 * forBatter(e.HR, bats)
  )
}

/**
 * Run-scoring park factor for a batter at a venue (proxy via extra-base hits).
 * XBH move runners and score runs at higher rates; 2B and 3B weighted higher.
 * Weights: 2B 40%, 3B 40%, HR 20%.
 * Unknown venues return 1.
 */
export function getRunParkFactor(
  venueId: number,
  bats: 'R' | 'L' | 'S',
): number {
  const e = PARK_FACTORS_2025[venueId]
  if (!e) return 1
  return (
    0.40 * forBatter(e['2B'], bats) +
    0.40 * forBatter(e['3B'], bats) +
    0.20 * forBatter(e.HR, bats)
  )
}

/** Just the HR park factor for a batter — convenience for surfacing in /api/picks. */
export function getHrParkFactorForBatter(
  venueId: number,
  bats: 'R' | 'L' | 'S',
): number {
  const e = PARK_FACTORS_2025[venueId]
  if (!e) return 1
  return forBatter(e.HR, bats)
}

/** Human-readable venue name; falls back to "Unknown park" for unrecognised IDs. */
export function getParkVenueName(venueId: number): string {
  return PARK_FACTORS_2025[venueId]?.name ?? 'Unknown park'
}

/**
 * Legacy: handedness-blended HR factor for a venue. Kept for any callers
 * that don't know the batter's handedness. Equivalent to
 * `(HR.L + HR.R) / 2`. Returns 1.00 for unknown venues.
 */
export function getParkFactor(venueId: number): number {
  const e = PARK_FACTORS_2025[venueId]
  if (!e) return 1.00
  return (e.HR.L + e.HR.R) / 2
}
