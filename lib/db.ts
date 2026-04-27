import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase database client wrapper.
 *
 * Two roles:
 *   - **Server-side (cron jobs, API routes)**: uses the service role key, which
 *     bypasses Row Level Security. All persistent picks data (locked_picks,
 *     settled_picks) is read/written via this client.
 *   - **Local dev fallback**: when env vars are missing (e.g., running tests in
 *     memory), `getSupabase` returns null and callers should branch to a
 *     no-persistence path.
 *
 * The publishable / anon key is never used in this codebase — we only ever
 * access Supabase server-side. If a future feature needs client-side access
 * (e.g., real-time leaderboard), that's where the anon key + RLS policies
 * would come in.
 */

let cached: SupabaseClient | null | undefined  // undefined = not yet checked

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached

  const url = sanitize(process.env.SUPABASE_URL)
  const serviceKey = sanitize(process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (!url || !serviceKey) {
    cached = null
    return null
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

export function isSupabaseAvailable(): boolean {
  return getSupabase() !== null
}

function sanitize(value: string | undefined): string | undefined {
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

// ============================================================================
// Table types — mirror the SQL schema in supabase/migrations/
// ============================================================================

export interface LockedPickRow {
  id?: number
  date: string  // YYYY-MM-DD
  locked_at?: string  // ISO timestamp; defaulted by Postgres
  game_id: number
  rung: 1 | 2 | 3
  player_id: number
  player_name: string
  player_team: string
  player_bats: 'R' | 'L' | 'S'
  opponent_team_id: number
  opponent_abbrev: string
  lineup_slot: number
  lineup_status: 'confirmed' | 'partial' | 'estimated'
  p_matchup: number
  p_typical: number
  edge: number
  confidence: number
  score: number
}

export interface SettledPickRow extends LockedPickRow {
  settled_at?: string
  outcome: 'HIT' | 'MISS' | 'PENDING'
  actual_hrr: number | null
}
