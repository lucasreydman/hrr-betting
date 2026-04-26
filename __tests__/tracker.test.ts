import { shouldLock, snapshotLockedPicks } from '@/lib/tracker'

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
