import asyncio
import copy
import json
from pathlib import Path
import socket
import sys
import threading
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.config import ConfigStore, ModelSettings, role_scope
from app.file_tools import FileTools
from app.mcp_configuration import MASK, configuration_fingerprint, service_transport, stored_configuration, tool_identifier
from app.mcp_services import catalog, refresh_services, services_status, set_tool_enabled
from app import mcp_services
from app.roles import RoleStore


@pytest.fixture
def profile(tmp_path):
    store = ConfigStore(str(tmp_path / "config.json"))
    root = tmp_path / "workspace"
    root.mkdir()
    store.save(ModelSettings(file_access_root=str(root), local_sandbox_mode="full_access"))
    return store, root


def _two_servers():
    return {"mcpServers": {
        "天气": {"url": "https://weather.example/mcp", "headers": {"Authorization": "Bearer private-token"}},
        "日历": {"command": "node", "args": ["calendar.js"], "env": {"TOKEN": "private-calendar"}},
    }}


def test_common_remote_configuration_infers_sse_from_endpoint():
    assert service_transport({"url": "https://example.test/abc/sse/"}) == "sse"
    assert service_transport({"url": "https://example.test/sse", "type": "streamable-http"}) == "http"
    assert service_transport({"url": "https://example.test/mcp"}) == "http"


def _fake_exchange(server, tool=None, arguments=None):
    if tool:
        return {"content": [{"type": "text", "text": json.dumps(arguments)}]}
    return {"server_info": {"name": "example-server", "version": "1.2"},
            "tools": [{"name": "lookup", "description": "Look up a value", "inputSchema": {"type": "object"}}]}


def test_mcp_config_redacts_credentials_and_preserves_masked_resaves(profile):
    store, _ = profile
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    public = store.get()["tools_mcp_config"]
    assert public["mcpServers"]["天气"]["headers"]["Authorization"] == MASK
    assert "private" not in store.path.read_text()
    assert "private" not in json.dumps(store.get())
    store.save(ModelSettings(tools_mcp_config=public))
    private = stored_configuration(store, private=True)
    assert private == _two_servers()
    store.save(ModelSettings(model="changed"))
    assert stored_configuration(store, private=True) == _two_servers()


def test_mcp_large_credentials_fit_windows_vault_chunks(profile, monkeypatch):
    store, _ = profile
    original = store._save_secret
    lengths = []

    def capture(name, value):
        lengths.append(len(value.encode("utf-16-le")))
        original(name, value)
    monkeypatch.setattr(store, "_save_secret", capture)
    config = {"mcpServers": {"large": {"command": "node", "env": {"TOKEN": "abc你好" * 1200}}}}
    store.save(ModelSettings(tools_mcp_config=config))
    assert max(lengths) <= 2400
    assert stored_configuration(store, private=True) == config


def test_mcp_roles_keep_configs_credentials_and_preferences_isolated(profile):
    store, _ = profile
    roles = RoleStore(store)
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    roles.upsert("alpha", {"name": "alpha"})
    with role_scope("alpha"):
        assert stored_configuration(store, private=True) == _two_servers()
        changed = copy.deepcopy(_two_servers())
        changed["mcpServers"]["天气"]["headers"]["Authorization"] = "alpha-only"
        store.save(ModelSettings(tools_mcp_config=changed))
    assert stored_configuration(store, private=True) == _two_servers()
    roles.delete("alpha")
    with role_scope("alpha"):
        assert stored_configuration(store, private=True) == {"mcpServers": {}}


def test_legacy_mcp_configuration_is_migrated_without_losing_credentials(profile):
    store, _ = profile
    store.save(ModelSettings(tools_mcp_url="https://legacy.example/mcp", tools_mcp_api_key="legacy-private"))
    config = store.get()["tools_mcp_config"]
    assert config["mcpServers"]["MCP"]["headers"]["Authorization"] == MASK
    store.save(ModelSettings(tools_mcp_config=config))
    assert stored_configuration(store, private=True)["mcpServers"]["MCP"]["headers"] == {
        "Authorization": "Bearer legacy-private",
    }


