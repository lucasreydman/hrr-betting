import { getParkFactor, getParkFactors } from '@/lib/park-factors'

describe('park-factors', () => {
  describe('getParkFactor', () => {
    it('returns legacy HR park factor for Yankee Stadium', () => {
      const factor = getParkFactor(3313)
      expect(factor).toBe(1.02)
    })

    it('returns legacy HR park factor for Coors Field', () => {
      const factor = getParkFactor(19)
      expect(factor).toBe(1.28)
    })

    it('returns 1.00 for unknown venues', () => {
      const factor = getParkFactor(99999)
      expect(factor).toBe(1.00)
    })
  })

  describe('getParkFactors', () => {
    it('returns extended park factors for Yankee Stadium', () => {
      const pf = getParkFactors(3313)
      expect(pf.venueId).toBe(3313)
      expect(pf.factors.hr).toBe(1.02)
      expect(pf.factors['1b']).toBe(1.00)
      expect(pf.factors['2b']).toBe(1.00)
      expect(pf.factors['3b']).toBe(1.00)
      expect(pf.factors.bb).toBe(1.00)
      expect(pf.factors.k).toBe(1.00)
      expect(pf.hrByHand.vsL).toBe(1.02)
      expect(pf.hrByHand.vsR).toBe(1.02)
    })

    it('returns extended park factors for Coors Field with high HR factor', () => {
      const pf = getParkFactors(19)
      expect(pf.venueId).toBe(19)
      expect(pf.factors.hr).toBe(1.28)
      expect(pf.hrByHand.vsL).toBe(1.28)
      expect(pf.hrByHand.vsR).toBe(1.28)
    })

    it('returns neutral factors for unknown venues', () => {
      const pf = getParkFactors(99999)
      expect(pf.venueId).toBe(99999)
      expect(pf.factors.hr).toBe(1.00)
      expect(pf.factors['1b']).toBe(1.00)
      expect(pf.hrByHand.vsL).toBe(1.00)
      expect(pf.hrByHand.vsR).toBe(1.00)
    })
  })
})
