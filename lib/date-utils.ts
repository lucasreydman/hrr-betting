/**
 * Shared date utilities for the HRR betting app.
 *
 * Slate dates are Pacific Time (most MLB scheduling, and the cron description in
 * .github/workflows/cron.yml). UTC is the wrong reference for the slate
 * boundary because late-night Pacific games (e.g. 10 PM PT) cross into the next
 * UTC day mid-slate, so a UTC "today" call between 00:00 UTC and 08:00 UTC
 * during the back half of the slate would miss in-progress games.
 *
 * The helpers here use `Intl.DateTimeFormat` with the IANA `America/Los_Angeles`
 * zone, which handles PDT/PST automatically (no fixed -7/-8 offset hacks).
 */
const PACIFIC_TZ = 'America/Los_Angeles'

/**
 * Returns YYYY-MM-DD for the current Pacific calendar date.
 * Uses `America/Los_Angeles`, so PST/PDT switchovers are handled correctly.
 */
export function pacificDateString(now: Date = new Date()): string {
  // en-CA gives YYYY-MM-DD format directly (avoids parsing a localized string).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(now)
}

/**
 * Shift a YYYY-MM-DD string by `days` (can be negative). Anchors at noon UTC
 * so DST transitions in any local zone don't shift the displayed date.
 */
export function shiftIsoDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Strict YYYY-MM-DD validator. Rejects malformed strings, non-numeric, and impossible dates. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  // Round-trip parse to catch impossible dates like 2026-02-31
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  return d.toISOString().slice(0, 10) === value
}
