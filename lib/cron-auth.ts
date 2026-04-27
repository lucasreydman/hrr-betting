import type { NextRequest } from 'next/server'
import { sanitizeEnvValue } from './env'

/**
 * Verify a request carries the expected `x-cron-secret` header.
 *
 * Returns true if:
 *   - CRON_SECRET env var is unset AND we're NOT in production (dev-mode
 *     bypass for local testing; in production this fails closed so an
 *     accidentally-unset secret can't open up cron routes to the world).
 *   - The request's `x-cron-secret` header matches CRON_SECRET, after
 *     normalising whitespace and surrounding quotes on both sides
 *     (Vercel's env UI sometimes wraps values in quotes; GitHub secrets
 *     don't — without sanitisation those wouldn't match).
 *
 * Cron-triggered routes (sim, lock, settle, admin/bvp) call this at the top
 * and 401 immediately if it returns false.
 */
export function verifyCronRequest(req: NextRequest): boolean {
  const expected = sanitizeEnvValue(process.env.CRON_SECRET)
  if (!expected) {
    // Fail-closed in production — never accept un-authenticated cron calls
    // when running on Vercel / a real deploy. Dev-mode bypass only.
    if (process.env.NODE_ENV === 'production') return false
    return true
  }
  const header = sanitizeEnvValue(req.headers.get('x-cron-secret') ?? undefined)
  return header === expected
}
