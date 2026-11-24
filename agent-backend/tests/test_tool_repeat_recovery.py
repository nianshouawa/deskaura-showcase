import asyncio
import copy
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.config import ConfigStore, ModelSettings
from app.file_tools import FileTools
from app.graph import CompanionGraph
from app.session_store import SessionStore


def make_graph(tmp_path, replies, *, approval="full_approval"):
    store = ConfigStore(str(tmp_path / "config.json"))
    store.save(ModelSettings(file_access_root=str(tmp_path), local_sandbox_mode="workspace_write",
                             local_operation_mode=approval, memory_enabled=False, persona_enabled=False))
    graph = CompanionGraph.__new__(CompanionGraph)
    graph.config_store, graph.files = store, FileTools(store)
    graph.sessions = SessionStore(str(tmp_path / "sessions.db"))
    contexts, actions = [], []
    iterator = iter(replies)

    async def respond(*args, **kwargs):
        contexts.append(args[1])
        return copy.deepcopy(next(iterator)), False

    original = graph.files.run

    def run(action, session):
        actions.append(copy.deepcopy(action))
        return original(action, session)

    async def context(_state):
        return {"context": "", "relationship": {}}

    graph.files.run = run
    graph.llm = SimpleNamespace(respond=respond)
    graph._context = context
    return graph, contexts, actions


def state(message="创建 one.txt 和 two.txt"):
    return {"message": message, "context": "", "relationship": {}, "session_id": "s"}


def create(name, content):
    return {"text": "准备写入", "file_action": {"operation": "create", "path": name, "content": content}}


def test_duplicate_write_reuses_receipt_and_continues_remaining_step(tmp_path):
    first, second = create("one.txt", "one"), create("two.txt", "two")
    graph, contexts, actions = make_graph(tmp_path, [first, first, second, {"text": "两份都已保存"}])
    result = asyncio.run(graph._reply(state()))["response"]
    assert result["text"] == "两份都已保存"
    assert [action["path"] for action in actions] == ["one.txt", "two.txt"]
    assert (tmp_path / "one.txt").read_text() == "one"
    assert (tmp_path / "two.txt").read_text() == "two"
    assert "重复步骤恢复" in contexts[2]
    assert json.dumps(str(tmp_path / "one.txt"))[1:-1] in contexts[2]


def test_safe_read_can_repeat_after_a_file_changed(tmp_path):
    (tmp_path / "one.txt").write_text("before")
    read = {"text": "核对", "file_action": {"operation": "read", "path": "one.txt"}}
    update = {"text": "更新", "file_action": {"operation": "update", "path": "one.txt", "content": "after"}}
    graph, contexts, actions = make_graph(tmp_path, [read, update, read, {"text": "已核对更新结果"}])
    result = asyncio.run(graph._reply(state("读取并修改 one.txt，再读取确认")))["response"]
    assert result["text"] == "已核对更新结果"
    assert [action["operation"] for action in actions] == ["read", "update", "read"]
    assert '"content": "before"' in contexts[1]
    assert '"content": "after"' in contexts[-1]


def test_approved_write_is_not_reexecuted_when_continuation_repeats_it(tmp_path):
    first, second = create("one.txt", "one"), create("two.txt", "two")
    graph, contexts, actions = make_graph(
        tmp_path, [first, first, second, {"text": "两步完成"}], approval="request_approval")
    reply = asyncio.run(graph._reply(state()))["response"]
    executed = graph.files.decide(reply["file_approval"]["id"], "s", True)
    resumed = asyncio.run(graph.summarize_tool_result("s", executed))
    assert "two.txt" in resumed["file_approval"]["path"]
    assert [action["path"] for action in actions] == ["one.txt", "two.txt"]
    executed = graph.files.decide(resumed["file_approval"]["id"], "s", True)
    final = asyncio.run(graph.summarize_tool_result("s", executed))
    assert final["text"] == "两步完成" and not final["file_approval"]
    assert "receipt" in contexts[2] and json.dumps(str(tmp_path / "one.txt"))[1:-1] in contexts[2]


def test_repeated_mutation_never_emits_internal_guard_or_runs_again(tmp_path):
    first = create("one.txt", "once")
    graph, _, actions = make_graph(tmp_path, [first] * 5)
    reply = asyncio.run(graph._reply(state("创建 one.txt")))["response"]
    assert len(actions) == 1
    assert "同一项操作已处理" not in reply["text"]
    assert "重复步骤恢复" not in reply["text"]
    assert str(tmp_path / "one.txt") in reply["text"]
    assert "后续步骤未能继续" in reply["text"]
    assert not any(reply.get(key) for key in ("file_action", "system_action", "media_request"))


def test_repeat_recovery_does_not_bypass_read_only_access(tmp_path):
    first = create("one.txt", "blocked")
    graph, _, actions = make_graph(tmp_path, [first])
    graph.config_store.save(ModelSettings(local_sandbox_mode="read_only"))
    reply = asyncio.run(graph._reply(state("创建 one.txt")))["response"]
    assert len(actions) == 1 and "只读" in reply["text"]
    assert not (tmp_path / "one.txt").exists()


@pytest.mark.parametrize("failure", [RuntimeError("provider disconnected"), HTTPException(502, "provider disconnected")])
def test_a_followup_failure_does_not_hide_an_already_completed_write(tmp_path, failure):
    graph, _, actions = make_graph(tmp_path, [])
    first = create("one.txt", "once")
    calls = 0

    async def respond(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return copy.deepcopy(first), False
        raise failure

    graph.llm = SimpleNamespace(respond=respond)
    reply = asyncio.run(graph._reply(state("创建 one.txt")))["response"]
    assert len(actions) == 1 and (tmp_path / "one.txt").read_text() == "once"
    assert str(tmp_path / "one.txt") in reply["text"]
    assert reply["emotion"] == "neutral" and reply["motion_needed"] is False
    assert "实际完成" in reply["text"]
