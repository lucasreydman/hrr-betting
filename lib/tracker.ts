import { kvGet, kvSet } from './kv'
import { getSupabase, isSupabaseAvailable } from './db'
import type { LockedPickRow, SettledPickRow } from './db'
import type { Pick, PicksResponse } from './ranker'
import type { Rung } from './types'
import { fetchBoxscore } from './mlb-api'
import { slateDateString, shiftIsoDate } from './date-utils'

// ============================================================================
// Pure lock-trigger logic
// ============================================================================

export interface ShouldLockArgs {
  now: number         // Date.now() ms
  firstPitch: number  // ms timestamp of first pitch
}

/**
 * Lock trigger: a single threshold at ≤30 minutes before first pitch.
 *
 * Previously the gate had a confirmed-lineup early-lock at ≤90 min, but
 * that committed picks based on data that could still meaningfully
 * change in the next hour (weather forecasts update, late scratches,
 * pitcher-status flips). A pick that was tracked at T-45 min and dropped
 * to watching by T-35 min would still get locked under the old logic if
 * the cron happened to fire while it was tracked — a lottery based on
 * cron jitter, not on the pick's actual final state.
 *
 * Tightening to ≤30 min eliminates the early-lock window entirely. By
 * 30 min before first pitch, conditions are stable: lineups are posted,
 * pitcher status is committed, and weather forecasts for first pitch
 * are essentially final. Any pick that's tracked when the cron fires
 * inside that window genuinely meets the floors at decision-time.
 *
 * Late recoveries (pick goes from watching at T-25 → tracked at T-15)
 * still get locked: the cron continues firing every 5 min through to
 * first pitch, and `snapshotLockedPicks` is insert-only, so any pick
 * that lands in tracked at any cron run within the window gets added.
 */
export function shouldLock(args: ShouldLockArgs): boolean {
  const ms30 = 30 * 60 * 1000
  const timeUntilFirstPitch = args.firstPitch - args.now
  return timeUntilFirstPitch <= ms30
}

// ============================================================================
// Legacy blob types — kept for backward compat with existing test fixtures
// @deprecated — use LockedPickRow / SettledPickRow from lib/db.ts instead
// ============================================================================

