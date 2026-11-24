"""Exercise the official MemU engine, with only its embedding transport stubbed."""

import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.memu_provider import MemoryConfig, MemURegistry, role_digest
from app.schemas import ConversationIn
from app.store import MemoryStore


@pytest.fixture
def credentials(monkeypatch):
    values = {}
    monkeypatch.setattr("keyring.get_password", lambda service, name: values.get((service, name)))
    monkeypatch.setattr("keyring.set_password", lambda service, name, key: values.__setitem__((service, name), key))
    monkeypatch.setattr("keyring.delete_password", lambda service, name: values.pop((service, name), None))
    return values


@pytest.fixture
def embedding(monkeypatch):
    calls = []

    async def embed(self, texts):
        calls.append(texts)
        return [[1.0, float("爵士" in text), float("雨天" in text), .2] for text in texts], {}

    monkeypatch.setattr("memu.embedding.http_client.HTTPEmbeddingClient.embed", embed)
    return calls


def test_real_memu_indexes_migrates_and_retrieves_per_role(tmp_path, credentials, embedding):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    registry.archive_for("alice").add_conversation(ConversationIn(
        user_message="我喜欢爵士音乐", ai_message="记住了", session_id="old", role_id="alice"))
    for role in ("alice", "bob"):
        config = registry.save_config(role, MemoryConfig(api_key="test-secret"))
        assert config["has_api_key"]
        assert "test-secret" not in str(config)
        assert "test-secret" not in registry._config_path(role).read_text(encoding="utf-8")
        assert asyncio.run(registry.test(role))["ok"]
    result = asyncio.run(registry.search("alice", "爵士音乐", 8))
    assert any("爵士" in item.content for item in result["memories"])
    assert not asyncio.run(registry.search("bob", "爵士音乐", 8))["memories"]
    assert embedding
    assert registry.provider_info("alice")["verified"]
    assert registry.provider_info("alice")["active"] == "memu"
    # A fresh registry reads the persisted MemU sqlite index, not an in-memory
    # local keyword cache.
    resumed = MemURegistry(registry.archive)
    assert asyncio.run(resumed.search("alice", "爵士音乐", 8))["memories"]


def test_memu_failure_is_red_and_never_fts_disguised(tmp_path, credentials, embedding, monkeypatch):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    registry.save_config("role", MemoryConfig(api_key="test-secret"))
    assert asyncio.run(registry.test("role"))["ok"]

    async def fail(*args, **kwargs):
        raise RuntimeError("upstream contains confidential request")

    monkeypatch.setattr("memu.embedding.http_client.HTTPEmbeddingClient.embed", fail)
    assert not asyncio.run(registry.test("role"))["ok"]
    assert not registry.provider_info("role")["verified"]
    result = asyncio.run(registry.search("role", "any", 8))
    assert not result["memories"]
    assert "confidential" not in str(result)


def test_memu_session_deletion_removes_actual_recall_files(tmp_path, credentials, embedding):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    registry.save_config("role", MemoryConfig(api_key="test-secret"))
    for session, text in (("one", "我喜欢爵士音乐"), ("two", "我喜欢雨天")):
        asyncio.run(registry.add_conversation("role", ConversationIn(
            session_id=session, user_message=text, ai_message="记住了")))
    registry.delete_session("role", "one")
    result = asyncio.run(registry.search("role", "爵士音乐", 8))
    assert all("爵士" not in item.content for item in result["memories"])
    assert any("雨天" in item.content for item in result["memories"])


def test_memory_http_role_isolation(tmp_path, credentials, monkeypatch):
    import app.main as main
    main.store = MemoryStore(str(tmp_path / "archive.db"))
    client = TestClient(main.app)
    assert client.post("/api/memory/conversations", json={
        "user_message": "我喜欢爵士音乐", "ai_message": "记住了", "role_id": "alice",
    }).status_code == 200
    assert client.get("/api/memory/status", params={"role_id": "alice"}).json()["memory_count"] > 0
    assert client.get("/api/memory/status", params={"role_id": "bob"}).json()["memory_count"] == 0


def test_invalid_embedding_never_passes(tmp_path, credentials, embedding, monkeypatch):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    registry.save_config("role", MemoryConfig(api_key="test-secret"))

    async def invalid(self, texts):
        return [[float("nan")] for _ in texts], {}

    monkeypatch.setattr("memu.embedding.http_client.HTTPEmbeddingClient.embed", invalid)
    assert not asyncio.run(registry.test("role"))["ok"]


