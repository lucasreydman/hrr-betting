import Papa from 'papaparse'
import type { BatterStatcast, PitcherStatcast } from './types'
import { kvGet, kvSet } from './kv'
import { slateDateString } from './date-utils'

// 24h TTL paired with a slate-aligned cache key — Savant updates a few times
// per day and we don't want mid-game updates flipping plays previously given,
// so the slate segment freezes the snapshot for the day.
const KV_TTL_SECONDS = 24 * 60 * 60
const SAVANT_CACHE_VERSION = 'v1'
const MIN_REASONABLE_SAVANT_ROWS = 50

function savantKey(type: 'batter' | 'pitcher', year: number): string {
  return `savant:${type}:${SAVANT_CACHE_VERSION}:${year}:${slateDateString()}`
}

export type BatterStore = Record<number, BatterStatcast>
export type PitcherStore = Record<number, PitcherStatcast>

/**
 * Parse Baseball Savant batter CSV into a typed store.
 * Expects columns: player_id, barrel_batted_rate, hard_hit_percent, xwoba, xiso, avg_exit_velo
 * TODO: Verify exact column names from live Savant export
 */
export function parseSavantBatterCsv(csv: string): BatterStore {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  const store: BatterStore = {}

  for (const row of data) {
    const batterId = parseInt(row['player_id'], 10)
    if (isNaN(batterId)) continue

    const barrelPct = parseFloat(row['barrel_batted_rate'] ?? '0') / 100
    const hardHitPct = parseFloat(row['hard_hit_percent'] ?? '0') / 100
    const xwOBA = parseFloat(row['xwoba'] ?? '0')
    const xISO = parseFloat(row['xiso'] ?? '0')
    const avgExitVelo = parseFloat(row['avg_exit_velo'] ?? '0')

    if (!Number.isFinite(barrelPct) || !Number.isFinite(hardHitPct) || !Number.isFinite(xwOBA)) {
      continue
    }

    store[batterId] = {
      batterId,
      barrelPct,
      hardHitPct,
      xwOBA,
      xISO: Number.isFinite(xISO) ? xISO : 0,
      avgExitVelo: Number.isFinite(avgExitVelo) ? avgExitVelo : 0,
    }
  }

  return store
}

/**
 * Parse Baseball Savant pitcher CSV into a typed store.
 * Expects columns: player_id, barrels_per_pa, hard_hit_percent, xwoba_against, whiff_percent
 * TODO: Verify exact column names from live Savant export
 */
export function parseSavantPitcherCsv(csv: string): PitcherStore {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  const store: PitcherStore = {}

  for (const row of data) {
    const pitcherId = parseInt(row['player_id'], 10)
    if (isNaN(pitcherId)) continue

    const barrelsAllowedPct = parseFloat(row['barrels_per_pa'] ?? '0') / 100
    const hardHitPctAllowed = parseFloat(row['hard_hit_percent'] ?? '0') / 100
    const xwOBAAllowed = parseFloat(row['xwoba_against'] ?? '0')
    const whiffPct = parseFloat(row['whiff_percent'] ?? '0') / 100

    if (!Number.isFinite(barrelsAllowedPct) || !Number.isFinite(hardHitPctAllowed) || !Number.isFinite(xwOBAAllowed)) {
      continue
    }

    store[pitcherId] = {
      pitcherId,
      barrelsAllowedPct,
      hardHitPctAllowed,
      xwOBAAllowed,
      whiffPct: Number.isFinite(whiffPct) ? whiffPct : 0,
    }
  }

  return store
}

async function fetchSavantBatterCsv(year: number): Promise<string> {
  const url = `https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${year}&position=&team=&min=1&csv=true`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Savant batter fetch failed: ${res.status}`)
  return res.text()
}

async function fetchSavantPitcherCsv(year: number): Promise<string> {
  const url = `https://baseballsavant.mlb.com/leaderboard/statcast?type=pitcher&year=${year}&position=SP,RP&team=&min=1&csv=true`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Savant pitcher fetch failed: ${res.status}`)
  return res.text()
}

export async function loadSavantBatterStore(year: number): Promise<BatterStore> {
  const cached = await kvGet<BatterStore>(savantKey('batter', year))
  if (cached && Object.keys(cached).length >= MIN_REASONABLE_SAVANT_ROWS) {
    return cached
  }

  try {
    const csv = await fetchSavantBatterCsv(year)
    const store = parseSavantBatterCsv(csv)
    if (Object.keys(store).length >= MIN_REASONABLE_SAVANT_ROWS) {
      await kvSet(savantKey('batter', year), store, KV_TTL_SECONDS)
      return store
    }
    return {}
  } catch {
    return {}
  }
}

export async function loadSavantPitcherStore(year: number): Promise<PitcherStore> {
  const cached = await kvGet<PitcherStore>(savantKey('pitcher', year))
  if (cached && Object.keys(cached).length >= MIN_REASONABLE_SAVANT_ROWS) {
    return cached
  }

  try {
    const csv = await fetchSavantPitcherCsv(year)
    const store = parseSavantPitcherCsv(csv)
    if (Object.keys(store).length >= MIN_REASONABLE_SAVANT_ROWS) {
      await kvSet(savantKey('pitcher', year), store, KV_TTL_SECONDS)
      return store
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Get Statcast metrics for a batter by ID and season.
 * Returns null if batter not found in Savant data.
 */
export async function getBatterStatcast(batterId: number, season: number): Promise<BatterStatcast | null> {
  const store = await loadSavantBatterStore(season)
  return store[batterId] ?? null
}

/**
 * Get Statcast metrics for a pitcher by ID and season.
 * Returns null if pitcher not found in Savant data.
 */
export async function getPitcherStatcast(pitcherId: number, season: number): Promise<PitcherStatcast | null> {
  const store = await loadSavantPitcherStore(season)
  return store[pitcherId] ?? null
}
