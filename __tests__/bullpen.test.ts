import { weightForPA } from '@/lib/bullpen'

test('weightForPA returns mostly high-leverage in late PAs', () => {
  expect(weightForPA(4)).toBeGreaterThan(0.7)
})

test('weightForPA returns low high-leverage weight in early PAs', () => {
  expect(weightForPA(2)).toBeLessThan(0.3)
})

test('weightForPA is monotonic non-decreasing across PA index', () => {
  expect(weightForPA(2)).toBeLessThanOrEqual(weightForPA(3))
  expect(weightForPA(3)).toBeLessThanOrEqual(weightForPA(4))
})

test('weightForPA caps at 1.0 for absurdly large indices', () => {
  expect(weightForPA(99)).toBeLessThanOrEqual(1.0)
})
