/**
 * Bet-sizing math for a given (model probability, sportsbook line) pair.
 *
 * Pure functions — no I/O, no localStorage, no React. Consumed by the
 * BetSettings context (bankroll + Kelly fraction) and per-pick line inputs
 * to compute expected value and recommended bet size in dollars.
 *
 * Why this lives in lib/ separate from the React layer: the math is the part
 * that has to be exactly right (vig, Kelly direction, edge-case zeros) so it
 * gets a focused unit-test suite. The UI on top can change without retesting
 * the formulas.
 */

// ---------------------------------------------------------------------------
// American odds → implied probability / payout
// ---------------------------------------------------------------------------

/**
 * Implied probability from American moneyline odds (returns 0..1, includes
 * the book's vig — this is NOT a fair-odds prob).
 *   · -110 → 110/210 ≈ 52.4%
 *   · +150 → 100/250 = 40.0%
 *   · ±100 → 50.0% (even)
 * Returns NaN for 0 or non-finite input.
 */
export function impliedProbFromAmericanOdds(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return NaN
  if (odds < 0) return -odds / (-odds + 100)
  return 100 / (odds + 100)
}

/**
 * Profit per $1 staked when the bet wins (i.e. excludes the stake itself).
 *   · -110 → 100/110 ≈ 0.9091
 *   · +150 → 1.50
 *   · ±100 → 1.00
 */
export function profitPerDollar(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return NaN
  if (odds < 0) return 100 / -odds
  return odds / 100
}

// ---------------------------------------------------------------------------
// EV + Kelly given a believed true probability
// ---------------------------------------------------------------------------

/**
 * Expected value per $1 wagered:
 *   EV = p × b − (1 − p)        where b = profit per $1 (`profitPerDollar`)
 * Positive value = +EV bet. Zero = break-even (book line equals true prob).
 * Negative = -EV (skip). Returns NaN for invalid odds or prob outside [0, 1].
 */
export function evPerDollar(modelProb: number, americanOdds: number): number {
  const b = profitPerDollar(americanOdds)
  if (!Number.isFinite(b) || !Number.isFinite(modelProb)) return NaN
  if (modelProb < 0 || modelProb > 1) return NaN
  return modelProb * b - (1 - modelProb)
}

/**
 * Kelly fraction of bankroll to bet:
 *   f = (p × b − q) / b         where q = 1 − p
 *
 * Clamped at 0 (never recommend a -EV bet). Returns 0 also for degenerate
 * inputs (b ≤ 0, p outside (0,1), non-finite).
 *
 * NOTE: This is *full* Kelly. Most practitioners run fractional Kelly
 * (¼ to ½) to absorb model error — apply that multiplier in
 * `recommendedBet`, not here. Keeping the raw fraction pure means tests can
 * exercise the math without coupling to the UI's Kelly-multiplier setting.
 */
export function kellyFraction(modelProb: number, americanOdds: number): number {
  const b = profitPerDollar(americanOdds)
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(modelProb)) return 0
  if (modelProb <= 0 || modelProb >= 1) return 0
  const q = 1 - modelProb
  const f = (modelProb * b - q) / b
  return Math.max(0, f)
}

/**
 * Dollar bet size = full-Kelly × kellyMultiplier × bankroll.
 *
 * `kellyMultiplier`:
 *   1.00 = full Kelly (theoretically optimal, practically too aggressive)
 *   0.50 = half Kelly (common pro setting)
 *   0.25 = quarter Kelly (default — survives most model miscalibration)
 *   0.125 = eighth Kelly (very conservative)
 *
 * Returns 0 for non-positive bankroll, non-positive multiplier, or any
 * upstream condition that makes Kelly fraction zero.
 */
export function recommendedBet(args: {
  modelProb: number
  americanOdds: number
  bankroll: number
  kellyMultiplier: number
}): number {
  if (!Number.isFinite(args.bankroll) || args.bankroll <= 0) return 0
  if (!Number.isFinite(args.kellyMultiplier) || args.kellyMultiplier <= 0) return 0
  const f = kellyFraction(args.modelProb, args.americanOdds)
  if (f <= 0) return 0
  return f * args.kellyMultiplier * args.bankroll
}

// ---------------------------------------------------------------------------
// User-input parsing
// ---------------------------------------------------------------------------

/**
 * Parse a free-text user entry into American odds.
 * Accepts: "-110", "+150", "150", "  -250  " (whitespace ok).
 * Rejects: empty, non-numeric, decimal points, anything with |odds| < 100
 * (American convention — sub-100 lines aren't a thing on real books).
 *
 * Returns null on any rejection so the UI can show a placeholder/error
 * without computing nonsense.
 */
export function parseAmericanOdds(input: string): number | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^([+-]?)(\d+)$/)
  if (!match) return null
  const num = parseInt(match[2], 10)
  if (!Number.isFinite(num) || num < 100) return null
  return match[1] === '-' ? -num : num
}
