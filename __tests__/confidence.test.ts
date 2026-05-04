import { computeConfidence, computeConfidenceBreakdown, passesHardGates } from '@/lib/confidence'

// =============================================================================
// passesHardGates
// =============================================================================

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
      lineupStatus: 'estimated',
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

// =============================================================================
// Reusable fully-saturated-positive baseline (every factor ramps to ceiling).
// Tests override one field at a time to isolate that factor.
// =============================================================================

const allCeilings = {
  lineupStatus: 'confirmed' as const,
  bvpAB: 25,             // ≥20 → bvp ceiling
  pitcherActive: true,
  pitcherBf: 250,        // ≥200 → pitcher ceiling
  weatherImpact: 0,      // ≤0.05 → weather ceiling
  bullpenIp: 200,        // ≥150 → bullpen ceiling
  timeToFirstPitchMin: 60,
  isOpener: false,
  batterSeasonPa: 200,   // covers either branch
  batterCareerPa: 600,   // strong-prior branch
  maxCacheAgeSec: 0,     // ≤300 → dataFreshness ceiling
}

// =============================================================================
// computeConfidence — overall product
// =============================================================================

describe('computeConfidence', () => {
  test('all-ceiling inputs → product ≈ 1.0', () => {
    expect(computeConfidence(allCeilings)).toBeCloseTo(1.0, 3)
  })

  test('estimated lineup + factor-inactive everything else → 0.70 floor only', () => {
    // Lineup floors at 0.70; everything else neutralised because the
    // probability factor isn't using anything (TBD pitcher, no BvP, dome,
    // null bullpen, rookie batter). This is the "we have nothing but a
    // lineup guess" case — confidence should reflect *just* the lineup
    // uncertainty.
    const c = computeConfidence({
      lineupStatus: 'estimated',
      bvpAB: 0,
      pitcherActive: false,
      pitcherBf: 0,
      weatherImpact: 0,
      bullpenIp: null,
      timeToFirstPitchMin: 30,  // pin time to 1.0 even though estimated
      isOpener: false,
      batterSeasonPa: 0,
      batterCareerPa: 0,
      maxCacheAgeSec: 0,
    })
    // 0.70 (lineup) × 1.0 (bvp) × 1.0 (pitcher) × 1.0 (weather) × 1.0 (bullpen)
    //   × 0.85 (batterSample, no career prior) × 1.0 (time) × 1.0 (opener)
    //   × 1.0 (dataFreshness) = 0.595
    expect(c).toBeCloseTo(0.595, 3)
  })

  test('confirmed lineup, all factors active and at ceiling → exactly 1.0', () => {
    expect(computeConfidence(allCeilings)).toBeCloseTo(1.0, 4)
  })

  test('opener stacks multiplicatively on top of everything else', () => {
    const noOpener = computeConfidence(allCeilings)
    const opener = computeConfidence({ ...allCeilings, isOpener: true })
    expect(opener).toBeCloseTo(noOpener * 0.90, 4)
  })
})

// =============================================================================
// BvP factor — aligned with probToday gate at 5 AB
// =============================================================================

describe('computeConfidenceBreakdown — bvp factor', () => {
  test('0 AB → 1.00 (probToday BvP factor inactive — no signal contributing)', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bvpAB: 0 })
    expect(factors.bvp).toBeCloseTo(1.0, 4)
  })

  test('4 AB → 1.00 (still below probToday activation threshold)', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bvpAB: 4 })
    expect(factors.bvp).toBeCloseTo(1.0, 4)
  })

  test('5 AB → 0.90 (just-activated, smallest possible sample)', () => {
    // The discontinuity at AB=5 is intentional. ≤4 AB the model ignores
    // BvP entirely; ≥5 AB it leans on a small career sample, which earns
    // a haircut that ramps off as the sample grows.
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bvpAB: 5 })
    expect(factors.bvp).toBeCloseTo(0.90, 4)
  })

  test('12 AB → ≈ 0.947 (mid-ramp)', () => {
    // 0.90 + ((12 - 5) / 15) * 0.10 = 0.9467
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bvpAB: 12 })
    expect(factors.bvp).toBeCloseTo(0.9467, 3)
  })

  test('20 AB → 1.00 (ramp ceiling)', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bvpAB: 20 })
    expect(factors.bvp).toBeCloseTo(1.0, 4)
  })

  test('100 AB → 1.00 (well above ceiling, clamped)', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bvpAB: 100 })
    expect(factors.bvp).toBeCloseTo(1.0, 4)
  })
})

