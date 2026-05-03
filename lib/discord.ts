/**
 * Discord webhook notifications for tracked-tier picks.
 *
 * Two events fire:
 *   1. Lock — `/api/lock` calls `postLockNotifications` after a successful
 *      `snapshotLockedPicks`. One embed per game with at least one un-notified
 *      tracked pick. Idempotency lives on the `discord_notified_at` column of
 *      `locked_picks`: rows with NULL are the queue, then set to NOW() after
 *      a successful POST.
 *   2. Settle — `/api/settle` calls `postSettleDigest` after `settlePicks`.
 *      One embed per day summarising rung W/L. Idempotency lives in KV
 *      (`discord:settle:${date}`) so manual re-dispatches don't double-post.
 *
 * Env-gated by `DISCORD_WEBHOOK_URL`. When unset, all functions no-op and
 * return false — the cron route's behaviour is unchanged.
 *
 * Network failures are logged + swallowed; they never propagate up. The
 * un-notified rows simply wait for the next cron tick (5 min during slate
 * hours).
 *
 * Server-only — never import from client components. Webhook URL holds no
 * secret beyond itself, but it's still env config and stays out of the
 * browser bundle.
 */

import { sanitizeEnvValue } from './env'
import { getSupabase, isSupabaseAvailable } from './db'
import type { LockedPickRow, SettledPickRow } from './db'
import { kvGet, kvSet } from './kv'
import type { Game, Rung } from './types'
import type { PicksResponse, Pick } from './ranker'

// ============================================================================
// Constants
// ============================================================================

const COLOR_LOCK = 0x3b82f6   // blue — matches the project's tracked-tier tag
const COLOR_DIGEST_GREEN = 0x22c55e
const COLOR_DIGEST_NEUTRAL = 0x6b7280

// Discord embed limits we have to respect.
const MAX_FIELD_VALUE = 1024
const MAX_DESC = 4096
const MAX_FIELDS = 25

// Live board URL — used as the clickable target on the lock embed title so a
// notification tap takes you straight to the board to verify and place the bet.
const SITE_URL = 'https://hrr-betting.vercel.app/'

// Default mention for lock messages. Discord channels only push-notify on
// mention by default, so without this a tracked lock would land silently and
// could be missed. The user can override or disable via DISCORD_LOCK_MENTION.
const DEFAULT_LOCK_MENTION = '@everyone'

// ============================================================================
// Embed types (subset of Discord's API we actually use)
// ============================================================================

export interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordEmbed {
  title?: string
  description?: string
  url?: string
  color?: number
  fields?: DiscordEmbedField[]
  footer?: { text: string }
  timestamp?: string
}

export interface DiscordWebhookBody {
  content?: string
  embeds: DiscordEmbed[]
  // Webhooks default to NOT firing real pings even if the content contains
  // @everyone / role / user mentions — Discord requires opting in. We pass
  // permissive parse for the lock message so the configured mention actually
  // notifies on phones; settle digests omit this so the recap stays quiet.
  allowed_mentions?: { parse?: Array<'everyone' | 'roles' | 'users'> }
}

// ============================================================================
// Lock embed
// ============================================================================

/**
 * Group rows by player so a player who clears multiple rungs gets one block,
 * not three. Returns players in lineup-slot order so the embed reads top-down.
 */
function groupByPlayer(picks: LockedPickRow[]): Array<{
  playerId: number
  playerName: string
  playerTeam: string
  bats: 'R' | 'L' | 'S'
  lineupSlot: number
  rungs: LockedPickRow[]  // sorted ascending
}> {
  const byPlayer = new Map<number, LockedPickRow[]>()
  for (const p of picks) {
    const list = byPlayer.get(p.player_id) ?? []
    list.push(p)
    byPlayer.set(p.player_id, list)
  }
  return [...byPlayer.entries()]
    .map(([playerId, rows]) => {
      const sorted = [...rows].sort((a, b) => a.rung - b.rung)
      const first = sorted[0]
      return {
        playerId,
        playerName: first.player_name,
        playerTeam: first.player_team,
        bats: first.player_bats,
        lineupSlot: first.lineup_slot,
        rungs: sorted,
      }
    })
    .sort((a, b) => a.lineupSlot - b.lineupSlot)
}

