import {
  impliedProbFromAmericanOdds,
  profitPerDollar,
  evPerDollar,
  kellyFraction,
  recommendedBet,
  parseAmericanOdds,
  estimateBookOddsFromModelProb,
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

// ---------------------------------------------------------------------------
// estimateBookOddsFromModelProb
// ---------------------------------------------------------------------------

describe('estimateBookOddsFromModelProb — pToday-only fallback', () => {
  // These tests exercise the legacy single-arg path: estimating book odds
  // from pToday alone. Less accurate than the pTypical-aware path (books
  // hedge between baseline and matchup-adjusted), but kept as a fallback
  // for callers that don't have pTypical.
  //
  // No-vig regime: bookImplied = modelProb directly, no pp added. Results
  // are the fair-line American moneyline equivalent of the model prob.

  test('chalk: model 0.85 (no pTypical) → ~-550 (raw -566.67, rounded /50)', () => {
    const odds = estimateBookOddsFromModelProb(0.85)
    expect(odds).toBe(-550)
  })

  test('coin flip: model 0.50 → -100 (exactly even, +100 lower-bound guard)', () => {
    const odds = estimateBookOddsFromModelProb(0.50)
    expect(odds).toBe(-100)
  })

  test('longshot: model 0.10 → +900 (fair odds 9-to-1)', () => {
    const odds = estimateBookOddsFromModelProb(0.10)
    expect(odds).toBe(900)
  })

  test('extreme chalk clamps near book ceiling: model 0.99 → very negative', () => {
    const odds = estimateBookOddsFromModelProb(0.99)
    expect(odds).toBe(-3250)
  })

  test('returns +100 sentinel for non-finite or out-of-range probabilities', () => {
    expect(estimateBookOddsFromModelProb(NaN)).toBe(100)
    expect(estimateBookOddsFromModelProb(0)).toBe(100)
    expect(estimateBookOddsFromModelProb(1)).toBe(100)
    expect(estimateBookOddsFromModelProb(-0.5)).toBe(100)
  })

  test('no-vig regime: implied prob from rounded odds matches modelProb (within rounding)', () => {
    // With vig removed, the only delta between modelProb and the
    // rounded-odds-implied-prob is the increment-rounding step itself.
    // For each tested probability, the absolute gap should be small
    // (well under 5pp) — far from the consistent +4pp gap the old vig
    // path produced.
    for (const p of [0.10, 0.30, 0.50, 0.70, 0.90]) {
      const odds = estimateBookOddsFromModelProb(p)
      const impliedFromOdds = odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100)
      expect(Math.abs(impliedFromOdds - p)).toBeLessThan(0.05)
    }
  })
})

describe('estimateBookOddsFromModelProb — pTypical-aware (legacy 2-arg path)', () => {
  // 2-arg signature kept for back-compat with any caller that doesn't have
  // rung context. Rung-aware (preferred) path tested in the next describe.

  test('Turang 1+ HRR (pTypical 0.767, pToday 0.862) lands near -440 (no vig)', () => {
    // midpoint = 0.8145, raw = -(0.8145/0.1855)*100 = -439.1 → /10 → -440.
    // Real-world FanDuel posted -500 on this pick — within ~3pp of our
    // estimate, well inside book-rounding tolerance plus the book's vig.
    const odds = estimateBookOddsFromModelProb(0.862, 0.767)
    expect(odds).toBe(-440)
    // pToday-only fallback (without pTypical context) over-extrapolates
    // toward chalk — the bias the pTypical-aware path is correcting for.
    const oldEstimate = estimateBookOddsFromModelProb(0.862)
    expect(oldEstimate).toBe(-600)
  })

  test('big matchup boost (pTypical 0.50, pToday 0.80) → midpoint 0.65, line -185', () => {
    // midpoint = 0.65 → raw = -(0.65/0.35)*100 = -185.7 → /5 → -185.
    const odds = estimateBookOddsFromModelProb(0.80, 0.50)
    expect(odds).toBe(-185)
  })

  test('no matchup boost (pTypical = pToday) → midpoint = pToday, behavior matches single-arg', () => {
    const both = estimateBookOddsFromModelProb(0.70, 0.70)
    const single = estimateBookOddsFromModelProb(0.70)
    expect(both).toBe(single)
  })

  test('longshot rung 3 (pTypical 0.10, pToday 0.18) → midpoint 0.14, line +600', () => {
    // midpoint = 0.14 → raw = (0.86/0.14)*100 = 614.3 → /50 → 600.
    const odds = estimateBookOddsFromModelProb(0.18, 0.10)
    expect(odds).toBe(600)
  })

  test('invalid pTypical (e.g. 0) → fallback to single-arg behavior', () => {
    const valid = estimateBookOddsFromModelProb(0.85)
    const withZero = estimateBookOddsFromModelProb(0.85, 0)
    const withNan = estimateBookOddsFromModelProb(0.85, NaN)
    expect(withZero).toBe(valid)
    expect(withNan).toBe(valid)
  })

  test('midpoint approach always sits between pTypical and pToday lines (book hedges)', () => {
    const cases: Array<[number, number]> = [
      [0.50, 0.65],
      [0.70, 0.85],
      [0.30, 0.40],
      [0.80, 0.90],
    ]
    for (const [pTyp, pTod] of cases) {
      const blended = estimateBookOddsFromModelProb(pTod, pTyp)
      const aggressive = estimateBookOddsFromModelProb(pTod)
      // Blended estimate should imply a LOWER book prob than the
      // pToday-only estimate (less aggressive favorite). For favorites,
      // that means odds are LESS NEGATIVE; for underdogs, MORE positive
      // (i.e. higher payout). In both cases: blended > aggressive
      // numerically (less extreme).
      expect(blended).toBeGreaterThan(aggressive)
    }
  })
})

