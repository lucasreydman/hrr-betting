import { shouldLock, snapshotLockedPicks, computeRollingMetrics } from '@/lib/tracker'
import type { SettledPickRow } from '@/lib/db'

function row(over: Partial<SettledPickRow> = {}): SettledPickRow {
  return {
    date: '2026-04-26',
    game_id: 1,
    rung: 1,
    player_id: 100,
    player_name: 'Test',
    player_team: 'NYY',
    player_bats: 'R',
    opponent_team_id: 147,
    opponent_abbrev: 'NYY',
    lineup_slot: 4,
    lineup_status: 'confirmed',
    p_matchup: 0.5,
    p_typical: 0.5,
    edge: 0,
    confidence: 1,
    score: 0,
    outcome: 'HIT',
    actual_hrr: 1,
    ...over,
  }
}

describe('shouldLock', () => {
  // Single threshold: lock fires when ≤ 30 min remain to first pitch.
  // Previously had a confirmed-lineup early-lock path at ≤ 90 min; that
  // committed picks based on data that could still meaningfully change
  // (weather forecasts, late scratches), and made the lock outcome
  // depend on cron-jitter timing. Tightening the threshold removes the
  // lottery and aligns lock-time with when conditions are stable.

  test('locks at 30 min before first pitch', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T23:00:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
    })).toBe(true)
  })

  test('locks at 5 min before first pitch (well inside the window)', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T23:25:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
    })).toBe(true)
  })

  test('locks past first pitch (in-progress catch-up)', () => {
    // Cron continues firing during the slate; if a pick became tracked
    // during the game it'd still get locked. timeUntilFirstPitch goes
    // negative but the ≤ 30 min check still fires.
    expect(shouldLock({
      now: new Date('2025-07-04T23:35:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
    })).toBe(true)
  })

  test('does NOT lock at 31 min before first pitch (just outside the window)', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T22:59:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
    })).toBe(false)
  })

  test('does NOT lock 90 minutes out — the early confirmed-lineup path is gone', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T22:00:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
    })).toBe(false)
  })

  test('does NOT lock 3 hours out', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T20:30:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
    })).toBe(false)
  })

  // Regression guard: the lock decision must depend ONLY on the UTC ms
  // delta between now and firstPitch — never on process.env.TZ, system
  // locale, DST status, or any timezone-aware date math.
  test('decision is invariant under process.env.TZ (UTC ms math only)', () => {
    const args = {
      now: new Date('2025-07-04T23:10:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
    }
    const originalTZ = process.env.TZ
    try {
      const decisions = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland'].map(tz => {
        process.env.TZ = tz
        return shouldLock(args)
      })
      expect(new Set(decisions).size).toBe(1)
      expect(decisions[0]).toBe(true)  // T-20 → fires
    } finally {
      if (originalTZ === undefined) delete process.env.TZ
      else process.env.TZ = originalTZ
    }
  })

  // Regression guard: a Pacific-coast late game crossing UTC-day rollover
  // must still compute the right delta. ms-since-epoch arithmetic handles
  // this trivially.
  test('handles games that span the UTC date boundary', () => {
    // First pitch 10:10 PM PT on Apr 26 = 05:10 UTC Apr 27.
    // Now: 9:50 PM PT on Apr 26 = 04:50 UTC Apr 27. 20 min before. Fires.
    expect(shouldLock({
      now: new Date('2026-04-27T04:50:00Z').getTime(),
      firstPitch: new Date('2026-04-27T05:10:00Z').getTime(),
    })).toBe(true)
    // 9:30 PM PT on Apr 26 = 04:30 UTC Apr 27. 40 min before. Does NOT fire.
    expect(shouldLock({
      now: new Date('2026-04-27T04:30:00Z').getTime(),
      firstPitch: new Date('2026-04-27T05:10:00Z').getTime(),
    })).toBe(false)
  })

  // Regression guard: DST transition day. If shouldLock were to convert
  // through a local timezone, you'd get a 60-min error around DST jumps.
  // ms-math is immune.
  test('DST-transition day computes correct delta', () => {
    // 2026 US DST starts Sun Mar 8 at 2 AM local.
    // 1:05 PM EDT = 17:05 UTC.
    // T-120 → does NOT fire.
    expect(shouldLock({
      now: new Date('2026-03-08T15:05:00Z').getTime(),
      firstPitch: new Date('2026-03-08T17:05:00Z').getTime(),
    })).toBe(false)
    // T-25 → fires.
    expect(shouldLock({
      now: new Date('2026-03-08T16:40:00Z').getTime(),
      firstPitch: new Date('2026-03-08T17:05:00Z').getTime(),
    })).toBe(true)
  })
})

