"""Role-scoped, configuration-bound checks for local tools and an MCP server."""
import asyncio
import json
from pathlib import Path
import tempfile
import threading
import time

from fastapi import HTTPException

from .config import normalized_role
from .file_tools import FileTools
from .local_permissions import sandbox_mode
from .mcp_client import MCPClient, credential, endpoint, signature
from .mcp_services import catalog as mcp_catalog, refresh_services_sync, services_status

_records = {}
_revisions = {}
_lock = threading.RLock()
PROOF_LIFETIME = 600
MAX_ROLE_RECORDS = 64


def _prune_role_state_locked(now: float | None = None) -> None:
    """Bound role-scoped verification receipts in the long-lived process."""
    now = time.time() if now is None else now
    stale_before = now - PROOF_LIFETIME * 2
    for role, value in list(_records.items()):
        if value.get("at", 0) < stale_before:
            _records.pop(role, None)
            _revisions.pop(role, None)
    if len(_records) <= MAX_ROLE_RECORDS:
        return
    oldest = sorted(_records.items(), key=lambda item: item[1].get("at", 0))
    for role, _ in oldest[:len(_records) - MAX_ROLE_RECORDS]:
        _records.pop(role, None)
        _revisions.pop(role, None)
    for role in list(_revisions):
        if role not in _records:
            _revisions.pop(role, None)


def _configuration(store):
    config = store.get()
    return config, signature(config, credential(store))


def _configured(config):
    root = str(config.get("file_access_root") or "").strip()
    servers = (config.get("tools_mcp_config") or {}).get("mcpServers", {})
    if not root and not servers and not str(config.get("tools_mcp_url") or "").strip():
        return False, "请选择工作空间或配置 MCP 服务"
    return True, "尚未检测"


def tools_status(store) -> dict:
    config, fingerprint = _configuration(store)
    enabled = bool(config.get("tools_enabled", True))
    configured, detail = _configured(config)
    with _lock:
        _prune_role_state_locked()
        record = dict(_records.get(normalized_role(), {}))
    matches = record.get("signature") == fingerprint
    fresh = matches and time.time() - record.get("at", 0) < PROOF_LIFETIME
    verified = bool(enabled and configured and fresh and record.get("verified"))
    services = services_status(store)
    modern = store._read_file().get("tools_mcp_config") is not None
    remote_tools = [tool for server in services["services"] if server["connected"] for tool in server["tools"] if tool["enabled"]]
    return {
        "enabled": enabled, "tag": config.get("tools_tag", ""),
        "configured": configured, "verified": verified,
        "detail": ("已停用" if not enabled else
                   record.get("detail", detail) if fresh else
                   "验证已过期 · 请重新检测" if matches and configured else detail),
        "verified_at": int(record["at"]) if verified else None,
        "sandbox_mode": sandbox_mode(config),
        "os_sandbox_available": False,
        "mcp_connected": bool(services["connected"]) if modern else bool(verified and record.get("mcp")),
        "mcp_label": services["label"], "mcp_connected_count": services["connected"],
        "mcp_configured_count": services["total"],
        "tool_count": len(remote_tools) if modern else len(record.get("tools", [])) if verified else 0,
        "tools": [{"name": item["name"], "description": str(item.get("description") or "")[:300]}
                  for item in remote_tools] if modern else [{"name": item["name"], "description": str(item.get("description") or "")[:300]}
                  for item in record.get("tools", [])] if verified else [],
    }


def _check_local(store, config):
    # Exercise the real path guard, then read an actual directory. No test file
    # is created for read-only access.
    files = FileTools(store)
    root, _ = files.target(".")
    files.run({"operation": "list", "path": "."}, "module-check")
    if sandbox_mode(config) == "read_only":
        return
    # Use exclusive creation and remove only this owned file. This checks real
    # write/read/delete access instead of interpreting os.access as a proof.
    test_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".deskaura-check-", suffix=".txt",
                                         dir=root, mode="w", encoding="utf-8", delete=False) as stream:
            test_path = Path(stream.name)
            stream.write("DeskAura local tool check")
        if test_path.read_text(encoding="utf-8") != "DeskAura local tool check":
            raise OSError
    finally:
        if test_path is not None:
            test_path.unlink(missing_ok=True)


