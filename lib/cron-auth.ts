import type { NextRequest } from 'next/server'

/**
 * Verify a request carries the expected `x-cron-secret` header.
 *
 * Returns true if:
 *   - CRON_SECRET env var is unset (dev mode — auth bypassed for local testing)
 *   - the request's `x-cron-secret` header matches CRON_SECRET
 *
 * Cron-triggered routes (sim, lock, settle) call this at the top and
 * 401 immediately if it returns false.
 */
export function verifyCronRequest(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return true  // dev-mode bypass
  const header = req.headers.get('x-cron-secret')
  return header === expected
}
