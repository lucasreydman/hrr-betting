import { applyOutcome, EMPTY_BASES, type BasesState } from './baserunner'
import type { Outcome, OutcomeRates } from '../types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Pre-computed per-PA rates for a single batter.
 * Each array is indexed by PA number (0 = first PA of the game).
 * All rates are already fully adjusted: TTO, park, weather, handedness, BvP.
 */
export interface BatterSimContext {
  batterId: number
  /** Final blended rate per PA index; index 0 = first PA of game. */
  ratesVsStarterByPA: OutcomeRates[]
  /** Bullpen blend (high-lev × weight + rest × (1-weight)) per PA index. */
  ratesVsBullpenByPA: OutcomeRates[]
  /** P(facing starter | PA i); length matches the longer of the two rate arrays. */
  starterShareByPA: number[]
}

export interface GameSimArgs {
  homeLineup: BatterSimContext[]  // length 9
  awayLineup: BatterSimContext[]  // length 9
  iterations: number
}

export interface SinglePlayerSimArgs extends GameSimArgs {
  /** batterId of the one player to track — must exist in home or away lineup. */
  targetPlayerId: number
}

export interface BatterHRRDist {
  batterId: number
  totalSims: number
  /**
   * Cumulative: atLeast[N] = P(HRR ≥ N).
   * Length 5: indices 0–4 → ≥0, ≥1, ≥2, ≥3, ≥4+
   * atLeast[0] is always 1.0.
   */
  atLeast: number[]
  /** Mean HRR across all simulated games. */
  meanHRR: number
}

