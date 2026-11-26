# Cybur Hunt (`puzzlehunt`)

A multiplayer, mobile-friendly web puzzle hunt built with **Python**, **Flask**, and **SQLite**. Players join a shared lobby from their phones, race through 10 cyber-themed puzzle levels once the host starts the game, and compete on a live auto-refreshing leaderboard.

---

## 1. Project Structure

```text
cybur_hunt/
├── make.md                     # Original build specification
├── README.md                   # This documentation
└── puzzlehunt/
    ├── app.py                  # Flask routes, game state rules, and APIs
    ├── config.py               # Game limits & environment secrets
    ├── db.py                   # SQLite connection helper & init_db()
    ├── schema.sql              # Database schema (players, levels, submissions, game_state)
    ├── seed_levels.py          # Hashes answers (SHA-256) and seeds levels into SQLite
    ├── puzzlehunt.db           # SQLite database (created by seed_levels.py)
    ├── requirements.txt        # Python dependencies (Flask and openpyxl)
    ├── levels/
    │   ├── __init__.py         # Auto-discovers and sorts LEVEL dicts by id
    │   ├── level_01.py ... level_10.py
    ├── templates/
    │   ├── join.html           # Player name entry (/)
    │   ├── lobby.html          # Waiting room (/lobby)
    │   ├── level.html          # Default clue & answer submission page (/level)
    │   ├── level_06.html       # Custom template with HTML-comment clue
    │   ├── leaderboard.html    # Live standings (/leaderboard)
    │   └── admin.html          # Host login & control panel (/admin)
    └── static/
        ├── style.css           # Mobile-first dark-mode styling
        ├── app.js              # Polling, form submissions, and admin actions
        └── levels/
            └── signal_05.png   # Morse code image asset for Level 5
```

---

## 2. How It Works

### Game States
The `game_state` table (single row, `id = 1`) controls what players can do:

| State | Allowed | Blocked |
| :--- | :--- | :--- |
| `lobby` | Join (`/api/join`, max 15 players), `/lobby`, `/leaderboard`, admin kick/start | `/level`, `/api/submit`, `/api/hint` |
| `running` | `/level`, `/api/submit`, `/api/hint`, `/leaderboard`, admin kick/finish/reset | New joins (`403 Game already started`) |
| `finished` | `/leaderboard`, admin controls | Joining, playing, submitting |

### Player Flow
1. **Join (`/`)**: A player enters a unique handle (up to 30 characters). `POST /api/join` uses a `BEGIN IMMEDIATE` SQLite transaction to enforce the `MAX_PLAYERS` (15) cap and uniqueness, then stores `pid` in a signed Flask session cookie.
2. **Lobby (`/lobby`)**: Polls `GET /api/lobby` every 2.5 seconds to show the current player count (`n / 15`) and joined names. If the host kicks a player, they are redirected back to `/`.
3. **Start (`/admin`)**: The host logs in at `/admin` and clicks **Start Game**. The server requires at least `MIN_PLAYERS` (2) players, sets `status = 'running'`, and records `started_at`.
4. **Play (`/level`)**: Lobby clients automatically redirect to `/level`.
   - The server always reads `current_level` from the player's database record (never from the client).
   - **Rate Limiting**: `POST /api/submit` enforces a `RATE_LIMIT_SECONDS` (3s) cooldown per player, returning HTTP `429` (`"Slow down"`) if exceeded.
   - **Answer Verification**: Submitted answers are stripped, lowercased, and compared against `levels.answer_hash` using SHA-256. Every attempt is logged in `submissions`.
   - **Hints**: Clicking **Get a hint** calls `POST /api/hint`, revealing the level's hint and incrementing `hints_used` once per level. Admins can pause and resume hints independently.
   - **Host controls**: Admins can pause and resume answer submissions independently of hints. Both controls are enforced by the server.
   - **Completion**: Solving Level 10 sets `finish_time` on the player and redirects them to `/leaderboard`.
5. **Leaderboard (`/leaderboard`)**: Auto-refreshes every 10 seconds (`GET /api/leaderboard`). Players are ranked by:
   1. Finishers first (`finish_time IS NOT NULL`)
   2. Highest `current_level`
   3. Earliest `finish_time` or `level_reached_at` (tie-breaker)
   4. Elapsed time shown relative to `started_at`.

