-- Flush today's pitcher season cache to pick up the hrPct unit fix.
--
-- The cached PitcherStats was missing the hrPct field (HR per BF), and the
-- ranker was deriving it from `hrPer9 / 9` which gives HR per inning, not
-- HR per BF — off by ~4×. Result: pitcher factor pegged at the 2.0 cap
-- on the majority of picks (audit showed mean 1.92 across 4 slates).
--
-- The fix in lib/mlb-api.ts now stores hrPct directly from raw HR / BF,
-- and the ranker reads it as-is. The cache key is slate-aligned, so old
-- entries naturally expire at the next 3 AM ET rollover, but we GC them
-- now so the next slate-refresh cron tick picks up the fix immediately.

DELETE FROM cache WHERE key LIKE 'hrr:pitcher:season:%';