// =============================================================================
// Pitcher factor — BF-based, gated on pitcherActive
// =============================================================================

describe('computeConfidenceBreakdown — pitcher factor', () => {
  test('TBD pitcher (active=false) → 1.00 (factor inactive → no haircut)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, pitcherActive: false, pitcherBf: 0,
    })
    expect(factors.pitcher).toBeCloseTo(1.0, 4)
  })

  test('low-sample pitcher (active=false even with some BF) → 1.00', () => {
    // pitcherActive is false when recentStarts < 3 even if pitcherBf has
    // some value. Confidence should still pin to 1.00 because the
    // probToday factor is neutralised.
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, pitcherActive: false, pitcherBf: 40,
    })
    expect(factors.pitcher).toBeCloseTo(1.0, 4)
  })

  test('just-activated pitcher (50 BF) → 0.90 floor', () => {
    // 50 BF is the activation threshold (~3 starts × 4 IP × 4.3 BF/IP).
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, pitcherActive: true, pitcherBf: 50,
    })
    expect(factors.pitcher).toBeCloseTo(0.90, 4)
  })

  test('mid-ramp (125 BF) → 0.95', () => {
    // 0.90 + ((125 - 50) / 150) * 0.10 = 0.95
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, pitcherActive: true, pitcherBf: 125,
    })
    expect(factors.pitcher).toBeCloseTo(0.95, 4)
  })

  test('200 BF → 1.00 ceiling (BB%/HR%/hardHit% all stabilized)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, pitcherActive: true, pitcherBf: 200,
    })
    expect(factors.pitcher).toBeCloseTo(1.0, 4)
  })

  test('400 BF (full season) → 1.00 ceiling, clamped', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, pitcherActive: true, pitcherBf: 400,
    })
    expect(factors.pitcher).toBeCloseTo(1.0, 4)
  })

  test('below activation threshold but active (edge case) → still 0.90 floor', () => {
    // 30 BF with active=true is a degenerate input, but defends against
    // floor leak: clamp(t) keeps the ramp at 0.90 below 50 BF.
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, pitcherActive: true, pitcherBf: 30,
    })
    expect(factors.pitcher).toBeCloseTo(0.90, 4)
  })
})

// =============================================================================
// Bullpen factor — NEW, was unmonitored before this refactor
// =============================================================================

describe('computeConfidenceBreakdown — bullpen factor', () => {
  test('null bullpen → 1.00 (factor inactive — bullpen probToday factor returns 1.00)', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bullpenIp: null })
    expect(factors.bullpen).toBeCloseTo(1.0, 4)
  })

  test('0 IP → 0.95 floor (factor active but no sample)', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bullpenIp: 0 })
    expect(factors.bullpen).toBeCloseTo(0.95, 4)
  })

  test('75 IP → 0.975 (mid-ramp, halfway to stabilization)', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bullpenIp: 75 })
    expect(factors.bullpen).toBeCloseTo(0.975, 4)
  })

  test('150 IP → 1.00 (Carleton stabilization point reached)', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bullpenIp: 150 })
    expect(factors.bullpen).toBeCloseTo(1.0, 4)
  })

  test('500 IP (full season) → 1.00, clamped', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bullpenIp: 500 })
    expect(factors.bullpen).toBeCloseTo(1.0, 4)
  })
})

// =============================================================================
// Batter sample factor — career-prior-aware
// =============================================================================

