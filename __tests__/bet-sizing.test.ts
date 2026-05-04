import {
  impliedProbFromAmericanOdds,
  profitPerDollar,
  evPerDollar,
  kellyFraction,
  recommendedBet,
  parseAmericanOdds,
} from '@/lib/bet-sizing'

// ---------------------------------------------------------------------------
// impliedProbFromAmericanOdds
// ---------------------------------------------------------------------------

describe('impliedProbFromAmericanOdds', () => {
  test('-110 → 110 / 210 ≈ 52.38%', () => {
    expect(impliedProbFromAmericanOdds(-110)).toBeCloseTo(110 / 210, 4)
  })

  test('+150 → 100 / 250 = 40%', () => {
    expect(impliedProbFromAmericanOdds(150)).toBeCloseTo(0.4, 4)
  })

  test('-300 → 75% (heavy favourite)', () => {
    expect(impliedProbFromAmericanOdds(-300)).toBeCloseTo(0.75, 4)
  })

  test('+100 → 50% (even, underdog convention)', () => {
    expect(impliedProbFromAmericanOdds(100)).toBeCloseTo(0.5, 4)
  })

  test('-100 → 50% (even, favourite convention)', () => {
    expect(impliedProbFromAmericanOdds(-100)).toBeCloseTo(0.5, 4)
  })

  test('NaN for 0', () => {
    expect(impliedProbFromAmericanOdds(0)).toBeNaN()
  })

  test('NaN for non-finite input', () => {
    expect(impliedProbFromAmericanOdds(NaN)).toBeNaN()
    expect(impliedProbFromAmericanOdds(Infinity)).toBeNaN()
  })

  test('vig is built in: a typical -110/-110 two-way market sums to > 1.0', () => {
    // Sportsbook offers -110 on BOTH sides → both implied probs are ~52.4%.
    // Sum > 1.0 = book's vig built into the offered prices.
    // (Note: -110/+110 is the symmetric/no-vig case; real books quote both
    // sides as -110 to take their cut.)
    const both = 2 * impliedProbFromAmericanOdds(-110)
    expect(both).toBeGreaterThan(1.0)
    expect(both).toBeCloseTo(1.0476, 3)  // ~4.76% two-way vig at -110 both sides
  })
})

// ---------------------------------------------------------------------------
// profitPerDollar
// ---------------------------------------------------------------------------

describe('profitPerDollar', () => {
  test('-110 returns ~0.909', () => {
    expect(profitPerDollar(-110)).toBeCloseTo(100 / 110, 4)
  })

  test('+150 returns 1.50', () => {
    expect(profitPerDollar(150)).toBeCloseTo(1.5, 4)
  })

  test('±100 returns 1.0', () => {
    expect(profitPerDollar(100)).toBeCloseTo(1.0, 4)
    expect(profitPerDollar(-100)).toBeCloseTo(1.0, 4)
  })
})

// ---------------------------------------------------------------------------
// evPerDollar
// ---------------------------------------------------------------------------

describe('evPerDollar', () => {
  test('+EV when model prob exceeds book implied prob', () => {
    // -110 implies 52.38%. Model says 60%. b = 0.909.
    // EV = 0.6 × 0.909 − 0.4 = 0.1455
    expect(evPerDollar(0.6, -110)).toBeCloseTo(0.1455, 3)
  })

  test('break-even at exactly the implied prob (= 0)', () => {
    const p = impliedProbFromAmericanOdds(-110)
    expect(evPerDollar(p, -110)).toBeCloseTo(0, 4)
  })

  test('-EV when model prob below implied', () => {
    expect(evPerDollar(0.4, -110)).toBeLessThan(0)
  })

  test('NaN for prob outside [0,1]', () => {
    expect(evPerDollar(-0.1, -110)).toBeNaN()
    expect(evPerDollar(1.5, -110)).toBeNaN()
  })

  test('NaN for invalid odds', () => {
    expect(evPerDollar(0.6, 0)).toBeNaN()
    expect(evPerDollar(0.6, NaN)).toBeNaN()
  })
})

// ---------------------------------------------------------------------------
// kellyFraction
// ---------------------------------------------------------------------------

describe('kellyFraction', () => {
  test('classic +EV: model 84% vs book -300 (75% implied)', () => {
    // b = 100/300 = 0.3333; q = 0.16
    // f = (0.84 × 0.3333 − 0.16) / 0.3333
    //   = (0.28 − 0.16) / 0.3333
    //   = 0.36
    expect(kellyFraction(0.84, -300)).toBeCloseTo(0.36, 2)
  })

  test('break-even (model prob equals implied) → 0', () => {
    const p = impliedProbFromAmericanOdds(-110)
    expect(kellyFraction(p, -110)).toBeCloseTo(0, 4)
  })

  test('-EV → 0 (never bet against EV)', () => {
    expect(kellyFraction(0.40, -110)).toBe(0)
    expect(kellyFraction(0.30, -300)).toBe(0)
  })

  test('degenerate prob at 0 or 1 → 0', () => {
    expect(kellyFraction(0, -110)).toBe(0)
    expect(kellyFraction(1, -110)).toBe(0)
  })

  test('NaN inputs → 0 (never recommend a bet on garbage)', () => {
    expect(kellyFraction(NaN, -110)).toBe(0)
    expect(kellyFraction(0.6, NaN)).toBe(0)
  })

  test('symmetric: same edge in different odds yields different f', () => {
    // Both bets have ~10pp edge over implied prob, but different odds shape.
    const fHeavyFav = kellyFraction(0.85, -300)  // book 75%, edge 10pp, b=0.333
    const fUnderdog = kellyFraction(0.45, 200)   // book 33.3%, edge ~12pp, b=2.0
    // Underdog at higher odds ⇒ Kelly recommends a smaller fraction even with
    // bigger edge, because the variance per unit bet is much higher.
    expect(fUnderdog).toBeLessThan(fHeavyFav)
  })
})

