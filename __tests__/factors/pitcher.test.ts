import { computePitcherFactor } from '../../lib/factors/pitcher'
import type { PitcherInputs } from '../../lib/factors/pitcher'
import { LG_K_PCT, LG_BB_PCT, LG_HR_PCT, LG_HARD_HIT_RATE } from '../../lib/constants'

const leagueAvgPitcher: PitcherInputs = {
  id: 1,
  kPct: LG_K_PCT,
  bbPct: LG_BB_PCT,
  hrPct: LG_HR_PCT,
  hardHitRate: LG_HARD_HIT_RATE,
  bf: 500,
  recentStarts: 5,
}

describe('computePitcherFactor', () => {
  it('returns 1 for TBD pitcher (id=0)', () => {
    expect(computePitcherFactor({ pitcher: { ...leagueAvgPitcher, id: 0 } })).toBe(1)
  })

  it('returns 1 for low sample pitcher (< 3 recent starts)', () => {
    expect(computePitcherFactor({ pitcher: { ...leagueAvgPitcher, recentStarts: 0 } })).toBe(1)
    expect(computePitcherFactor({ pitcher: { ...leagueAvgPitcher, recentStarts: 2 } })).toBe(1)
  })

  it('league-average pitcher with large sample returns ~1.0', () => {
    const f = computePitcherFactor({ pitcher: leagueAvgPitcher })
    expect(f).toBeCloseTo(1.0, 2)
  })

  it('elite pitcher (high K, low BB, low HR, low hard-hit) returns < 1 (harder to score)', () => {
    const elitePitcher: PitcherInputs = {
      id: 2,
      kPct: 0.35,       // very high strikeout rate
      bbPct: 0.04,      // very low walk rate
      hrPct: 0.015,     // very low HR rate
      hardHitRate: 0.28, // very low hard-hit rate
      bf: 600,
      recentStarts: 10,
    }
    const f = computePitcherFactor({ pitcher: elitePitcher })
    expect(f).toBeLessThan(1)
  })

  it('poor pitcher (low K, high BB, high HR, high hard-hit) returns > 1 (easier to score)', () => {
    const poorPitcher: PitcherInputs = {
      id: 3,
      kPct: 0.12,       // low K rate
      bbPct: 0.15,      // high BB rate
      hrPct: 0.055,     // high HR rate
      hardHitRate: 0.52, // high hard-hit rate
      bf: 400,
      recentStarts: 8,
    }
    const f = computePitcherFactor({ pitcher: poorPitcher })
    expect(f).toBeGreaterThan(1)
  })

  it('output is always in [0.5, 2.0]', () => {
    const extreme1: PitcherInputs = { id: 4, kPct: 0.50, bbPct: 0.01, hrPct: 0.001, hardHitRate: 0.10, bf: 1000, recentStarts: 20 }
    const extreme2: PitcherInputs = { id: 5, kPct: 0.05, bbPct: 0.30, hrPct: 0.10, hardHitRate: 0.70, bf: 1000, recentStarts: 20 }
    expect(computePitcherFactor({ pitcher: extreme1 })).toBeGreaterThanOrEqual(0.5)
    expect(computePitcherFactor({ pitcher: extreme2 })).toBeLessThanOrEqual(2.0)
  })
})
