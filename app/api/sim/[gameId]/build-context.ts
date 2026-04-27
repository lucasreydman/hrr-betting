/**
 * app/api/sim/[gameId]/build-context.ts
 *
 * Assembles BatterSimContext for a single batter by pulling and blending:
 *   - Season stats + Statcast (batter & opposing pitcher)
 *   - Bullpen tier rates
 *   - Starter-share per PA
 *   - TTO multipliers
 *   - Park & weather factors
 *
 * V1 simplifications (documented):
 *   - No L30/L15 blend — season stats only (game log fetch is expensive per-player)
 *   - BvP layer skipped; season handedness splits used as baseline
 *   - Pitcher outcomeRates derived from their K%/BB%/HR9 season stats (no per-split outcomeRates on PitcherStats)
 *
 * Park factors and weather factors are now real per-PA multipliers — see
 * lib/park-factors.ts and lib/weather-factors.ts.
 */

import { fetchBatterSeasonStats, fetchPitcherSeasonStats } from '@/lib/mlb-api'
import { getBullpenTiers, weightForPA } from '@/lib/bullpen'
import { getStarterShare } from '@/lib/starter-share'
import { getTtoMultipliers } from '@/lib/tto'
import { computePerPA } from '@/lib/per-pa'
import { stabilizeRates } from '@/lib/stabilization'
import { applyHandedness, blendRates } from '@/lib/rates'
import { getBatterStatcast, getPitcherStatcast } from '@/lib/savant-api'
import { getParkFactorsForBatter } from '@/lib/park-factors'
import { LEAGUE_AVG_RATES } from '@/lib/constants'
import type { BatterSimContext } from '@/lib/sim'
import type { Outcome, OutcomeRates, Handedness, PlayerRef, PitcherStats } from '@/lib/types'


// ---------------------------------------------------------------------------
// pitcherStatsToOutcomeRates
// ---------------------------------------------------------------------------

/**
 * Derive a pitcher's per-PA outcome distribution from their season FIP stats.
 * K% and BB% come directly from the stats; HR/PA is derived from HR/9 and league
 * avg IP/PA. Hit rates are approximated so the distribution sums to 1.
 *
 * Used as the log-5 pitcher baseline in computePerPA — not a final prediction,
 * but an informed prior that beats pure league-average for strong/weak pitchers.
 */
function pitcherStatsToOutcomeRates(stats: PitcherStats): OutcomeRates {
  const k   = Math.min(stats.kPct,  0.40)           // cap at reasonable bounds
  const bb  = Math.min(stats.bbPct, 0.20)
  // HR/9 → HR/PA via ~3.2 PA per out (league avg ~37 PA/9 innings)
  const hrPa = Math.min(stats.hrPer9 / 37, 0.08)

  // Approximate BABIP-in-play rate for singles + doubles + triples
  const hitRate = 0.240 - hrPa                       // rough total hit rate excl HR
  const singles = Math.max(0, hitRate - 0.046 - 0.005)
  const outs    = Math.max(0, 1 - k - bb - hrPa - hitRate)

  const raw: OutcomeRates = {
    '1B': singles,
    '2B': 0.046,
    '3B': 0.005,
    HR:   hrPa,
    BB:   bb,
    K:    k,
    OUT:  outs,
  }

  // Normalize so outcomes sum to exactly 1
  const total = Object.values(raw).reduce((a, b) => a + b, 0)
  if (total <= 0) return { ...LEAGUE_AVG_RATES }

  return Object.fromEntries(
    (Object.keys(raw) as Outcome[]).map(key => [key, raw[key] / total])
  ) as OutcomeRates
}

// ---------------------------------------------------------------------------
// buildBatterContext
// ---------------------------------------------------------------------------

export interface BuildBatterContextArgs {
  batter: PlayerRef
  /** 1-indexed lineup slot */
  lineupSlot: number
  opposingStarter: { id: number; throws: Handedness; type: 'starter' | 'opener' }
  opposingTeamId: number
  /** MLB venueId — used to look up *per-batter-handedness* park factors. */
  venueId: number
  weatherFactors: Record<Outcome, number>
  date: string
  season: number
}

