"""Small persistent store for the website: public counters and contact-form messages.

SQLite on the cache volume (CACHE_DIR, /data on Railway), so both survive redeploys. No IP addresses or
user agents are stored (see the privacy note on /about).
"""
import sqlite3
import threading
import time
from pathlib import Path

COUNTERS = ("fields_analysed", "live_searches", "exposures_processed", "downloads", "visits")
# Events the browser may report. Live searches and exposures are counted by the server when a job finishes.
CLIENT_EVENTS = {"field": "fields_analysed", "download": "downloads", "visit": "visits"}


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)")
            self._db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, created REAL NOT NULL,"
                " name TEXT NOT NULL, email TEXT NOT NULL, topic TEXT NOT NULL, body TEXT NOT NULL,"
                " handled INTEGER NOT NULL DEFAULT 0)")
            for c in COUNTERS:
                self._db.execute("INSERT OR IGNORE INTO counters VALUES (?, 0)", (c,))
            self._db.execute("INSERT OR IGNORE INTO meta VALUES ('since', ?)", (time.strftime("%Y-%m-%d"),))

    def incr(self, name: str, by: int = 1) -> None:
        if name not in COUNTERS or by <= 0:
            return
        with self._lock:
            self._db.execute("UPDATE counters SET value = value + ? WHERE name = ?", (by, name))

    def stats(self) -> dict:
        with self._lock:
            rows = dict(self._db.execute("SELECT name, value FROM counters").fetchall())
            since = self._db.execute("SELECT value FROM meta WHERE key = 'since'").fetchone()[0]
        return {**{c: rows.get(c, 0) for c in COUNTERS}, "since": since}

    def add_message(self, name: str, email: str, topic: str, body: str) -> int:
        with self._lock:
            cur = self._db.execute("INSERT INTO messages (created, name, email, topic, body) VALUES (?, ?, ?, ?, ?)",
                                   (time.time(), name, email, topic, body))
            return int(cur.lastrowid)

    def messages(self, limit: int = 500) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT id, created, name, email, topic, body, handled FROM messages"
                                    " ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{"id": r[0], "created": r[1], "name": r[2], "email": r[3], "topic": r[4], "body": r[5],
                 "handled": bool(r[6])} for r in rows]

    def mark_handled(self, msg_id: int, handled: bool = True) -> bool:
        with self._lock:
            cur = self._db.execute("UPDATE messages SET handled = ? WHERE id = ?", (int(handled), msg_id))
            return cur.rowcount > 0

    def close(self) -> None:
        with self._lock:
            self._db.close()
