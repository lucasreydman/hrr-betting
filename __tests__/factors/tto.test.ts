import { computeTtoFactor } from '../../lib/factors/tto'

describe('computeTtoFactor', () => {
  it('returns a small positive lift (~1.06–1.10) reflecting average TTO penalty', () => {
    const f = computeTtoFactor()
    expect(f).toBeGreaterThan(1.0)
    expect(f).toBeLessThanOrEqual(1.15)
  })

  it('is deterministic across calls (constant computed once)', () => {
    const a = computeTtoFactor()
    const b = computeTtoFactor()
    expect(a).toBe(b)
  })
})