function formatRungLine(row: LockedPickRow): string {
  const sign = row.edge >= 0 ? '+' : ''
  return `**${row.rung}+ HRR** · prob ${row.p_matchup.toFixed(2)} · edge ${sign}${row.edge.toFixed(2)} · conf ${row.confidence.toFixed(2)}`
}

/**
 * Build a single-game lock embed. `picks` MUST all share the same `game_id`.
 * Caller is responsible for grouping; passing mixed games will produce
 * misleading output.
 *
 * `game` is used for opponent abbreviations + first-pitch unix time. Falls
 * back to the row's `opponent_abbrev` when the schedule lookup is missing.
 */
export function buildLockEmbed(args: {
  picks: LockedPickRow[]
  game?: Game
  opposingPitcher?: { name: string; throws?: 'R' | 'L' | 'S' }
}): DiscordEmbed {
  const { picks, game, opposingPitcher } = args
  if (picks.length === 0) {
    throw new Error('buildLockEmbed: picks must be non-empty')
  }

  const first = picks[0]
  const players = groupByPlayer(picks)

  // Title: away @ home. We try the schedule for proper abbrevs; otherwise
  // fall back to "{playerTeam} vs {opponentAbbrev}" which is less precise
  // about home/away but always correct factually.
  let matchup: string
  if (game) {
    matchup = `${game.awayTeam.abbrev} @ ${game.homeTeam.abbrev}`
  } else {
    matchup = `${first.player_team} vs ${first.opponent_abbrev}`
  }

  // Description: discord <t:UNIX:t> renders as "7:10 PM" in viewer's local TZ.
  const firstPitchUnix = game ? Math.floor(new Date(game.gameDate).getTime() / 1000) : null
  const description = firstPitchUnix
    ? `First pitch <t:${firstPitchUnix}:t> · <t:${firstPitchUnix}:R>`
    : undefined

  const fields: DiscordEmbedField[] = players.slice(0, MAX_FIELDS).map(p => ({
    name: `${p.playerName} (${p.playerTeam}) · ${p.bats}HB · #${p.lineupSlot}`,
    value: p.rungs.map(formatRungLine).join('\n').slice(0, MAX_FIELD_VALUE),
    inline: false,
  }))

  const footer = opposingPitcher
    ? { text: `Opposing pitcher: ${opposingPitcher.name}${opposingPitcher.throws ? ` (${opposingPitcher.throws}HP)` : ''}` }
    : undefined

  return {
    title: `🔒 Tracked locked — ${matchup}`,
    ...(description ? { description } : {}),
    url: SITE_URL,
    color: COLOR_LOCK,
    fields,
    ...(footer ? { footer } : {}),
    timestamp: new Date().toISOString(),
  }
}

// ============================================================================
// Settle digest embed
// ============================================================================

interface RungBucket {
  rung: Rung
  hits: SettledPickRow[]
  misses: SettledPickRow[]
  pending: SettledPickRow[]
}

function bucketSettled(rows: SettledPickRow[]): RungBucket[] {
  const buckets: Record<Rung, RungBucket> = {
    1: { rung: 1, hits: [], misses: [], pending: [] },
    2: { rung: 2, hits: [], misses: [], pending: [] },
    3: { rung: 3, hits: [], misses: [], pending: [] },
  }
  for (const r of rows) {
    const b = buckets[r.rung as Rung]
    if (r.outcome === 'HIT') b.hits.push(r)
    else if (r.outcome === 'MISS') b.misses.push(r)
    else b.pending.push(r)
  }
  return [buckets[1], buckets[2], buckets[3]]
}

