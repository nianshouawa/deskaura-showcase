import asyncio
from types import SimpleNamespace

import pytest

from app.config import ConfigStore, ModelSettings, role_scope
from app.file_tools import FileTools
from app.graph import CompanionGraph
from app.roles import RoleStore
from app.session_store import SessionStore
from app.connectivity import ConnectivityProofs


def test_lowest_default_and_explicit_choice_survive_restart(tmp_path):
    store = ConfigStore(str(tmp_path / "config.json"))
    assert store.get()["local_sandbox_mode"] == "read_only"
    store.save(ModelSettings(local_sandbox_enabled=True))
    store.save(ModelSettings(local_sandbox_mode="full_access"))
    restored = ConfigStore(str(store.base_path))
    assert restored.get()["local_sandbox_mode"] == "full_access"
    assert restored.get()["local_sandbox_enabled"] is False
    store.save(ModelSettings(local_operation_mode="full_approval"))
    RoleStore(store).upsert("new", {"name": "New"})
    with role_scope("new"):
        assert store.get()["local_sandbox_mode"] == "read_only"
        assert store.get()["local_operation_mode"] == "request_approval"


def test_recognition_proof_not_invalidated_by_unrelated_key_changes(tmp_path, monkeypatch):
    secrets = {}
    monkeypatch.setattr("app.config.keyring.get_password", lambda service, name: secrets.get(name))
    monkeypatch.setattr("app.config.keyring.set_password", lambda service, name, value: secrets.update({name: value}))
    store = ConfigStore(str(tmp_path / "config.json"))
    proofs = ConnectivityProofs()
    before = proofs.signature("recognition", store)
    store.save(ModelSettings(audio_api_key="unrelated-voice-key", model="changed-brain"))
    assert proofs.signature("recognition", store) == before


def test_approved_step_continues_original_task_and_requests_next_approval(tmp_path, monkeypatch):
    store = ConfigStore(str(tmp_path / "config.json"))
    store.save(ModelSettings(file_access_root=str(tmp_path), local_sandbox_mode="workspace_write",
                             memory_enabled=False, persona_enabled=False))
    graph = CompanionGraph.__new__(CompanionGraph)
    graph.config_store, graph.files = store, FileTools(store)
    graph.sessions = SessionStore(str(tmp_path / "sessions.db"))
    responses = iter([
        {"text": "先创建第一份", "file_action": {"operation": "create", "path": "one.txt", "content": "one"}},
        {"text": "继续第二份", "file_action": {"operation": "create", "path": "two.txt", "content": "two"}},
        {"text": "两份文件都已创建"},
    ])
    calls = []
    async def respond(*args, **kwargs):
        calls.append(args[0])
        return next(responses), False
    graph.llm = SimpleNamespace(respond=respond)
    async def context(state):
        return {"context": "", "relationship": {}}
    graph._context = context
    message = "创建 one.txt 和 two.txt"
    first = asyncio.run(graph._reply({"message": message, "context": "", "relationship": {}, "session_id": "s"}))["response"]
    assert graph.files.pending("s")["id"] == first["file_approval"]["id"]
    result = graph.files.decide(first["file_approval"]["id"], "s", True)
    second = asyncio.run(graph.summarize_tool_result("s", result))
    assert (tmp_path / "one.txt").exists() and not (tmp_path / "two.txt").exists()
    assert second["file_approval"] and "two.txt" in second["file_approval"]["path"]
    result = graph.files.decide(second["file_approval"]["id"], "s", True)
    final = asyncio.run(graph.summarize_tool_result("s", result))
    assert (tmp_path / "two.txt").exists()
    assert final["text"] == "两份文件都已创建" and not final["file_approval"]
    assert calls == [message, message, message]
