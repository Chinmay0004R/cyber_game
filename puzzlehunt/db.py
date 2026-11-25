import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "puzzlehunt.db")
SCHEMA_PATH = os.path.join(BASE_DIR, "schema.sql")


def get_db():
    """Return a SQLite connection configured with Row factory and autocommit."""
    db = sqlite3.connect(DB_PATH, isolation_level=None, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def init_db():
    """Initialize database tables from schema.sql."""
    db = get_db()
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        db.executescript(f.read())
    db.close()

