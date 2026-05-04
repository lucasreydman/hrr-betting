import { computeConfidence, computeConfidenceBreakdown, passesHardGates } from '@/lib/confidence'

describe('passesHardGates', () => {
  test('postponed game fails', () => {
    expect(passesHardGates({
      gameStatus: 'postponed',
      probableStarterId: 543037,
      lineupStatus: 'confirmed',
      expectedPA: 4,
    })).toBe(false)
  })

  test('final game passes — kept in the data so the live board can show outcome', () => {
    expect(passesHardGates({
      gameStatus: 'final',
      probableStarterId: 543037,
      lineupStatus: 'confirmed',
      expectedPA: 4,
    })).toBe(true)
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
  // With batterSeasonPa:0 → sampleSize=0.85; maxCacheAgeSec:0 → dataFreshness=1.0
  // All existing tests must include the two new required fields.

  test('confirmed lineup + good samples + stable weather + non-opener → 0.85 (sampleSize floor)', () => {
    const c = computeConfidence({
      lineupStatus: 'confirmed',
      bvpAB: 25,
      pitcherStartCount: 12,
      weatherImpact: 0,
      isOpener: false,
      timeToFirstPitchMin: 60,
      batterSeasonPa: 0,
      maxCacheAgeSec: 0,
    })
    // All original factors = 1.0; sampleSize(0 PA)=0.85; dataFreshness=1.0 → product=0.85
    expect(c).toBeCloseTo(0.85, 2)
  })

  test('confirmed lineup + good samples + full PA + stable weather + non-opener → 1.0', () => {
    const c = computeConfidence({
      lineupStatus: 'confirmed',
      bvpAB: 25,
      pitcherStartCount: 12,
      weatherImpact: 0,
      isOpener: false,
      timeToFirstPitchMin: 60,
      batterSeasonPa: 200,
      maxCacheAgeSec: 0,
    })
    expect(c).toBeCloseTo(1.0, 2)
  })

  test('estimated lineup + zero BvP + few starts + volatile weather + opener → ~0.38', () => {
    const c = computeConfidence({
      lineupStatus: 'estimated',
      bvpAB: 0,
      pitcherStartCount: 3,
      weatherImpact: 0.25,  // post-cliff (≥0.20) → factor pins at 0.90
      isOpener: true,
      timeToFirstPitchMin: 240,
      batterSeasonPa: 0,
      maxCacheAgeSec: 0,
    })
    // Original factors: 0.70 * 0.90 * 0.90 * 0.90 * 0.95 * 0.90 ≈ 0.386
    // × sampleSize(0.85) × dataFreshness(1.0) ≈ 0.328
    expect(c).toBeGreaterThan(0.25)
    expect(c).toBeLessThan(0.55)
  })

  test('partial lineup with otherwise good inputs', () => {
    const c = computeConfidence({
      lineupStatus: 'partial',
      bvpAB: 20,
      pitcherStartCount: 10,
      weatherImpact: 0,
      isOpener: false,
      timeToFirstPitchMin: 30,  // ≤30 min → time pins to 1.0 even for partial
      batterSeasonPa: 200,
      maxCacheAgeSec: 0,
    })
    // All non-lineup factors = 1.0; lineup=0.85; sampleSize(200PA)=1.0; dataFreshness=1.0
    expect(c).toBeCloseTo(0.85, 2)
  })

  test('opener reduces confidence by 0.90× relative to non-opener', () => {
    const base = {
      lineupStatus: 'confirmed' as const,
      bvpAB: 25,
      pitcherStartCount: 12,
      weatherImpact: 0,
      timeToFirstPitchMin: 60,
      batterSeasonPa: 200,
      maxCacheAgeSec: 0,
    }
    const noOpener = computeConfidence({ ...base, isOpener: false })
    const opener = computeConfidence({ ...base, isOpener: true })
    expect(opener).toBeCloseTo(noOpener * 0.90, 3)
  })
})

describe('computeConfidenceBreakdown — pitcherStart factor (with prior-season backfill)', () => {
  const baseGood = {
    lineupStatus: 'confirmed' as const,
    bvpAB: 25,
    weatherImpact: 0,
    isOpener: false,
    timeToFirstPitchMin: 60,
    batterSeasonPa: 200,
    maxCacheAgeSec: 0,
  }

  test('rookie (0 prior, 0 current) pins to 0.90 floor', () => {
    const { factors } = computeConfidenceBreakdown({
      ...baseGood, pitcherStartCount: 0, priorSeasonStartsCount: 0,
    })
    expect(factors.pitcherStart).toBeCloseTo(0.90, 4)
  })

  test('rookie (0 prior, 6 current) hits the mid-ramp value ~0.943', () => {
    // No prior backfill → effectiveStarts = 6 → 0.90 + (3/7)*0.10 ≈ 0.9429
    const { factors } = computeConfidenceBreakdown({
      ...baseGood, pitcherStartCount: 6, priorSeasonStartsCount: 0,
    })
    expect(factors.pitcherStart).toBeCloseTo(0.9429, 3)
  })

  test('veteran (30 prior, 0 current) lifts to ~0.957 (effective 7)', () => {
    // min(7, 30) = 7. effective = 0 + 7 = 7. ramp: 0.90 + (4/7)*0.10 ≈ 0.9571
    const { factors } = computeConfidenceBreakdown({
      ...baseGood, pitcherStartCount: 0, priorSeasonStartsCount: 30,
    })
    expect(factors.pitcherStart).toBeCloseTo(0.9571, 3)
  })

  test('veteran (30 prior, 3 current) reaches the 1.00 ceiling (effective 10)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...baseGood, pitcherStartCount: 3, priorSeasonStartsCount: 30,
    })
    expect(factors.pitcherStart).toBeCloseTo(1.0, 4)
  })

  test('prior-season cap at 7: 100 prior ≡ 7 prior at the same current count', () => {
    const a = computeConfidenceBreakdown({
      ...baseGood, pitcherStartCount: 0, priorSeasonStartsCount: 100,
    })
    const b = computeConfidenceBreakdown({
      ...baseGood, pitcherStartCount: 0, priorSeasonStartsCount: 7,
    })
    expect(a.factors.pitcherStart).toBeCloseTo(b.factors.pitcherStart, 6)
  })

  test('omitted priorSeasonStartsCount is current-season-only (backwards compatible)', () => {
    // 5 current → 0.90 + (2/7)*0.10 ≈ 0.929
    const { factors } = computeConfidenceBreakdown({
      ...baseGood, pitcherStartCount: 5,
    })
    expect(factors.pitcherStart).toBeCloseTo(0.929, 3)
  })

  test('negative priorSeasonStartsCount clamps to 0 (no spurious boost)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...baseGood, pitcherStartCount: 0, priorSeasonStartsCount: -5,
    })
    expect(factors.pitcherStart).toBeCloseTo(0.90, 4)
  })
})

