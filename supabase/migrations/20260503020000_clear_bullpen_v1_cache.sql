-- Flush the broken v1 bullpen cache.
--
-- v1 hit the team-level /teams/{id}/stats endpoint which returns a single
-- combined split (gamesStarted = total team starts, never 0). The "skip
-- starters" parsing filter then dropped the only entry, totalIp came back
-- 0, and every team got the league-average fallback. Result: every pick's
-- bullpen factor was 1.00. v2 (in lib/bullpen.ts) uses the per-player
-- /stats?teamId endpoint and bumps the cache prefix; this migration GCs
-- the orphaned v1 rows so they don't sit there forever.

DELETE FROM cache WHERE key LIKE 'bullpen:v1:%';
