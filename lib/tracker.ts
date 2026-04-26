import { kvGet, kvSet } from './kv'
import type { Pick, PicksResponse } from './ranker'
import type { Rung } from './types'
import { fetchBoxscore } from './mlb-api'

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

export interface SettledPick extends Pick {
  rung: Rung
  outcome: 'HIT' | 'MISS' | 'PENDING'
  actualHRR?: number
}

export interface LockedDay {
  date: string
  lockedAt: string
  picks: Array<Pick & { rung: Rung }>
}

export interface SettledDay {
  date: string
  picks: SettledPick[]
}

/**
 * Snapshot Tracked picks for a single date. Reads picks:current:YYYY-MM-DD,
 * filters to tier === 'tracked', writes picks:locked:YYYY-MM-DD.
 *
 * Idempotent: if picks:locked already exists for the date, this is a no-op
 * (locked picks are immutable once captured).
 */
export async function snapshotLockedPicks(date: string): Promise<{ locked: number; alreadyLocked: boolean }> {
  const lockedKey = `picks:locked:${date}`
  const existing = await kvGet<LockedDay>(lockedKey)
  if (existing) return { locked: existing.picks.length, alreadyLocked: true }

  const current = await kvGet<PicksResponse>(`picks:current:${date}`)
  if (!current) return { locked: 0, alreadyLocked: false }

  const tracked: Array<Pick & { rung: Rung }> = []
  for (const p of current.rung1) if (p.tier === 'tracked') tracked.push({ ...p, rung: 1 })
  for (const p of current.rung2) if (p.tier === 'tracked') tracked.push({ ...p, rung: 2 })
  for (const p of current.rung3) if (p.tier === 'tracked') tracked.push({ ...p, rung: 3 })

  const locked: LockedDay = {
    date,
    lockedAt: new Date().toISOString(),
    picks: tracked,
  }
  await kvSet(lockedKey, locked, 60 * 24 * 60 * 60)  // 60d TTL
  return { locked: tracked.length, alreadyLocked: false }
}

/**
 * Settle previous-day picks. For each locked pick, fetch the boxscore for that game,
 * compute the player's actual H+R+RBI, mark each rung HIT or MISS.
 */
export async function settlePicks(date: string): Promise<{ settled: number; pending: number; alreadySettled: boolean }> {
  const settledKey = `picks:settled:${date}`
  const existing = await kvGet<SettledDay>(settledKey)
  if (existing && existing.picks.every(p => p.outcome !== 'PENDING')) {
    return { settled: existing.picks.length, pending: 0, alreadySettled: true }
  }

  const locked = await kvGet<LockedDay>(`picks:locked:${date}`)
  if (!locked) return { settled: 0, pending: 0, alreadySettled: false }

  const settled: SettledPick[] = []
  let pendingCount = 0

  // Cache boxscores per game to avoid duplicate fetches
  const boxscoreCache = new Map<number, Awaited<ReturnType<typeof fetchBoxscore>>>()

  for (const p of locked.picks) {
    let boxscore = boxscoreCache.get(p.gameId)
    if (!boxscore) {
      try {
        boxscore = await fetchBoxscore(p.gameId)
        boxscoreCache.set(p.gameId, boxscore)
      } catch {
        // Boxscore fetch failed — leave pending
        settled.push({ ...p, outcome: 'PENDING' })
        pendingCount++
        continue
      }
    }

    if (boxscore.status !== 'final') {
      settled.push({ ...p, outcome: 'PENDING' })
      pendingCount++
      continue
    }

    const stats = boxscore.playerStats[p.player.playerId]
    if (!stats) {
      // Player didn't play — count as MISS (didn't clear any rung)
      settled.push({ ...p, outcome: 'MISS', actualHRR: 0 })
      continue
    }

    const actualHRR = stats.hits + stats.runs + stats.rbis
    const outcome: 'HIT' | 'MISS' = actualHRR >= p.rung ? 'HIT' : 'MISS'
    settled.push({ ...p, outcome, actualHRR })
  }

  const settledDay: SettledDay = { date, picks: settled }
  await kvSet(settledKey, settledDay, 365 * 24 * 60 * 60)  // 365d TTL
  return { settled: settled.length, pending: pendingCount, alreadySettled: false }
}
