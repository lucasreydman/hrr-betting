-- One-shot cache invalidation: clear schedule and lineup rows held under the
-- old uniform 6h TTL.
--
-- The schedule cache held game.status for 6h, so once a slate cached as
-- "scheduled" the status stuck all afternoon — pitcher pills never flipped
-- from PROBABLE to CONFIRMED even after first pitch. Same shape of bug on
-- estimated/partial lineups: a team would post the real lineup and the UI
-- would still show "estimated #N" for hours.
--
-- Fix in lib/mlb-api.ts:
--  · TTL_SCHEDULE = 2 min (was 6h), key bumped hrr:schedule: → hrr:schedule:v2:
--  · TTL_LINEUP_PENDING = 2 min for partial/estimated lineups (confirmed
--    keeps 6h since they don't change once posted), key bumped
--    hrr:lineup:v2: → hrr:lineup:v3:
--
-- Cleared keys:
--  · hrr:schedule:%       (without v2)   — orphaned 6h schedule rows
--  · hrr:lineup:v2:%                     — orphaned 6h lineup rows
--  · picks:current:%                     — 30s ranker cache built on stale data
--
-- Safe to leave in the migrations directory — re-running on a clean DB just
-- deletes nothing.

DELETE FROM cache
 WHERE (key LIKE 'hrr:schedule:%' AND key NOT LIKE 'hrr:schedule:v2:%')
    OR key LIKE 'hrr:lineup:v2:%'
    OR key LIKE 'picks:current:%';
