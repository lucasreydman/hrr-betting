import { lineupHash } from '@/lib/lineup'
import type { Lineup } from '@/lib/types'

const mkLineup = (overrides: Partial<Lineup> = {}): Lineup => ({
  status: 'confirmed',
  entries: Array.from({ length: 9 }, (_, i) => ({
    slot: i + 1,
    player: {
      playerId: 100 + i,
      fullName: `Player ${i + 1}`,
      team: 'NYY',
      bats: 'R' as const,
    },
  })),
  ...overrides,
})

test('lineupHash is deterministic for same input', () => {
  const a = mkLineup()
  const b = mkLineup()
  expect(lineupHash(a)).toBe(lineupHash(b))
})

test('lineupHash differs when slot reorder', () => {
  const a = mkLineup()
  const b = mkLineup()
  // Swap slots 1 and 2
  ;[b.entries[0].slot, b.entries[1].slot] = [b.entries[1].slot, b.entries[0].slot]
  expect(lineupHash(a)).not.toBe(lineupHash(b))
})

test('lineupHash differs when player changes', () => {
  const a = mkLineup()
  const b = mkLineup()
  b.entries[0].player.playerId = 999
  expect(lineupHash(a)).not.toBe(lineupHash(b))
})

test('lineupHash differs between estimated and confirmed status', () => {
  const a = mkLineup({ status: 'estimated' })
  const b = mkLineup({ status: 'confirmed' })
  expect(lineupHash(a)).not.toBe(lineupHash(b))
})
