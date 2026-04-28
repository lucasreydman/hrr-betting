-- One-shot: GC deprecated sim cache rows. The hybrid model uses
-- typical:v1:* (offline-precomputed) instead of sim:* (request-time MC).
-- See docs/superpowers/specs/2026-04-28-hybrid-ranking-refactor-design.md
DELETE FROM cache WHERE key LIKE 'sim:%';
DELETE FROM cache WHERE key LIKE 'sim-meta:%';
