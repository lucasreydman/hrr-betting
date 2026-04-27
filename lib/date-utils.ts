/**
 * Shared date utilities for the HRR betting app.
 *
 * The "slate date" is the boundary the user, the cron, and the picks history
 * all agree on. We use the standard DFS / sportsbook convention:
 *
 *     ET (America/New_York), rolls over at 3 AM ET.
 *
 * That means a 10 PM PT game starting on April 26 — which finishes at ~2 AM ET
 * on April 27 — still belongs to the April 26 slate. Locking, settling, and
 * the user's "today's board" all use this same date. The 3 AM rollover is
 * implemented by subtracting 3 hours from "now" (in ET) before taking the
 * calendar date, so the cutover is timezone-correct across DST transitions.
 *
 * `pacificDateString` is kept for any caller that genuinely wants the Pacific
 * calendar date (it's not used in the live slate path anymore).
 */
const PACIFIC_TZ = 'America/Los_Angeles'
const EASTERN_TZ = 'America/New_York'

/**
 * Returns YYYY-MM-DD for the current Pacific calendar date.
 * Uses `America/Los_Angeles`, so PST/PDT switchovers are handled correctly.
 *
 * Not used for the slate boundary — see `slateDateString` for that.
 */
export function pacificDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(now)
}

/**
 * Returns YYYY-MM-DD for the current MLB slate.
 *
 * Convention: Eastern Time, rolls over at 3 AM ET.
 *  - 11 PM ET on Apr 26 → "2026-04-26"
 *  - 1 AM ET  on Apr 27 → "2026-04-26"  (still part of Apr 26 slate)
 *  - 3 AM ET  on Apr 27 → "2026-04-27"  (new slate)
 *
 * Implementation: take the ET wall-clock time, subtract 3 hours, then take
 * the ET calendar date. Subtracting 3 hours moves "1 AM ET" into the
 * previous calendar day's 22:00, so the calendar date is correctly the
 * previous day. At 3 AM ET, the shifted time is exactly midnight of the
 * current ET day, so the date stays on the new slate. `Intl.DateTimeFormat`
 * with `America/New_York` handles EDT/EST and DST automatically — no fixed
 * −5/−4 offset hacks.
 */
export function slateDateString(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EASTERN_TZ,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(shifted)
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
