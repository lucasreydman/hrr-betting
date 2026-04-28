-- One-shot: delete deprecated p-typical:* cache rows. New baseline lives
-- under typical:v1:* (see docs/superpowers/specs/2026-04-28-hybrid-ranking-refactor-design.md).
DELETE FROM cache WHERE key LIKE 'p-typical:%';
