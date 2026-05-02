import Papa from 'papaparse'
import type { BatterStatcast, PitcherStatcast } from './types'
import { kvGet, kvSet } from './kv'
import { slateDateString } from './date-utils'

// 24h TTL paired with a slate-aligned cache key — Savant updates a few times
// per day and we don't want mid-game updates flipping plays previously given,
// so the slate segment freezes the snapshot for the day.
const KV_TTL_SECONDS = 24 * 60 * 60
// v2: column-name fix. The previous parser expected columns like
// `barrel_batted_rate` / `hard_hit_percent` / `xwoba` that don't exist in the
// live Savant CSV exports — actual columns are `brl_percent`, `ev95percent`,
// and `est_woba` (split across two endpoints). v1 produced all-zero records
// for every player; the cache-key bump forces a clean rebuild.
const SAVANT_CACHE_VERSION = 'v2'
const MIN_REASONABLE_SAVANT_ROWS = 50

function savantKey(type: 'batter' | 'pitcher', year: number): string {
  return `savant:${type}:${SAVANT_CACHE_VERSION}:${year}:${slateDateString()}`
}

export type BatterStore = Record<number, BatterStatcast>
export type PitcherStore = Record<number, PitcherStatcast>

/**
 * Parse Baseball Savant `/leaderboard/statcast?type=batter` CSV.
 *
 * Real column names (verified 2026-05-03):
 *   player_id, attempts, avg_hit_angle, anglesweetspotpercent,
 *   max_hit_speed, avg_hit_speed, ev50, fbld, gb, max_distance,
 *   avg_distance, avg_hr_distance, ev95plus, ev95percent, barrels,
 *   brl_percent, brl_pa
 *
 * `brl_percent` and `ev95percent` arrive as percentages (e.g. 4.8, 34.9),
 * so we divide by 100. xwOBA isn't in this CSV — it lives in the separate
 * `expected_statistics` endpoint and is merged in by `parseSavantBatterXwobaCsv`.
 */
export function parseSavantBatterCsv(csv: string): BatterStore {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  const store: BatterStore = {}

  for (const row of data) {
    const batterId = parseInt(row['player_id'], 10)
    if (isNaN(batterId)) continue

    const barrelPct = parseFloat(row['brl_percent'] ?? '') / 100
    const hardHitPct = parseFloat(row['ev95percent'] ?? '') / 100
    const avgExitVelo = parseFloat(row['avg_hit_speed'] ?? '')

    // Skip rows where the core signals are missing — better to leave the
    // batter out of the store and surface "no data" downstream than to
    // record zeros that look like real data.
    if (!Number.isFinite(barrelPct) || !Number.isFinite(hardHitPct)) continue

    store[batterId] = {
      batterId,
      barrelPct,
      hardHitPct,
      // xwOBA / xISO get merged in from the expected-stats CSV. Default
      // to 0 for now; the merge step overwrites when data arrives.
      xwOBA: 0,
      xISO: 0,
      avgExitVelo: Number.isFinite(avgExitVelo) ? avgExitVelo : 0,
    }
  }

  return store
}

/**
 * Parse Baseball Savant `/leaderboard/expected_statistics?type=batter` CSV
 * and merge xwOBA / xBA into an existing batter store. Real columns:
 *   player_id, year, pa, bip, ba, est_ba, est_ba_minus_ba_diff, slg,
 *   est_slg, est_slg_minus_slg_diff, woba, est_woba, est_woba_minus_woba_diff
 *
 * `est_woba` is on the 0–1 scale (no division needed). Adds xwOBA to
 * existing batter records; new players (not in the contact-quality CSV)
 * get added with neutral barrel/hardHit so the store is union-shaped.
 */
export function mergeBatterXwobaCsv(csv: string, store: BatterStore): void {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  for (const row of data) {
    const batterId = parseInt(row['player_id'], 10)
    if (isNaN(batterId)) continue
    const xwOBA = parseFloat(row['est_woba'] ?? '')
    const xBA = parseFloat(row['est_ba'] ?? '')
    const xSlg = parseFloat(row['est_slg'] ?? '')
    if (!Number.isFinite(xwOBA)) continue
    const existing = store[batterId]
    // xISO ≈ xSLG − xBA (standard derivation). Falls back to 0 if either
    // is missing.
    const xISO = Number.isFinite(xBA) && Number.isFinite(xSlg) ? Math.max(0, xSlg - xBA) : 0
    if (existing) {
      existing.xwOBA = xwOBA
      existing.xISO = xISO
    } else {
      store[batterId] = {
        batterId,
        barrelPct: 0,
        hardHitPct: 0,
        xwOBA,
        xISO,
        avgExitVelo: 0,
      }
    }
  }
}

