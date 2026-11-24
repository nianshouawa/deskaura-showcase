"""System application actions obey the same two independent permission axes."""
import asyncio
from types import SimpleNamespace

import pytest

from app.graph import CompanionGraph


def graph_with(config, action):
    graph = CompanionGraph.__new__(CompanionGraph)
    graph.config_store = SimpleNamespace(get=lambda: config)
    graph.sessions = SimpleNamespace(history=lambda _: [])

    async def respond(*_args, **kwargs):
        value = {"text": "已经执行成功", "emotion": "neutral", "system_action": action}
        if kwargs.get("on_plan"):
            await kwargs["on_plan"](value)
        if kwargs.get("on_delta"):
            await kwargs["on_delta"](value["text"])
        return value, False

    graph.llm = SimpleNamespace(respond=respond)
    return graph


def reply(config, action, message="打开记事本"):
    graph = graph_with(config, action)
    return asyncio.run(graph._reply({"message": message, "context": "", "relationship": {},
                                    "session_id": "test-session"}))["response"]


@pytest.mark.parametrize("policy", ["request_approval", "help_me_approve"])
def test_approval_required_actions_never_claim_execution(policy):
    action = {"type": "open_app", "app": "notepad"}
    result = reply({"tools_enabled": True, "local_sandbox_mode": "full_access",
                    "local_operation_mode": policy}, action)
    assert result["system_action"] == action
    assert result["text"] == "待确认：打开应用 notepad。尚未执行。"


def test_fully_approved_action_is_prepared_not_falsely_reported_as_success():
    action = {"type": "lock_screen"}
    result = reply({"tools_enabled": True, "local_sandbox_mode": "full_access",
                    "local_operation_mode": "full_approval"}, action, "请帮我锁定屏幕")
    assert result["system_action"] == action
    assert result["text"] == "已准备执行：锁定屏幕。"
    assert "成功" not in result["text"]


@pytest.mark.parametrize("patch", [
    {"tools_enabled": False},
    {"local_sandbox_mode": "read_only"},
    {"local_sandbox_mode": "workspace_write"},
    {"local_sandbox_enabled": True},
])
def test_disabled_or_constrained_access_blocks_even_full_approval(patch):
    config = {"tools_enabled": True, "local_sandbox_mode": "full_access",
              "local_operation_mode": "full_approval", **patch}
    result = reply(config, {"type": "open_app", "app": "notepad"})
    assert "system_action" not in result
    assert "不允许" in result["text"] or "阻止" in result["text"]


@pytest.mark.parametrize("message,action", [
    ("你好", {"type": "lock_screen"}),
    ("读取说明文件", {"type": "open_app", "app": "notepad"}),
    ("如何打开记事本", {"type": "open_app", "app": "notepad"}),
    ("不要打开记事本", {"type": "open_app", "app": "notepad"}),
    ("打开计算器", {"type": "open_app", "app": "notepad"}),
    ("别锁定屏幕", {"type": "lock_screen"}),
    ("请提高音量", {"type": "volume", "command": "down"}),
    ("打开记事本", {"type": "open_url", "url": "https://example.com"}),
    ("打开这个网址", {"type": "open_url", "url": "http://[invalid"}),
])
def test_model_action_cannot_supply_missing_current_user_intent(message, action):
    result = reply({"tools_enabled": True, "local_sandbox_mode": "full_access",
                    "local_operation_mode": "full_approval"}, action, message)
    assert "system_action" not in result
    assert "本轮没有明确请求" in result["text"]


@pytest.mark.parametrize("message,action", [
    ("请打开计算器", {"type": "open_app", "app": "calc"}),
    ("打开任务管理器", {"type": "open_app", "app": "taskmgr"}),
    ("open notepad", {"type": "open_app", "app": "notepad"}),
    ("请打开资源管理器", {"type": "open_folder"}),
    ("打开这个网站 https://example.com", {"type": "open_url", "url": "https://example.com"}),
    ("visit example.com", {"type": "open_url", "url": "https://example.com"}),
    ("请把声音调大一点", {"type": "volume", "command": "up"}),
    ("decrease volume", {"type": "volume", "command": "down"}),
    ("静音", {"type": "volume", "command": "mute"}),
    ("锁屏", {"type": "lock_screen"}),
])
def test_supported_system_requests_are_recognized(message, action):
    result = reply({"tools_enabled": True, "local_sandbox_mode": "full_access",
                    "local_operation_mode": "request_approval"}, action, message)
    assert result["system_action"] == action
    assert result["text"].startswith("待确认：")


def test_stream_does_not_emit_unchecked_execution_claims():
    graph = graph_with({"tools_enabled": True, "local_sandbox_mode": "full_access",
                        "local_operation_mode": "request_approval"},
                       {"type": "open_app", "app": "notepad"})
    deltas = []

    async def delta(value):
        deltas.append(value)

    result = asyncio.run(graph._reply(
        {"message": "打开记事本", "context": "", "relationship": {}, "session_id": "test-session"},
        on_delta=delta))
    assert deltas == [result["response"]["text"]]
    assert "待确认" in deltas[0] and "成功" not in deltas[0]


def test_volume_request_is_held_even_when_provider_returns_legacy_text_first():
    assert CompanionGraph._tool_turn_requested("请把音量提高一点")
