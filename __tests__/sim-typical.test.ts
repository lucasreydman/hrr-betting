/**
 * __tests__/sim-typical.test.ts
 *
 * Tests for POST /api/sim/typical.
 *
 * Auth bypass: verifyCronRequest returns true when CRON_SECRET is unset and
 * NODE_ENV !== 'production'. In the test environment NODE_ENV === 'test', so
 * all requests without a secret header still pass auth (CRON_SECRET must be
 * unset — ensured by afterEach cleanup).
 */

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/sim/typical/route'

function makeRequest(body: unknown, secret?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (secret !== undefined) headers['x-cron-secret'] = secret
  return new NextRequest('http://localhost:3000/api/sim/typical', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  delete process.env.CRON_SECRET
  jest.restoreAllMocks()
})

describe('POST /api/sim/typical', () => {
  // To test the 401 path we temporarily set NODE_ENV=production + a secret.
  it('returns 401 when CRON_SECRET is set and header is wrong (production mode)', async () => {
    const origEnv = process.env.NODE_ENV
    process.env.CRON_SECRET = 'supersecret'
    // @ts-expect-error -- NODE_ENV is readonly in types but writable at runtime for test setup
    process.env.NODE_ENV = 'production'
    try {
      const req = makeRequest({ mode: 'full' }, 'wrongsecret')
      const res = await POST(req)
      expect(res.status).toBe(401)
    } finally {
      // @ts-expect-error -- restore NODE_ENV after test
      process.env.NODE_ENV = origEnv
      delete process.env.CRON_SECRET
    }
  })

  it('returns 400 on invalid mode', async () => {
    const req = makeRequest({ mode: 'bogus' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid mode')
  })

  it('returns 400 when mode is player but playerId is missing', async () => {
    const req = makeRequest({ mode: 'player' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid playerId')
  })

  it('returns 400 when mode is player but playerId is 0', async () => {
    const req = makeRequest({ mode: 'player', playerId: 0 })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid playerId')
  })

  it('returns 400 on invalid json body', async () => {
    const req = new NextRequest('http://localhost:3000/api/sim/typical', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid json')
  })

  it('returns 200 on full mode even with empty playerIds (fire-and-forget)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const req = makeRequest({ mode: 'full' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('full')
    expect(Array.isArray(body.playerIds)).toBe(true)
    expect(Array.isArray(body.errors)).toBe(true)
    expect(body.errors).toHaveLength(0)
  })
})