function rungSummaryLine(b: RungBucket): string {
  const settled = b.hits.length + b.misses.length
  if (settled === 0 && b.pending.length === 0) {
    return `**${b.rung}+ HRR** — no tracked picks`
  }
  if (settled === 0) {
    return `**${b.rung}+ HRR** — ${b.pending.length} pending`
  }
  const rate = (b.hits.length / settled) * 100
  const avgPredicted = (b.hits.concat(b.misses).reduce((s, r) => s + r.p_matchup, 0) / settled) * 100
  const edgePp = rate - avgPredicted
  const edgeSign = edgePp >= 0 ? '+' : ''
  const pendingNote = b.pending.length > 0 ? ` · ${b.pending.length} pending` : ''
  return `**${b.rung}+ HRR**  ✅ ${b.hits.length}  ❌ ${b.misses.length}  · hit rate **${rate.toFixed(1)}%**  · vs predicted ${edgeSign}${edgePp.toFixed(1)}pp${pendingNote}`
}

/**
 * Format a single hit/miss line for the player roster fields. Includes actual
 * HRR for hits so the reader sees how much the pick beat its rung by.
 */
function formatPlayerOutcome(r: SettledPickRow): string {
  const hrr = r.actual_hrr ?? 0
  return `${r.player_name} (${r.rung}+, ${hrr})`
}

export function buildSettleDigestEmbed(args: {
  date: string
  rows: SettledPickRow[]
}): DiscordEmbed | null {
  const { date, rows } = args
  if (rows.length === 0) return null

  const buckets = bucketSettled(rows)

  const description = buckets.map(rungSummaryLine).join('\n')

  const allHits = buckets.flatMap(b => b.hits).sort((a, b) => (b.actual_hrr ?? 0) - (a.actual_hrr ?? 0))
  const allMisses = buckets.flatMap(b => b.misses)

  const fields: DiscordEmbedField[] = []
  if (allHits.length > 0) {
    const text = allHits.map(formatPlayerOutcome).join(' · ').slice(0, MAX_FIELD_VALUE)
    fields.push({ name: `✅ Hits (${allHits.length})`, value: text, inline: false })
  }
  if (allMisses.length > 0) {
    const text = allMisses.map(formatPlayerOutcome).join(' · ').slice(0, MAX_FIELD_VALUE)
    fields.push({ name: `❌ Misses (${allMisses.length})`, value: text, inline: false })
  }

  const totalSettled = buckets.reduce((s, b) => s + b.hits.length + b.misses.length, 0)
  const totalHits = buckets.reduce((s, b) => s + b.hits.length, 0)
  const overallHitRate = totalSettled > 0 ? totalHits / totalSettled : 0
  const color = overallHitRate >= 0.5 ? COLOR_DIGEST_GREEN : COLOR_DIGEST_NEUTRAL

  const distinctGames = new Set(rows.map(r => r.game_id)).size

  return {
    title: `📊 Tracked recap — ${date}`,
    description: description.slice(0, MAX_DESC),
    color,
    fields,
    footer: { text: `${rows.length} picks across ${distinctGames} games` },
    timestamp: new Date().toISOString(),
  }
}

// ============================================================================
// Webhook POST
// ============================================================================

function getWebhookUrl(): string | undefined {
  return sanitizeEnvValue(process.env.DISCORD_WEBHOOK_URL)
}

export function isDiscordEnabled(): boolean {
  return getWebhookUrl() !== undefined
}

/**
 * POST a webhook body. Returns true on 2xx, false otherwise (including when
 * the env var is unset). Never throws — Discord failures must not break the
 * cron route. Errors are logged so they're visible in Vercel logs.
 */
export async function postWebhook(body: DiscordWebhookBody): Promise<boolean> {
  const url = getWebhookUrl()
  if (!url) return false
  if (body.embeds.length === 0) return false

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.error(`[discord] webhook POST failed: ${res.status} ${res.statusText}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[discord] webhook POST threw:`, err)
    return false
  }
}

// ============================================================================
// High-level helpers used by the cron routes
// ============================================================================

