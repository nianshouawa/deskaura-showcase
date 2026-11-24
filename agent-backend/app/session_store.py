"""Short-term session history persisted locally for restart resilience."""
from __future__ import annotations
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

class SessionStore:
    """Durable archive; context is limited at model invocation, never by deletion."""
    def __init__(self, path: str | None = None) -> None:
        self.path = Path(path or os.getenv("SESSION_DATABASE_PATH", "./data/sessions.db"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS turns (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT)")
            conn.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at TEXT NOT NULL)")
            conn.execute("INSERT OR IGNORE INTO sessions SELECT DISTINCT session_id, '过去的对话', ? FROM turns", (self.now(),))
    @staticmethod
    def now():
        return datetime.now(timezone.utc).isoformat()
    @staticmethod
    def _prefix(role_id: str | None) -> str:
        value = str(role_id or "default").strip()[:128] or "default"
        return "" if value == "default" else f"{value}::"

    def create(self, role_id: str | None = None) -> dict:
        value = {"id": self._prefix(role_id) + uuid4().hex, "title": "新对话", "updated_at": self.now()}
        with sqlite3.connect(self.path) as conn:
            conn.execute("INSERT INTO sessions VALUES (:id,:title,:updated_at)", value)
        return value
    def list(self, role_id: str | None = None) -> list[dict]:
        with sqlite3.connect(self.path) as conn:
            conn.row_factory = sqlite3.Row
            rows = [dict(row) for row in conn.execute("SELECT * FROM sessions ORDER BY updated_at DESC")]
        prefix = self._prefix(role_id)
        return ([row for row in rows if "::" not in str(row["id"])] if not prefix else
                [row for row in rows if str(row["id"]).startswith(prefix)])

    @classmethod
    def belongs(cls, session_id: str, role_id: str) -> bool:
        prefix = cls._prefix(role_id)
        return session_id.startswith(prefix) if prefix else "::" not in session_id
    def rename(self, session_id: str, title: str) -> bool:
        with sqlite3.connect(self.path) as conn:
            return bool(conn.execute("UPDATE sessions SET title=? WHERE id=?", (title.strip()[:80] or "新对话", session_id)).rowcount)
    def delete(self, session_id: str) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.execute("DELETE FROM turns WHERE session_id=?", (session_id,))
            conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))
    def delete_role(self, role_id: str) -> None:
        prefix = self._prefix(role_id)
        if not prefix:
            return
        with sqlite3.connect(self.path) as conn:
            ids = [row[0] for row in conn.execute("SELECT id FROM sessions") if str(row[0]).startswith(prefix)]
            conn.executemany("DELETE FROM turns WHERE session_id=?", ((ident,) for ident in ids))
            conn.executemany("DELETE FROM sessions WHERE id=?", ((ident,) for ident in ids))
    def append(self, session_id: str, role: str, content: str) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.execute("INSERT OR IGNORE INTO sessions VALUES (?, '新对话', ?)", (session_id, self.now()))
            if role == 'user':
                conn.execute("UPDATE sessions SET title=? WHERE id=? AND title='新对话'", (content.strip().replace('\n', ' ')[:24], session_id))
            conn.execute("INSERT INTO turns(session_id, role, content) VALUES (?, ?, ?)", (session_id, role, content))
            conn.execute("UPDATE sessions SET updated_at=? WHERE id=?", (self.now(), session_id))
    def history(self, session_id: str) -> list[dict[str, str]]:
        with sqlite3.connect(self.path) as conn:
            rows = conn.execute("SELECT role, content FROM turns WHERE session_id=? ORDER BY id", (session_id,)).fetchall()
        return [{"role": row[0], "content": row[1]} for row in rows]
