import { getBatterStatcast, getPitcherStatcast } from '@/lib/savant-api'

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1'
const maybe = RUN_LIVE ? test : test.skip

describe('savant-api', () => {
  describe('getBatterStatcast', () => {
    maybe('getBatterStatcast returns barrel% for known slugger', async () => {
      // Aaron Judge - 592450
      const sc = await getBatterStatcast(592450, 2024)
      expect(sc).not.toBeNull()
      if (sc) {
        expect(sc.barrelPct).toBeGreaterThan(0.10)
        expect(sc.barrelPct).toBeLessThan(0.30)
        expect(sc.xwOBA).toBeGreaterThan(0.30)
        expect(sc.xwOBA).toBeLessThan(0.50)
      }
    }, 30_000)

    maybe('getBatterStatcast caches across calls', async () => {
      // Should hit same cache for second call
      const sc1 = await getBatterStatcast(642715, 2024) // Juan Soto
      const sc2 = await getBatterStatcast(642715, 2024)
      expect(sc1).toEqual(sc2)
    }, 30_000)
  })

  describe('getPitcherStatcast', () => {
    maybe('getPitcherStatcast returns metrics for known pitcher', async () => {
      // Gerrit Cole - 543037
      const sc = await getPitcherStatcast(543037, 2024)
      expect(sc).not.toBeNull()
      if (sc) {
        expect(sc.hardHitPctAllowed).toBeGreaterThanOrEqual(0)
        expect(sc.hardHitPctAllowed).toBeLessThanOrEqual(1)
        expect(sc.whiffPct).toBeGreaterThan(0.25)
        expect(sc.whiffPct).toBeLessThan(0.40)
      }
    }, 30_000)
  })
})
