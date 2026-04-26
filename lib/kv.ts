const memoryStore = new Map<string, { value: unknown; expiresAt: number }>()

type KvClient = {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, options?: { ex: number }): Promise<unknown>
  del(key: string): Promise<unknown>
}

let kvClientPromise: Promise<KvClient> | null = null

export function sanitizeEnvValue(value: string | undefined): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1).trim() || undefined
  }

  return trimmed
}

function getKvCredentials(): { url: string; token: string } | null {
  const url = sanitizeEnvValue(process.env.KV_REST_API_URL)
  const token = sanitizeEnvValue(process.env.KV_REST_API_TOKEN)

  if (!url || !token) return null
  return { url, token }
}

export function isVercelKvAvailable(): boolean {
  return getKvCredentials() !== null
}

async function getKvClient(): Promise<KvClient> {
  if (!kvClientPromise) {
    const credentials = getKvCredentials()
    if (!credentials) {
      throw new Error('Missing required environment variables KV_REST_API_URL and KV_REST_API_TOKEN')
    }

    kvClientPromise = import('@vercel/kv').then(({ createClient }) =>
      createClient({
        url: credentials.url,
        token: credentials.token,
      })
    )
  }

  return kvClientPromise
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (isVercelKvAvailable()) {
    const kv = await getKvClient()
    return kv.get<T>(key)
  }
  const entry = memoryStore.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key)
    return null
  }
  return entry.value as T
}

export async function kvSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  if (isVercelKvAvailable()) {
    const kv = await getKvClient()
    if (ttlSeconds) {
      await kv.set(key, value, { ex: ttlSeconds })
    } else {
      await kv.set(key, value)
    }
    return
  }
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity
  memoryStore.set(key, { value, expiresAt })
}

export async function kvDel(key: string): Promise<void> {
  if (isVercelKvAvailable()) {
    const kv = await getKvClient()
    await kv.del(key)
    return
  }
  memoryStore.delete(key)
}