def _run_test(store):
    role = normalized_role()
    config, fingerprint = _configuration(store)
    with _lock:
        _prune_role_state_locked()
        revision = _revisions.get(role, 0) + 1
        _revisions[role] = revision
        _records[role] = {"signature": fingerprint, "verified": False,
                          "at": time.time(), "detail": "检测中"}
    try:
        if not config.get("tools_enabled", True):
            raise HTTPException(409, "手脚模块已停用。")
        configured, detail = _configured(config)
        if not configured:
            raise HTTPException(409, detail)
        modern = store._read_file().get("tools_mcp_config") is not None
        mcp_state = refresh_services_sync(store) if modern else None
        local = bool(str(config.get("file_access_root") or "").strip())
        if local:
            _check_local(store, config)
        tools = []
        mcp = bool(str(config.get("tools_mcp_url") or "").strip())
        if modern:
            mcp = bool(mcp_state["total"])
            tools = [tool for server in mcp_state["services"] if server["connected"] for tool in server["tools"] if tool["enabled"]]
            if mcp and mcp_state["connected"] != mcp_state["total"]:
                raise HTTPException(503, f"MCP 服务未全部连接（{mcp_state['connected']}/{mcp_state['total']}），请查看服务列表。")
        elif mcp:
            with MCPClient(endpoint(config), credential(store)) as client:
                client.initialize()
                tools = client.list_tools()
            if not tools:
                raise HTTPException(502, "MCP 服务已响应，但没有公开可调用的工具。")
        _, latest = _configuration(store)
        if latest != fingerprint:
            raise HTTPException(409, "配置在检测过程中发生变化，请重新检测。")
        description = (f"{'本地文件工具正常 · ' if local else ''}{mcp_state['label']} · {len(tools)} 个已启用工具" if modern and mcp else
                       f"正常 · 本地文件工具与 {len(tools)} 个 MCP 工具" if mcp else
                       "正常 · 本地只读工具" if sandbox_mode(config) == "read_only" else
                       "正常 · 本地文件读写工具")
        with _lock:
            if _revisions.get(role) != revision:
                raise HTTPException(409, "已有更新的检测请求，请查看最新检测结果。")
            _records[role] = {
                "signature": fingerprint, "verified": True, "at": time.time(),
                "detail": description, "tools": tools, "mcp": mcp,
            }
            _prune_role_state_locked()
        return tools_status(store)
    except Exception as error:
        detail = error.detail if isinstance(error, HTTPException) else "本地工具检测失败，请检查目录是否存在、访问权限与 MCP 服务。"
        # Never display a server body, a secret, or the configured endpoint.
        with _lock:
            if _revisions.get(role) == revision:
                _records[role] = {"signature": fingerprint, "verified": False,
                                  "at": time.time(), "detail": detail}
                _prune_role_state_locked()
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(503, detail) from None


async def test_tools(store) -> dict:
    """Probe actual local file access and initialize/list an optional MCP server."""
    return await asyncio.to_thread(_run_test, store)


def tools_catalog(store) -> list[dict]:
    """Expose schemas only after a recent role/configuration-matching check."""
    if store.get().get("tools_enabled", True) and store._read_file().get("tools_mcp_config") is not None:
        return mcp_catalog(store)
    status = tools_status(store)
    if not status["verified"] or not status["mcp_connected"]:
        return []
    with _lock:
        record = _records.get(normalized_role(), {})
        catalog, length = [], 0
        for tool in record.get("tools", [])[:40]:
            item = {"name": tool["name"], "description": str(tool.get("description") or "")[:1000],
                    "inputSchema": tool["inputSchema"]}
            size = len(json.dumps(item, ensure_ascii=False))
            if size > 8000 or length + size > 24000:
                continue
            catalog.append(item)
            length += size
        return catalog