describe('computeConfidenceBreakdown — sampleSize factor', () => {
  const baseGood = {
    lineupStatus: 'confirmed' as const,
    bvpAB: 25,
    pitcherStartCount: 12,
    weatherImpact: 0,
    isOpener: false,
    timeToFirstPitchMin: 60,
    maxCacheAgeSec: 0,
  }

  test('0 PA → sampleSize = 0.85', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, batterSeasonPa: 0 })
    expect(factors.sampleSize).toBeCloseTo(0.85, 4)
  })

  test('200 PA → sampleSize = 1.0', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, batterSeasonPa: 200 })
    expect(factors.sampleSize).toBeCloseTo(1.0, 4)
  })

  test('100 PA → sampleSize = 0.925', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, batterSeasonPa: 100 })
    expect(factors.sampleSize).toBeCloseTo(0.925, 4)
  })

  test('clamps at lower bound: -5 PA → sampleSize = 0.85', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, batterSeasonPa: -5 })
    expect(factors.sampleSize).toBeCloseTo(0.85, 4)
  })

  test('clamps at upper bound: 500 PA → sampleSize = 1.0', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, batterSeasonPa: 500 })
    expect(factors.sampleSize).toBeCloseTo(1.0, 4)
  })
})

describe('computeConfidenceBreakdown — dataFreshness factor', () => {
  const baseGood = {
    lineupStatus: 'confirmed' as const,
    bvpAB: 25,
    pitcherStartCount: 12,
    weatherImpact: 0,
    isOpener: false,
    timeToFirstPitchMin: 60,
    batterSeasonPa: 200,
  }

  test('60s old → dataFreshness = 1.0', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, maxCacheAgeSec: 60 })
    expect(factors.dataFreshness).toBeCloseTo(1.0, 4)
  })

  test('5 min (300s) exactly → dataFreshness = 1.0', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, maxCacheAgeSec: 300 })
    expect(factors.dataFreshness).toBeCloseTo(1.0, 4)
  })

  test('30 min (1800s) → dataFreshness = 0.90', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, maxCacheAgeSec: 1800 })
    expect(factors.dataFreshness).toBeCloseTo(0.90, 4)
  })

  test('17.5 min (1050s) → dataFreshness ≈ 0.95', () => {
    // midpoint between 5 min and 30 min → 0.90 + 0.05 = 0.95
    const { factors } = computeConfidenceBreakdown({ ...baseGood, maxCacheAgeSec: 1050 })
    expect(factors.dataFreshness).toBeCloseTo(0.95, 4)
  })

  test('clamps above 30 min: 60 min → dataFreshness = 0.90', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, maxCacheAgeSec: 3600 })
    expect(factors.dataFreshness).toBeCloseTo(0.90, 4)
  })
})

