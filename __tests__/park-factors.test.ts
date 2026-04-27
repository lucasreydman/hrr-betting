import {
  getParkFactor,
  getParkFactorsForBatter,
  getHrParkFactorForBatter,
  getParkVenueName,
} from '@/lib/park-factors'

describe('park-factors', () => {
  // Yankee Stadium (3313) — short porch in right favours LHB HR
  // Coors Field (19)     — large LF dimensions favour RHB HR
  // Dodger Stadium (22)  — RHB-friendly HR park (per FG 2025)

  describe('getParkFactor (legacy: handedness-blended HR)', () => {
    it('blends L+R HR factors for known venues', () => {
      // Yankee Stadium 2025: HR L 1.07, R 1.04 → blend 1.055
      expect(getParkFactor(3313)).toBeCloseTo(1.055, 3)
    })

    it('returns 1.00 for unknown venues', () => {
      expect(getParkFactor(99999)).toBe(1.00)
    })
  })

  describe('getHrParkFactorForBatter', () => {
    it('returns the L value for left-handed batters at Yankee Stadium', () => {
      expect(getHrParkFactorForBatter(3313, 'L')).toBe(1.07)
    })

    it('returns the R value for right-handed batters at Yankee Stadium', () => {
      expect(getHrParkFactorForBatter(3313, 'R')).toBe(1.04)
    })

    it('switch hitters get the L+R average', () => {
      expect(getHrParkFactorForBatter(3313, 'S')).toBeCloseTo(1.055, 3)
    })

    it('Yankee Stadium: HR boost is bigger for L than R (short porch)', () => {
      const l = getHrParkFactorForBatter(3313, 'L')
      const r = getHrParkFactorForBatter(3313, 'R')
      expect(l).toBeGreaterThan(r)
    })

    it('Coors Field: HR boost is bigger for R than L', () => {
      const l = getHrParkFactorForBatter(19, 'L')
      const r = getHrParkFactorForBatter(19, 'R')
      expect(r).toBeGreaterThan(l)
    })

    it('Dodger Stadium: HRs are boosted overall, more for RHB', () => {
      const l = getHrParkFactorForBatter(22, 'L')
      const r = getHrParkFactorForBatter(22, 'R')
      expect(l).toBeGreaterThan(1.0)
      expect(r).toBeGreaterThan(l)
    })

    it('returns 1.00 for unknown venues regardless of handedness', () => {
      expect(getHrParkFactorForBatter(99999, 'L')).toBe(1.00)
      expect(getHrParkFactorForBatter(99999, 'R')).toBe(1.00)
      expect(getHrParkFactorForBatter(99999, 'S')).toBe(1.00)
    })
  })

  describe('getParkFactorsForBatter (full 7-outcome map)', () => {
    it('returns all 7 outcome factors for a known venue', () => {
      const f = getParkFactorsForBatter(19, 'R')  // Coors / RHB
      expect(f).toHaveProperty('1B')
      expect(f).toHaveProperty('2B')
      expect(f).toHaveProperty('3B')
      expect(f).toHaveProperty('HR')
      expect(f).toHaveProperty('BB')
      expect(f).toHaveProperty('K')
      expect(f).toHaveProperty('OUT')
    })

    it('OUT is always 1.00', () => {
      expect(getParkFactorsForBatter(19, 'L').OUT).toBe(1.00)
      expect(getParkFactorsForBatter(99999, 'L').OUT).toBe(1.00)
    })

    it('Coors Field 3B factor is meaningfully above 1.0 (huge outfield)', () => {
      // Coors 3B 2025: L 1.28, R 1.42
      const f = getParkFactorsForBatter(19, 'R')
      expect(f['3B']).toBeGreaterThan(1.20)
    })

    it('T-Mobile Park (SEA) suppresses 3B for both handednesses (deep alleys)', () => {
      // T-Mobile 3B 2025: L 0.75, R 0.84 — both well below neutral
      const fL = getParkFactorsForBatter(680, 'L')
      const fR = getParkFactorsForBatter(680, 'R')
      expect(fL['3B']).toBeLessThan(0.90)
      expect(fR['3B']).toBeLessThan(0.90)
    })

    it('BB and K are handedness-blended (no L/R variation per FG)', () => {
      const fL = getParkFactorsForBatter(3313, 'L')
      const fR = getParkFactorsForBatter(3313, 'R')
      expect(fL.BB).toBe(fR.BB)
      expect(fL.K).toBe(fR.K)
    })

    it('switch hitter 1B factor equals (L + R) / 2', () => {
      const fL = getParkFactorsForBatter(3313, 'L')
      const fR = getParkFactorsForBatter(3313, 'R')
      const fS = getParkFactorsForBatter(3313, 'S')
      expect(fS['1B']).toBeCloseTo((fL['1B'] + fR['1B']) / 2, 6)
    })

    it('returns neutral 1.00 across the board for unknown venues', () => {
      const f = getParkFactorsForBatter(99999, 'R')
      expect(f['1B']).toBe(1)
      expect(f['2B']).toBe(1)
      expect(f['3B']).toBe(1)
      expect(f.HR).toBe(1)
      expect(f.BB).toBe(1)
      expect(f.K).toBe(1)
      expect(f.OUT).toBe(1)
    })
  })

  describe('getParkVenueName', () => {
    it('returns the canonical venue name for known IDs', () => {
      expect(getParkVenueName(3313)).toBe('Yankee Stadium')
      expect(getParkVenueName(19)).toBe('Coors Field')
      expect(getParkVenueName(2680)).toBe('Petco Park')
    })

    it('returns "Unknown park" for unrecognised IDs', () => {
      expect(getParkVenueName(99999)).toBe('Unknown park')
    })
  })
})
