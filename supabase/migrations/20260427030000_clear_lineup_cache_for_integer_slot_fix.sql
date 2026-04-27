-- One-shot cache invalidation: clear lineup, picks, and sim rows that were
-- generated under the old fractional-slot lineup estimator
-- (lib/mlb-api.ts:buildEstimatedLineupForTeam used a `medianOf` helper that
-- could return slot 4.5 for a player split between slots 4 and 5, and
-- assigned multiple players to the same slot when their medians collided).
--
-- The fix in lib/mlb-api.ts switches to a mode-based estimator with greedy
-- collision handling, guaranteeing 9 distinct integer slots 1-9. To force
-- the new logic to take effect immediately (rather than waiting for the
-- 6-hour TTL on the old cache rows), the lineup cache key was also bumped
-- from `hrr:lineup:` to `hrr:lineup:v2:` — so old rows are unreachable
-- already; this migration just frees their storage.
--
-- Cleared keys:
--  · hrr:lineup:% (without v2)   — orphaned lineups under the old prefix
--  · picks:current:%             — 5-min ranker cache built on old lineups
--  · sim:%                       — sim outputs whose lineupHash embedded
--                                  fractional slots (unreachable from new
--                                  lineup hashes anyway, just freeing space)
--  · sim-meta:%                  — paired metadata for the above sim rows
--
-- Safe to leave in the migrations directory — re-running on a clean DB
-- just deletes nothing.

DELETE FROM cache
 WHERE (key LIKE 'hrr:lineup:%' AND key NOT LIKE 'hrr:lineup:v2:%')
    OR key LIKE 'picks:current:%'
    OR key LIKE 'sim:%'
    OR key LIKE 'sim-meta:%';