describe('computeConfidenceBreakdown — batterSample factor', () => {
  test('rookie (0 career, 0 current) → 0.85 floor', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: 0, batterCareerPa: 0,
    })
    expect(factors.batterSample).toBeCloseTo(0.85, 4)
  })

  test('rookie (0 career, 100 current) → 0.925 (rookie ramp halfway)', () => {
    // 0.85 + (100/200) * 0.15 = 0.925
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: 100, batterCareerPa: 0,
    })
    expect(factors.batterSample).toBeCloseTo(0.925, 4)
  })

  test('rookie (0 career, 200 current) → 1.00 (rookie ramp ceiling)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: 200, batterCareerPa: 0,
    })
    expect(factors.batterSample).toBeCloseTo(1.0, 4)
  })

  test('veteran (600 career, 0 current) → 0.92 (veteran floor — strong career prior lifts off rookie floor)', () => {
    // pTypical uses career rates as the stabilization prior at ≥200 career
    // PA, so a 0-current veteran's pTypical rates are already stable.
    // Confidence reflects: we know who this player is, even if they haven't
    // batted yet this year.
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: 0, batterCareerPa: 600,
    })
    expect(factors.batterSample).toBeCloseTo(0.92, 4)
  })

  test('veteran (600 career, 50 current) → 0.96 (mid-ramp)', () => {
    // 0.92 + (50/100) * 0.08 = 0.96
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: 50, batterCareerPa: 600,
    })
    expect(factors.batterSample).toBeCloseTo(0.96, 4)
  })

  test('veteran (600 career, 100 current) → 1.00 (ceiling reached)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: 100, batterCareerPa: 600,
    })
    expect(factors.batterSample).toBeCloseTo(1.0, 4)
  })

  test('boundary career=199 → still rookie ramp', () => {
    // The threshold is ≥200 (matches lib/p-typical.ts:88).
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: 0, batterCareerPa: 199,
    })
    expect(factors.batterSample).toBeCloseTo(0.85, 4)
  })

  test('boundary career=200 → veteran ramp activates', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: 0, batterCareerPa: 200,
    })
    expect(factors.batterSample).toBeCloseTo(0.92, 4)
  })

  test('negative current PA clamps to 0 (no spurious lift below floor)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: -50, batterCareerPa: 0,
    })
    expect(factors.batterSample).toBeCloseTo(0.85, 4)
  })

  test('negative career PA clamps to 0 (treat as rookie)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, batterSeasonPa: 100, batterCareerPa: -10,
    })
    expect(factors.batterSample).toBeCloseTo(0.925, 4)
  })
})

// =============================================================================
// Lineup factor (unchanged — unaffected by the alignment refactor)
// =============================================================================

describe('computeConfidenceBreakdown — lineup factor', () => {
  test('confirmed → 1.00', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, lineupStatus: 'confirmed' })
    expect(factors.lineup).toBeCloseTo(1.0, 4)
  })

  test('partial → 0.85', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, lineupStatus: 'partial' })
    expect(factors.lineup).toBeCloseTo(0.85, 4)
  })

  test('estimated → 0.70', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, lineupStatus: 'estimated' })
    expect(factors.lineup).toBeCloseTo(0.70, 4)
  })
})

// =============================================================================
// Time, weather, dataFreshness, opener factors (unchanged from prior shape)
// =============================================================================

describe('computeConfidenceBreakdown — weather factor', () => {
  test('neutral (impact = 0) → 1.00', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, weatherImpact: 0 })
    expect(factors.weather).toBeCloseTo(1.0, 4)
  })

  test('within deadband (impact = 0.05) → 1.00', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, weatherImpact: 0.05 })
    expect(factors.weather).toBeCloseTo(1.0, 4)
  })

  test('mid-ramp (impact = 0.10) → ≈ 0.967', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, weatherImpact: 0.10 })
    expect(factors.weather).toBeCloseTo(0.9667, 4)
  })

  test('hits floor (impact = 0.20) → 0.90', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, weatherImpact: 0.20 })
    expect(factors.weather).toBeCloseTo(0.90, 4)
  })

  test('clamps at floor for extreme impact (impact = 0.50) → 0.90', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, weatherImpact: 0.50 })
    expect(factors.weather).toBeCloseTo(0.90, 4)
  })
})

