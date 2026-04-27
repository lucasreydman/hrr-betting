import { pacificDateString, shiftIsoDate, isValidIsoDate, slateDateString } from '@/lib/date-utils'

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

describe('slateDateString — ET 3AM rollover', () => {
  // Reference: 2026-04-27 is past DST start, so ET = UTC-4 (EDT).
  // 11 PM ET Apr 26 = 03:00 UTC Apr 27.
  // 12 AM ET Apr 27 = 04:00 UTC Apr 27.
  // 1  AM ET Apr 27 = 05:00 UTC Apr 27.
  // 3  AM ET Apr 27 = 07:00 UTC Apr 27 (rollover boundary).
  // 4  AM ET Apr 27 = 08:00 UTC Apr 27.

  test('11 PM ET on the slate day → that slate', () => {
    const t = new Date('2026-04-27T03:00:00Z')  // 11 PM EDT Apr 26
    expect(slateDateString(t)).toBe('2026-04-26')
  })

  test('exactly midnight ET → still previous slate (within the 3am window)', () => {
    const t = new Date('2026-04-27T04:00:00Z')  // 00:00 EDT Apr 27
    expect(slateDateString(t)).toBe('2026-04-26')
  })

  test('1 AM ET → still previous slate', () => {
    const t = new Date('2026-04-27T05:00:00Z')  // 01:00 EDT Apr 27
    expect(slateDateString(t)).toBe('2026-04-26')
  })

  test('2:59 AM ET → still previous slate', () => {
    const t = new Date('2026-04-27T06:59:00Z')  // 02:59 EDT Apr 27
    expect(slateDateString(t)).toBe('2026-04-26')
  })

  test('3:00 AM ET → rollover to new slate', () => {
    const t = new Date('2026-04-27T07:00:00Z')  // 03:00 EDT Apr 27
    expect(slateDateString(t)).toBe('2026-04-27')
  })

  test('4 AM ET → new slate', () => {
    const t = new Date('2026-04-27T08:00:00Z')  // 04:00 EDT Apr 27
    expect(slateDateString(t)).toBe('2026-04-27')
  })

  test('mid-afternoon ET → current slate', () => {
    const t = new Date('2026-04-27T18:00:00Z')  // 14:00 EDT Apr 27
    expect(slateDateString(t)).toBe('2026-04-27')
  })

  test('handles EST (winter): 3 AM EST on Jan 15 → rollover', () => {
    // 2026-01-15 = winter, ET is UTC-5 (EST).
    // 3 AM EST Jan 15 = 08:00 UTC Jan 15.
    const t = new Date('2026-01-15T08:00:00Z')
    expect(slateDateString(t)).toBe('2026-01-15')
  })

  test('handles EST (winter): 1 AM EST on Jan 15 → previous slate', () => {
    // 1 AM EST Jan 15 = 06:00 UTC Jan 15.
    const t = new Date('2026-01-15T06:00:00Z')
    expect(slateDateString(t)).toBe('2026-01-14')
  })

  test('returns YYYY-MM-DD format', () => {
    expect(slateDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('cron firing at 10 UTC = 6 AM ET → slate is current ET date (settle path)', () => {
    // /api/settle cron runs at 10 UTC. We want to make sure that maps to the
    // ET calendar date for the day that's just ended.
    const t = new Date('2026-04-28T10:00:00Z')  // 06:00 EDT Apr 28
    expect(slateDateString(t)).toBe('2026-04-28')
    // shiftIsoDate(slateDateString(t), -1) is what /api/settle uses for "yesterday"
    expect(shiftIsoDate(slateDateString(t), -1)).toBe('2026-04-27')
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