/**
 * Parse Baseball Savant `/leaderboard/statcast?type=pitcher` CSV.
 *
 * Same column set as the batter contact-quality CSV. Pitcher whiff% lives
 * in a separate endpoint that returns per-pitch data; aggregating that
 * isn't worth the complexity for a signal the closed-form pitcher factor
 * doesn't currently consume. Whiff% is left at 0 (model treats it as
 * unused).
 */
export function parseSavantPitcherCsv(csv: string): PitcherStore {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  const store: PitcherStore = {}

  for (const row of data) {
    const pitcherId = parseInt(row['player_id'], 10)
    if (isNaN(pitcherId)) continue

    const barrelsAllowedPct = parseFloat(row['brl_percent'] ?? '') / 100
    const hardHitPctAllowed = parseFloat(row['ev95percent'] ?? '') / 100

    if (!Number.isFinite(barrelsAllowedPct) || !Number.isFinite(hardHitPctAllowed)) continue

    store[pitcherId] = {
      pitcherId,
      barrelsAllowedPct,
      hardHitPctAllowed,
      // xwOBAAllowed merged in from the pitcher expected-stats CSV.
      xwOBAAllowed: 0,
      whiffPct: 0,
    }
  }

  return store
}

/**
 * Merge `est_woba` from the pitcher `/leaderboard/expected_statistics` CSV
 * into the pitcher store. Same shape as the batter merge.
 */
export function mergePitcherXwobaCsv(csv: string, store: PitcherStore): void {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  for (const row of data) {
    const pitcherId = parseInt(row['player_id'], 10)
    if (isNaN(pitcherId)) continue
    const xwOBAAllowed = parseFloat(row['est_woba'] ?? '')
    if (!Number.isFinite(xwOBAAllowed)) continue
    const existing = store[pitcherId]
    if (existing) {
      existing.xwOBAAllowed = xwOBAAllowed
    } else {
      store[pitcherId] = {
        pitcherId,
        barrelsAllowedPct: 0,
        hardHitPctAllowed: 0,
        xwOBAAllowed,
        whiffPct: 0,
      }
    }
  }
}

async function fetchCsv(url: string, label: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Savant ${label} fetch failed: ${res.status}`)
  return res.text()
}

async function fetchSavantBatterContactCsv(year: number): Promise<string> {
  return fetchCsv(
    `https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${year}&position=&team=&min=1&csv=true`,
    'batter contact',
  )
}

async function fetchSavantBatterXwobaCsv(year: number): Promise<string> {
  return fetchCsv(
    `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&filterType=bip&min=1&csv=true`,
    'batter xwOBA',
  )
}

async function fetchSavantPitcherContactCsv(year: number): Promise<string> {
  return fetchCsv(
    `https://baseballsavant.mlb.com/leaderboard/statcast?type=pitcher&year=${year}&position=SP,RP&team=&min=1&csv=true`,
    'pitcher contact',
  )
}

async function fetchSavantPitcherXwobaCsv(year: number): Promise<string> {
  return fetchCsv(
    `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher&year=${year}&position=&team=&filterType=bip&min=1&csv=true`,
    'pitcher xwOBA',
  )
}

export async function loadSavantBatterStore(year: number): Promise<BatterStore> {
  const cached = await kvGet<BatterStore>(savantKey('batter', year))
  if (cached && Object.keys(cached).length >= MIN_REASONABLE_SAVANT_ROWS) {
    return cached
  }

  try {
    const [contactCsv, xwobaCsv] = await Promise.all([
      fetchSavantBatterContactCsv(year),
      fetchSavantBatterXwobaCsv(year).catch(() => ''),
    ])
    const store = parseSavantBatterCsv(contactCsv)
    if (xwobaCsv) mergeBatterXwobaCsv(xwobaCsv, store)
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
    const [contactCsv, xwobaCsv] = await Promise.all([
      fetchSavantPitcherContactCsv(year),
      fetchSavantPitcherXwobaCsv(year).catch(() => ''),
    ])
    const store = parseSavantPitcherCsv(contactCsv)
    if (xwobaCsv) mergePitcherXwobaCsv(xwobaCsv, store)
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