/**
 * Group picks by game, build one embed per game, post sequentially. Returns
 * the set of `locked_picks.id` values that were successfully notified — the
 * caller updates `discord_notified_at` for these.
 *
 * Sequential (not parallel) to stay well clear of Discord's 5-req/2s rate
 * limit. At our peak observed volume (~5 games locking together) this is
 * still <2s wall-clock.
 *
 * `gameLookup` is a Map<gameId, Game> built by the caller from the slate
 * schedule. Missing entries fall back to row metadata for a degraded but
 * correct embed.
 *
 * `pitcherLookup` is a Map<gameId, {name, throws}> built by the caller
 * from the slate's lineup data. Optional — missing entries skip the footer.
 */
export async function postLockNotifications(args: {
  pendingRows: LockedPickRow[]
  gameLookup: Map<number, Game>
  pitcherLookup?: Map<number, { name: string; throws?: 'R' | 'L' | 'S' }>
}): Promise<{ notifiedIds: number[]; gamesPosted: number }> {
  const { pendingRows, gameLookup, pitcherLookup } = args
  if (!isDiscordEnabled() || pendingRows.length === 0) {
    return { notifiedIds: [], gamesPosted: 0 }
  }

  const byGame = new Map<number, LockedPickRow[]>()
  for (const r of pendingRows) {
    const list = byGame.get(r.game_id) ?? []
    list.push(r)
    byGame.set(r.game_id, list)
  }

  const notifiedIds: number[] = []
  let gamesPosted = 0

  // Resolve the lock-message mention. Default `@everyone` so phone push
  // notifications fire reliably; user can override via DISCORD_LOCK_MENTION
  // (e.g. `@here`, a `<@USER_ID>` direct mention, or empty to disable).
  const rawMention = process.env.DISCORD_LOCK_MENTION
  const mention = rawMention === undefined
    ? DEFAULT_LOCK_MENTION
    : (sanitizeEnvValue(rawMention) ?? '')

  for (const [gameId, picks] of byGame) {
    const embed = buildLockEmbed({
      picks,
      game: gameLookup.get(gameId),
      opposingPitcher: pitcherLookup?.get(gameId),
    })
    const body: DiscordWebhookBody = {
      embeds: [embed],
      ...(mention ? {
        content: mention,
        allowed_mentions: { parse: ['everyone', 'roles', 'users'] },
      } : {}),
    }
    const ok = await postWebhook(body)
    if (ok) {
      gamesPosted++
      for (const p of picks) {
        if (typeof p.id === 'number') notifiedIds.push(p.id)
      }
    }
  }

  return { notifiedIds, gamesPosted }
}

/**
 * Build + post the daily settle digest. Returns true on successful POST.
 * Caller is responsible for the KV idempotency flag.
 */
export async function postSettleDigest(args: {
  date: string
  rows: SettledPickRow[]
}): Promise<boolean> {
  if (!isDiscordEnabled() || args.rows.length === 0) return false
  const embed = buildSettleDigestEmbed(args)
  if (!embed) return false
  return postWebhook({ embeds: [embed] })
}

// ============================================================================
// Orchestrators (called by the cron routes)
// ============================================================================

/**
 * Build a `Map<gameId, opposingPitcher>` from a fresh PicksResponse. All picks
 * for the same game face the same starter, so we just pick the first.
 *
 * Used by the lock route — `locked_picks` rows don't persist pitcher metadata,
 * but the in-memory PicksResponse that produced them does.
 */
function pitcherLookupFromPicks(picks: PicksResponse): Map<number, { name: string; throws?: 'R' | 'L' | 'S' }> {
  const out = new Map<number, { name: string; throws?: 'R' | 'L' | 'S' }>()
  const all: Pick[] = [...picks.rung1, ...picks.rung2, ...picks.rung3]
  for (const p of all) {
    if (out.has(p.gameId)) continue
    const sp = p.opposingPitcher
    if (!sp || sp.name === 'unknown') continue
    out.set(p.gameId, { name: sp.name, throws: sp.throws as ('R' | 'L' | 'S' | undefined) })
  }
  return out
}

