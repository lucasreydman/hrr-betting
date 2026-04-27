-- One-shot cache invalidation: clear lineup + person rows that were populated
-- before the player-name hydration fix landed. New requests will repopulate
-- with real names from the MLB Stats /people endpoint.
--
-- This runs once and is safe to leave in the migrations directory — re-running
-- on a clean database just deletes nothing.

DELETE FROM cache WHERE key LIKE 'hrr:lineup:%' OR key LIKE 'hrr:person:%';
