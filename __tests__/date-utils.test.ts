import { pacificDateString, shiftIsoDate, isValidIsoDate } from '@/lib/date-utils'

describe('pacificDateString', () => {
  test('returns YYYY-MM-DD format', () => {
    const out = pacificDateString()
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('uses Pacific date — UTC midnight on Apr 27 (= 5 PM PT Apr 26) returns Apr 26', () => {
    // 2026-04-27 00:00 UTC = 2026-04-26 17:00 PDT
    const utcMidnight = new Date('2026-04-27T00:00:00Z')
    expect(pacificDateString(utcMidnight)).toBe('2026-04-26')
  })

  test('uses Pacific date — UTC 09:00 on Apr 27 (= 2 AM PT Apr 27) returns Apr 27', () => {
    // 2026-04-27 09:00 UTC = 2026-04-27 02:00 PDT
    const utcMorning = new Date('2026-04-27T09:00:00Z')
    expect(pacificDateString(utcMorning)).toBe('2026-04-27')
  })

  test('handles PST (winter) correctly: UTC 07:00 on Jan 15 (= 11 PM PST Jan 14) returns Jan 14', () => {
    // 2026-01-15 07:00 UTC = 2026-01-14 23:00 PST (UTC-8)
    const winterEvening = new Date('2026-01-15T07:00:00Z')
    expect(pacificDateString(winterEvening)).toBe('2026-01-14')
  })
})

describe('shiftIsoDate', () => {
  test('shifts forward by 1 day', () => {
    expect(shiftIsoDate('2026-04-27', 1)).toBe('2026-04-28')
  })

  test('shifts backward by 1 day', () => {
    expect(shiftIsoDate('2026-04-27', -1)).toBe('2026-04-26')
  })

  test('handles month boundary', () => {
    expect(shiftIsoDate('2026-04-30', 1)).toBe('2026-05-01')
  })

  test('handles year boundary', () => {
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01')
  })

  test('handles leap-year Feb 29 → Mar 1', () => {
    expect(shiftIsoDate('2024-02-29', 1)).toBe('2024-03-01')
  })

  test('zero shift returns same date', () => {
    expect(shiftIsoDate('2026-04-27', 0)).toBe('2026-04-27')
  })
})

describe('isValidIsoDate', () => {
  test('accepts well-formed dates', () => {
    expect(isValidIsoDate('2026-04-27')).toBe(true)
    expect(isValidIsoDate('1900-01-01')).toBe(true)
    expect(isValidIsoDate('2099-12-31')).toBe(true)
  })

  test('rejects malformed strings', () => {
    expect(isValidIsoDate('2026/04/27')).toBe(false)
    expect(isValidIsoDate('26-04-27')).toBe(false)
    expect(isValidIsoDate('2026-4-27')).toBe(false)
    expect(isValidIsoDate('2026-04-27T00:00:00Z')).toBe(false)
    expect(isValidIsoDate('not-a-date')).toBe(false)
    expect(isValidIsoDate('')).toBe(false)
  })

  test('rejects impossible dates that pass the regex', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false)  // Feb 30 doesn't exist
    expect(isValidIsoDate('2026-13-01')).toBe(false)  // Month 13
    expect(isValidIsoDate('2026-00-15')).toBe(false)  // Month 0
    expect(isValidIsoDate('2026-04-31')).toBe(false)  // April only has 30 days
    expect(isValidIsoDate('2025-02-29')).toBe(false)  // 2025 is not a leap year
  })

  test('accepts leap day in leap year', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
  })

  test('rejects non-string types', () => {
    expect(isValidIsoDate(null as unknown as string)).toBe(false)
    expect(isValidIsoDate(undefined as unknown as string)).toBe(false)
    expect(isValidIsoDate(20260427 as unknown as string)).toBe(false)
    expect(isValidIsoDate({} as unknown as string)).toBe(false)
  })
})
