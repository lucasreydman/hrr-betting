-- Cache table backing lib/kv.ts (replaces Vercel KV / Upstash for hot caches).
-- All cache values are JSONB; expires_at is optional (null = no expiry).
-- The application checks expires_at on read; expired rows are deleted lazily.
-- For periodic cleanup, a small SELECT pg_sleep(... ) cron job or a Supabase
-- Edge Function on a schedule would suffice — for v1 we rely on lazy cleanup
-- + the natural churn (most cache entries are overwritten before they expire).

CREATE TABLE cache (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    written_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index: only index rows that have an expires_at, so the cleanup query
-- can scan a small subset.
CREATE INDEX cache_expires_at_idx ON cache (expires_at) WHERE expires_at IS NOT NULL;

-- RLS — service-role-only access.
ALTER TABLE cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE cache IS 'Hot cache for HRR betting (sim results, P_typical, weather, Savant CSVs, etc.). Replaces Vercel KV / Upstash.';
