/**
 * Hot-cache helpers backed by Supabase Postgres (`cache` table).
 *
 * The functions here keep the historical `kv*` naming so that no call site
 * in the codebase has to change — but under the hood, this is the same
 * Supabase client that lib/db.ts uses for picks. One service, one auth.
 *
 * When `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are not set (local dev,
 * unit tests), an in-memory Map is used as a fallback so tests run hermetically.
 */

import { getSupabase } from './db'

interface MemoryEntry { value: unknown; expiresAt: number }
const memoryStore = new Map<string, MemoryEntry>()

interface CacheRow {
  key: string
  value: unknown
  expires_at: string | null
}

/**
 * Returns true when the persistent cache backend (Supabase) is available.
 * Name kept as `isVercelKvAvailable` for backward compatibility — the function
 * is unchanged in behavior: it gates which code path (Postgres vs in-memory)
 * is used.
 */
export function isVercelKvAvailable(): boolean {
  return getSupabase() !== null
}

/**
 * Sanitize an env value (strip whitespace + matching surrounding quotes).
 * Kept as a public export because some callers in the codebase use it for
 * other env-var sanitization needs.
 */
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

export async function kvGet<T>(key: string): Promise<T | null> {
  const supabase = getSupabase()
  if (!supabase) return memoryGet<T>(key)

  const { data, error } = await supabase
    .from('cache')
    .select('value, expires_at')
    .eq('key', key)
    .maybeSingle<{ value: unknown; expires_at: string | null }>()

  if (error || !data) return null

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    // Expired — fire-and-forget delete; don't await (return null fast)
    void supabase.from('cache').delete().eq('key', key)
    return null
  }

  return data.value as T
}

export async function kvSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return memorySet(key, value, ttlSeconds)

  const expires_at = ttlSeconds
    ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
    : null

  await supabase
    .from('cache')
    .upsert({ key, value, expires_at } satisfies CacheRow, { onConflict: 'key' })
}

export async function kvDel(key: string): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return memoryDel(key)
  await supabase.from('cache').delete().eq('key', key)
}

// ---------------------------------------------------------------------------
// In-memory fallback (used in tests and local dev without SUPABASE_* env vars)
// ---------------------------------------------------------------------------

function memoryGet<T>(key: string): T | null {
  const entry = memoryStore.get(key)
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    memoryStore.delete(key)
    return null
  }
  return entry.value as T
}

function memorySet(key: string, value: unknown, ttlSeconds?: number): void {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity
  memoryStore.set(key, { value, expiresAt })
}

function memoryDel(key: string): void {
  memoryStore.delete(key)
}