export async function buildBatterContext(args: BuildBatterContextArgs): Promise<BatterSimContext> {
  const {
    batter,
    lineupSlot,
    opposingStarter,
    opposingTeamId,
    venueId,
    weatherFactors,
    date,
    season,
  } = args

  // Park factors are now resolved *per batter* using FanGraphs' per-handedness
  // columns (1B/2B/3B/HR by L/R). Yankee Stadium's short porch boosts LHB HR
  // ~3% over RHB; this routes that asymmetry into the per-PA model instead of
  // applying the same number to both. Switch hitters get the L/R average.
  const parkFactors = getParkFactorsForBatter(venueId, batter.bats)

  // 1. Batter season stats + Statcast
  const seasonStats = await fetchBatterSeasonStats(batter.playerId, season)
  const batterStatcast = await getBatterStatcast(batter.playerId, season).catch(() => null)

  // 2. Stabilize season rates against league average as prior
  //    (v1: use league avg as career prior — season sample only)
  const stabilizedRates = stabilizeRates(seasonStats.outcomeRates, LEAGUE_AVG_RATES, seasonStats.pa)

  // 3. Apply handedness split if available, otherwise use stabilized overall
  let ratesVsStarter_baseline: OutcomeRates
  if (seasonStats.vsR && seasonStats.vsL) {
    ratesVsStarter_baseline = applyHandedness(
      { vsR: seasonStats.vsR, vsL: seasonStats.vsL },
      opposingStarter.throws,
    )
  } else {
    ratesVsStarter_baseline = stabilizedRates
  }

  // 4. Pitcher season stats + Statcast
  const [pitcherStats, pitcherStatcast] = await Promise.all([
    fetchPitcherSeasonStats(opposingStarter.id, season),
    getPitcherStatcast(opposingStarter.id, season).catch(() => null),
  ])

  // Derive pitcher outcome rates from their K%, BB%, HR/9 counting stats.
  // Single and double rates are approximated so the distribution sums to 1.
  // This gives a per-pitcher log-5 baseline; Statcast adjustments are applied later.
  const pitcherOutcomeRates: OutcomeRates = pitcherStatsToOutcomeRates(pitcherStats)

  // 5. Bullpen tiers for the opposing team, matched to batter handedness
  const bullpenTiers = await getBullpenTiers({ teamId: opposingTeamId, batterHand: batter.bats })

  // 6. Starter share per PA
  const expectedPA = 4
  const ss = await getStarterShare({
    pitcherId:   opposingStarter.id,
    pitcherType: opposingStarter.type,
    lineupSlot,
    expectedPA,
    date,
  })

  // 7. Build per-PA rate arrays (length = expectedPA + 1 for insurance on extra innings)
  const ratesVsStarterByPA: OutcomeRates[] = []
  const ratesVsBullpenByPA: OutcomeRates[] = []

  const neutralTTO: Record<Outcome, number> = {
    '1B': 1, '2B': 1, '3B': 1, HR: 1, BB: 1, K: 1, OUT: 1,
  }

  for (let i = 1; i <= expectedPA + 1; i++) {
    const ttoIndex = Math.min(i, 4) as 1 | 2 | 3 | 4
    const ttoMult = await getTtoMultipliers({ pitcherId: opposingStarter.id, ttoIndex })

    // vs starter — log-5 blend with TTO + park + weather
    const ratesVsStarter = computePerPA({
      batter:  { rates: ratesVsStarter_baseline, statcast: batterStatcast ?? undefined },
      pitcher: { rates: pitcherOutcomeRates, statcast: pitcherStatcast ?? undefined },
      ctx:     { parkFactors, weatherFactors, ttoMultipliers: ttoMult },
    })
    ratesVsStarterByPA.push(ratesVsStarter)

    // vs bullpen — blend high-leverage and rest by weightForPA
    const w = weightForPA(i)
    const blendedBullpen = blendRates({
      season:  bullpenTiers.highLeverage,
      l30:     bullpenTiers.rest,
      l15:     bullpenTiers.rest,
      weights: { season: w, l30: 1 - w, l15: 0 },
    })

    // Bullpen: park + weather applied but neutral TTO (no TTO adjustment vs relievers)
    const ratesVsBullpen = computePerPA({
      batter:  { rates: ratesVsStarter_baseline, statcast: batterStatcast ?? undefined },
      pitcher: { rates: blendedBullpen },
      ctx:     { parkFactors, weatherFactors, ttoMultipliers: neutralTTO },
    })
    ratesVsBullpenByPA.push(ratesVsBullpen)
  }

  return {
    batterId:           batter.playerId,
    ratesVsStarterByPA,
    ratesVsBullpenByPA,
    starterShareByPA:   ss.perPaProbabilities,
  }
}
