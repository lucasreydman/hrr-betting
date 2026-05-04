-- Flush pitcher season cache (v2 → v3) so the new gamesPlayed +
-- gamesStarted fields are populated on the next cron tick.
--
-- Without these fields, opener detection's prior-season-reliever path
-- and the pitcher factor's cold-start fallback both silently read 0
-- and skip their codepaths. Bumping the cache prefix v2 → v3 in
-- lib/mlb-api.ts:fetchPitcherSeasonStats forces a re-fetch with the
-- new shape; this DELETE GCs the v2 entries immediately so the next
-- slate-refresh cron picks up the fix.
--
-- Pattern matches both v2 and v3 (using the bare prefix); the v3
-- entries don't exist yet so the DELETE only hits v2 in practice.

DELETE FROM cache WHERE key LIKE 'hrr:pitcher:season:%';
