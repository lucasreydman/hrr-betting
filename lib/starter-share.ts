/**
 * lib/starter-share.ts
 *
 * Computes starter_share — the fraction of a batter's expected PAs that come
 * against the starting pitcher — using a tiered IP CDF fallback strategy.
 *
 * Tiers (by starts available this season):
 *   >= 5 starts : empirical CDF from recent starts
 *   1-4 starts  : Bayesian blend (n/5 * empirical + (1-n/5) * league-avg)
 *   0 starts    : league-avg CDF by pitcher type (starter | opener)
 */

import { fetchPitcherRecentStarts } from './mlb-api'
import { kvGet, kvSet } from './kv'
import type { StartLine } from './types'

// ---------------------------------------------------------------------------
// IPCDF interface
// ---------------------------------------------------------------------------

export interface IPCDF {
  /** P(starter completed at least `inning` innings) — 1.0 at inning=0, 0 at inning > max. */
  completedAtLeast(inning: number): number
}

// ---------------------------------------------------------------------------
// ipCdfFromStarts — empirical CDF builder
// ---------------------------------------------------------------------------

/**
 * Build an empirical survival CDF from a list of pitcher starts.
 * P(starter completed at least N innings) = fraction of starts with ip >= N.
 * Always returns 1.0 for inning <= 0.
 */
export function ipCdfFromStarts(starts: StartLine[]): IPCDF {
  if (starts.length === 0) {
    return { completedAtLeast: () => 0 }
  }
  const ips = starts.map(s => s.ip).sort((a, b) => a - b)
  return {
    completedAtLeast(inning: number): number {
      if (inning <= 0) return 1.0
      const ge = ips.filter(ip => ip >= inning).length
      return ge / ips.length
    },
  }
}

// ---------------------------------------------------------------------------
// League-avg CDFs by pitcher type
// ---------------------------------------------------------------------------

/**
 * League-average starter CDF.
 * Modal ~5.5 IP; calibrated to real MLB starter IP distributions (2023-era).
 * Gradual taper: ~95% finish 1 IP, ~62% finish 5 IP, ~10% finish 7 IP.
 */
const STARTER_AVG_CDF: IPCDF = {
  completedAtLeast(inning: number): number {
    if (inning <= 0) return 1.0
    if (inning <= 1) return 0.97
    if (inning <= 2) return 0.93
    if (inning <= 3) return 0.88
    if (inning <= 4) return 0.80
    if (inning <= 5) return 0.62
    if (inning <= 6) return 0.35
    if (inning <= 7) return 0.10
    if (inning <= 8) return 0.02
    return 0
  },
}

/**
 * League-average opener CDF.
 * Openers typically face one turn through the order (1-2 innings).
 */
const OPENER_AVG_CDF: IPCDF = {
  completedAtLeast(inning: number): number {
    if (inning <= 0) return 1.0
    if (inning <= 1) return 0.85
    if (inning <= 2) return 0.30
    if (inning <= 3) return 0.05
    return 0
  },
}

// ---------------------------------------------------------------------------
// PA → estimated inning mapping
// ---------------------------------------------------------------------------

/**
 * Estimate the inning in which a batter's Nth plate appearance (1-indexed) occurs,
 * given their lineup slot (1-9).
 *
 * Each batting cycle covers ~2.4 innings on average (27 outs / ~11.25 per side).
 * Slot offset shifts first PA earlier (slot 1) or later (slot 9) within cycle 1.
 */
function estimatedInningOfPA(lineupSlot: number, paIndex: number): number {
  const slotOffset = (lineupSlot - 1) / 9   // 0 (slot 1) → 0.89 (slot 9)
  const cycleStart = (paIndex - 1) * 1.7    // cycle 1 → 0, cycle 2 → 1.7, etc.
  return Math.max(1, cycleStart + 1 + slotOffset)
}

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface StarterShareArgs {
  pitcherId: number
  /** Default: 'starter'. Affects which league-avg CDF is used as fallback. */
  pitcherType?: 'starter' | 'opener'
  /** 1-9 lineup slot for the batter. */
  lineupSlot: number
  /** Expected number of PAs for the batter in this game (typically 3-5). */
  expectedPA: number
  /** YYYY-MM-DD for cache key. Defaults to today. */
  date?: string
}

export interface StarterShareResult {
  /** Fraction of expectedPA PAs estimated to come against the starter. 0-1. */
  starterShare: number
  /** Per-PA probabilities P(starter still in) for each PA index. */
  perPaProbabilities: number[]
  /** Source of the CDF used to produce this estimate. */
  cdfSource: 'empirical' | 'bayesian-blend' | 'league-avg-starter' | 'league-avg-opener'
}

// ---------------------------------------------------------------------------
// getStarterShare — main export
// ---------------------------------------------------------------------------

const TTL_7D = 7 * 24 * 60 * 60

/**
 * Compute starter_share for a batter facing a given pitcher.
 *
 * Uses tiered CDF fallback based on how many recent starts the pitcher has:
 *   >= 5 : empirical CDF
 *   1-4  : Bayesian blend with league-avg
 *   0    : pure league-avg by pitcher type
 *
 * Results are cached for 7 days by (pitcherId, date, slot, PA count, type).
 */
export async function getStarterShare(args: StarterShareArgs): Promise<StarterShareResult> {
  const date = args.date ?? new Date().toISOString().slice(0, 10)
  const pitcherType = args.pitcherType ?? 'starter'
  const cacheKey = `pitcher-ipcdf:${args.pitcherId}:${date}:slot${args.lineupSlot}:pa${args.expectedPA}:${pitcherType}`

  const cached = await kvGet<StarterShareResult>(cacheKey)
  if (cached) return cached

  const fallbackCDF = pitcherType === 'opener' ? OPENER_AVG_CDF : STARTER_AVG_CDF
  const fallbackSource = pitcherType === 'opener'
    ? ('league-avg-opener' as const)
    : ('league-avg-starter' as const)

  const starts = await fetchPitcherRecentStarts(args.pitcherId, 10).catch(() => [] as StartLine[])

  let cdf: IPCDF
  let source: StarterShareResult['cdfSource']

  if (starts.length >= 5) {
    cdf = ipCdfFromStarts(starts)
    source = 'empirical'
  } else if (starts.length >= 1) {
    const empCdf = ipCdfFromStarts(starts)
    const w = starts.length / 5
    cdf = {
      completedAtLeast: (inning) =>
        w * empCdf.completedAtLeast(inning) + (1 - w) * fallbackCDF.completedAtLeast(inning),
    }
    source = 'bayesian-blend'
  } else {
    cdf = fallbackCDF
    source = fallbackSource
  }

  // For each expected PA, estimate the inning and look up P(starter still in).
  // We use a half-inning offset (inning - 0.5) to account for mid-inning pulls.
  const perPaProbabilities: number[] = []
  for (let i = 1; i <= args.expectedPA; i++) {
    const inning = estimatedInningOfPA(args.lineupSlot, i)
    perPaProbabilities.push(cdf.completedAtLeast(inning - 0.5))
  }

  const starterShare =
    perPaProbabilities.reduce((a, b) => a + b, 0) / args.expectedPA

  const result: StarterShareResult = { starterShare, perPaProbabilities, cdfSource: source }
  await kvSet(cacheKey, result, TTL_7D)
  return result
}
