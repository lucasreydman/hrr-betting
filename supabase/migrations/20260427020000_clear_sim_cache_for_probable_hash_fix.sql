-- One-shot cache invalidation: clear sim and picks:current rows generated
-- under the old cache-key scheme (sim:{gameId}:{lineupHash}, no probableHash).
-- The new scheme adds probableHash to the key (sim:{gameId}:{lineupHash}:{probableHash})
-- so old rows would never be hit again; this just frees the storage and prevents
-- /api/picks from reading any leaked stale entries during the migration window.
--
-- Safe to leave in the migrations directory — re-running on a clean database
-- just deletes nothing.

DELETE FROM cache
 WHERE key LIKE 'sim:%'
    OR key LIKE 'sim-meta:%'
    OR key LIKE 'picks:current:%';