describe('estimateBookOddsFromModelProb — rung-aware (preferred 3-arg path)', () => {
  // Calibrated 2026-05-05 against 24 hand-collected FanDuel lines. Per-rung
  // shrinkage table:
  //   1+: bookProb = pTyp           (no shrink)
  //   2+: bookProb = pTyp - 0.02    (book ~2pp below pTyp)
  //   3+: bookProb = pTyp - 0.04    (book ~4pp below pTyp; model over-states 3+)
  //
  // The rung argument switches off the legacy midpoint-of-pTyp-and-pToday
  // path. pToday is still passed (as `modelProb`) but ignored in the rung-
  // aware path.

  test('1+ HRR — Trout (pTypical 0.795) lands at -390 (matches FD)', () => {
    // bookProb = 0.795 → -(0.795/0.205)*100 = -387.8 → /10 → -390.
    // FD posted -390 on 2026-05-05; estimator hits it exactly.
    const odds = estimateBookOddsFromModelProb(0.853, 0.795, 1)
    expect(odds).toBe(-390)
  })

  test('1+ HRR — Caminero (pTypical 0.758) lands at -310', () => {
    // bookProb = 0.758 → -(0.758/0.242)*100 = -313.2 → /10 → -310.
    const odds = estimateBookOddsFromModelProb(0.804, 0.758, 1)
    expect(odds).toBe(-310)
  })

  test('2+ HRR — Vladdy (pTypical 0.581) lands at -130 (matches FD -130)', () => {
    // bookProb = 0.581 - 0.02 = 0.561 → -(0.561/0.439)*100 = -127.8 → /5 → -130.
    // FD posted -130; estimator hits it exactly.
    const odds = estimateBookOddsFromModelProb(0.659, 0.581, 2)
    expect(odds).toBe(-130)
  })

  test('2+ HRR — Trout (pTypical 0.604) lands at -140 (matches FD -145)', () => {
    // bookProb = 0.604 - 0.02 = 0.584 → -(0.584/0.416)*100 = -140.4 → /5 → -140.
    const odds = estimateBookOddsFromModelProb(0.697, 0.604, 2)
    expect(odds).toBe(-140)
  })

  test('3+ HRR — Trout (pTypical 0.446) lands at +145 (FD posted +130)', () => {
    // bookProb = 0.446 - 0.04 = 0.406 → ((1-0.406)/0.406)*100 = +146.3 → /5 → +145.
    const odds = estimateBookOddsFromModelProb(0.550, 0.446, 3)
    expect(odds).toBe(145)
  })

  test('3+ HRR — De La Cruz (pTypical 0.416) lands at +165 (matches FD +180)', () => {
    // bookProb = 0.416 - 0.04 = 0.376 → ((1-0.376)/0.376)*100 = +166.0 → /5 → +165.
    const odds = estimateBookOddsFromModelProb(0.513, 0.416, 3)
    expect(odds).toBe(165)
  })

  test('rung-aware path produces a DIFFERENT estimate than legacy midpoint', () => {
    // Same inputs, with vs without rung. Rung-aware uses pTyp - shrink;
    // legacy uses midpoint. They MUST diverge or there's a wiring bug.
    const legacy = estimateBookOddsFromModelProb(0.85, 0.75)        // midpoint = 0.80
    const rungAware = estimateBookOddsFromModelProb(0.85, 0.75, 1)  // pTyp = 0.75
    expect(legacy).not.toBe(rungAware)
    // Legacy midpoint produces a steeper line (more chalk) than rung-aware
    // for any pick where pToday > pTyp. For favorites, "steeper" = more
    // negative.
    expect(legacy).toBeLessThan(rungAware)
  })

  test('rung-aware shrinkage grows monotonically with rung', () => {
    // Same baseline pTyp, only the shrinkage differs across rungs.
    // Higher rung → more shrinkage → bookProb lower → odds further from
    // chalk (less negative for favorites, more positive for dogs).
    const r1 = estimateBookOddsFromModelProb(0.7, 0.6, 1)
    const r2 = estimateBookOddsFromModelProb(0.7, 0.6, 2)
    const r3 = estimateBookOddsFromModelProb(0.7, 0.6, 3)
    expect(r2).toBeGreaterThan(r1)
    expect(r3).toBeGreaterThan(r2)
  })

  test('omitting rung falls back to legacy midpoint formula', () => {
    // The 2-arg signature must keep working — back-compat for any caller
    // without rung context.
    const noRung = estimateBookOddsFromModelProb(0.85, 0.75)
    const undefRung = estimateBookOddsFromModelProb(0.85, 0.75, undefined)
    expect(noRung).toBe(undefRung)
  })
})
