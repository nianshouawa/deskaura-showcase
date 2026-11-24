import asyncio
import json

from fastapi import HTTPException
import httpx
import pytest

from app.config import ConfigStore, ModelSettings, role_scope
from app.file_tools import FileTools
from app.mcp_client import MCPClient, authentication_headers
from app import tools_module


@pytest.fixture
def local(tmp_path, monkeypatch):
    credentials = {}
    monkeypatch.setattr("app.config.keyring.get_password", lambda _, name: credentials.get(name, ""))
    monkeypatch.setattr("app.config.keyring.set_password", lambda _, name, value: credentials.update({name: value}))
    root = tmp_path / "workspace"
    root.mkdir()
    store = ConfigStore(str(tmp_path / "config.json"))
    store.save(ModelSettings(file_access_root=str(root), tools_connection_mode="local", local_sandbox_mode="workspace_write"))
    return store, root, FileTools(store)


def test_read_only_blocks_mutations_despite_full_approval(local):
    store, root, files = local
    (root / "readme.txt").write_text("original")
    store.save(ModelSettings(local_sandbox_mode="read_only", local_operation_mode="full_approval"))
    assert files.run({"operation": "read", "path": "readme.txt"}, "s")["content"] == "original"
    assert files.run({"operation": "list"}, "s")["items"]
    for action in [
        {"operation": "update", "path": "readme.txt", "content": "changed"},
        {"operation": "delete", "path": "readme.txt"},
        {"operation": "create", "path": "new.txt", "content": "changed"},
        {"operation": "mkdir", "path": "new"},
        {"operation": "execute", "command": "echo hi"},
        {"operation": "code", "content": "print('hi')"},
        {"operation": "mcp", "tool": "read", "arguments": {}},
    ]:
        with pytest.raises(HTTPException) as error:
            files.run(action, "s")
        assert error.value.status_code == 403
    assert (root / "readme.txt").read_text() == "original"
    assert not (root / "new.txt").exists()


def test_mcp_authentication_supports_common_credential_formats():
    assert authentication_headers("plain-token") == {"Authorization": "Bearer plain-token"}
    assert authentication_headers("Bearer token-value") == {"Authorization": "Bearer token-value"}
    assert authentication_headers("Basic dXNlcjpwYXNz") == {"Authorization": "Basic dXNlcjpwYXNz"}
    assert authentication_headers("X-API-Key: custom-value") == {"X-API-Key": "custom-value"}
    assert authentication_headers('{"X-API-Key":"one","X-Tenant":"two"}') == {
        "X-API-Key": "one", "X-Tenant": "two",
    }
    with pytest.raises(HTTPException):
        authentication_headers("Host: invalid.example")


def test_workspace_cannot_escape_but_full_access_can(local):
    store, root, files = local
    store.save(ModelSettings(local_operation_mode="full_approval"))
    outside = root.parent / "outside.txt"
    with pytest.raises(HTTPException):
        files.run({"operation": "create", "path": str(outside), "content": "blocked"}, "s")
    files.run({"operation": "create", "path": "inside.txt", "content": "inside"}, "s")
    with pytest.raises(HTTPException):
        files.run({"operation": "copy", "path": "inside.txt", "destination": str(outside)}, "s")
    store.save(ModelSettings(local_sandbox_mode="full_access"))
    files.run({"operation": "copy", "path": "inside.txt", "destination": str(outside)}, "s")
    assert outside.read_text() == "inside"
    files.run({"operation": "update", "path": str(outside), "content": "outside"}, "s")
    assert files.run({"operation": "read", "path": str(outside)}, "s")["content"] == "outside"
    files.run({"operation": "delete", "path": str(outside)}, "s")
    assert not outside.exists()


def test_sandbox_changes_revoke_pending_write_and_modules_can_be_disabled(local):
    store, root, files = local
    approval = files.run({"operation": "create", "path": "draft.txt", "content": "pending"}, "s")["approval"]
    store.save(ModelSettings(local_sandbox_mode="read_only"))
    with pytest.raises(HTTPException):
        files.decide(approval["id"], "s", True)
    assert not (root / "draft.txt").exists()
    store.save(ModelSettings(tools_enabled=False))
    with pytest.raises(HTTPException):
        files.run({"operation": "list"}, "s")


@pytest.mark.parametrize("operation", ["execute", "code", "mcp"])
def test_workspace_policy_never_claims_to_sandbox_external_execution(local, operation):
    store, _, files = local
    store.save(ModelSettings(local_sandbox_mode="workspace_write", local_operation_mode="full_approval"))
    with pytest.raises(HTTPException) as error:
        files.run({"operation": operation, "command": "echo hi", "content": "print('hi')",
                   "tool": "anything", "arguments": {}}, "s")
    assert "操作系统沙箱" in error.value.detail