export interface GameSimResult {
  batterHRR: Map<number, BatterHRRDist>
  iterations: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const OUTCOME_ORDER: Outcome[] = ['1B', '2B', '3B', 'HR', 'BB', 'K', 'OUT']

/** Precompute a cumulative probability array for fast sampling. */
function buildCumulative(rates: OutcomeRates): number[] {
  const cum: number[] = []
  let acc = 0
  for (const o of OUTCOME_ORDER) {
    acc += rates[o] ?? 0
    cum.push(acc)
  }
  return cum
}

/** Sample one outcome from a precomputed cumulative array. */
function sampleFromCumulative(cum: number[]): Outcome {
  // Multiply by last entry to guard against floating-point drift above 1.0
  const r = Math.random() * cum[cum.length - 1]
  for (let i = 0; i < cum.length; i++) {
    if (r < cum[i]) return OUTCOME_ORDER[i]
  }
  return 'OUT'  // safe fallback
}

/** Pick the correct rates array for batter at PA index paIdx (0-based). */
function getRates(batter: BatterSimContext, paIdx: number): OutcomeRates {
  const starterShare = batter.starterShareByPA[Math.min(paIdx, batter.starterShareByPA.length - 1)]
  const useStarter = Math.random() < starterShare

  if (useStarter) {
    return batter.ratesVsStarterByPA[Math.min(paIdx, batter.ratesVsStarterByPA.length - 1)]
  } else {
    return batter.ratesVsBullpenByPA[Math.min(paIdx, batter.ratesVsBullpenByPA.length - 1)]
  }
}

// ---------------------------------------------------------------------------
// Cache precomputed cumulatives to avoid rebuilding on every PA
// ---------------------------------------------------------------------------

/** Lazily-built cache: Map<OutcomeRates object ref → cumulative[]> */
const cumCache = new WeakMap<OutcomeRates, number[]>()

function getCumulative(rates: OutcomeRates): number[] {
  let cum = cumCache.get(rates)
  if (!cum) {
    cum = buildCumulative(rates)
    cumCache.set(rates, cum)
  }
  return cum
}

// ---------------------------------------------------------------------------
// Per-iteration accumulators
// ---------------------------------------------------------------------------

interface BatterIterStats {
  hits: number
  runs: number
  rbis: number
  paCount: number
}

function makeStats(): BatterIterStats {
  return { hits: 0, runs: 0, rbis: 0, paCount: 0 }
}

// ---------------------------------------------------------------------------
// Half-inning simulation
// ---------------------------------------------------------------------------

/**
 * Simulate one half-inning for a lineup.
 *
 * Mutates:
 *  - `lineupIdx` (passed by reference via the wrapping object so caller can track)
 *  - `stats` accumulator entries for each batter
 *  - `paCountByIdx` to track per-batter PA totals for proper rate selection
 *
 * Returns updated lineupIdx.
 */
function simHalfInning(
  lineup: BatterSimContext[],
  lineupIdx: number,
  paCountByIdx: number[],
  stats: Map<number, BatterIterStats>,
): number {
  let outs = 0
  let bases: BasesState = { ...EMPTY_BASES }

  while (outs < 3) {
    const batterCtx = lineup[lineupIdx]
    const paIdx = paCountByIdx[lineupIdx]
    paCountByIdx[lineupIdx]++

    const rates = getRates(batterCtx, paIdx)
    const cum = getCumulative(rates)
    const outcome = sampleFromCumulative(cum)

    const result = applyOutcome(bases, outcome, { batterId: batterCtx.batterId })

    // Accumulate stats for this batter
    const s = stats.get(batterCtx.batterId)!
    s.paCount++

    // Hit outcomes
    if (outcome === '1B' || outcome === '2B' || outcome === '3B' || outcome === 'HR') {
      s.hits++
    }

    // RBIs
    s.rbis += result.rbis

    // Runs: credit each player who scored
    for (const scoredId of result.runsScored) {
      const scorer = stats.get(scoredId)
      if (scorer) scorer.runs++
    }

    outs += result.outsRecorded
    bases = result.bases

    // Advance to next batter (wrap around lineup)
    lineupIdx = (lineupIdx + 1) % 9
  }

  return lineupIdx
}

// ---------------------------------------------------------------------------
// Aggregate raw HRR counts → BatterHRRDist
// ---------------------------------------------------------------------------

/**
 * Given an array of per-iteration HRR totals, compute the BatterHRRDist.
 * `hrrCounts[i]` = HRR total for iteration i.
 */
function buildDist(batterId: number, hrrCounts: number[]): BatterHRRDist {
  const n = hrrCounts.length
  // Buckets for 0, 1, 2, 3, ≥4
  const gte = [0, 0, 0, 0, 0]
  let sumHRR = 0

  for (const hrr of hrrCounts) {
    sumHRR += hrr
    // atLeast[0] = ≥0 = always
    gte[0]++
    if (hrr >= 1) gte[1]++
    if (hrr >= 2) gte[2]++
    if (hrr >= 3) gte[3]++
    if (hrr >= 4) gte[4]++
  }

  return {
    batterId,
    totalSims: n,
    atLeast: gte.map(c => c / n),
    meanHRR: n > 0 ? sumHRR / n : 0,
  }
}

// ---------------------------------------------------------------------------
// simGame — full 18-lineup simulation
// ---------------------------------------------------------------------------

/**
 * Simulate N complete games, returning HRR distributions for all 18 batters.
 */
export async function simGame(args: GameSimArgs): Promise<GameSimResult> {
  const { homeLineup, awayLineup, iterations } = args

  // Per-batter HRR accumulator: batterId → array of per-iteration HRR
  const hrrAccum = new Map<number, number[]>()
  for (const b of [...homeLineup, ...awayLineup]) {
    hrrAccum.set(b.batterId, [])
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Per-iteration stats accumulators
    const stats = new Map<number, BatterIterStats>()
    for (const b of [...homeLineup, ...awayLineup]) {
      stats.set(b.batterId, makeStats())
    }

    // PA counts per lineup slot (to track which PA index each batter is on)
    const homePACount = new Array<number>(9).fill(0)
    const awayPACount = new Array<number>(9).fill(0)

    let homeLineupIdx = 0
    let awayLineupIdx = 0

    for (let inning = 0; inning < 9; inning++) {
      // Top half: away bats
      awayLineupIdx = simHalfInning(awayLineup, awayLineupIdx, awayPACount, stats)

      // Bottom half: home bats
      // v1: always play all 9 innings for simplicity (no walk-off early exit)
      homeLineupIdx = simHalfInning(homeLineup, homeLineupIdx, homePACount, stats)
    }

    // Record HRR for each batter this iteration
    for (const [batterId, s] of stats) {
      const hrr = s.hits + s.runs + s.rbis
      hrrAccum.get(batterId)!.push(hrr)
    }
  }

  // Build distribution for each batter
  const batterHRR = new Map<number, BatterHRRDist>()
  for (const [batterId, counts] of hrrAccum) {
    batterHRR.set(batterId, buildDist(batterId, counts))
  }

  return { batterHRR, iterations }
}

// ---------------------------------------------------------------------------
// simSinglePlayerHRR — lightweight single-batter tracking
// ---------------------------------------------------------------------------

/**
 * Same engine as simGame but only materialises HRR tracking for one target batter.
 * All other batters still run through the sim (lineup-awareness is preserved) but
 * their stats are discarded — this saves allocations on aggregation.
 */
export async function simSinglePlayerHRR(args: SinglePlayerSimArgs): Promise<BatterHRRDist> {
  const { homeLineup, awayLineup, iterations, targetPlayerId } = args

  // Verify target exists
  const allBatters = [...homeLineup, ...awayLineup]
  const targetExists = allBatters.some(b => b.batterId === targetPlayerId)
  if (!targetExists) {
    throw new Error(`simSinglePlayerHRR: targetPlayerId ${targetPlayerId} not found in either lineup`)
  }

  const hrrCounts: number[] = []

  for (let iter = 0; iter < iterations; iter++) {
    // Full stats map — same as simGame (lineup interactions require tracking all runners)
    const stats = new Map<number, BatterIterStats>()
    for (const b of allBatters) {
      stats.set(b.batterId, makeStats())
    }

    const homePACount = new Array<number>(9).fill(0)
    const awayPACount = new Array<number>(9).fill(0)

    let homeLineupIdx = 0
    let awayLineupIdx = 0

    for (let inning = 0; inning < 9; inning++) {
      awayLineupIdx = simHalfInning(awayLineup, awayLineupIdx, awayPACount, stats)
      homeLineupIdx = simHalfInning(homeLineup, homeLineupIdx, homePACount, stats)
    }

    // Only extract HRR for target batter
    const s = stats.get(targetPlayerId)!
    hrrCounts.push(s.hits + s.runs + s.rbis)
  }

  return buildDist(targetPlayerId, hrrCounts)
}