export interface SettledPick extends Pick {
  rung: Rung
  date: string  // YYYY-MM-DD — slate date this pick belongs to
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
    player: {
      playerId: row.player_id, fullName: row.player_name, team: row.player_team,
      // teamId 0 = sentinel for locked picks that predate the teamId schema.
      // PickRow falls back to abbreviation format when teamId === 0.
      teamId: 0,
      bats: row.player_bats,
    },
    // isHome false = sentinel; PickRow falls back to abbreviation for teamId=0 picks.
    isHome: false,
    opponent: { teamId: row.opponent_team_id, abbrev: row.opponent_abbrev },
    // Locked picks predate the opposingPitcher schema; fill with sentinel so the
    // type matches. Future schema migration can persist the real pitcher metadata.
    opposingPitcher: { id: 0, name: 'unknown', status: 'confirmed' },
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
 * Insert-only semantics: existing locked rows are NEVER overwritten on a
 * later run (so late-fetched BvP / weather can't mutate a frozen pick), but
 * NEW picks that became Tracked since the prior lock pass DO get added. This
 * is critical for staggered slates: an early 5 PM lock fires before late-game
 * lineups confirm, so a 9 PM start's tracked picks need a later lock pass to
 * be captured. Without insert-only, the existence-check used to bail and
 * those picks were dropped entirely.
 *
 * Idempotent via UNIQUE(date, game_id, player_id, rung) + upsert with
 * ignoreDuplicates: re-runs are safe and additive.
 *
 * Returns:
 *   - `locked`: total locked rows for the date AFTER this call
 *   - `newlyLocked`: rows actually inserted by this call (0 if all were
 *     already locked or no new Tracked picks materialised)
 *   - `alreadyLocked`: true if at least one row existed before this call
 *
 * Falls back to KV blob write when Supabase is unavailable (local dev / tests).
 */
export async function snapshotLockedPicks(args: {
  date: string
  /**
   * Optional pre-computed picks. When omitted, falls back to the
   * `picks:current:{date}` cache. The lock route is responsible for
   * supplying a fresh `rankPicks` result when the cache is empty —
   * keeping that import out of `tracker.ts` avoids pulling the entire
   * ranker dependency tree into the settle function bundle (which
   * caused settle to 500 on cold-load before this refactor).
   */
  current?: PicksResponse
}): Promise<{
  locked: number
  newlyLocked: number
  alreadyLocked: boolean
}> {
  const { date } = args
  const current = args.current ?? await kvGet<PicksResponse>(`picks:current:${date}`)

  if (!isSupabaseAvailable()) {
    // KV fallback path — same insert-only semantics as the Supabase path
    const lockedKey = `picks:locked:${date}`
    const existing = await kvGet<LockedDay>(lockedKey)
    const alreadyLocked = existing != null

    if (!current) {
      return { locked: existing?.picks.length ?? 0, newlyLocked: 0, alreadyLocked }
    }

    const tracked = collectTracked(current)

    // Build a Set of (gameId, playerId, rung) keys already locked so we can
    // skip dupes — KV doesn't have a unique constraint to lean on.
    const existingKeys = new Set<string>(
      (existing?.picks ?? []).map(p => `${p.gameId}:${p.player.playerId}:${p.rung}`),
    )
    const fresh = tracked.filter(
      p => !existingKeys.has(`${p.gameId}:${p.player.playerId}:${p.rung}`),
    )

    const merged = [...(existing?.picks ?? []), ...fresh]
    if (merged.length > 0) {
      await kvSet(
        lockedKey,
        { date, lockedAt: existing?.lockedAt ?? new Date().toISOString(), picks: merged },
        60 * 24 * 60 * 60,
      )
    }

    return { locked: merged.length, newlyLocked: fresh.length, alreadyLocked }
  }

  const supabase = getSupabase()!

  // Count existing rows (used for alreadyLocked + the "before" delta).
  const { count: existingCount, error: selectErr } = await supabase
    .from('locked_picks')
    .select('*', { count: 'exact', head: true })
    .eq('date', date)
  if (selectErr) throw new Error(`locked_picks select failed: ${selectErr.message}`)

  const alreadyLocked = (existingCount ?? 0) > 0

  if (!current) {
    return { locked: existingCount ?? 0, newlyLocked: 0, alreadyLocked }
  }

  const tracked = collectTracked(current)
  if (tracked.length === 0) {
    return { locked: existingCount ?? 0, newlyLocked: 0, alreadyLocked }
  }

  // ignoreDuplicates: existing (date, game_id, player_id, rung) rows stay
  // frozen; only new combinations are inserted. This is the correctness
  // fix for staggered slates — it lets a 9 PM start's Tracked picks land in
  // a 7 PM cron run after the early-game lock already wrote rows.
  const { error: upsertErr } = await supabase
    .from('locked_picks')
    .upsert(tracked.map(p => pickToLockedRow(date, p)), {
      onConflict: 'date,game_id,player_id,rung',
      ignoreDuplicates: true,
    })
  if (upsertErr) throw new Error(`locked_picks upsert failed: ${upsertErr.message}`)

  // Re-count to compute the delta. Doing this rather than trusting the upsert
  // response lets us return precise newlyLocked even when Supabase doesn't
  // surface per-row conflict info.
  const { count: afterCount, error: afterErr } = await supabase
    .from('locked_picks')
    .select('*', { count: 'exact', head: true })
    .eq('date', date)
  if (afterErr) throw new Error(`locked_picks recount failed: ${afterErr.message}`)

  const finalCount = afterCount ?? 0
  return {
    locked: finalCount,
    newlyLocked: Math.max(0, finalCount - (existingCount ?? 0)),
    alreadyLocked,
  }
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

  // Pre-fetch all boxscores in parallel before iterating. The previous serial
  // for-loop fan-out made wall-clock ≈ N × per-fetch on cold cache, which on
  // a 15-game slate (~22s) blew Vercel's 10s function limit. Parallel pre-
  // fetch drops it to max(per-fetch) ≈ 1.5–2s.
  const cache = new Map<number, Awaited<ReturnType<typeof fetchBoxscore>>>()
  const distinctGameIds = [...new Set(lockedRows.map(r => r.game_id))]
  await Promise.all(
    distinctGameIds.map(async gid => {
      try {
        cache.set(gid, await fetchBoxscore(gid))
      } catch {
        // Leave the cache slot empty — computeOutcome falls back to PENDING
        // on cache miss + fetch failure.
      }
    }),
  )

  const settledRows: SettledPickRow[] = []
  let pendingCount = 0

  for (const row of lockedRows as LockedPickRow[]) {
    const result = await computeOutcome(row.game_id, row.player_id, row.rung as Rung, cache)
    if (result.outcome === 'PENDING') pendingCount++
    // Strip locked_picks-only columns (id, locked_at, discord_notified_at)
    // before upserting into settled_picks. Recent PostgREST versions reject
    // unknown columns by default; spreading the raw row used to silently work
    // but now 500s. Settled_picks owns its own id sequence and `settled_at`
    // default, and never uses the Discord notify marker.
    const {
      id: _lockedPicksId,
      locked_at: _lockedAt,
      discord_notified_at: _discordNotifiedAt,
      ...lockedFields
    } = row
    void _lockedPicksId
    void _lockedAt
    void _discordNotifiedAt
    settledRows.push({ ...lockedFields, ...result })
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
    settled.push({ ...p, date: locked.date, outcome, ...(actual_hrr !== null ? { actualHRR: actual_hrr } : {}) })
  }

  await kvSet(settledKey, { date, picks: settled }, 365 * 24 * 60 * 60)
  return { settled: settled.length, pending: pendingCount, alreadySettled: false }
}

// ============================================================================
// getSettledPicks
// ============================================================================

/**
 * Return the set of (game_id, player_id, rung) keys for picks already
 * locked into `locked_picks` for a slate. Used by the live ranker to
 * overlay tier='tracked' on picks whose lock window has fired — once a
 * pick has been frozen by `/api/lock`, the live board should keep showing
 * it as tracked even if real-time data (weather, lineup churn) drifts the
 * raw confidence below the floor.
 *
 * Returns each entry as the canonical lookup string `"{gameId}:{playerId}:{rung}"`.
 * Empty set on Supabase unavailable, fetch failure, or unlocked slate —
 * the live board falls back to its computed-from-current-data tier in
 * those cases (no tier overlay, behavior unchanged from pre-overlay model).
 *
 * Cheap: single SELECT of three integer columns; ~30-50ms against the
 * Supabase free tier. Caller can run it in parallel with other slate-prep
 * fetches.
 */
export async function getLockedPickKeysForDate(date: string): Promise<Set<string>> {
  if (!isSupabaseAvailable()) return new Set()
  const supabase = getSupabase()!
  try {
    const { data, error } = await supabase
      .from('locked_picks')
      .select('game_id, player_id, rung')
      .eq('date', date)
    if (error || !data) return new Set()
    return new Set(data.map(r => `${r.game_id}:${r.player_id}:${r.rung}`))
  } catch {
    return new Set()
  }
}

/**
 * Return settled picks ordered newest-first.
 *
 * `sinceDate` is optional. When omitted, returns all settled picks ever
 * (the page's headline record is all-time, not a rolling window). When
 * provided, only returns picks on or after that date.
 *
 * Falls back to iterating KV date keys when Supabase is unavailable.
 */
export async function getSettledPicks(args: { sinceDate?: string } = {}): Promise<SettledPickRow[]> {
  if (isSupabaseAvailable()) {
    const supabase = getSupabase()!
    let query = supabase
      .from('settled_picks')
      .select('*')
      .order('date', { ascending: false })
    if (args.sinceDate) query = query.gte('date', args.sinceDate)
    const { data, error } = await query
    if (error) throw new Error(`settled_picks query failed: ${error.message}`)
    return (data ?? []) as SettledPickRow[]
  }

  // KV fallback: walk dates from today's slate back to sinceDate. When no
  // sinceDate is given, walk back ~10 years (the whole history of the app
  // could not realistically exceed that, and the in-memory dev fallback
  // doesn't have a sane "list all keys" path).
  // Anchor on slateDateString() (ET 3AM rollover) instead of UTC today so
  // we don't skip a slate during the late-night ET window when UTC has
  // already rolled but ET hasn't. Anchor cursor at noon UTC and mutate via
  // setUTCDate so DST transitions in any local zone can't shift the cursor
  // off by a day during traversal.
  const sinceStr = args.sinceDate ?? shiftIsoDate(slateDateString(), -3650)
  const rows: SettledPickRow[] = []
  const since = new Date(`${sinceStr}T00:00:00Z`)
  const todayStr = slateDateString()
  const cursor = new Date(`${todayStr}T12:00:00Z`)

  while (cursor.getTime() >= since.getTime()) {
    const dateStr = cursor.toISOString().slice(0, 10)
    const day = await kvGet<SettledDay>(`picks:settled:${dateStr}`)
    if (day) {
      for (const p of day.picks) {
        rows.push(settledPickToRow(day.date, p as SettledPick & { rung: Rung }))
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1)
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