@pytest.mark.parametrize("value", [
    {}, {"mcpServers": []}, {"mcpServers": {"bad": {}}},
    {"mcpServers": {"bad": {"url": "https://example", "command": "node"}}},
    {"mcpServers": {"bad": {"url": "file:///private"}}},
    {"mcpServers": {"bad": {"url": "https://example", "headers": {"Host": "x"}}}},
    {"mcpServers": {"bad": {"command": "node", "args": "wrong"}}},
])
def test_mcp_invalid_json_is_rejected_without_replacing_saved_config(profile, value):
    store, _ = profile
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    with pytest.raises(HTTPException):
        store.save(ModelSettings(tools_mcp_config=value))
    assert stored_configuration(store, private=True) == _two_servers()


def test_multiserver_discovery_toggle_catalog_and_connected_label(profile, monkeypatch):
    store, _ = profile
    monkeypatch.setattr(mcp_services, "exchange", _fake_exchange)
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    state = asyncio.run(refresh_services(store))
    assert (state["connected"], state["total"], state["label"]) == (2, 2, "MCP(2/2)")
    assert all(service["tools"][0]["enabled"] for service in state["services"])
    entries = catalog(store)
    assert len({tool["name"] for tool in entries}) == 2
    assert entries[0]["name"] != "lookup"
    from app.tools_module import tools_catalog
    assert tools_catalog(store) == entries
    state = set_tool_enabled(store, "天气", "lookup", False)
    assert state["connected"] == 2
    assert not state["services"][0]["tools"][0]["enabled"]
    assert len(catalog(store)) == 1
    assert store.get()["tools_mcp_config"]["mcpServers"]["天气"]["disabledTools"] == ["lookup"]
    with role_scope("other"):
        assert not services_status(store)["services"]
    one = {"mcpServers": {"我的服务": {"url": "https://example/mcp"}}}
    store.save(ModelSettings(tools_mcp_config=one))
    assert asyncio.run(refresh_services(store))["label"] == "我的服务"


def test_mcp_discovery_does_not_require_a_local_workspace(profile, monkeypatch):
    from app.tools_module import test_tools as run_module_test
    store, _ = profile
    monkeypatch.setattr(mcp_services, "exchange", _fake_exchange)
    store.save(ModelSettings(file_access_root="", tools_mcp_config=_two_servers()))
    state = asyncio.run(run_module_test(store))
    assert state["verified"] and state["mcp_connected_count"] == 2
    assert state["mcp_label"] == "MCP(2/2)"


def test_partial_connection_failure_has_exact_connected_count(profile, monkeypatch):
    store, _ = profile
    def exchange(server):
        if server.get("command"):
            raise HTTPException(503, "程序未安装")
        return _fake_exchange(server)
    monkeypatch.setattr(mcp_services, "exchange", exchange)
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    state = asyncio.run(refresh_services(store))
    assert state["label"] == "MCP(1/2)"
    assert state["services"][1]["detail"] == "程序未安装"
    assert len(catalog(store)) == 1


def test_lazy_discovery_renews_only_when_stale(profile, monkeypatch):
    store, _ = profile
    calls = []
    monkeypatch.setattr(mcp_services, "exchange", lambda server: calls.append(server) or _fake_exchange(server))
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    from app.mcp_services import ensure_services_available
    asyncio.run(ensure_services_available(store))
    assert len(calls) == 2
    asyncio.run(ensure_services_available(store))
    assert len(calls) == 2
    mcp_services._records[mcp_services._key(store)]["at"] -= 601
    asyncio.run(ensure_services_available(store))
    assert len(calls) == 4
    store.save(ModelSettings(tools_enabled=False))
    mcp_services._records[mcp_services._key(store)]["at"] -= 601
    asyncio.run(ensure_services_available(store))
    assert len(calls) == 4