def _mcp_transport(seen, *, sse=False, error=False, empty=False):
    def handler(request):
        if request.method == "DELETE":
            return httpx.Response(204)
        body = json.loads(request.content)
        seen.append((body, dict(request.headers)))
        method = body["method"]
        if method == "initialize":
            result = {"protocolVersion": "2025-11-25", "capabilities": {"tools": {}}}
        elif method == "notifications/initialized":
            return httpx.Response(202)
        elif method == "tools/list":
            result = {"tools": [] if empty else [{"name": "echo", "description": "Echo one value",
                                                   "inputSchema": {"type": "object"}}]}
        elif method == "tools/call":
            result = {"content": [{"type": "text", "text": str(body["params"]["arguments"].get("value"))}]}
        else:
            raise AssertionError(method)
        response = {"jsonrpc": "2.0", "id": body["id"], "result": result}
        if error:
            response = {"jsonrpc": "2.0", "id": body["id"], "error": {"code": -32000, "message": "sensitive-server-body"}}
        headers = {"Mcp-Session-Id": "checked-session"}
        if sse:
            return httpx.Response(200, headers={**headers, "Content-Type": "text/event-stream"},
                                  content=(": keepalive\n\ndata:\n\nevent: message\ndata: " + json.dumps(response) + "\n\n").encode())
        return httpx.Response(200, headers={**headers, "Content-Type": "application/json"}, json=response)
    return httpx.MockTransport(handler)


@pytest.mark.parametrize("sse", [False, True])
def test_mcp_lifecycle_session_version_and_tool_call(sse):
    seen = []
    with MCPClient("http://127.0.0.1:3333/mcp", "private-test", transport=_mcp_transport(seen, sse=sse)) as client:
        client.initialize()
        assert client.list_tools()[0]["name"] == "echo"
        assert client.call("echo", {"value": "hello"})["content"][0]["text"] == "hello"
    assert [item[0]["method"] for item in seen] == [
        "initialize", "notifications/initialized", "tools/list", "tools/list", "tools/call"
    ]
    assert seen[0][1]["authorization"] == "Bearer private-test"
    assert seen[1][1]["mcp-session-id"] == "checked-session"
    assert seen[1][1]["mcp-protocol-version"] == "2025-11-25"


def test_mcp_errors_do_not_echo_server_body_or_credentials():
    seen = []
    with MCPClient("http://127.0.0.1:3333/mcp", "private-test", transport=_mcp_transport(seen, error=True)) as client:
        with pytest.raises(HTTPException) as error:
            client.initialize()
        assert "private-test" not in error.value.detail
        assert "sensitive-server-body" not in error.value.detail


def test_mcp_probe_does_not_call_tools_and_proof_is_role_scoped(local, monkeypatch):
    store, _, _ = local
    seen = []
    original = MCPClient
    monkeypatch.setattr(tools_module, "MCPClient", lambda address, key: original(
        address, key, transport=_mcp_transport(seen)))
    store.save(ModelSettings(tools_mcp_url="http://127.0.0.1:3333/mcp"))
    assert not tools_module.tools_status(store)["verified"]
    result = asyncio.run(tools_module.test_tools(store))
    assert result["verified"] and result["tool_count"] == 1
    assert "tools/call" not in [item[0]["method"] for item in seen]
    assert tools_module.tools_catalog(store)[0]["name"] == "echo"
    with role_scope("another"):
        assert not tools_module.tools_status(store)["verified"]
    store.save(ModelSettings(tools_mcp_api_key="replacement"))
    assert not tools_module.tools_status(store)["verified"]
    assert not tools_module.tools_catalog(store)


def test_local_probe_exercises_file_access_and_retains_no_files(local):
    store, root, _ = local
    before = set(root.iterdir())
    assert asyncio.run(tools_module.test_tools(store))["verified"]
    assert set(root.iterdir()) == before
    store.save(ModelSettings(local_sandbox_mode="read_only"))
    assert not tools_module.tools_status(store)["verified"]
    assert asyncio.run(tools_module.test_tools(store))["verified"]
    assert set(root.iterdir()) == before
    store.save(ModelSettings(file_access_root=""))
    assert not tools_module.tools_status(store)["verified"]
    with pytest.raises(HTTPException):
        asyncio.run(tools_module.test_tools(store))


def test_mcp_approval_prevents_early_call_and_checks_changed_configuration(local, monkeypatch):
    import app.mcp_client as mcp
    store, _, files = local
    store.save(ModelSettings(local_sandbox_mode="full_access", tools_mcp_url="http://127.0.0.1:3333/mcp"))
    calls = []
    original = MCPClient
    monkeypatch.setattr(mcp, "MCPClient", lambda address, key: original(
        address, key, transport=_mcp_transport(calls)))
    request = {"operation": "mcp", "tool": "echo", "arguments": {"value": "hello"}}
    card = files.run(request, "s")["approval"]
    assert not calls and card["runtime"] == "MCP"
    store.save(ModelSettings(tools_mcp_url="http://127.0.0.1:3334/mcp"))
    with pytest.raises(HTTPException):
        files.decide(card["id"], "s", True)
    assert not calls
    card = files.run(request, "s")["approval"]
    assert files.decide(card["id"], "s", True)["result"]["content"][0]["text"] == "hello"
    assert any(item[0]["method"] == "tools/call" for item in calls)
