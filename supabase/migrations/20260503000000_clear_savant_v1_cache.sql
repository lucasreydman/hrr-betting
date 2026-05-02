-- Drop any cached `savant:*:v1:*` entries. The v1 parser used wrong CSV
-- column names (e.g. `barrel_batted_rate` instead of the live `brl_percent`),
-- so every cached record had all-zero values for barrelPct / hardHitPct /
-- xwOBA. The new parser reads the real Savant column names; this flush
-- makes sure the in-cache zeros don't keep serving while the v2 cache
-- builds.
DELETE FROM cache WHERE key LIKE 'savant:%:v1:%';