def test_delete_role_does_not_delete_another_character(tmp_path, credentials, embedding):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    for role in ("alice", "bob"):
        registry.save_config(role, MemoryConfig(api_key="test-secret"))
        asyncio.run(registry.add_conversation(role, ConversationIn(
            user_message="我喜欢爵士音乐", ai_message="记住了", role_id=role)))
    assert registry.delete_role("alice")["ok"]
    assert registry.archive_for("alice").status()["memory_count"] == 0
    assert not registry._get_key("alice")
    assert registry._config_path("alice").exists()  # Other role module settings are retained.
    assert registry.archive_for("bob").status()["memory_count"] > 0
    assert asyncio.run(registry.search("bob", "爵士音乐", 8))["memories"]


def test_memory_path_accepts_a_file_and_uses_its_parent_directory(tmp_path, credentials, monkeypatch):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    target = tmp_path / "migrated-memory" / "memu.db"
    target.parent.mkdir(parents=True)
    target.write_text("index", encoding="utf-8")
    monkeypatch.setattr(registry, "_shared_settings", lambda _role: {"memory_path": str(target)})
    assert registry._storage_directory("role") == target.parent
    assert registry.archive_for("role").path == registry._index_directory("role") / "memory.db"


def test_custom_memory_path_keeps_index_separate_from_markdown(tmp_path, credentials):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    custom = tmp_path / "portable-memory"
    registry.save_config("role", MemoryConfig(api_key="test-secret", memory_path=str(custom)))
    registry.archive_for("role").add_conversation(ConversationIn(
        user_message="我喜欢爵士音乐", ai_message="记住了", session_id="one", role_id="role"))
    assert (registry._directory("role") / "memory.db").is_file()
    assert (custom / "memory").is_dir()
    assert (custom / "skill").is_dir()


def test_empty_memory_path_returns_and_initializes_the_default_markdown_store(tmp_path, credentials):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    value = registry.get_config("role")
    default = registry._directory("role") / "memu"
    assert value["memory_path"] == str(default)
    assert (default / "memory").is_dir()
    assert (default / "skill").is_dir()


def test_legacy_role_directory_memory_path_migrates_to_markdown_subdirectory(tmp_path, credentials):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    legacy = registry._directory("role")
    (legacy / "memory").mkdir(parents=True)
    (legacy / "memory" / "existing.md").write_text(
        "---\nname: existing\ndescription: 现有记忆\n---\n现有内容\n", encoding="utf-8")
    registry.save_config("role", MemoryConfig(api_key="test-secret", memory_path=str(legacy)))
    value = registry.get_config("role")
    migrated = legacy / "memu"
    assert value["memory_path"] == str(migrated)
    assert (migrated / "memory" / "existing.md").is_file()
    assert (migrated / "skill").is_dir()


def test_memory_path_mirrors_portable_markdown_and_imports_external_edits(tmp_path, credentials, embedding):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    custom = tmp_path / "portable-memu"
    registry.save_config("role", MemoryConfig(api_key="test-secret", memory_path=str(custom)))
    asyncio.run(registry.add_conversation("role", ConversationIn(
        user_message="我喜欢爵士音乐", ai_message="记住了", session_id="one", role_id="role")))
    mirrored = list((custom / "memory").glob("*.md"))
    assert mirrored and mirrored[0].read_text(encoding="utf-8").startswith("---\n")
    assert (custom / ".memory_manifest.json").is_file()

    external = custom / "memory" / "durable-hobby.md"
    external.write_text(
        "---\nname: durable-hobby\ndescription: 用户长期爱好\n---\n用户喜欢爵士音乐。\n",
        encoding="utf-8",
    )
    asyncio.run(registry.search("role", "爵士音乐", 8))
    names = {item.name for item in registry._service("role").database.recall_file_repo.list_recall_files().values()}
    assert "durable-hobby" in names
    assert external.is_file()


def test_config_rejects_embedded_credentials(tmp_path, credentials):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    with pytest.raises(ValueError):
        registry.save_config("role", MemoryConfig(base_url="https://user:password@example.com/v1"))


