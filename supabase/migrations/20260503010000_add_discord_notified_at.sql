-- Add discord_notified_at column to locked_picks for Discord webhook idempotency.
--
-- The lock cron route posts a Discord embed per game whenever new tracked picks
-- land. This column gates "have we already posted this row?" without needing a
-- separate notification log table.
--
-- Backfill: existing rows are set to NOW() so the first post-deploy cron run
-- does not blast every previously-locked pick. Only picks locked after this
-- migration runs (i.e., have NULL here) will trigger a Discord post.

ALTER TABLE locked_picks
    ADD COLUMN IF NOT EXISTS discord_notified_at TIMESTAMPTZ;

UPDATE locked_picks
    SET discord_notified_at = NOW()
    WHERE discord_notified_at IS NULL;

-- Partial index: only the un-notified subset is hot. Speeds up the
-- "WHERE date = $1 AND discord_notified_at IS NULL" query the cron runs every
-- 5 minutes during slate hours.
CREATE INDEX IF NOT EXISTS locked_picks_discord_pending_idx
    ON locked_picks (date)
    WHERE discord_notified_at IS NULL;
