import { getTtoMultipliers } from '@/lib/tto'

test('returns league-avg multipliers when pitcher data is missing', async () => {
  const result = await getTtoMultipliers({ pitcherId: 999999999, ttoIndex: 3 })
  expect(result.HR).toBeCloseTo(1.25, 2)  // matches TTO_MULTIPLIERS['3'].HR
})

test('1st time through has 1.0 multipliers across all outcomes', async () => {
  const result = await getTtoMultipliers({ pitcherId: 543037, ttoIndex: 1 })
  expect(result.HR).toBe(1.0)
  expect(result.K).toBe(1.0)
})

test('4th time through has biggest HR boost', async () => {
  const tto4 = await getTtoMultipliers({ pitcherId: 999999999, ttoIndex: 4 })
  const tto3 = await getTtoMultipliers({ pitcherId: 999999999, ttoIndex: 3 })
  expect(tto4.HR).toBeGreaterThan(tto3.HR)
})
