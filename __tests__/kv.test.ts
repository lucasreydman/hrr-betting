import { kvGet, kvSet, kvDel, isVercelKvAvailable } from '@/lib/kv'

describe('kv wrapper (in-memory fallback)', () => {
  beforeEach(() => { delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN })

  test('isVercelKvAvailable returns false without env', () => {
    expect(isVercelKvAvailable()).toBe(false)
  })

  test('set / get / del round-trip in memory', async () => {
    await kvSet('hrr:test', { foo: 'bar' }, 60)
    const got = await kvGet<{ foo: string }>('hrr:test')
    expect(got).toEqual({ foo: 'bar' })
    await kvDel('hrr:test')
    expect(await kvGet('hrr:test')).toBeNull()
  })

  test('expired key returns null', async () => {
    await kvSet('hrr:exp', 'x', 1)
    // Wait for expiration (1 second = 1000ms)
    await new Promise(r => setTimeout(r, 1100))
    expect(await kvGet('hrr:exp')).toBeNull()
  })
})
