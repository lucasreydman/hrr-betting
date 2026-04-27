import { kvGet, kvSet } from './kv'
import { getSupabase, isSupabaseAvailable } from './db'
import type { LockedPickRow, SettledPickRow } from './db'
import type { Pick, PicksResponse } from './ranker'
import type { Rung } from './types'
import { fetchBoxscore } from './mlb-api'

// ============================================================================
// Pure lock-trigger logic
// ============================================================================

export interface ShouldLockArgs {
  now: number         // Date.now() ms
  firstPitch: number  // ms timestamp of first pitch
  lineupStatus: 'confirmed' | 'partial' | 'estimated'
}

/**
 * Lock trigger: earliest-wins.
 * - Confirmed lineup AND now >= first_pitch - 90min: fire
 * - now >= first_pitch - 30min: fire (forced fallback regardless of lineup status)
 */
export function shouldLock(args: ShouldLockArgs): boolean {
  const ms90 = 90 * 60 * 1000
  const ms30 = 30 * 60 * 1000
  const timeUntilFirstPitch = args.firstPitch - args.now
  if (args.lineupStatus === 'confirmed' && timeUntilFirstPitch <= ms90) return true
  if (timeUntilFirstPitch <= ms30) return true
  return false
}

// ============================================================================
// Legacy blob types — kept for backward compat with existing test fixtures
// @deprecated — use LockedPickRow / SettledPickRow from lib/db.ts instead
// ============================================================================

export interface SettledPick extends Pick {
  rung: Rung
  outcome: 'HIT' | 'MISS' | 'PENDING'
  actualHRR?: number
}

/** @deprecated */
export interface LockedDay {
  date: string
  lockedAt: string
  picks: Array<Pick & { rung: Rung }>
}

/** @deprecated */
export interface SettledDay {
  date: string
  picks: SettledPick[]
}

// ============================================================================
// Row mappers
// ============================================================================

function pickToLockedRow(date: string, p: Pick & { rung: Rung }): LockedPickRow {
  return {
    date, game_id: p.gameId, rung: p.rung,
    player_id: p.player.playerId, player_name: p.player.fullName,
    player_team: p.player.team, player_bats: p.player.bats,
    opponent_team_id: p.opponent.teamId, opponent_abbrev: p.opponent.abbrev,
    lineup_slot: p.lineupSlot, lineup_status: p.lineupStatus,
    p_matchup: p.pMatchup, p_typical: p.pTypical,
    edge: p.edge, confidence: p.confidence, score: p.score,
  }
}

export function lockedRowToPick(row: LockedPickRow): Pick & { rung: Rung } {
  return {
    player: { playerId: row.player_id, fullName: row.player_name, team: row.player_team, bats: row.player_bats },
    opponent: { teamId: row.opponent_team_id, abbrev: row.opponent_abbrev },
    gameId: row.game_id, rung: row.rung,
    lineupSlot: row.lineup_slot, lineupStatus: row.lineup_status,
    pMatchup: row.p_matchup, pTypical: row.p_typical,
    edge: row.edge, confidence: row.confidence, score: row.score,
    tier: 'tracked' as const,
  }
}

function settledPickToRow(date: string, p: SettledPick & { rung: Rung }): SettledPickRow {
  return {
    ...pickToLockedRow(date, p),
    outcome: p.outcome,
    actual_hrr: p.actualHRR ?? null,
  }
}

// ============================================================================
// Shared boxscore settlement logic
// ============================================================================

type BoxscoreResult = { outcome: 'HIT' | 'MISS' | 'PENDING'; actual_hrr: number | null }

async function computeOutcome(
  gameId: number,
  playerId: number,
  rung: Rung,
  cache: Map<number, Awaited<ReturnType<typeof fetchBoxscore>>>,
): Promise<BoxscoreResult> {
  let boxscore = cache.get(gameId)
  if (!boxscore) {
    try {
      boxscore = await fetchBoxscore(gameId)
      cache.set(gameId, boxscore)
    } catch {
      return { outcome: 'PENDING', actual_hrr: null }
    }
  }
  if (boxscore.status !== 'final') return { outcome: 'PENDING', actual_hrr: null }

  const stats = boxscore.playerStats[playerId]
  if (!stats) return { outcome: 'MISS', actual_hrr: 0 }

  const actualHRR = stats.hits + stats.runs + stats.rbis
  return { outcome: actualHRR >= rung ? 'HIT' : 'MISS', actual_hrr: actualHRR }
}