describe('computeConfidenceBreakdown — weather factor', () => {
  const baseGood = {
    lineupStatus: 'confirmed' as const,
    bvpAB: 25,
    pitcherStartCount: 12,
    isOpener: false,
    timeToFirstPitchMin: 60,
    batterSeasonPa: 200,
    maxCacheAgeSec: 0,
  }

  test('neutral (impact = 0) → weather = 1.00', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, weatherImpact: 0 })
    expect(factors.weather).toBeCloseTo(1.0, 4)
  })

  test('within deadband (impact = 0.05) → weather = 1.00', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, weatherImpact: 0.05 })
    expect(factors.weather).toBeCloseTo(1.0, 4)
  })

  test('mid-ramp (impact = 0.10) → weather ≈ 0.967', () => {
    // 1.0 - ((0.10 - 0.05) / 0.15) * 0.10 = 1.0 - 0.0333 = 0.9667
    const { factors } = computeConfidenceBreakdown({ ...baseGood, weatherImpact: 0.10 })
    expect(factors.weather).toBeCloseTo(0.9667, 4)
  })

  test('hits floor (impact = 0.20) → weather = 0.90', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, weatherImpact: 0.20 })
    expect(factors.weather).toBeCloseTo(0.90, 4)
  })

  test('clamps at floor for extreme impact (impact = 0.50) → weather = 0.90', () => {
    const { factors } = computeConfidenceBreakdown({ ...baseGood, weatherImpact: 0.50 })
    expect(factors.weather).toBeCloseTo(0.90, 4)
  })
})

describe('computeConfidenceBreakdown — time factor', () => {
  const baseGood = {
    bvpAB: 25,
    pitcherStartCount: 12,
    weatherImpact: 0,
    isOpener: false,
    batterSeasonPa: 200,
    maxCacheAgeSec: 0,
  }

  test('confirmed lineup pins time to 1.0 even at 6 hours out', () => {
    const { factors } = computeConfidenceBreakdown({
      ...baseGood,
      lineupStatus: 'confirmed',
      timeToFirstPitchMin: 360,
    })
    expect(factors.time).toBeCloseTo(1.0, 4)
  })

  test('confirmed lineup pins time to 1.0 even at 12 hours out', () => {
    // Confirmed lineups don't get penalised for waiting — late scratches
    // are too rare to warrant a global haircut.
    const { factors } = computeConfidenceBreakdown({
      ...baseGood,
      lineupStatus: 'confirmed',
      timeToFirstPitchMin: 720,
    })
    expect(factors.time).toBeCloseTo(1.0, 4)
  })

  test('estimated lineup ≤30 min out → time = 1.0', () => {
    const { factors } = computeConfidenceBreakdown({
      ...baseGood,
      lineupStatus: 'estimated',
      timeToFirstPitchMin: 30,
    })
    expect(factors.time).toBeCloseTo(1.0, 4)
  })

  test('estimated lineup at 360 min (6 hrs) → time = 0.95', () => {
    const { factors } = computeConfidenceBreakdown({
      ...baseGood,
      lineupStatus: 'estimated',
      timeToFirstPitchMin: 360,
    })
    expect(factors.time).toBeCloseTo(0.95, 4)
  })

  test('estimated lineup mid-ramp (195 min) → time ≈ 0.975', () => {
    // midpoint between 30 and 360 → 1.0 - 0.5*0.05 = 0.975
    const { factors } = computeConfidenceBreakdown({
      ...baseGood,
      lineupStatus: 'estimated',
      timeToFirstPitchMin: 195,
    })
    expect(factors.time).toBeCloseTo(0.975, 4)
  })

  test('estimated lineup clamps at 0.95 floor for extreme distance', () => {
    const { factors } = computeConfidenceBreakdown({
      ...baseGood,
      lineupStatus: 'estimated',
      timeToFirstPitchMin: 1440,  // 24 hrs
    })
    expect(factors.time).toBeCloseTo(0.95, 4)
  })

  test('partial lineup uses the ramp (not confirmed gate)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...baseGood,
      lineupStatus: 'partial',
      timeToFirstPitchMin: 360,
    })
    expect(factors.time).toBeCloseTo(0.95, 4)
  })
})