/**
 * End-to-end lock-notification flow for a slate date:
 *   1. Query locked_picks for `discord_notified_at IS NULL` on the date.
 *   2. Group by game_id, post one embed per game.
 *   3. UPDATE notified rows to NOW().
 *
 * No-op when:
 *   · DISCORD_WEBHOOK_URL is unset
 *   · Supabase is unavailable (dev fallback can't track idempotency safely;
 *     KV fallback path stays Discord-quiet by design)
 *
 * Designed to be called inside `/api/lock` immediately after a successful
 * `snapshotLockedPicks`. Errors are swallowed to keep the cron green.
 *
 * `gamesForLookup` lets the caller hand in the schedule it already fetched
 * for the lock decision so we don't re-fetch it. `currentPicks` is the in-
 * memory PicksResponse the lock route just produced; we extract pitcher
 * metadata from it (locked_picks rows don't persist that).
 */
export async function processLockNotifications(args: {
  date: string
  gamesForLookup?: Game[]
  currentPicks?: PicksResponse
}): Promise<{ posted: number; notifiedIds: number[] }> {
  if (!isDiscordEnabled()) return { posted: 0, notifiedIds: [] }
  if (!isSupabaseAvailable()) return { posted: 0, notifiedIds: [] }

  const supabase = getSupabase()!

  try {
    const { data: pendingRows, error } = await supabase
      .from('locked_picks')
      .select('*')
      .eq('date', args.date)
      .is('discord_notified_at', null)
      .order('lineup_slot', { ascending: true })
    if (error) {
      console.error('[discord] pending query failed:', error.message)
      return { posted: 0, notifiedIds: [] }
    }
    if (!pendingRows || pendingRows.length === 0) {
      return { posted: 0, notifiedIds: [] }
    }

    const gameLookup = new Map<number, Game>(
      (args.gamesForLookup ?? []).map(g => [g.gameId, g]),
    )
    const pitcherLookup = args.currentPicks
      ? pitcherLookupFromPicks(args.currentPicks)
      : new Map<number, { name: string; throws?: 'R' | 'L' | 'S' }>()

    const { notifiedIds, gamesPosted } = await postLockNotifications({
      pendingRows: pendingRows as LockedPickRow[],
      gameLookup,
      pitcherLookup,
    })

    if (notifiedIds.length > 0) {
      const { error: updateErr } = await supabase
        .from('locked_picks')
        .update({ discord_notified_at: new Date().toISOString() })
        .in('id', notifiedIds)
      if (updateErr) {
        console.error('[discord] mark-notified update failed:', updateErr.message)
        // Rows will be re-attempted on next cron run — duplicate Discord
        // messages possible but rare (failure between successful POST and
        // successful UPDATE). Acceptable tradeoff.
      }
    }

    return { posted: gamesPosted, notifiedIds }
  } catch (err) {
    console.error('[discord] processLockNotifications threw:', err)
    return { posted: 0, notifiedIds: [] }
  }
}

/**
 * End-to-end settle-digest flow for a slate date. KV-flag idempotent so
 * manual re-dispatches don't double-post.
 */
export async function processSettleDigest(args: {
  date: string
}): Promise<{ posted: boolean; reason?: string }> {
  if (!isDiscordEnabled()) return { posted: false, reason: 'disabled' }
  if (!isSupabaseAvailable()) return { posted: false, reason: 'no-supabase' }

  const flagKey = `discord:settle:${args.date}`
  const already = await kvGet<string>(flagKey)
  if (already) return { posted: false, reason: 'already-posted' }

  const supabase = getSupabase()!
  try {
    const { data: rows, error } = await supabase
      .from('settled_picks')
      .select('*')
      .eq('date', args.date)
    if (error) {
      console.error('[discord] settled query failed:', error.message)
      return { posted: false, reason: 'query-error' }
    }
    if (!rows || rows.length === 0) {
      return { posted: false, reason: 'no-rows' }
    }

    const ok = await postSettleDigest({ date: args.date, rows: rows as SettledPickRow[] })
    if (ok) {
      // 7-day TTL — well past any plausible manual re-dispatch window.
      await kvSet(flagKey, '1', 7 * 24 * 60 * 60)
    }
    return { posted: ok, ...(ok ? {} : { reason: 'post-failed' }) }
  } catch (err) {
    console.error('[discord] processSettleDigest threw:', err)
    return { posted: false, reason: 'threw' }
  }
}