// ---------------------------------------------------------------------------
// recommendedBet
// ---------------------------------------------------------------------------

describe('recommendedBet', () => {
  test('typical Tracked-tier pick at $500 / ¼ Kelly', () => {
    // model 84%, book -300 → Kelly ≈ 0.36
    // ¼ Kelly = 0.09 → $45 on $500 bankroll
    const bet = recommendedBet({
      modelProb: 0.84,
      americanOdds: -300,
      bankroll: 500,
      kellyMultiplier: 0.25,
    })
    expect(bet).toBeCloseTo(45, 0)
  })

  test('zero bankroll → 0', () => {
    expect(recommendedBet({
      modelProb: 0.84, americanOdds: -300, bankroll: 0, kellyMultiplier: 0.25,
    })).toBe(0)
  })

  test('zero kelly multiplier → 0 (no betting)', () => {
    expect(recommendedBet({
      modelProb: 0.84, americanOdds: -300, bankroll: 500, kellyMultiplier: 0,
    })).toBe(0)
  })

  test('-EV pick → 0 regardless of bankroll/multiplier', () => {
    expect(recommendedBet({
      modelProb: 0.4, americanOdds: -110, bankroll: 500, kellyMultiplier: 0.25,
    })).toBe(0)
  })

  test('full Kelly is exactly 4× quarter Kelly for the same pick', () => {
    const args = { modelProb: 0.84, americanOdds: -300, bankroll: 500 }
    const quarter = recommendedBet({ ...args, kellyMultiplier: 0.25 })
    const full = recommendedBet({ ...args, kellyMultiplier: 1.0 })
    expect(full).toBeCloseTo(quarter * 4, 4)
  })

  test('non-finite bankroll → 0', () => {
    expect(recommendedBet({
      modelProb: 0.84, americanOdds: -300, bankroll: NaN, kellyMultiplier: 0.25,
    })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// parseAmericanOdds
// ---------------------------------------------------------------------------

describe('parseAmericanOdds', () => {
  test('accepts explicit negative', () => {
    expect(parseAmericanOdds('-110')).toBe(-110)
    expect(parseAmericanOdds('-300')).toBe(-300)
  })

  test('accepts explicit positive', () => {
    expect(parseAmericanOdds('+150')).toBe(150)
    expect(parseAmericanOdds('+200')).toBe(200)
  })

  test('treats positive without sign as positive', () => {
    expect(parseAmericanOdds('150')).toBe(150)
    expect(parseAmericanOdds('200')).toBe(200)
  })

  test('tolerates surrounding whitespace', () => {
    expect(parseAmericanOdds('  -250  ')).toBe(-250)
    expect(parseAmericanOdds('\t+100\n')).toBe(100)
  })

  test('rejects empty / whitespace-only', () => {
    expect(parseAmericanOdds('')).toBeNull()
    expect(parseAmericanOdds('   ')).toBeNull()
  })

  test('rejects non-numeric', () => {
    expect(parseAmericanOdds('abc')).toBeNull()
    expect(parseAmericanOdds('foo')).toBeNull()
    expect(parseAmericanOdds('-110abc')).toBeNull()
  })

  test('rejects decimal (we want integer odds)', () => {
    expect(parseAmericanOdds('-110.5')).toBeNull()
    expect(parseAmericanOdds('1.85')).toBeNull()  // decimal odds format, not American
  })

  test('rejects sub-100 magnitudes (not real American odds)', () => {
    expect(parseAmericanOdds('99')).toBeNull()
    expect(parseAmericanOdds('-99')).toBeNull()
    expect(parseAmericanOdds('0')).toBeNull()
    expect(parseAmericanOdds('+1')).toBeNull()
  })

  test('boundary: ±100 is valid (even-money)', () => {
    expect(parseAmericanOdds('100')).toBe(100)
    expect(parseAmericanOdds('-100')).toBe(-100)
    expect(parseAmericanOdds('+100')).toBe(100)
  })

  test('non-string input rejected', () => {
    // Defensive — TypeScript should prevent this but localStorage returns
    // string|null and pre-typed casts upstream might let other types through.
    expect(parseAmericanOdds(null as unknown as string)).toBeNull()
    expect(parseAmericanOdds(undefined as unknown as string)).toBeNull()
  })
})