def test_shared_config_and_role_header_are_used(tmp_path, credentials, monkeypatch):
    import hashlib
    import json
    import app.main as main
    config = tmp_path / "config.json"
    monkeypatch.setenv("DESKAURA_CONFIG_PATH", str(config))
    main.store = MemoryStore(str(tmp_path / "memory.db"))
    main._registry = None
    slug = hashlib.sha256(b"alice").hexdigest()[:24]
    path = tmp_path / "roles" / slug / "config.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"brain_tag": "preserve", "memory_tag": "Alice memory",
                               "memory_connection_mode": "local",
                               "memory_embedding_base_url": "http://127.0.0.1:9999/v1",
                               "memory_embedding_model": "local-embed"}))
    client = TestClient(main.app)
    headers = {"X-DeskAura-Role": "alice"}
    settings = client.get("/api/memory/config", headers=headers).json()
    assert settings["tag"] == "Alice memory" and settings["model"] == "local-embed"
    result = client.post("/api/memory/conversations", headers=headers, json={
        "user_message": "我喜欢爵士", "ai_message": "记住了",
    })
    assert result.is_success
    assert client.get("/api/memory/status", headers=headers).json()["memory_count"] > 0
    assert client.get("/api/memory/status", headers={"X-DeskAura-Role": "bob"}).json()["memory_count"] == 0
    client.put("/api/memory/config", headers=headers, json={"api_key": "secret", "tag": "changed"})
    assert json.loads(path.read_text())["brain_tag"] == "preserve"
    assert credentials[("DeskAura", f"memory-embedding-api-key:{slug}")] == "secret"
    assert "secret" not in path.read_text()


@pytest.mark.parametrize("operation", ["add", "search"])
def test_inflight_old_configuration_cannot_verify_new_settings(
    tmp_path, credentials, embedding, monkeypatch, operation
):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    registry.save_config("role", MemoryConfig(api_key="test-secret"))
    if operation == "search":
        asyncio.run(registry.add_conversation("role", ConversationIn(
            session_id="one", user_message="我喜欢爵士音乐", ai_message="记住了")))

    from memu.embedding.http_client import HTTPEmbeddingClient
    original_embed = HTTPEmbeddingClient.embed

    async def change_config_during_embedding(self, texts):
        path = registry._config_path("role")
        settings = json.loads(path.read_text(encoding="utf-8"))
        settings["memory_embedding_model"] = "different-model"
        path.write_text(json.dumps(settings), encoding="utf-8")
        return await original_embed(self, texts)

    monkeypatch.setattr(HTTPEmbeddingClient, "embed", change_config_during_embedding)
    old_signature = registry._signature("role")
    if operation == "search":
        result = asyncio.run(registry.search("role", "爵士", 8))
        assert not result["memories"]
    else:
        asyncio.run(registry.add_conversation("role", ConversationIn(
            session_id="one", user_message="我喜欢爵士音乐", ai_message="记住了")))
    assert registry._signature("role") != old_signature
    assert not registry.provider_info("role")["verified"]
    assert registry._states["role"]["signature"] == old_signature


@pytest.mark.parametrize("unavailable", ["key_cleared", "disabled"])
def test_session_deletion_is_local_when_embedding_is_unavailable(
    tmp_path, credentials, embedding, monkeypatch, unavailable
):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    registry.save_config("role", MemoryConfig(api_key="test-secret"))
    for session, text in (("one", "我喜欢爵士音乐"), ("two", "我喜欢雨天")):
        asyncio.run(registry.add_conversation("role", ConversationIn(
            session_id=session, user_message=text, ai_message="记住了")))
    if unavailable == "key_cleared":
        registry.clear_key("role")
    else:
        registry.save_config("role", MemoryConfig(enabled=False))

    async def unexpected_network(*args, **kwargs):
        pytest.fail("Deleting local memory must not call Embedding")

    monkeypatch.setattr("memu.embedding.http_client.HTTPEmbeddingClient.embed", unexpected_network)
    registry.delete_session("role", "one")
    with registry.archive_for("role")._connection() as connection:
        assert [row[0] for row in connection.execute("SELECT session_id FROM conversations")] == ["two"]
    # Open the real official index directly without asking _service() to
    # validate disabled credentials.
    from memu.app.settings import DatabaseConfig, UserConfig
    from memu.database.factory import build_database
    database = build_database(
        config=DatabaseConfig(metadata_store={"provider": "sqlite",
            "dsn": f"sqlite:///{(registry._directory('role') / 'memu.db').as_posix()}"}),
        user_model=UserConfig().model,
    )
    try:
        files = list(database.recall_file_repo.list_recall_files({"user_id": "role"}).values())
        assert len(files) == 1
        assert "雨天" in files[0].content
    finally:
        database.close()


