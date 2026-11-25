Puzzle Hunt: Complete Structure, Working and Build Guide

puzzlehunt/
├── app.py                  # routes + game logic
├── config.py               # MIN_PLAYERS, MAX_PLAYERS, RATE_LIMIT, secrets from env
├── db.py                   # connection helper + init_db()
├── schema.sql              # tables
├── seed_levels.py          # loads levels/ into DB (hashes answers)
├── requirements.txt        # flask
│
├── levels/                 # one file per level
│   ├── __init__.py         # collects every LEVEL dict, sorted by id
│   ├── level_01.py ... level_10.py
│
├── templates/
│   ├── join.html           # name entry
│   ├── lobby.html          # waiting room (n / 15)
│   ├── level.html          # default clue page
│   ├── level_06.html       # custom page with HTML-comment clue
│   ├── leaderboard.html
│   └── admin.html          # player count, Start, kick, reset, progress
│
└── static/
    ├── style.css
    ├── app.js              # fetch calls, polling
    └── levels/             # images only (QR, stego image), never answers


-- schema.sql
CREATE TABLE players (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    current_level INTEGER NOT NULL DEFAULT 1,
    level_reached_at REAL,              -- server time of last level-up (leaderboard tie-break)
    finish_time REAL,                   -- set when the last level is solved
    last_attempt_at REAL NOT NULL DEFAULT 0,
    hints_used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE levels (
    id INTEGER PRIMARY KEY,
    title TEXT, clue_text TEXT,
    answer_hash TEXT NOT NULL,          -- never the plain answer
    hint_text TEXT, template TEXT, asset TEXT
);
CREATE TABLE submissions (
    id INTEGER PRIMARY KEY,
    player_id INTEGER, level_id INTEGER,
    attempt_number INTEGER, submitted_at REAL, is_correct INTEGER
);
CREATE TABLE game_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'lobby',   -- lobby | running | finished
    started_at REAL
);
INSERT OR IGNORE INTO game_state (id) VALUES (1);




3. How it works

Game states

State	Allowed	Blocked
lobby	join (max 15), lobby page, leaderboard, admin kick	/level, submit, hint
running	level, submit, hint, leaderboard	new joins
finished	leaderboard only	everything else


Player flow

Player opens /, enters a unique name. POST /api/join creates the player and sets a session cookie.
Player waits in the lobby, which polls the player count every few seconds.
Admin presses Start. The server confirms at least 2 players, then sets status = running and saves started_at.
The lobby page sees the change and redirects to /level.
The player solves a level and is moved to the next. After level 10, finish_time is saved.
/leaderboard refreshes every 10 seconds and is shown on a projector.


Submit logic (server only)
Read the player from the session, never a level number from the browser.
Check status == running.
If now - last_attempt_at < 3, return "Slow down".
Clean the answer (strip().lower()), hash it with SHA-256 and compare with the current level's answer_hash.
Log the attempt in submissions.
If correct, increment current_level and set level_reached_at. If it was the last level, set finish_time.
If wrong, return "Wrong, try again."
Leaderboard order: highest current_level first, then earliest level_reached_at (or finish_time for finishers). Times are shown relative to started_at.

4. Key code
# config.py
import os
MIN_PLAYERS = 2
MAX_PLAYERS = 15
RATE_LIMIT_SECONDS = 3
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
SECRET_KEY = os.environ["SECRET_KEY"]

# db.py
import sqlite3
def get_db():
    db = sqlite3.connect("puzzlehunt.db", isolation_level=None, timeout=10)
    db.row_factory = sqlite3.Row
    return db
def init_db():
    db = get_db()
    db.executescript(open("schema.sql").read())

    # seed_levels.py
import hashlib
from db import get_db, init_db
from levels import load_levels

def h(t): return hashlib.sha256(t.strip().lower().encode()).hexdigest()

init_db()
db = get_db()
for l in load_levels():
    db.execute("""INSERT INTO levels (id,title,clue_text,answer_hash,hint_text,template,asset)
                  VALUES (?,?,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET title=excluded.title,
                  clue_text=excluded.clue_text, answer_hash=excluded.answer_hash,
                  hint_text=excluded.hint_text, template=excluded.template,
                  asset=excluded.asset""",
               (l["id"], l["title"], l["clue_text"], h(l["answer"]),
                l["hint"], l.get("template", "level.html"), l.get("asset")))

                # app.py (core routes)
import time, hashlib
from flask import Flask, request, session, jsonify, render_template, redirect
from db import get_db
import config

app = Flask(__name__)
app.secret_key = config.SECRET_KEY

