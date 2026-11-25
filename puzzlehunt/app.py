import hashlib
import time
from flask import Flask, jsonify, redirect, render_template, request, session, url_for

import config
from db import get_db

app = Flask(__name__)
app.secret_key = config.SECRET_KEY


def now() -> float:
    return time.time()


def hash_answer(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).hexdigest()


def get_state(db):
    return db.execute("SELECT * FROM game_state WHERE id = 1").fetchone()


def get_player(db):
    pid = session.get("pid")
    if not pid:
        return None
    return db.execute("SELECT * FROM players WHERE id = ?", (pid,)).fetchone()


def get_total_levels(db) -> int:
    row = db.execute("SELECT COUNT(*) AS cnt, MAX(id) AS max_id FROM levels").fetchone()
    return row["max_id"] or row["cnt"] or 0


# ---------------------------------------------------------------------------
# Player Pages
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    db = get_db()
    st = get_state(db)
    p = get_player(db)
    if st["status"] == "finished":
        return redirect(url_for("leaderboard_page"))
    if p:
        if st["status"] == "running":
            return redirect(url_for("level_page"))
        return redirect(url_for("lobby_page"))
    return render_template("join.html", max_players=config.MAX_PLAYERS, status=st["status"])


@app.get("/lobby")
def lobby_page():
    db = get_db()
    st = get_state(db)
    if st["status"] == "finished":
        return redirect(url_for("leaderboard_page"))
    p = get_player(db)
    if not p:
        session.pop("pid", None)
        return redirect(url_for("index"))
    if st["status"] == "running":
        return redirect(url_for("level_page"))
    return render_template(
        "lobby.html",
        player_name=p["name"],
        max_players=config.MAX_PLAYERS,
    )


@app.get("/level")
def level_page():
    db = get_db()
    st = get_state(db)
    if st["status"] == "finished":
        return redirect(url_for("leaderboard_page"))
    p = get_player(db)
    if not p:
        session.pop("pid", None)
        return redirect(url_for("index"))
    if st["status"] == "lobby":
        return redirect(url_for("lobby_page"))
    if p["finish_time"] is not None:
        return redirect(url_for("leaderboard_page"))

    lvl = db.execute("SELECT * FROM levels WHERE id = ?", (p["current_level"],)).fetchone()
    if not lvl:
        return redirect(url_for("leaderboard_page"))

    total_levels = get_total_levels(db)
    revealed_hints = session.get("hints", [])
    hint_text = lvl["hint_text"] if lvl["id"] in revealed_hints else None
    template_name = lvl["template"] or "level.html"

    return render_template(
        template_name,
        player=p,
        level=lvl,
        total_levels=total_levels,
        hint_text=hint_text,
    )


@app.get("/leaderboard")
def leaderboard_page():
    return render_template("leaderboard.html")


# ---------------------------------------------------------------------------
# Player APIs
# ---------------------------------------------------------------------------

@app.post("/api/join")
def api_join():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:30]
    if not name:
        return jsonify(error="Enter a name"), 400

    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        if get_state(db)["status"] != "lobby":
            db.execute("ROLLBACK")
            return jsonify(error="Game already started"), 403
        if db.execute("SELECT COUNT(*) FROM players").fetchone()[0] >= config.MAX_PLAYERS:
            db.execute("ROLLBACK")
            return jsonify(error="Game is full"), 403
        if db.execute("SELECT 1 FROM players WHERE LOWER(name) = LOWER(?)", (name,)).fetchone():
            db.execute("ROLLBACK")
            return jsonify(error="Name taken"), 409
        cur = db.execute("INSERT INTO players (name) VALUES (?)", (name,))
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK")
        raise

    session["pid"] = cur.lastrowid
    session["hints"] = []
    return jsonify(ok=True, name=name)


@app.get("/api/lobby")
def api_lobby():
    db = get_db()
    st = get_state(db)
    p = get_player(db)
    rows = db.execute("SELECT name FROM players ORDER BY id ASC").fetchall()
    return jsonify(
        status=st["status"],
        player_count=len(rows),
        max_players=config.MAX_PLAYERS,
        players=[r["name"] for r in rows],
        me_exists=p is not None,
    )


@app.post("/api/submit")
def api_submit():
    db = get_db()
    p = get_player(db)
    st = get_state(db)
    if not p or st["status"] != "running" or p["finish_time"] is not None:
        return jsonify(error="Game has not started"), 403

    t = now()
    if t - p["last_attempt_at"] < config.RATE_LIMIT_SECONDS:
        return jsonify(error="Slow down"), 429

    db.execute("UPDATE players SET last_attempt_at = ? WHERE id = ?", (t, p["id"]))

    data = request.get_json(silent=True) or {}
    answer = (data.get("answer") or "")[:100]
    lvl = db.execute("SELECT * FROM levels WHERE id = ?", (p["current_level"],)).fetchone()
    if not lvl:
        return jsonify(error="Level not found"), 404

    ok = hash_answer(answer) == lvl["answer_hash"]
    attempt_num = (
        db.execute(
            "SELECT COUNT(*) FROM submissions WHERE player_id = ? AND level_id = ?",
            (p["id"], lvl["id"]),
        ).fetchone()[0]
        + 1
    )
    db.execute(
        "INSERT INTO submissions (player_id, level_id, attempt_number, submitted_at, is_correct) VALUES (?, ?, ?, ?, ?)",
        (p["id"], lvl["id"], attempt_num, t, int(ok)),
    )

    if not ok:
        return jsonify(correct=False, message="Wrong, try again.")

    last_id = db.execute("SELECT MAX(id) FROM levels").fetchone()[0]
    if lvl["id"] == last_id:
        db.execute(
            "UPDATE players SET finish_time = ?, level_reached_at = ? WHERE id = ?",
            (t, t, p["id"]),
        )
        return jsonify(correct=True, finished=True)

    db.execute(
        "UPDATE players SET current_level = current_level + 1, level_reached_at = ? WHERE id = ?",
        (t, p["id"]),
    )
    return jsonify(correct=True, finished=False)


