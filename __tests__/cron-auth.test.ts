/**
 * Cron-auth verifies the `x-cron-secret` header against `CRON_SECRET`.
 * It's the security boundary that gates every cron-only route in production
 * (`/api/lock`, `/api/settle`, `/api/refresh`, `/api/sim/*`, `/api/admin/bvp`).
 *
 * Direct unit coverage here — the higher-level route tests exercise the
 * happy path indirectly, but they don't pin down each branch of the
 * fail-closed-in-prod / open-in-dev policy.
 */
import { NextRequest } from 'next/server'
import { verifyCronRequest } from '@/lib/cron-auth'

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/lock', { headers })
}

// Direct assignment is used (not Object.defineProperty) because Node 24+
// rejects `defineProperty` on `process.env` unless writable + enumerable are
// also set, and the simple assignment form is the convention Jest documents.
// The `@ts-expect-error` is for `NODE_ENV` being typed as readonly — it's
// writable at runtime, just declared readonly so production code can't mutate it.
function withEnv<T>(
  overrides: { NODE_ENV?: string; CRON_SECRET?: string | undefined },
  body: () => T,
): T {
  const origNode = process.env.NODE_ENV
  const origSecret = process.env.CRON_SECRET
  if ('NODE_ENV' in overrides) {
    if (overrides.NODE_ENV === undefined) {
      delete process.env.NODE_ENV
    } else {
      // @ts-expect-error -- NODE_ENV is readonly in types but writable at runtime
      process.env.NODE_ENV = overrides.NODE_ENV
    }
  }
  if ('CRON_SECRET' in overrides) {
    if (overrides.CRON_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = overrides.CRON_SECRET
  }
  try {
    return body()
  } finally {
    if (origNode === undefined) delete process.env.NODE_ENV
    // @ts-expect-error -- NODE_ENV restoration; same readonly-at-types caveat
    else process.env.NODE_ENV = origNode
    if (origSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = origSecret
  }
}

describe('verifyCronRequest', () => {
  test('production + matching secret → true', () => {
    const ok = withEnv({ NODE_ENV: 'production', CRON_SECRET: 'topsecret' }, () =>
      verifyCronRequest(reqWith({ 'x-cron-secret': 'topsecret' })),
    )
    expect(ok).toBe(true)
  })

  test('production + missing header → false', () => {
    const ok = withEnv({ NODE_ENV: 'production', CRON_SECRET: 'topsecret' }, () =>
      verifyCronRequest(reqWith({})),
    )
    expect(ok).toBe(false)
  })

  test('production + wrong header → false', () => {
    const ok = withEnv({ NODE_ENV: 'production', CRON_SECRET: 'topsecret' }, () =>
      verifyCronRequest(reqWith({ 'x-cron-secret': 'nope' })),
    )
    expect(ok).toBe(false)
  })

  test('production + no CRON_SECRET set → false (fail closed)', () => {
    // Critical: an accidentally-unset secret in prod must NOT open the route.
    // The only-in-dev bypass is the trap we're guarding against.
    const ok = withEnv({ NODE_ENV: 'production', CRON_SECRET: undefined }, () =>
      verifyCronRequest(reqWith({ 'x-cron-secret': 'anything' })),
    )
    expect(ok).toBe(false)
  })

  test('dev (no secret set) + missing header → true (bypass)', () => {
    const ok = withEnv({ NODE_ENV: 'development', CRON_SECRET: undefined }, () =>
      verifyCronRequest(reqWith({})),
    )
    expect(ok).toBe(true)
  })

  test('dev + secret set + wrong header → false', () => {
    // When a secret IS configured, even dev requires it. The bypass is only
    // for the "no secret configured at all" case.
    const ok = withEnv({ NODE_ENV: 'development', CRON_SECRET: 'devsecret' }, () =>
      verifyCronRequest(reqWith({ 'x-cron-secret': 'wrong' })),
    )
    expect(ok).toBe(false)
  })

  test('dev + secret set + matching header → true', () => {
    const ok = withEnv({ NODE_ENV: 'development', CRON_SECRET: 'devsecret' }, () =>
      verifyCronRequest(reqWith({ 'x-cron-secret': 'devsecret' })),
    )
    expect(ok).toBe(true)
  })

  test('quoted env var + unquoted header still match (Vercel UI quirk)', () => {
    // sanitizeEnvValue strips matching surrounding quotes on both sides so a
    // value pasted with quotes in Vercel matches a GitHub Actions secret
    // that was stored without quotes.
    const ok = withEnv({ NODE_ENV: 'production', CRON_SECRET: '"topsecret"' }, () =>
      verifyCronRequest(reqWith({ 'x-cron-secret': 'topsecret' })),
    )
    expect(ok).toBe(true)
  })

  test('whitespace-padded header still matches', () => {
    const ok = withEnv({ NODE_ENV: 'production', CRON_SECRET: 'topsecret' }, () =>
      verifyCronRequest(reqWith({ 'x-cron-secret': '  topsecret  ' })),
    )
    expect(ok).toBe(true)
  })
})
