import { POST } from '@/app/api/refresh/route'
import { NextRequest } from 'next/server'

// Mock rankPicks so the third test doesn't do live network calls / p-typical MCs.
// The route's auth + input validation logic is what this file tests; rankPicks
// correctness is covered by the ranker and prob-today unit tests.
jest.mock('@/lib/ranker', () => ({
  rankPicks: jest.fn().mockResolvedValue({
    date: '2026-04-28',
    refreshedAt: new Date().toISOString(),
    rung1: [],
    rung2: [],
    rung3: [],
    meta: {
      gamesTotal: 0,
      fromCache: false,
      gameStates: { scheduled: 0, inProgress: 0, final: 0, postponed: 0 },
    },
  }),
}))

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

  it('returns 200 on a valid request when ranker succeeds', async () => {
    const res = await POST(buildReq({ scope: 'today' }))
    expect(res.status).toBe(200)
  })

  it('returns 503 when ranker throws', async () => {
    const { rankPicks } = await import('@/lib/ranker')
    ;(rankPicks as jest.Mock).mockRejectedValueOnce(new Error('upstream failure'))
    const res = await POST(buildReq({ scope: 'today' }))
    expect(res.status).toBe(503)
  })
})