def test_disabled_mcp_tool_never_reaches_execution(profile, monkeypatch):
    store, _ = profile
    monkeypatch.setattr(mcp_services, "exchange", _fake_exchange)
    store.save(ModelSettings(tools_mcp_config=_two_servers(), local_operation_mode="full_approval"))
    asyncio.run(refresh_services(store))
    set_tool_enabled(store, "天气", "lookup", False)
    with pytest.raises(HTTPException) as error:
        FileTools(store).run({"operation": "mcp", "tool": tool_identifier("天气", "lookup"), "arguments": {}}, "s")
    assert error.value.status_code == 403


def test_mcp_approval_uses_server_alias_and_is_revoked_by_tool_toggle(profile, monkeypatch):
    import app.mcp_transport as transport
    store, _ = profile
    monkeypatch.setattr(mcp_services, "exchange", _fake_exchange)
    calls = []
    monkeypatch.setattr(transport, "exchange", lambda *args: calls.append(args) or _fake_exchange(*args))
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    asyncio.run(refresh_services(store))
    files = FileTools(store)
    action = {"operation": "mcp", "tool": tool_identifier("天气", "lookup"), "arguments": {"city": "北京"}}
    card = files.run(action, "s")["approval"]
    assert not calls
    set_tool_enabled(store, "日历", "lookup", False)
    with pytest.raises(HTTPException):
        files.decide(card["id"], "s", True)
    assert not calls
    card = files.run(action, "s")["approval"]
    assert files.decide(card["id"], "s", True)["server"] == "天气"
    assert len(calls) == 1
    assert calls[0][0]["headers"]["Authorization"] == "Bearer private-token"


def test_mcp_api_save_refresh_toggle_export(profile, monkeypatch):
    from app import main
    from app.mcp_routes import build_mcp_router
    from fastapi import FastAPI
    store, _ = profile
    monkeypatch.setattr(mcp_services, "exchange", _fake_exchange)
    app = FastAPI()
    app.include_router(build_mcp_router(lambda: store))
    client = TestClient(app)
    result = client.put("/api/tools/mcp/config", json={"config": _two_servers()})
    assert result.status_code == 200
    assert result.json()["label"] == "MCP(2/2)"
    assert "private" not in result.text
    result = client.put("/api/tools/mcp/tool", json={"server": "天气", "tool": "lookup", "enabled": False})
    assert result.is_success
    assert not result.json()["services"][0]["tools"][0]["enabled"]
    assert client.get("/api/tools/mcp/export").json()["mcpServers"]["天气"]["headers"]["Authorization"] == "Bearer private-token"
    assert client.post("/api/tools/mcp/refresh").json()["connected"] == 2


def test_status_reads_never_start_mcp_discovery(profile, monkeypatch):
    from app.mcp_routes import build_mcp_router
    from fastapi import FastAPI
    store, _ = profile
    calls = []
    monkeypatch.setattr(mcp_services, "exchange", lambda server: calls.append(server) or _fake_exchange(server))
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    app = FastAPI()
    app.include_router(build_mcp_router(lambda: store))
    client = TestClient(app)
    assert client.get("/api/tools/mcp").is_success
    assert client.get("/api/tools/mcp").is_success
    assert not calls


def test_single_refresh_only_probes_selected_server_and_never_writes_config(profile, monkeypatch):
    store, _ = profile
    calls = []
    monkeypatch.setattr(mcp_services, "exchange", lambda server: calls.append(server) or _fake_exchange(server))
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    asyncio.run(refresh_services(store))
    calls.clear()
    before = store.path.read_bytes()
    state = asyncio.run(refresh_services(store, "天气"))
    assert len(calls) == 1 and calls[0]["url"] == "https://weather.example/mcp"
    assert state["connected"] == 2
    assert store.path.read_bytes() == before
    with pytest.raises(HTTPException):
        asyncio.run(refresh_services(store, "不存在"))