def now(): return time.time()
def h(t): return hashlib.sha256(t.strip().lower().encode()).hexdigest()
def state(db): return db.execute("SELECT * FROM game_state").fetchone()
def me(db):
    pid = session.get("pid")
    return db.execute("SELECT * FROM players WHERE id=?", (pid,)).fetchone() if pid else None

@app.post("/api/join")
def join():
    name = (request.json.get("name") or "").strip()[:30]
    if not name: return jsonify(error="Enter a name"), 400
    db = get_db()
    db.execute("BEGIN IMMEDIATE")            # count + insert as one step
    try:
        if state(db)["status"] != "lobby":
            db.execute("ROLLBACK"); return jsonify(error="Game already started"), 403
        if db.execute("SELECT COUNT(*) FROM players").fetchone()[0] >= config.MAX_PLAYERS:
            db.execute("ROLLBACK"); return jsonify(error="Game is full"), 403
        if db.execute("SELECT 1 FROM players WHERE name=?", (name,)).fetchone():
            db.execute("ROLLBACK"); return jsonify(error="Name taken"), 409
        cur = db.execute("INSERT INTO players (name) VALUES (?)", (name,))
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK"); raise
    session["pid"] = cur.lastrowid
    return jsonify(ok=True)

@app.post("/admin/start")
def start():
    if not session.get("admin"): return "", 403
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM players").fetchone()[0] < config.MIN_PLAYERS:
        return jsonify(error="Need at least 2 players"), 400
    db.execute("UPDATE game_state SET status='running', started_at=?", (now(),))
    return jsonify(ok=True)

@app.post("/api/submit")
def submit():
    db = get_db()
    p = me(db)
    if not p or state(db)["status"] != "running":
        return jsonify(error="Game has not started"), 403
    t = now()
    if t - p["last_attempt_at"] < config.RATE_LIMIT_SECONDS:
        return jsonify(error="Slow down"), 429
    db.execute("UPDATE players SET last_attempt_at=? WHERE id=?", (t, p["id"]))
    answer = (request.json.get("answer") or "")[:100]
    lvl = db.execute("SELECT * FROM levels WHERE id=?", (p["current_level"],)).fetchone()
    ok = h(answer) == lvl["answer_hash"]
    n = db.execute("SELECT COUNT(*) FROM submissions WHERE player_id=? AND level_id=?",
                   (p["id"], lvl["id"])).fetchone()[0] + 1
    db.execute("INSERT INTO submissions VALUES (NULL,?,?,?,?,?)",
               (p["id"], lvl["id"], n, t, int(ok)))
    if not ok: return jsonify(correct=False, message="Wrong, try again.")
    last = db.execute("SELECT MAX(id) FROM levels").fetchone()[0]
    if lvl["id"] == last:
        db.execute("UPDATE players SET finish_time=?, level_reached_at=? WHERE id=?", (t, t, p["id"]))
        return jsonify(correct=True, finished=True)
    db.execute("UPDATE players SET current_level=current_level+1, level_reached_at=? WHERE id=?",
               (t, p["id"]))
    return jsonify(correct=True, finished=False)

    Not shown but needed: /level, /api/hint, /api/leaderboard, /api/lobby (player count and status), /admin/login, /admin/kick, /admin/reset.

    5. Building guide (step by step)
Step	Build	Done when
1	Create the folder, pip install flask, set ADMIN_PASSWORD and SECRET_KEY env vars. Add a route returning "Hello".	Browser shows Hello
2	Write schema.sql, db.py, config.py. Create levels/ with 3 test levels and run seed_levels.py.	DB has 3 rows with hashes
3	join.html plus /api/join, with session cookie, name check and 15-player cap.	Refresh keeps you as the same player; the 16th join is refused
4	lobby.html, /api/lobby polling, admin login, /admin/start with the 2-player check.	Start fails with 1 player and works with 2
5	level.html plus /level and /api/submit (steps 1 to 7 above).	Correct answer advances, wrong one doesn't, /level before start redirects to lobby
6	Rate limit (already in submit) and attempt logging. Test by spamming the button.	Second click within 3 seconds says "Slow down"
7	/api/leaderboard, leaderboard.html with a 10-second refresh.	Two phones show correct ordering
8	Admin page: live progress, kick, reset all, add or edit levels (or just re-run the seed).	Kick frees a slot
9	Write the real 10 levels, one file each. Level 6 gets level_06.html, level 10 imports answers from levels 2 to 9. Record every walkthrough in your spreadsheet.	You can finish all 10 yourself
10	Style for mobile (large input, big button). Add /hint and optional hint penalty.	Usable one-handed on a phone
11	Deploy to Render/Railway or run on a laptop with flask run --host=0.0.0.0. Test on real devices.	15 devices work at once

Complete steps 1 to 5 first. That is the whole game in its simplest form.