describe('snapshotLockedPicks (in-memory KV)', () => {
  test('returns 0 when no current picks exist', async () => {
    const result = await snapshotLockedPicks({ date: '2099-12-31' })
    expect(result.locked).toBe(0)
    expect(result.newlyLocked).toBe(0)
    expect(result.alreadyLocked).toBe(false)
  })

  test('staggered slate: second call adds late-game tracked picks without overwriting earlier ones', async () => {
    // Regression test for the lock-route bug where existence of any prior
    // locked rows caused snapshotLockedPicks to bail out, dropping tracked
    // picks for late-confirming games entirely.
    const { kvSet } = await import('@/lib/kv')

    const date = '2099-11-30'
    const earlyPick = {
      player: { playerId: 600, fullName: 'Early', team: 'BOS', teamId: 111, bats: 'R' as const },
      isHome: false,
      opponent: { teamId: 147, abbrev: 'NYY' },
      opposingPitcher: { id: 1, name: 'P', status: 'confirmed' as const },
      gameId: 1,
      gameDate: `${date}T22:05:00Z`,
      lineupSlot: 4,
      lineupStatus: 'confirmed' as const,
      pMatchup: 0.9, pTypical: 0.8, edge: 0.125, confidence: 1, score: 0.125,
      tier: 'tracked' as const,
    }
    const latePick = { ...earlyPick, gameId: 2, player: { ...earlyPick.player, playerId: 700, fullName: 'Late' } }

    // First lock pass: only the early game has a Tracked pick (late game still
    // has an estimated lineup, doesn't pass the floor).
    await kvSet(`picks:current:${date}`, {
      date,
      refreshedAt: new Date().toISOString(),
      rung1: [earlyPick],
      rung2: [],
      rung3: [],
      meta: { gamesTotal: 2, fromCache: false, gameStates: { scheduled: 2, inProgress: 0, final: 0, postponed: 0 } },
    })
    const first = await snapshotLockedPicks({ date })
    expect(first.locked).toBe(1)
    expect(first.newlyLocked).toBe(1)
    expect(first.alreadyLocked).toBe(false)

    // Late-game lineup confirms; both picks now appear as Tracked in the
    // current picks blob. Second lock pass should add the late one and leave
    // the early one untouched.
    await kvSet(`picks:current:${date}`, {
      date,
      refreshedAt: new Date().toISOString(),
      rung1: [earlyPick, latePick],
      rung2: [],
      rung3: [],
      meta: { gamesTotal: 2, fromCache: false, gameStates: { scheduled: 2, inProgress: 0, final: 0, postponed: 0 } },
    })
    const second = await snapshotLockedPicks({ date })
    expect(second.locked).toBe(2)
    expect(second.newlyLocked).toBe(1)  // only the late pick is new
    expect(second.alreadyLocked).toBe(true)
  })
})

describe('computeRollingMetrics', () => {
  test('returns zeroed buckets when no rows', () => {
    const out = computeRollingMetrics([])
    expect(out).toHaveLength(3)
    for (const m of out) {
      expect(m.total).toBe(0)
      expect(m.hits).toBe(0)
      expect(m.rate).toBe(0)
      expect(m.brier).toBe(0)
    }
  })

  test('Brier score = 0.25 when all p_matchup=0.5 and outcomes split 50/50', () => {
    // Brier = mean((predicted - actual)^2). With p=0.5 and outcomes 0 or 1,
    // each (0.5 - 0)^2 = 0.25 and (0.5 - 1)^2 = 0.25. So Brier = 0.25 regardless of split.
    const rows: SettledPickRow[] = [
      row({ p_matchup: 0.5, outcome: 'HIT', actual_hrr: 1 }),
      row({ p_matchup: 0.5, outcome: 'MISS', actual_hrr: 0 }),
      row({ p_matchup: 0.5, outcome: 'HIT', actual_hrr: 1 }),
      row({ p_matchup: 0.5, outcome: 'MISS', actual_hrr: 0 }),
    ]
    const out = computeRollingMetrics(rows)
    const r1 = out.find(m => m.rung === 1)!
    expect(r1.total).toBe(4)
    expect(r1.hits).toBe(2)
    expect(r1.rate).toBe(0.5)
    expect(r1.brier).toBeCloseTo(0.25, 6)
    expect(r1.predicted_avg).toBeCloseTo(0.5, 6)
  })

  test('PENDING rows are excluded from totals', () => {
    const rows: SettledPickRow[] = [
      row({ outcome: 'HIT', actual_hrr: 1 }),
      row({ outcome: 'PENDING', actual_hrr: null }),
      row({ outcome: 'PENDING', actual_hrr: null }),
    ]
    const out = computeRollingMetrics(rows)
    expect(out.find(m => m.rung === 1)!.total).toBe(1)
  })

  test('per-rung bucketing keeps rungs separate', () => {
    const rows: SettledPickRow[] = [
      row({ rung: 1, outcome: 'HIT' }),
      row({ rung: 1, outcome: 'HIT' }),
      row({ rung: 2, outcome: 'MISS' }),
      row({ rung: 3, outcome: 'HIT' }),
    ]
    const out = computeRollingMetrics(rows)
    expect(out.find(m => m.rung === 1)!).toMatchObject({ hits: 2, total: 2, rate: 1 })
    expect(out.find(m => m.rung === 2)!).toMatchObject({ hits: 0, total: 1, rate: 0 })
    expect(out.find(m => m.rung === 3)!).toMatchObject({ hits: 1, total: 1, rate: 1 })
  })

  test('perfect calibration: predicted=actual on every row → Brier=0', () => {
    // p=1.0 + HIT → (1-1)^2 = 0. p=0 + MISS → (0-0)^2 = 0.
    const rows: SettledPickRow[] = [
      row({ p_matchup: 1.0, outcome: 'HIT' }),
      row({ p_matchup: 0.0, outcome: 'MISS' }),
    ]
    const out = computeRollingMetrics(rows)
    expect(out.find(m => m.rung === 1)!.brier).toBeCloseTo(0, 6)
  })
})