def test_save_without_probe_then_test_all_does_not_save(profile, monkeypatch):
    from app.mcp_routes import build_mcp_router
    from fastapi import FastAPI
    store, _ = profile
    calls = []
    monkeypatch.setattr(mcp_services, "exchange", lambda server: calls.append(server) or _fake_exchange(server))
    app = FastAPI()
    app.include_router(build_mcp_router(lambda: store))
    client = TestClient(app)
    result = client.put("/api/tools/mcp/config", json={"config": _two_servers(), "reconnect": False})
    assert result.is_success and not calls
    before = store.path.read_bytes()
    assert client.post("/api/tools/mcp/refresh", json={}).json()["connected"] == 2
    assert len(calls) == 2 and store.path.read_bytes() == before


def test_partial_failure_fails_the_full_module_check(profile, monkeypatch):
    from app.tools_module import test_tools as run_module_test
    store, _ = profile
    store.save(ModelSettings(tools_mcp_config=_two_servers()))
    def exchange(server):
        if server.get("command"):
            raise HTTPException(503, "服务不可用")
        return _fake_exchange(server)
    monkeypatch.setattr(mcp_services, "exchange", exchange)
    with pytest.raises(HTTPException):
        asyncio.run(run_module_test(store))
    assert services_status(store)["connected"] == 1


def test_general_role_export_remains_importable_without_mcp_secrets(profile):
    store, _ = profile
    roles = RoleStore(store)
    roles.upsert("source", {"name": "Source"})
    roles.upsert("target", {"name": "Target"})
    with role_scope("source"):
        store.save(ModelSettings(tools_mcp_config=_two_servers()))
    exported = roles.export("source")
    roles.import_config("target", exported)
    with role_scope("target"):
        config = stored_configuration(store, private=True)
        assert set(config["mcpServers"]) == {"天气", "日历"}
        assert config["mcpServers"]["天气"]["headers"]["Authorization"] == ""
        assert config["mcpServers"]["日历"]["env"]["TOKEN"] == ""


def test_real_stdio_sdk_discovers_and_calls_fixture(tmp_path):
    from app.mcp_transport import exchange
    fixture = Path(__file__).parent / "fixtures" / "mcp_echo_server.py"
    server = {"command": sys.executable, "args": [str(fixture)]}
    state = exchange(server)
    assert state["server_info"]["name"] == "DeskAura Test MCP"
    assert state["tools"][0]["name"] == "echo"
    result = exchange(server, "echo", {"value": "real stdio response"})
    assert result["content"][0]["text"] == "real stdio response"


@pytest.mark.parametrize("transport", ["http", "sse"])
def test_real_remote_sdk_discovers_and_calls_local_fixture(transport):
    from mcp.server.fastmcp import FastMCP
    from app.mcp_transport import exchange
    import uvicorn
    from sse_starlette.sse import AppStatus
    AppStatus.should_exit_event = None
    AppStatus.should_exit = False
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    service = FastMCP("DeskAura HTTP Test", host="127.0.0.1", port=port)
    @service.tool()
    def echo(value: str) -> str:
        """Return a test value over a real local HTTP connection."""
        return value
    app = service.sse_app() if transport == "sse" else service.streamable_http_app()
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="error", timeout_graceful_shutdown=1,
    ))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(.02)
        assert server.started
        config = {"url": f"http://127.0.0.1:{port}/{'sse' if transport == 'sse' else 'mcp'}",
                  "transport": transport}
        state = exchange(config)
        assert state["server_info"]["name"] == "DeskAura HTTP Test"
        assert state["tools"][0]["name"] == "echo"
        assert exchange(config, "echo", {"value": "remote response"})["content"][0]["text"] == "remote response"
    finally:
        server.should_exit = True
        thread.join(10)
        assert not thread.is_alive()
