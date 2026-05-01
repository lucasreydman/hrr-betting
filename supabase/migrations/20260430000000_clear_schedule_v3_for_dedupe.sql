-- Drop any cached schedule:v3 entries that may hold duplicate matchup rows
-- (MLB Stats occasionally returns two gamePks for one game). The fetcher now
-- dedupes via dedupeGamesByMatchup and writes under v4. Without this flush,
-- cached v3 entries would still serve duplicates until their 2-min TTL
-- naturally expired.
DELETE FROM cache WHERE key LIKE 'hrr:schedule:v3:%';