describe('computeConfidenceBreakdown — time factor', () => {
  test('confirmed lineup pins time to 1.0 even at 12 hours out', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, lineupStatus: 'confirmed', timeToFirstPitchMin: 720,
    })
    expect(factors.time).toBeCloseTo(1.0, 4)
  })

  test('estimated lineup ≤30 min out → time = 1.0', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, lineupStatus: 'estimated', timeToFirstPitchMin: 30,
    })
    expect(factors.time).toBeCloseTo(1.0, 4)
  })

  test('estimated lineup at 360 min (6 hrs) → time = 0.95', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, lineupStatus: 'estimated', timeToFirstPitchMin: 360,
    })
    expect(factors.time).toBeCloseTo(0.95, 4)
  })

  test('estimated lineup mid-ramp (195 min) → time ≈ 0.975', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, lineupStatus: 'estimated', timeToFirstPitchMin: 195,
    })
    expect(factors.time).toBeCloseTo(0.975, 4)
  })

  test('partial lineup uses the ramp (not confirmed gate)', () => {
    const { factors } = computeConfidenceBreakdown({
      ...allCeilings, lineupStatus: 'partial', timeToFirstPitchMin: 360,
    })
    expect(factors.time).toBeCloseTo(0.95, 4)
  })
})

describe('computeConfidenceBreakdown — dataFreshness factor', () => {
  test('60s old → 1.0', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, maxCacheAgeSec: 60 })
    expect(factors.dataFreshness).toBeCloseTo(1.0, 4)
  })

  test('5 min (300s) exactly → 1.0', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, maxCacheAgeSec: 300 })
    expect(factors.dataFreshness).toBeCloseTo(1.0, 4)
  })

  test('30 min (1800s) → 0.90', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, maxCacheAgeSec: 1800 })
    expect(factors.dataFreshness).toBeCloseTo(0.90, 4)
  })

  test('17.5 min (1050s) → ≈ 0.95', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, maxCacheAgeSec: 1050 })
    expect(factors.dataFreshness).toBeCloseTo(0.95, 4)
  })

  test('clamps above 30 min: 60 min → 0.90', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, maxCacheAgeSec: 3600 })
    expect(factors.dataFreshness).toBeCloseTo(0.90, 4)
  })
})

describe('computeConfidenceBreakdown — opener factor', () => {
  test('non-opener → 1.00', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, isOpener: false })
    expect(factors.opener).toBeCloseTo(1.0, 4)
  })

  test('opener → 0.90 (relevance haircut)', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, isOpener: true })
    expect(factors.opener).toBeCloseTo(0.90, 4)
  })
})

// =============================================================================
// Alignment regression tests — pin down the "factor inactive → confidence 1.00"
// invariants that this whole refactor was built around. Future changes that
// break alignment will fail here.
// =============================================================================

describe('alignment invariants — confidence pins to 1.00 when probToday factor is inactive', () => {
  test('BvP: probToday gate at 5 AB → confidence 1.00 below threshold', () => {
    for (const ab of [0, 1, 2, 3, 4]) {
      const { factors } = computeConfidenceBreakdown({ ...allCeilings, bvpAB: ab })
      expect(factors.bvp).toBeCloseTo(1.0, 4)
    }
  })

  test('Pitcher: pitcherActive=false → confidence 1.00 regardless of BF', () => {
    for (const bf of [0, 30, 100, 200, 500]) {
      const { factors } = computeConfidenceBreakdown({
        ...allCeilings, pitcherActive: false, pitcherBf: bf,
      })
      expect(factors.pitcher).toBeCloseTo(1.0, 4)
    }
  })

  test('Bullpen: bullpenIp=null → confidence 1.00', () => {
    const { factors } = computeConfidenceBreakdown({ ...allCeilings, bullpenIp: null })
    expect(factors.bullpen).toBeCloseTo(1.0, 4)
  })

  test('Weather: impact ≤ 0.05 → confidence 1.00 (covers domes / failed forecasts)', () => {
    for (const impact of [0, 0.01, 0.03, 0.05]) {
      const { factors } = computeConfidenceBreakdown({ ...allCeilings, weatherImpact: impact })
      expect(factors.weather).toBeCloseTo(1.0, 4)
    }
  })
})
