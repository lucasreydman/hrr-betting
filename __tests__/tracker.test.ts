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
  test('locks when lineup confirmed AND >= 90 min before first pitch', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T22:00:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
      lineupStatus: 'confirmed',
    })).toBe(true)
  })

  test('does NOT lock for confirmed lineup if > 90 min remain', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T20:00:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
      lineupStatus: 'confirmed',
    })).toBe(false)
  })

  test('locks at 30 min before first pitch regardless of lineup status', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T23:00:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
      lineupStatus: 'estimated',
    })).toBe(true)
  })

  test('does NOT lock at 31 min if lineup not confirmed', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T22:59:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
      lineupStatus: 'estimated',
    })).toBe(false)
  })

  test('always locks within 30 min, even with confirmed lineup', () => {
    expect(shouldLock({
      now: new Date('2025-07-04T23:25:00Z').getTime(),
      firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
      lineupStatus: 'confirmed',
    })).toBe(true)
  })
})

describe('snapshotLockedPicks (in-memory KV)', () => {
  test('returns 0 when no current picks exist', async () => {
    const result = await snapshotLockedPicks('2099-12-31')
    expect(result.locked).toBe(0)
    expect(result.alreadyLocked).toBe(false)
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