@app.post("/api/hint")
def api_hint():
    db = get_db()
    p = get_player(db)
    st = get_state(db)
    if not p or st["status"] != "running" or p["finish_time"] is not None:
        return jsonify(error="Game is not active"), 403

    lvl = db.execute("SELECT id, hint_text FROM levels WHERE id = ?", (p["current_level"],)).fetchone()
    if not lvl:
        return jsonify(error="Level not found"), 404

    hints = list(session.get("hints", []))
    hints_used = p["hints_used"]
    if lvl["id"] not in hints:
        hints.append(lvl["id"])
        session["hints"] = hints
        hints_used += 1
        db.execute("UPDATE players SET hints_used = ? WHERE id = ?", (hints_used, p["id"]))

    return jsonify(hint=lvl["hint_text"], hints_used=hints_used)


@app.get("/api/leaderboard")
def api_leaderboard():
    db = get_db()
    st = get_state(db)
    total_levels = get_total_levels(db)
    started_at = st["started_at"]

    rows = db.execute(
        """SELECT id, name, current_level, level_reached_at, finish_time, hints_used
           FROM players
           ORDER BY
               (finish_time IS NOT NULL) DESC,
               current_level DESC,
               COALESCE(finish_time, level_reached_at, 9e18) ASC,
               id ASC"""
    ).fetchall()

    players = []
    for idx, r in enumerate(rows, start=1):
        ref_time = r["finish_time"] or r["level_reached_at"]
        elapsed = (ref_time - started_at) if (started_at and ref_time) else None
        players.append(
            {
                "rank": idx,
                "name": r["name"],
                "current_level": r["current_level"],
                "finished": r["finish_time"] is not None,
                "elapsed_seconds": round(elapsed, 1) if elapsed is not None else None,
                "hints_used": r["hints_used"],
            }
        )

    return jsonify(
        status=st["status"],
        started_at=started_at,
        total_levels=total_levels,
        players=players,
    )


# ---------------------------------------------------------------------------
# Admin Pages & APIs
# ---------------------------------------------------------------------------

@app.get("/admin")
def admin_page():
    return render_template("admin.html", is_admin=bool(session.get("admin")))


@app.post("/admin/login")
def admin_login():
    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    if password != config.ADMIN_PASSWORD:
        return jsonify(error="Invalid password"), 403
    session["admin"] = True
    return jsonify(ok=True)


@app.post("/admin/logout")
def admin_logout():
    session.pop("admin", None)
    return jsonify(ok=True)


@app.get("/api/admin/status")
def admin_status():
    if not session.get("admin"):
        return jsonify(error="Unauthorized"), 403
    db = get_db()
    st = get_state(db)
    total_levels = get_total_levels(db)
    started_at = st["started_at"]

    rows = db.execute(
        """SELECT p.id, p.name, p.current_level, p.level_reached_at, p.finish_time, p.hints_used,
                  COUNT(s.id) AS attempts
           FROM players p
           LEFT JOIN submissions s ON s.player_id = p.id
           GROUP BY p.id
           ORDER BY
               (p.finish_time IS NOT NULL) DESC,
               p.current_level DESC,
               COALESCE(p.finish_time, p.level_reached_at, 9e18) ASC,
               p.id ASC"""
    ).fetchall()

    players = []
    for r in rows:
        ref_time = r["finish_time"] or r["level_reached_at"]
        elapsed = (ref_time - started_at) if (started_at and ref_time) else None
        players.append(
            {
                "id": r["id"],
                "name": r["name"],
                "current_level": r["current_level"],
                "finished": r["finish_time"] is not None,
                "elapsed_seconds": round(elapsed, 1) if elapsed is not None else None,
                "hints_used": r["hints_used"],
                "attempts": r["attempts"],
            }
        )

    return jsonify(
        status=st["status"],
        started_at=started_at,
        min_players=config.MIN_PLAYERS,
        max_players=config.MAX_PLAYERS,
        total_levels=total_levels,
        players=players,
    )


@app.post("/admin/start")
def admin_start():
    if not session.get("admin"):
        return "", 403
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM players").fetchone()[0] < config.MIN_PLAYERS:
        return jsonify(error=f"Need at least {config.MIN_PLAYERS} players"), 400
    db.execute("UPDATE game_state SET status = 'running', started_at = ? WHERE id = 1", (now(),))
    return jsonify(ok=True)


@app.post("/admin/finish")
def admin_finish():
    if not session.get("admin"):
        return "", 403
    db = get_db()
    db.execute("UPDATE game_state SET status = 'finished' WHERE id = 1")
    return jsonify(ok=True)


@app.post("/admin/kick")
def admin_kick():
    if not session.get("admin"):
        return "", 403
    data = request.get_json(silent=True) or {}
    player_id = data.get("player_id")
    if not player_id:
        return jsonify(error="Missing player_id"), 400
    db = get_db()
    db.execute("DELETE FROM submissions WHERE player_id = ?", (player_id,))
    db.execute("DELETE FROM players WHERE id = ?", (player_id,))
    return jsonify(ok=True)


@app.post("/admin/reset")
def admin_reset():
    if not session.get("admin"):
        return "", 403
    db = get_db()
    db.execute("DELETE FROM submissions")
    db.execute("DELETE FROM players")
    db.execute("UPDATE game_state SET status = 'lobby', started_at = NULL WHERE id = 1")
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

