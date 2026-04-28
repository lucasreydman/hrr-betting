import { POST } from '@/app/api/refresh/route'
import { NextRequest } from 'next/server'

function buildReq(body: object = {}, secret: string | null = null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (secret !== null) headers['x-cron-secret'] = secret
  return new NextRequest('http://localhost/api/refresh', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/refresh', () => {
  it('rejects with 401 when prod auth fails', async () => {
    const orig = process.env.NODE_ENV
    const origSecret = process.env.CRON_SECRET
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true })
    process.env.CRON_SECRET = 'real-secret'
    try {
      const res = await POST(buildReq({}, 'wrong-secret'))
      expect(res.status).toBe(401)
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: orig, configurable: true })
      if (origSecret === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = origSecret
    }
  })

  it('rejects with 400 on invalid date', async () => {
    const res = await POST(buildReq({ date: 'not-a-date' }))
    expect(res.status).toBe(400)
  })

  it('returns 200 or 503 on a valid request (depends on whether ranker can complete in test env)', async () => {
    const res = await POST(buildReq({ scope: 'today' }))
    expect([200, 503]).toContain(res.status)
  })
})