// ============================================================================
// snapshotLockedPicks
// ============================================================================

function collectTracked(current: PicksResponse): Array<Pick & { rung: Rung }> {
  const tracked: Array<Pick & { rung: Rung }> = []
  for (const p of current.rung1) if (p.tier === 'tracked') tracked.push({ ...p, rung: 1 })
  for (const p of current.rung2) if (p.tier === 'tracked') tracked.push({ ...p, rung: 2 })
  for (const p of current.rung3) if (p.tier === 'tracked') tracked.push({ ...p, rung: 3 })
  return tracked
}

/**
 * Snapshot Tracked picks for a single date. Reads picks:current:YYYY-MM-DD,
 * filters to tier === 'tracked', writes to Supabase locked_picks table.
 *
 * Idempotent via UNIQUE(date, game_id, player_id, rung) + upsert.
 * Falls back to KV blob write when Supabase is unavailable (local dev / tests).
 */
export async function snapshotLockedPicks(date: string): Promise<{ locked: number; alreadyLocked: boolean }> {
  const current = await kvGet<PicksResponse>(`picks:current:${date}`)

  if (!isSupabaseAvailable()) {
    // KV fallback path
    const lockedKey = `picks:locked:${date}`
    const existing = await kvGet<LockedDay>(lockedKey)
    if (existing) return { locked: existing.picks.length, alreadyLocked: true }
    if (!current) return { locked: 0, alreadyLocked: false }

    const tracked = collectTracked(current)
    await kvSet(lockedKey, { date, lockedAt: new Date().toISOString(), picks: tracked }, 60 * 24 * 60 * 60)
    return { locked: tracked.length, alreadyLocked: false }
  }

  const supabase = getSupabase()!

  // Check for existing rows to determine alreadyLocked
  const { data: existing, error: selectErr } = await supabase
    .from('locked_picks')
    .select('id')
    .eq('date', date)
    .limit(1)
  if (selectErr) throw new Error(`locked_picks select failed: ${selectErr.message}`)

  if (existing && existing.length > 0) {
    const { count } = await supabase
      .from('locked_picks')
      .select('*', { count: 'exact', head: true })
      .eq('date', date)
    return { locked: count ?? 0, alreadyLocked: true }
  }

  if (!current) return { locked: 0, alreadyLocked: false }

  const tracked = collectTracked(current)
  if (tracked.length === 0) return { locked: 0, alreadyLocked: false }

  const { error: upsertErr } = await supabase
    .from('locked_picks')
    .upsert(tracked.map(p => pickToLockedRow(date, p)), { onConflict: 'date,game_id,player_id,rung' })
  if (upsertErr) throw new Error(`locked_picks upsert failed: ${upsertErr.message}`)

  return { locked: tracked.length, alreadyLocked: false }
}

// ============================================================================
// settlePicks
// ============================================================================

/**
 * Settle previous-day picks. For each locked pick, fetch the boxscore,
 * compute actual H+R+RBI, UPSERT outcome into settled_picks.
 *
 * Falls back to KV blob when Supabase is unavailable.
 */
export async function settlePicks(date: string): Promise<{ settled: number; pending: number; alreadySettled: boolean }> {
  if (!isSupabaseAvailable()) {
    return settlePicksKv(date)
  }

  const supabase = getSupabase()!

  // Check if already fully settled
  const { data: existing, error: checkErr } = await supabase
    .from('settled_picks')
    .select('outcome')
    .eq('date', date)
  if (checkErr) throw new Error(`settled_picks select failed: ${checkErr.message}`)

  if (existing && existing.length > 0 && existing.every(r => r.outcome !== 'PENDING')) {
    return { settled: existing.length, pending: 0, alreadySettled: true }
  }

  const { data: lockedRows, error: lockedErr } = await supabase
    .from('locked_picks')
    .select('*')
    .eq('date', date)
  if (lockedErr) throw new Error(`locked_picks read failed: ${lockedErr.message}`)
  if (!lockedRows || lockedRows.length === 0) return { settled: 0, pending: 0, alreadySettled: false }

  const cache = new Map<number, Awaited<ReturnType<typeof fetchBoxscore>>>()
  const settledRows: SettledPickRow[] = []
  let pendingCount = 0

  for (const row of lockedRows as LockedPickRow[]) {
    const result = await computeOutcome(row.game_id, row.player_id, row.rung as Rung, cache)
    if (result.outcome === 'PENDING') pendingCount++
    settledRows.push({ ...row, ...result })
  }

  const { error: upsertErr } = await supabase
    .from('settled_picks')
    .upsert(settledRows, { onConflict: 'date,game_id,player_id,rung' })
  if (upsertErr) throw new Error(`settled_picks upsert failed: ${upsertErr.message}`)

  return { settled: settledRows.length, pending: pendingCount, alreadySettled: false }
}

