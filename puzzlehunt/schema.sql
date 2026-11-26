-- schema.sql
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    current_level INTEGER NOT NULL DEFAULT 1,
    level_reached_at REAL,              -- server time of last level-up (leaderboard tie-break)
    finish_time REAL,                   -- set when the last level is solved
    last_attempt_at REAL NOT NULL DEFAULT 0,
    hints_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS levels (
    id INTEGER PRIMARY KEY,
    title TEXT,
    clue_text TEXT,
    answer_hash TEXT NOT NULL,          -- never the plain answer
    hint_text TEXT,
    template TEXT,
    asset TEXT
);

CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY,
    player_id INTEGER,
    level_id INTEGER,
    attempt_number INTEGER,
    submitted_at REAL,
    is_correct INTEGER
);

CREATE TABLE IF NOT EXISTS game_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'lobby',   -- lobby | running | finished
    started_at REAL,
    hints_enabled INTEGER NOT NULL DEFAULT 1,
    submissions_enabled INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO game_state (id) VALUES (1);

