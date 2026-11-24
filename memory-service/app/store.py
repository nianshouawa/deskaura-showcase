"""SQLite persistence, memory extraction, and relationship tracking."""

import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .schemas import ConversationIn, MemoryItem

DEFAULT_SCORE = 10
CONFIDENCE_THRESHOLD = 0.6
CATEGORIES = (
    "preferences",
    "relationship",
    "important_events",
    "emotional_patterns",
    "interests",
)

CATEGORY_KEYWORDS = {
    "preferences": ("喜欢", "讨厌", "习惯", "爱吃", "偏好", "最爱"),
    "important_events": ("生日", "纪念日", "毕业", "搬家", "面试", "入职", "考试"),
    "emotional_patterns": ("心情", "难过", "伤心", "开心", "焦虑", "失眠", "压力"),
    "interests": ("游戏", "音乐", "电影", "运动", "阅读", "旅行", "动漫"),
    "relationship": ("朋友", "陪伴", "认识", "关系", "信任"),
}


class MemoryStore:
    """Store local memories and auditable relationship changes."""

    def __init__(self, database_path: str | None = None) -> None:
        """Initialize the SQLite database at the configured path."""
        path = database_path or os.getenv("MEMORY_DATABASE_PATH", "./data/memory.db")
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @staticmethod
    def provider_info() -> dict[str, object]:
        """Describe the configured memory provider without exposing credentials.

        DeskAura keeps SQLite as the deterministic local fallback.  A MemU
        installation can be requested with ``MEMORY_PROVIDER=memu``; the
        optional package is loaded by the future adapter only when it is
        actually installed.  Reporting this separately prevents a running
        SQLite service from being mistaken for a MemU connection.
        """
        requested = os.getenv("MEMORY_PROVIDER", "sqlite").strip().lower() or "sqlite"
        method = os.getenv("MEMU_RETRIEVE_METHOD", "rag").strip().lower() or "rag"
        if method not in {"rag", "llm"}:
            method = "rag"
        if requested != "memu":
            return {
                "requested": requested,
                "active": "sqlite",
                "available": True,
                "fallback": False,
                "method": "fts5",
                "detail": "本机 SQLite FTS5 记忆",
            }
        try:
            import memu  # type: ignore[import-not-found]  # optional dependency
        except Exception:
            return {
                "requested": "memu",
                "active": "sqlite",
                "available": False,
                "fallback": True,
                "method": method,
                "detail": "未安装 memu-py，已安全回退到本机 SQLite",
            }
        version = getattr(memu, "__version__", None)
        return {
            "requested": "memu",
            "active": "sqlite",
            "available": False,
            "fallback": True,
            "method": method,
            "version": str(version) if version else "unknown",
            "detail": "MemU 运行库已安装；请在角色记忆模块保存 Embedding 配置并检测",
        }

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY,
                    category TEXT NOT NULL,
                    content TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(category, content)
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
                    USING fts5(content, tokenize='unicode61');
                CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                    INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
                END;
                DROP TRIGGER IF EXISTS memories_au;
                CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
                    DELETE FROM memory_fts WHERE rowid = old.id;
                    INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
                END;
                CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                    DELETE FROM memory_fts WHERE rowid = old.id;
                END;
                CREATE TABLE IF NOT EXISTS relationship_events (
                    id INTEGER PRIMARY KEY,
                    delta INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    user_message TEXT NOT NULL,
                    ai_message TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS relationship_daily (
                    day TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL
                );
                """
            )

    def add_conversation(self, conversation: ConversationIn) -> list[MemoryItem]:
        """Persist a conversation and extract high-confidence memories."""
        memories = self._extract(conversation)
        now = datetime.now(timezone.utc).isoformat()
        with self._connection() as conn:
            conn.execute(
                "INSERT INTO conversations(session_id, user_message, ai_message, created_at) VALUES (?, ?, ?, ?)",
                (conversation.session_id, conversation.user_message, conversation.ai_message, now),
            )
            stored: list[MemoryItem] = []
            for item in memories:
                conn.execute(
                    """
                    INSERT INTO memories(category, content, confidence, created_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(category, content) DO UPDATE SET
                        confidence = MAX(confidence, excluded.confidence),
                        created_at = excluded.created_at
                    """,
                    (item.category, item.content, item.confidence, item.created_at.isoformat()),
                )
                row = conn.execute(
                    "SELECT * FROM memories WHERE category = ? AND content = ?",
                    (item.category, item.content),
                ).fetchone()
                stored.append(self._row_to_memory(row))
        return stored

    def _extract(self, conversation: ConversationIn) -> list[MemoryItem]:
        text = conversation.user_message.strip()
        if len(text) < 4:
            return []
        categories = [
            category
            for category, keywords in CATEGORY_KEYWORDS.items()
            if any(keyword in text for keyword in keywords)
        ]
        if conversation.user_emotion and "emotional_patterns" not in categories:
            categories.append("emotional_patterns")
        now = datetime.now(timezone.utc)
        return [
            MemoryItem(
                id=0,
                category=category,
                content=text,
                confidence=0.8,
                created_at=now,
            )
            for category in categories
            if 0.8 >= CONFIDENCE_THRESHOLD
        ]

    def delete_session(self, session_id: str) -> None:
        """Remove this conversation and memories not also supplied by other sessions."""
        with self._connection() as conn:
            texts = [r[0] for r in conn.execute('SELECT user_message FROM conversations WHERE session_id=?', (session_id,))]
            conn.execute('DELETE FROM conversations WHERE session_id=?', (session_id,))
            for text in texts:
                if not conn.execute('SELECT 1 FROM conversations WHERE user_message=? LIMIT 1', (text,)).fetchone():
                    conn.execute('DELETE FROM memories WHERE content=?', (text.strip(),))

    def search(self, query: str, top_k: int = 8) -> list[MemoryItem]:
        """Search memories using exact fragments, FTS, then recent fallback."""
        query = query.strip()
        with self._connection() as conn:
            rows = conn.execute(
                "SELECT * FROM memories WHERE content LIKE ? ORDER BY id DESC LIMIT ?",
                (f"%{query}%", top_k),
            ).fetchall()
            if not rows and query:
                tokens = re.findall(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]{2,}", query)
                try:
                    rows = conn.execute(
                        """
                        SELECT m.* FROM memory_fts f
                        JOIN memories m ON m.id = f.rowid
                        WHERE memory_fts MATCH ? ORDER BY bm25(memory_fts) LIMIT ?
                        """,
                        (" OR ".join(f'"{token}"' for token in tokens), top_k),
                    ).fetchall() if tokens else []
                except sqlite3.OperationalError:
                    rows = []
            if not rows:
                rows = conn.execute(
                    "SELECT * FROM memories ORDER BY id DESC LIMIT ?", (top_k,)
                ).fetchall()
        return [self._row_to_memory(row) for row in rows]

    def categories(self) -> dict[str, int]:
        """Return totals for all companion memory categories."""
        result = dict.fromkeys(CATEGORIES, 0)
        with self._connection() as conn:
            for row in conn.execute(
                "SELECT category, COUNT(*) AS total FROM memories GROUP BY category"
            ):
                result[row["category"]] = row["total"]
        return result

    def status(self) -> dict[str, int]:
        """Return memory count and the current relationship level."""
        with self._connection() as conn:
            count = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
            delta = conn.execute(
                "SELECT COALESCE(SUM(delta), 0) FROM relationship_events"
            ).fetchone()[0]
        score = max(0, min(100, DEFAULT_SCORE + delta))
        return {
            "memory_count": count,
            "relationship_score": score,
            "relationship_level": min(5, score // 20 + 1),
        }

    def update_relationship(self, delta: int, reason: str) -> dict[str, int]:
        """Append an auditable score adjustment and return the new status."""
        with self._connection() as conn:
            conn.execute(
                "INSERT INTO relationship_events(delta, reason, created_at) VALUES (?, ?, ?)",
                (delta, reason, datetime.now(timezone.utc).isoformat()),
            )
        return self.status()

    def record_interaction(self, message: str, user_emotion: str | None) -> dict[str, int]:
        """Apply daily, deep-conversation, negative, and absence rules."""
        now = datetime.now(timezone.utc)
        today = now.date().isoformat()
        with self._connection() as conn:
            last_row = conn.execute(
                "SELECT created_at FROM conversations ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if last_row:
                last_seen = datetime.fromisoformat(last_row["created_at"])
                absent_days = max(0, (now - last_seen).days)
                if absent_days >= 7:
                    decay = -min(5, absent_days // 7)
                    reason = f"absence_decay:{last_seen.date().isoformat()}:{today}"
                    exists = conn.execute(
                        "SELECT 1 FROM relationship_events WHERE reason = ?", (reason,)
                    ).fetchone()
                    if not exists:
                        conn.execute(
                            "INSERT INTO relationship_events(delta, reason, created_at) VALUES (?, ?, ?)",
                            (decay, reason, now.isoformat()),
                        )
            inserted = conn.execute(
                "INSERT OR IGNORE INTO relationship_daily(day, created_at) VALUES (?, ?)",
                (today, now.isoformat()),
            ).rowcount
            if inserted:
                conn.execute(
                    "INSERT INTO relationship_events(delta, reason, created_at) VALUES (1, ?, ?)",
                    (f"daily_chat:{today}", now.isoformat()),
                )
            if len(message.strip()) >= 80:
                conn.execute(
                    "INSERT INTO relationship_events(delta, reason, created_at) VALUES (2, ?, ?)",
                    ("deep_conversation", now.isoformat()),
                )
            if user_emotion in {"angry", "disgusted"}:
                conn.execute(
                    "INSERT INTO relationship_events(delta, reason, created_at) VALUES (-1, ?, ?)",
                    (f"negative_emotion:{user_emotion}", now.isoformat()),
                )
        return self.status()

    def proactive_messages(self) -> list[dict[str, str]]:
        """Return special-date and reunion prompts appropriate for today."""
        now = datetime.now(timezone.utc)
        messages: list[dict[str, str]] = []
        with self._connection() as conn:
            rows = conn.execute(
                "SELECT content FROM memories WHERE category = 'important_events' ORDER BY id DESC"
            ).fetchall()
            last_row = conn.execute(
                "SELECT created_at FROM conversations ORDER BY id DESC LIMIT 1"
            ).fetchone()
        for row in rows:
            for month, day in re.findall(r"(\d{1,2})月(\d{1,2})日", row["content"]):
                if int(month) == now.month and int(day) == now.day:
                    messages.append(
                        {"type": "special_date", "text": f"今天是你提过的特别日子：{row['content']}。希望今天对你温柔一点。"}
                    )
                    break
        if last_row:
            last_seen = datetime.fromisoformat(last_row["created_at"])
            absent_days = max(0, (now - last_seen).days)
            if absent_days >= 3:
                messages.append(
                    {"type": "reunion", "text": f"我们有 {absent_days} 天没见了，最近过得怎么样？"}
                )
        return messages

    @staticmethod
    def _row_to_memory(row: sqlite3.Row) -> MemoryItem:
        return MemoryItem(
            id=row["id"],
            category=row["category"],
            content=row["content"],
            confidence=row["confidence"],
            created_at=row["created_at"],
        )


class MemUMemoryProvider:
    """Compatibility bridge to the real role-scoped MemU registry."""

    def __init__(self, *, method: str = "rag", role_id: str = "default", database_path: str | None = None) -> None:
        from .memu_provider import MemURegistry
        self.method = method if method in {"rag", "llm"} else "rag"
        self.role_id = role_id
        self.registry = MemURegistry(MemoryStore(database_path))

    @property
    def info(self) -> dict[str, object]:
        return self.registry.provider_info(self.role_id)

    async def get_context(self, query: str, top_k: int = 8) -> str:
        result = await self.registry.search(self.role_id, query, top_k)
        return "\n".join(item.content for item in result["memories"])