async function settlePicksKv(date: string): Promise<{ settled: number; pending: number; alreadySettled: boolean }> {
  const settledKey = `picks:settled:${date}`
  const existing = await kvGet<SettledDay>(settledKey)
  if (existing && existing.picks.every(p => p.outcome !== 'PENDING')) {
    return { settled: existing.picks.length, pending: 0, alreadySettled: true }
  }

  const locked = await kvGet<LockedDay>(`picks:locked:${date}`)
  if (!locked) return { settled: 0, pending: 0, alreadySettled: false }

  const cache = new Map<number, Awaited<ReturnType<typeof fetchBoxscore>>>()
  const settled: SettledPick[] = []
  let pendingCount = 0

  for (const p of locked.picks) {
    const { outcome, actual_hrr } = await computeOutcome(p.gameId, p.player.playerId, p.rung, cache)
    if (outcome === 'PENDING') pendingCount++
    settled.push({ ...p, outcome, ...(actual_hrr !== null ? { actualHRR: actual_hrr } : {}) })
  }

  await kvSet(settledKey, { date, picks: settled }, 365 * 24 * 60 * 60)
  return { settled: settled.length, pending: pendingCount, alreadySettled: false }
}

// ============================================================================
// getSettledPicks
// ============================================================================

/**
 * Return all settled picks on or after sinceDate, ordered newest-first.
 * Used by app/api/history/route.ts to replace 30 sequential KV gets.
 *
 * Falls back to iterating KV date keys when Supabase is unavailable.
 */
export async function getSettledPicks(args: { sinceDate: string }): Promise<SettledPickRow[]> {
  if (isSupabaseAvailable()) {
    const supabase = getSupabase()!
    const { data, error } = await supabase
      .from('settled_picks')
      .select('*')
      .gte('date', args.sinceDate)
      .order('date', { ascending: false })
    if (error) throw new Error(`settled_picks query failed: ${error.message}`)
    return (data ?? []) as SettledPickRow[]
  }

  // KV fallback: walk dates from today back to sinceDate
  const rows: SettledPickRow[] = []
  const since = new Date(args.sinceDate)
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)

  while (cursor >= since) {
    const dateStr = cursor.toISOString().slice(0, 10)
    const day = await kvGet<SettledDay>(`picks:settled:${dateStr}`)
    if (day) {
      for (const p of day.picks) {
        rows.push(settledPickToRow(day.date, p as SettledPick & { rung: Rung }))
      }
    }
    cursor.setDate(cursor.getDate() - 1)
  }

  return rows
}

// ============================================================================
// computeRollingMetrics
// ============================================================================

export interface RungMetrics {
  rung: Rung
  hits: number
  total: number
  rate: number
  predicted_avg: number
  brier: number
}

/**
 * Pure function — no I/O. Aggregates settled rows into per-rung hit rate,
 * predicted average, and Brier score. PENDING rows are excluded.
 */
export function computeRollingMetrics(rows: SettledPickRow[]): RungMetrics[] {
  type Acc = { hits: number; total: number; sumPred: number; sumBrier: number }
  const buckets = new Map<Rung, Acc>([1, 2, 3].map(r => [r as Rung, { hits: 0, total: 0, sumPred: 0, sumBrier: 0 }]))

  for (const row of rows) {
    if (row.outcome === 'PENDING') continue
    const b = buckets.get(row.rung as Rung)!
    const actual = row.outcome === 'HIT' ? 1 : 0
    b.hits += actual
    b.total += 1
    b.sumPred += row.p_matchup
    b.sumBrier += (row.p_matchup - actual) ** 2
  }

  return ([1, 2, 3] as Rung[]).map(rung => {
    const { hits, total, sumPred, sumBrier } = buckets.get(rung)!
    return {
      rung,
      hits,
      total,
      rate: total > 0 ? hits / total : 0,
      predicted_avg: total > 0 ? sumPred / total : 0,
      brier: total > 0 ? sumBrier / total : 0,
    }
  })
}