def test_session_index_failure_preserves_source_conversation(tmp_path, credentials, embedding, monkeypatch):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    registry.save_config("role", MemoryConfig(api_key="test-secret"))
    asyncio.run(registry.add_conversation("role", ConversationIn(
        session_id="one", user_message="我喜欢爵士音乐", ai_message="记住了")))

    def fail_open(**kwargs):
        raise OSError("index unavailable")

    monkeypatch.setattr("memu.database.factory.build_database", fail_open)
    with pytest.raises(OSError):
        registry.delete_session("role", "one")
    with registry.archive_for("role")._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM conversations").fetchone()[0] == 1


def test_role_delete_rejects_link_before_opening_or_modifying_database(tmp_path, credentials, monkeypatch):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    directory = registry.root / role_digest("role")
    original_is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda path: path == directory or original_is_symlink(path))
    monkeypatch.setattr(registry, "archive_for", lambda *_: pytest.fail("unsafe directory was opened"))
    with pytest.raises(ValueError, match="不能是链接"):
        registry.delete_role("role")


def test_builtin_memu_gateway_preserves_roles_and_deletes_both_indexes(
    tmp_path, credentials, embedding, monkeypatch
):
    from deskaura_local import runtime
    monkeypatch.setattr(runtime, "model_available", lambda kind: kind == "embedding")
    monkeypatch.setattr(runtime, "embed_texts", lambda texts: [
        [1.0, float("爵士" in text), float("雨天" in text), .2] for text in texts])
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    registry.save_config("alice", MemoryConfig(api_key="test-secret"))
    asyncio.run(registry.add_conversation("alice", ConversationIn(
        session_id="one", user_message="我喜欢爵士音乐", ai_message="记住了")))
    assert (registry._directory("alice") / "memu.db").exists()
    old_calls = len(embedding)
    for role in ("alice", "bob"):
        registry.save_config(role, MemoryConfig(deployment="local", local_provider="built_in"))
        assert asyncio.run(registry.test(role))["ok"]
    assert len(embedding) == old_calls  # The bundled path never invokes HTTP.
    assert (registry._directory("alice") / "memu-builtin.db").exists()
    assert asyncio.run(registry.search("alice", "爵士", 8))["memories"]
    assert not asyncio.run(registry.search("bob", "爵士", 8))["memories"]
    registry.delete_session("alice", "one")
    assert not asyncio.run(registry.search("alice", "爵士", 8))["memories"]
    registry.save_config("alice", MemoryConfig(api_key="test-secret"))
    assert not asyncio.run(registry.search("alice", "爵士", 8))["memories"]


def test_real_builtin_memu_native_write_and_retrieve(tmp_path, credentials, monkeypatch):
    from deskaura_local import runtime
    if not runtime.model_available("embedding"):
        pytest.skip("Full installation embedding assets are not present")

    async def network_forbidden(*args, **kwargs):
        pytest.fail("Built-in MemU must not access the network")

    monkeypatch.setattr("memu.embedding.http_client.HTTPEmbeddingClient.embed", network_forbidden)
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    registry.save_config("alice", MemoryConfig(deployment="local", local_provider="built_in"))
    assert asyncio.run(registry.test("alice"))["ok"]
    asyncio.run(registry.add_conversation("alice", ConversationIn(
        session_id="native", user_message="我喜欢爵士音乐", ai_message="记住了")))
    result = asyncio.run(registry.search("alice", "喜欢听什么音乐", 8))
    assert result["provider"]["verified"]
    assert any("爵士" in item.content for item in result["memories"])


@pytest.mark.parametrize("url", [
    "https://example.com/v1?key=secret", "https://example.com/v1#secret",
    "https://host:wrong/v1", "https://[bad", "http://127.0.0.1:0/v1",
])
def test_memory_config_rejects_invalid_url_without_saving_key(tmp_path, credentials, url):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    with pytest.raises(ValueError):
        registry.save_config("role", MemoryConfig(base_url=url, api_key="private"))
    assert not credentials


def test_memory_external_local_requires_private_url_but_builtin_ignores_stale_url(tmp_path, credentials):
    registry = MemURegistry(MemoryStore(str(tmp_path / "archive.db")))
    with pytest.raises(ValueError):
        registry.save_config("role", MemoryConfig(deployment="local"))
    assert registry.save_config("role", MemoryConfig(
        deployment="local", local_provider="built_in", base_url=""))["local_provider"] == "built_in"

