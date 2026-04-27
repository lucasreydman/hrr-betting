-- HRR Betting v0.1.0 initial schema
-- Two tables: locked_picks (snapshotted at lock trigger, immutable)
--             settled_picks (boxscore outcome appended after game finalizes)
--
-- Both tables hold one row per (date, game, player, rung) — i.e., a single
-- player can have up to 3 rows per game (one per rung) on any given date.

-- ============================================================================
-- locked_picks: Tracked picks captured at lock time (~30 min before first pitch)
-- ============================================================================

CREATE TABLE locked_picks (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    game_id INTEGER NOT NULL,
    rung SMALLINT NOT NULL CHECK (rung IN (1, 2, 3)),
    player_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    player_team TEXT NOT NULL,
    player_bats CHAR(1) NOT NULL CHECK (player_bats IN ('R', 'L', 'S')),
    opponent_team_id INTEGER NOT NULL,
    opponent_abbrev TEXT NOT NULL,
    lineup_slot SMALLINT NOT NULL,
    lineup_status TEXT NOT NULL CHECK (lineup_status IN ('confirmed', 'partial', 'estimated')),
    p_matchup REAL NOT NULL,
    p_typical REAL NOT NULL,
    edge REAL NOT NULL,
    confidence REAL NOT NULL,
    score REAL NOT NULL,
    UNIQUE (date, game_id, player_id, rung)
);

CREATE INDEX locked_picks_date_idx ON locked_picks (date);
CREATE INDEX locked_picks_player_idx ON locked_picks (player_id, date);
CREATE INDEX locked_picks_game_idx ON locked_picks (game_id);

-- ============================================================================
-- settled_picks: Same shape as locked_picks plus outcome columns.
-- A locked pick becomes a settled pick after the cron at 3 AM Pacific
-- pulls the boxscore and computes actual H+R+RBI.
-- ============================================================================

CREATE TABLE settled_picks (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    game_id INTEGER NOT NULL,
    rung SMALLINT NOT NULL CHECK (rung IN (1, 2, 3)),
    player_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    player_team TEXT NOT NULL,
    player_bats CHAR(1) NOT NULL CHECK (player_bats IN ('R', 'L', 'S')),
    opponent_team_id INTEGER NOT NULL,
    opponent_abbrev TEXT NOT NULL,
    lineup_slot SMALLINT NOT NULL,
    lineup_status TEXT NOT NULL CHECK (lineup_status IN ('confirmed', 'partial', 'estimated')),
    p_matchup REAL NOT NULL,
    p_typical REAL NOT NULL,
    edge REAL NOT NULL,
    confidence REAL NOT NULL,
    score REAL NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('HIT', 'MISS', 'PENDING')),
    actual_hrr SMALLINT,
    UNIQUE (date, game_id, player_id, rung)
);

CREATE INDEX settled_picks_date_idx ON settled_picks (date);
CREATE INDEX settled_picks_settled_at_idx ON settled_picks (settled_at);
CREATE INDEX settled_picks_player_idx ON settled_picks (player_id, date);
CREATE INDEX settled_picks_rung_outcome_idx ON settled_picks (rung, outcome);

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- Enable RLS so anon/authenticated keys can't read these tables.
-- Service role (used by our cron jobs and API routes) bypasses RLS.
-- We deliberately don't add any policies — this locks the tables to
-- service-role-only access.

ALTER TABLE locked_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE settled_picks ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Comment on schema for future readers
-- ============================================================================

COMMENT ON TABLE locked_picks IS 'Tracked picks captured at lock trigger (~30 min before first pitch). Immutable once written.';
COMMENT ON TABLE settled_picks IS 'Locked picks with HIT/MISS outcome appended after boxscore settlement.';
