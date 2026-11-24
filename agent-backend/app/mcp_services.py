"""Role-scoped discovery and tool preferences for multiple MCP servers."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import copy
import json
import threading
import time

from fastapi import HTTPException

from .config import ModelSettings, normalized_role
from .mcp_configuration import configuration_fingerprint, service_transport, stored_configuration, tool_identifier
from .mcp_transport import exchange

_records = {}
_revisions = {}
_lock = threading.RLock()
PROOF_LIFETIME = 600
RETRY_INTERVAL = 30
MAX_ROLE_RECORDS = 64


def _prune_role_state_locked(now: float | None = None) -> None:
    """Bound discovery state when roles or isolated data roots churn."""
    now = time.time() if now is None else now
    stale_before = now - PROOF_LIFETIME * 2
    for key, value in list(_records.items()):
        if value.get("at", 0) < stale_before:
            _records.pop(key, None)
            _revisions.pop(key, None)
    if len(_records) <= MAX_ROLE_RECORDS:
        return
    oldest = sorted(_records.items(), key=lambda item: item[1].get("at", 0))
    for key, _ in oldest[:len(_records) - MAX_ROLE_RECORDS]:
        _records.pop(key, None)
        _revisions.pop(key, None)
    for key in list(_revisions):
        if key not in _records:
            _revisions.pop(key, None)


def _key(store):
    return str(store.base_path.resolve()), normalized_role()


def _public_service(name: str, server: dict, record: dict | None, fresh: bool) -> dict:
    result = copy.deepcopy(record or {})
    fresh = fresh and time.time() - result.get("at", time.time()) < PROOF_LIFETIME
    connected = bool(fresh and result.get("connected"))
    tools = result.get("tools", [])
    disabled = set(server.get("disabledTools", []))
    tools = [{**item, "enabled": item["name"] not in disabled} for item in tools]
    return {
        "name": name, "transport": service_transport(server), "connected": connected,
        "detail": result.get("detail", "尚未连接") if fresh else "尚未连接",
        "server_info": result.get("server_info", {}), "tools": tools,
        "tool_count": len(tools), "enabled_count": sum(item["enabled"] for item in tools),
    }


def services_status(store) -> dict:
    config = stored_configuration(store)
    fingerprint = configuration_fingerprint(store)
    with _lock:
        _prune_role_state_locked()
        state = copy.deepcopy(_records.get(_key(store), {}))
    fresh = state.get("signature") == fingerprint and time.time() - state.get("at", 0) < PROOF_LIFETIME
    services = [_public_service(name, server, state.get("services", {}).get(name), fresh)
                for name, server in config["mcpServers"].items()]
    connected = sum(item["connected"] for item in services)
    total = len(services)
    label = services[0]["name"] if total == 1 and connected == 1 else f"MCP({connected}/{total})" if total else "未配置服务"
    return {"config": config, "services": services, "connected": connected, "total": total, "label": label}


def _probe(name: str, server: dict) -> tuple[str, dict]:
    try:
        result = exchange(server)
        tools = [{
            "name": tool["name"], "description": str(tool.get("description") or "")[:3000],
            "inputSchema": tool["inputSchema"],
        } for tool in result["tools"]]
        return name, {"connected": True, "detail": f"已连接 · {len(tools)} 个工具",
                      "server_info": result["server_info"], "tools": tools}
    except HTTPException as error:
        return name, {"connected": False, "detail": str(error.detail), "server_info": {}, "tools": []}
    except Exception:
        return name, {"connected": False, "detail": "连接失败，请检查配置和服务状态。", "server_info": {}, "tools": []}


def refresh_services_sync(store, server_name: str | None = None) -> dict:
    key = _key(store)
    config, fingerprint = stored_configuration(store, private=True), configuration_fingerprint(store)
    with _lock:
        _prune_role_state_locked()
        revision = _revisions.get(key, 0) + 1
        _revisions[key] = revision
    servers = config["mcpServers"]
    if server_name is not None:
        if server_name not in servers:
            raise HTTPException(404, "找不到此 MCP 服务。")
        servers = {server_name: servers[server_name]}
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix="mcp-discovery") as executor:
        services = dict(executor.map(lambda item: _probe(*item), servers.items()))
    for service in services.values():
        service["at"] = time.time()
    if configuration_fingerprint(store) != fingerprint:
        raise HTTPException(409, "MCP 配置在连接过程中发生变化，请重新检测。")
    with _lock:
        if _revisions.get(key) != revision:
            return services_status(store)
        previous = _records.get(key, {})
        if server_name is not None and previous.get("signature") == fingerprint:
            services = {**previous.get("services", {}), **services}
        _records[key] = {"signature": fingerprint, "at": time.time(), "services": services}
        _prune_role_state_locked()
    return services_status(store)


async def refresh_services(store, server_name: str | None = None) -> dict:
    return await asyncio.to_thread(refresh_services_sync, store, server_name)


async def ensure_services_available(store) -> None:
    """Renew expired discovery on demand without retrying every model turn."""
    config = store.get()
    if not config.get("tools_enabled", True) or not config.get("tools_mcp_config", {}).get("mcpServers"):
        return
    fingerprint = configuration_fingerprint(store)
    with _lock:
        record = _records.get(_key(store), {})
        same = record.get("signature") == fingerprint
        age = time.time() - record.get("at", 0)
        successful = any(item.get("connected") for item in record.get("services", {}).values())
        if same and age < (PROOF_LIFETIME if successful else RETRY_INTERVAL):
            return
    try:
        await refresh_services(store)
    except HTTPException:
        pass


def set_tool_enabled(store, server_name: str, tool_name: str, enabled: bool) -> dict:
    state = services_status(store)
    service = next((item for item in state["services"] if item["name"] == server_name), None)
    if service is None or tool_name not in {item["name"] for item in service["tools"]}:
        raise HTTPException(404, "找不到此 MCP 工具，请先连接服务。")
    config = state["config"]
    server = config["mcpServers"][server_name]
    disabled = set(server.get("disabledTools", []))
    disabled.discard(tool_name) if enabled else disabled.add(tool_name)
    if disabled:
        server["disabledTools"] = sorted(disabled)
    else:
        server.pop("disabledTools", None)
    old_signature = configuration_fingerprint(store)
    store.save(ModelSettings(tools_mcp_config=config))
    # A toggle changes availability, not the connected endpoint. Preserve the
    # discovery proof while approvals remain invalidated by the new signature.
    with _lock:
        record = _records.get(_key(store))
        if record and record.get("signature") == old_signature:
            record["signature"] = configuration_fingerprint(store)
    return services_status(store)


def catalog(store) -> list[dict]:
    state = services_status(store)
    result, length = [], 0
    for server in state["services"]:
        if not server["connected"]:
            continue
        for tool in server["tools"]:
            if not tool["enabled"]:
                continue
            item = {"name": tool_identifier(server["name"], tool["name"]),
                    "server": server["name"], "tool": tool["name"],
                    "description": f"[{server['name']}] {tool['description']}"[:1000],
                    "inputSchema": tool["inputSchema"]}
            size = len(json.dumps(item, ensure_ascii=False))
            if size > 8000 or size + length > 24000 or len(result) >= 40:
                continue
            result.append(item)
            length += size
    return result


def resolve_registered_tool(store, action: dict) -> tuple[str, str]:
    tool, requested_server = action["tool"], action.get("server")
    state = services_status(store)
    matches = []
    for server in state["services"]:
        name = server["name"]
        if requested_server and name != requested_server:
            continue
        for item in server["tools"]:
            if tool not in {item["name"], tool_identifier(name, item["name"])}:
                continue
            if not item["enabled"]:
                raise HTTPException(403, "此 MCP 工具已被禁用。")
            if server["connected"]:
                matches.append((name, item["name"]))
    if len(matches) == 1:
        return matches[0]
    raise HTTPException(422, "请先连接 MCP 服务，并使用工具列表中唯一的工具名称。")