---

## 3. Configuration (`puzzlehunt/config.py`)

| Setting | Default | Description |
| :--- | :--- | :--- |
| `MIN_PLAYERS` | `2` | Minimum players required to start the game |
| `MAX_PLAYERS` | `15` | Maximum players allowed in the lobby |
| `RATE_LIMIT_SECONDS` | `3` | Cooldown between answer submissions per player |
| `ADMIN_PASSWORD` | `admin123` (or `ADMIN_PASSWORD` env var) | Password for `/admin` |
| `SECRET_KEY` | `cybur-hunt-dev-secret-key` (or `SECRET_KEY` env var) | Flask session signing key |

---

## 4. How to Run

### Prerequisites
- Python 3.10+ (tested on Python 3.13)
- `pip`

### 1. Install Dependencies
```powershell
cd puzzlehunt
pip install -r requirements.txt
```

### 2. Seed the Database
Run `seed_levels.py` to create `puzzlehunt.db` from `schema.sql` and load all 10 levels with SHA-256 hashed answers:
```powershell
python seed_levels.py
```
*(Re-run `python seed_levels.py` anytime you edit level clues, hints, or answers.)*

### 3. Set Environment Variables & Start the Server
**PowerShell (Windows):**
```powershell
$env:ADMIN_PASSWORD = "choose-a-strong-password"
$env:SECRET_KEY = "choose-a-random-secret"
python app.py
```



**Bash (Linux / macOS):**
```bash
export ADMIN_PASSWORD="choose-a-strong-password"
export SECRET_KEY="choose-a-random-secret"
python app.py
```

The server binds to `0.0.0.0:5000` so devices on the same Wi-Fi/LAN can connect using your machine's local IP address (e.g. `http://192.168.1.50:5000`).

---

## 5. URLs & Hosting an Event

- **Players (Phones):** `http://<host-ip>:5000/`
- **Projector / TV:** `http://<host-ip>:5000/leaderboard`
- **Host / Admin Panel:** `http://<host-ip>:5000/admin`

### Admin Controls
- **Start Game**: Transitions from `lobby` to `running` (requires at least 2 players).
- **Finish Game**: Transitions to `finished` and locks submissions.
- **Pause / Resume hints and submissions**: Independently disables or re-enables hints and answer submissions. Settings persist until changed or the game is reset.
- **Download results (.xlsx)**: Downloads ranked player standings, progress, elapsed time, hints used, and total attempts as an Excel workbook.
- **Kick**: Removes a specific player and their submissions, freeing their lobby slot.
- **Reset All**: Clears all players and submissions and returns `game_state` to `lobby`.

---

## 6. Level Walkthrough (Host Reference)

> **Note:** Plaintext answers are never stored in the database (`puzzlehunt.db` only stores SHA-256 hashes).

| Level | Title | Puzzle Type | Answer |
| :---: | :--- | :--- | :--- |
| 1 | Base64 Warmup | Base64 decode (`d2VsY29tZQ==`) | `welcome` |
| 2 | Caesar's Shift | Caesar cipher shift +3 (`Wkh nhb lv vlpsob VKLIW`) | `shift` |
| 3 | Hexadecimal Signal | Hex to ASCII (`4e 45 54 57 4f 52 4b`) | `network` |
| 4 | Binary Pulse | 8-bit ASCII binary | `proxy` |
| 5 | Morse Intercept | Visual Morse code ([signal_05.png](file:///d:/techevent2027_mayuri/cybur_hunt/puzzlehunt/static/levels/signal_05.png)) | `cipher` |
| 6 | Hidden in the Source | HTML comment inside [level_06.html](file:///d:/techevent2027_mayuri/cybur_hunt/puzzlehunt/templates/level_06.html) | `phantom` |
| 7 | ROT13 Transmission | ROT13 decode (`zngevk`) | `matrix` |
| 8 | The Acrostic | First letter of each of the 6 lines | `beacon` |
| 9 | Atbash Mirror | Atbash cipher (`K Z H H D L I W`) | `password` |
| 10 | The Master Key | First letter of Levels 2–9 answers combined (imported dynamically in [level_10.py](file:///d:/techevent2027_mayuri/cybur_hunt/puzzlehunt/levels/level_10.py)) | `snpcpmbp` |

