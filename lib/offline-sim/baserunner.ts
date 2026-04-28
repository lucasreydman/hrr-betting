import type { Outcome } from '../types'

export interface BasesState { b1: number | null; b2: number | null; b3: number | null }
export const EMPTY_BASES: BasesState = { b1: null, b2: null, b3: null }

export interface OutcomeResult {
  bases: BasesState
  runsScored: number[]  // playerIds who scored on this play (incl. batter if applicable)
  rbis: number
  outsRecorded: number  // 0 for hits/walks/HR; 1 for K/OUT/sac fly; 2 for double plays (rare; v1: always 1 for OUT)
}

// Probabilities derived from public run-expectancy tables (Tom Tango, The Book).
// v1 uses these as fixed constants; spec §11 lists this as a calibration target.
const SCORE_FROM_2ND_ON_1B = 0.62
const SCORE_FROM_1ST_ON_2B = 0.40
const SCORE_FROM_3RD_ON_OUT = 0.30  // sac fly / productive out
const ADVANCE_TO_3B_FROM_1ST_ON_1B = 0.30  // r1 → 3B on a single

export function applyOutcome(
  bases: BasesState,
  outcome: Outcome,
  batter: { batterId: number },
): OutcomeResult {
  const runsScored: number[] = []
  const newBases: BasesState = { b1: bases.b1, b2: bases.b2, b3: bases.b3 }
  let outsRecorded = 0
  let rbis = 0

  switch (outcome) {
    case 'HR':
      // All baserunners + batter score
      if (bases.b1 != null) runsScored.push(bases.b1)
      if (bases.b2 != null) runsScored.push(bases.b2)
      if (bases.b3 != null) runsScored.push(bases.b3)
      runsScored.push(batter.batterId)
      rbis = runsScored.length
      newBases.b1 = null
      newBases.b2 = null
      newBases.b3 = null
      break

    case '3B':
      // All on score, batter to 3B
      if (bases.b1 != null) runsScored.push(bases.b1)
      if (bases.b2 != null) runsScored.push(bases.b2)
      if (bases.b3 != null) runsScored.push(bases.b3)
      rbis = runsScored.length
      newBases.b1 = null
      newBases.b2 = null
      newBases.b3 = batter.batterId
      break

    case '2B':
      // r3 scores, r2 scores, r1 scores ~40% / stops at 3B otherwise
      if (bases.b3 != null) runsScored.push(bases.b3)
      if (bases.b2 != null) runsScored.push(bases.b2)
      let new3rd: number | null = null
      if (bases.b1 != null) {
        if (Math.random() < SCORE_FROM_1ST_ON_2B) {
          runsScored.push(bases.b1)
        } else {
          new3rd = bases.b1
        }
      }
      rbis = runsScored.length
      newBases.b1 = null
      newBases.b2 = batter.batterId
      newBases.b3 = new3rd
      break

    case '1B':
      // r3 scores, r2 scores ~62% / stops at 3B, r1 → 3B ~30% / 2B otherwise, batter to 1B
      if (bases.b3 != null) runsScored.push(bases.b3)
      let runner3rd: number | null = null
      if (bases.b2 != null) {
        if (Math.random() < SCORE_FROM_2ND_ON_1B) {
          runsScored.push(bases.b2)
        } else {
          runner3rd = bases.b2
        }
      }
      let runner2nd: number | null = null
      if (bases.b1 != null) {
        if (Math.random() < ADVANCE_TO_3B_FROM_1ST_ON_1B && runner3rd == null) {
          runner3rd = bases.b1
        } else {
          runner2nd = bases.b1
        }
      }
      rbis = runsScored.length
      newBases.b1 = batter.batterId
      newBases.b2 = runner2nd
      newBases.b3 = runner3rd
      break

    case 'BB':
      // Force advances only
      if (bases.b1 != null && bases.b2 != null && bases.b3 != null) {
        // Bases loaded → r3 scores
        runsScored.push(bases.b3)
        rbis = 1
        newBases.b3 = bases.b2
        newBases.b2 = bases.b1
        newBases.b1 = batter.batterId
      } else if (bases.b1 != null && bases.b2 != null) {
        // r1 + r2, no r3 → r2 to 3B, r1 to 2B, batter to 1B
        newBases.b3 = bases.b2
        newBases.b2 = bases.b1
        newBases.b1 = batter.batterId
      } else if (bases.b1 != null) {
        // r1 only → r1 to 2B, batter to 1B (b3 unchanged)
        newBases.b2 = bases.b1
        newBases.b1 = batter.batterId
      } else {
        // Open base for batter — just take 1B (b2/b3 unchanged)
        newBases.b1 = batter.batterId
      }
      break

    case 'K':
      // Strikeout: 1 out, no advancement
      outsRecorded = 1
      break

    case 'OUT':
      // 1 out. Sac fly: runner on 3rd may score ~30% of the time.
      outsRecorded = 1
      if (bases.b3 != null && Math.random() < SCORE_FROM_3RD_ON_OUT) {
        runsScored.push(bases.b3)
        rbis = 1
        newBases.b3 = null
      }
      break
  }

  return { bases: newBases, runsScored, rbis, outsRecorded }
}
