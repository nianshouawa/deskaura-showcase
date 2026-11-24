"""Memory API tests."""

from fastapi.testclient import TestClient


def test_extracts_and_searches_preference(tmp_path, monkeypatch):
    """A Chinese preference should be categorized and searchable."""
    monkeypatch.setenv("MEMORY_DATABASE_PATH", str(tmp_path / "memory.db"))
    import app.main as main
    from app.store import MemoryStore

    main.store = MemoryStore()
    client = TestClient(main.app)
    response = client.post(
        "/api/memory/conversations",
        json={"user_message": "我喜欢爵士音乐", "ai_message": "我记住了"},
    )
    assert response.status_code == 200
    assert response.json()["memories"][0]["category"] == "preferences"
    assert client.get(
        "/api/memory/search", params={"query": "爵士音乐"}
    ).json()["memories"]


def test_relationship_is_bounded(tmp_path, monkeypatch):
    """Relationship score should remain within zero and one hundred."""
    monkeypatch.setenv("MEMORY_DATABASE_PATH", str(tmp_path / "memory.db"))
    import app.main as main
    from app.store import MemoryStore

    main.store = MemoryStore()
    assert main.store.update_relationship(-10, "test")["relationship_score"] == 0

def test_deleting_session_preserves_only_shared_memories(tmp_path):
    from app.store import MemoryStore
    from app.schemas import ConversationIn
    store = MemoryStore(str(tmp_path / 'memory-delete.db'))
    for session, text in [('a', '我喜欢爵士音乐'), ('b', '我喜欢爵士音乐'), ('a', '我喜欢下雨天')]:
        store.add_conversation(ConversationIn(session_id=session, user_message=text, ai_message='记住了'))
    store.delete_session('a')
    with store._connection() as conn:
        assert conn.execute('SELECT COUNT(*) FROM conversations').fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM memories WHERE content='我喜欢下雨天'").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM memories WHERE content='我喜欢爵士音乐'").fetchone()[0] > 0
        assert conn.execute("SELECT COUNT(*) FROM memory_fts WHERE memory_fts MATCH '\"下雨天\"'").fetchone()[0] == 0
    store.delete_session('b')
    assert store.status()['memory_count'] == 0


def test_daily_relationship_gain_only_applies_once(tmp_path, monkeypatch):
    monkeypatch.setenv("MEMORY_DATABASE_PATH", str(tmp_path / "memory.db"))
    from app.store import MemoryStore
    store = MemoryStore()
    first = store.record_interaction("今天聊聊天", None)
    second = store.record_interaction("再聊一次", None)
    assert first["relationship_score"] == 11
    assert second["relationship_score"] == 11


def test_provider_status_is_explicit_and_never_claims_unavailable_memu(tmp_path, monkeypatch):
    """MemU selection must report a truthful fallback instead of fake green."""
    monkeypatch.setenv("MEMORY_DATABASE_PATH", str(tmp_path / "memory.db"))
    monkeypatch.setenv("MEMORY_PROVIDER", "memu")
    from app.store import MemoryStore

    info = MemoryStore.provider_info()
    assert info["requested"] == "memu"
    assert info["active"] in {"sqlite", "memu"}
    if info["active"] == "sqlite":
        assert info["fallback"] is True
        assert info["available"] is False
