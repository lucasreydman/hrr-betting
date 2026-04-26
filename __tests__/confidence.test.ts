import { computeConfidence, passesHardGates } from '@/lib/confidence'

describe('passesHardGates', () => {
  test('postponed game fails', () => {
    expect(passesHardGates({
      gameStatus: 'postponed',
      probableStarterId: 543037,
      lineupStatus: 'confirmed',
      expectedPA: 4,
    })).toBe(false)
  })

  test('TBD pitcher (null id) fails', () => {
    expect(passesHardGates({
      gameStatus: 'scheduled',
      probableStarterId: null,
      lineupStatus: 'confirmed',
      expectedPA: 4,
    })).toBe(false)
  })

  test('expected PA < 3 fails', () => {
    expect(passesHardGates({
      gameStatus: 'scheduled',
      probableStarterId: 543037,
      lineupStatus: 'confirmed',
      expectedPA: 2.5,
    })).toBe(false)
  })

  test('all conditions met: passes', () => {
    expect(passesHardGates({
      gameStatus: 'scheduled',
      probableStarterId: 543037,
      lineupStatus: 'estimated',  // estimated lineup is OK for hard gate
      expectedPA: 3,
    })).toBe(true)
  })

  test('lineup status null fails (must exist)', () => {
    expect(passesHardGates({
      gameStatus: 'scheduled',
      probableStarterId: 543037,
      lineupStatus: null as never,
      expectedPA: 4,
    })).toBe(false)
  })
})

describe('computeConfidence', () => {
  test('confirmed lineup + good samples + stable weather + non-opener → 1.0', () => {
    const c = computeConfidence({
      lineupStatus: 'confirmed',
      bvpAB: 25,
      pitcherStartCount: 12,
      weatherStable: true,
      isOpener: false,
      timeToFirstPitchMin: 60,
    })
    expect(c).toBeCloseTo(1.0, 2)
  })

  test('estimated lineup + zero BvP + few starts + volatile weather + opener → ~0.45', () => {
    const c = computeConfidence({
      lineupStatus: 'estimated',
      bvpAB: 0,
      pitcherStartCount: 3,
      weatherStable: false,
      isOpener: true,
      timeToFirstPitchMin: 240,
    })
    expect(c).toBeGreaterThan(0.40)
    expect(c).toBeLessThan(0.65)
  })

  test('partial lineup with otherwise good inputs', () => {
    const c = computeConfidence({
      lineupStatus: 'partial',
      bvpAB: 20,
      pitcherStartCount: 10,
      weatherStable: true,
      isOpener: false,
      timeToFirstPitchMin: 90,
    })
    expect(c).toBeCloseTo(0.85, 2)  // primarily limited by partial-lineup factor
  })

  test('opener reduces confidence by 0.90×', () => {
    const noOpener = computeConfidence({
      lineupStatus: 'confirmed',
      bvpAB: 25,
      pitcherStartCount: 12,
      weatherStable: true,
      isOpener: false,
      timeToFirstPitchMin: 60,
    })
    const opener = computeConfidence({
      lineupStatus: 'confirmed',
      bvpAB: 25,
      pitcherStartCount: 12,
      weatherStable: true,
      isOpener: true,
      timeToFirstPitchMin: 60,
    })
    expect(opener).toBeCloseTo(noOpener * 0.90, 3)
  })
})
