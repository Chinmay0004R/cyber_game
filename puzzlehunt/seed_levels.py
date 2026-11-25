import hashlib
from db import get_db, init_db
from levels import load_levels


def hash_answer(text: str) -> str:
    """Normalize and SHA-256 hash an answer string."""
    return hashlib.sha256(text.strip().lower().encode("utf-8")).hexdigest()


def seed():
    """Initialize the database and upsert all levels from levels/."""
    init_db()
    db = get_db()
    loaded = load_levels()
    for lvl in loaded:
        db.execute(
            """INSERT INTO levels (id, title, clue_text, answer_hash, hint_text, template, asset)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                   title=excluded.title,
                   clue_text=excluded.clue_text,
                   answer_hash=excluded.answer_hash,
                   hint_text=excluded.hint_text,
                   template=excluded.template,
                   asset=excluded.asset""",
            (
                lvl["id"],
                lvl["title"],
                lvl["clue_text"],
                hash_answer(lvl["answer"]),
                lvl["hint"],
                lvl.get("template", "level.html"),
                lvl.get("asset"),
            ),
        )
    db.close()
    print(f"Seeded {len(loaded)} levels into puzzlehunt.db")


if __name__ == "__main__":
    seed()

