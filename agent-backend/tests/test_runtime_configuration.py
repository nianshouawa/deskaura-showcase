"""Regression coverage for role settings applied to active conversation tools."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.config import ConfigStore, ModelSettings, role_scope
from app.file_tools import FileTools
from app.graph import CompanionGraph
from app import recognition


def scoped_graph(store, monkeypatch):
    graph = CompanionGraph.__new__(CompanionGraph)
    graph.config_store = store
    graph.files = FileTools(store)
    graph.sessions = SimpleNamespace(history=lambda _: [])
    graph.memory = SimpleNamespace()
    return graph


def test_context_tells_model_the_saved_role_workspace_and_permissions(tmp_path, monkeypatch):
    store = ConfigStore(str(tmp_path / "config.json"))
    with role_scope("role-a"):
        store.save(ModelSettings(
            memory_enabled=False, persona_enabled=False, tools_enabled=True,
            file_access_root=str(tmp_path), local_sandbox_mode="full_access",
            local_operation_mode="full_approval",
        ))
        graph = scoped_graph(store, monkeypatch)
        monkeypatch.setattr("app.tools_module.tools_catalog", lambda _: [])
        result = asyncio.run(graph._context({"message": "编写代码", "role_id": "role-a"}))
        context = result["context"]
        assert json.dumps(str(tmp_path)) in context
        assert '"access": "full_access"' in context
        assert '"approval": "full_approval"' in context
        assert "不要求先配置 MCP" in context
    with role_scope("role-b"):
        store.save(ModelSettings(memory_enabled=False, persona_enabled=False))
        result = asyncio.run(graph._context({"message": "你好", "role_id": "role-b"}))
        assert json.dumps(str(tmp_path)) not in result["context"]


def test_code_creation_and_execution_use_actual_saved_policy(tmp_path, monkeypatch):
    store = ConfigStore(str(tmp_path / "config.json"))
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    store.save(ModelSettings(file_access_root=str(workspace),
                             local_sandbox_mode="full_access", local_operation_mode="full_approval"))
    graph = scoped_graph(store, monkeypatch)
    replies = iter([
        {"text": "准备写入", "file_action": {"operation": "create", "path": "example.py",
                                           "content": "print('verified-local-code')"}},
        {"text": "准备运行", "file_action": {"operation": "execute", "path": ".",
                                           "shell": "powershell", "command": "Write-Output 'verified-execution'"}},
        {"text": "已根据真实结果完成。"},
    ])
    contexts = []

    async def respond(*args, **kwargs):
        contexts.append(args[1])
        return next(replies), False

    graph.llm = SimpleNamespace(respond=respond)
    result = asyncio.run(graph._reply({
        "message": "帮我编写代码，保存到 example.py，然后执行一个输出命令",
        "context": "", "relationship": {}, "session_id": "s",
    }))
    assert (workspace / "example.py").read_text() == "print('verified-local-code')"
    assert "verified-execution" in contexts[-1]
    assert '"exit_code": 0' in contexts[-1]
    assert result["response"]["text"] == "已根据真实结果完成。"
    assert not result["response"].get("file_approval")


@pytest.mark.parametrize("text", ["帮我编写代码并保存到 main.py", "写一个脚本保存下来", "write a script in main.py"])
def test_writing_code_is_authorized_as_file_creation_without_authorizing_execution(text):
    assert CompanionGraph._write_requested(text)
    assert CompanionGraph._tool_turn_requested(text)
    assert not CompanionGraph._execution_requested(text)


@pytest.mark.parametrize("text", ["只编写代码，不要运行", "请不要执行命令", "write script but do not run it"])
def test_explicit_non_execution_is_preserved(text):
    assert not CompanionGraph._execution_requested(text)


def test_repeated_action_is_not_executed_twice(tmp_path, monkeypatch):
    store = ConfigStore(str(tmp_path / "config.json"))
    store.save(ModelSettings(file_access_root=str(tmp_path), local_operation_mode="full_approval", local_sandbox_mode="workspace_write"))
    graph = scoped_graph(store, monkeypatch)
    calls = []
    original = graph.files.run

    def run(action, session):
        calls.append(action)
        return original(action, session)

    graph.files.run = run

    async def respond(*args, **kwargs):
        return {"text": "准备写入", "file_action": {"operation": "create", "path": "one.txt", "content": "once"}}, False

    graph.llm = SimpleNamespace(respond=respond)
    result = asyncio.run(graph._reply({"message": "创建 one.txt", "context": "", "relationship": {}, "session_id": "s"}))
    assert len(calls) == 1
    assert (tmp_path / "one.txt").read_text() == "once"
    assert "同一项操作已处理" not in result["response"]["text"]
    assert str(tmp_path / "one.txt") in result["response"]["text"]
    assert "实际完成" in result["response"]["text"]


@pytest.mark.parametrize("config,expected", [
    ({"asr_provider": "compatible", "asr_model": "qwen3-asr-flash", "asr_base_url": "http://127.0.0.1:6007/v1"}, "dashscope"),
    ({"asr_provider": "compatible", "asr_model": "qwen3-asr-flash", "asr_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"}, "dashscope"),
    ({"asr_provider": "compatible", "asr_model": "FunAudioLLM/SenseVoiceSmall", "asr_base_url": "https://api.siliconflow.cn/v1"}, "compatible"),
    ({"asr_provider": "compatible", "asr_model": "whisper-1", "asr_base_url": "http://localhost:8003/v1"}, "compatible"),
    ({"asr_provider": "dashscope", "asr_model": "FunAudioLLM/SenseVoiceSmall", "asr_base_url": "https://api.siliconflow.cn/v1"}, "compatible"),
])
def test_recognition_protocol_does_not_need_a_visible_platform_picker(config, expected):
    assert recognition.recognition_provider(config) == expected
