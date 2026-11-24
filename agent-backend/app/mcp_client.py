"""Bounded MCP Streamable HTTP client.

Only an explicitly configured server is contacted. Discovery never calls tools.
Model-authored tool calls are separately authorized by FileTools.
"""
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urlsplit

from fastapi import HTTPException
import httpx

PROTOCOL_VERSIONS = {"2025-11-25", "2025-06-18", "2025-03-26"}
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_TOOLS = 200
HEADER_NAME = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")
RESERVED_HEADERS = {
    "accept", "accept-encoding", "connection", "content-length", "content-type",
    "host", "transfer-encoding",
}


def _reject_json_constant(_value):
    raise ValueError("Non-finite JSON number")


def endpoint(config: dict) -> str:
    value = str(config.get("tools_mcp_url") or "").strip()
    try:
        parsed = urlsplit(value)
        if (len(value) > 500 or parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username or parsed.password or parsed.fragment):
            raise ValueError
        # Access credentials belong in the separate encrypted key field.
        if parsed.query:
            raise ValueError
        _ = parsed.port
    except (ValueError, TypeError):
        raise HTTPException(422, "MCP 地址须为 HTTP(S) 接口地址；密钥请填在独立密钥栏，不要放入地址。") from None
    return value.rstrip("/")


def credential(store) -> str:
    try:
        return str(store.secret("tools_mcp_api_key") or "")
    except KeyError:
        return ""


def authentication_headers(value: str) -> dict[str, str]:
    """Accept raw tokens, Bearer/Basic values, one header, or a JSON header map."""
    text = str(value or "").strip()
    if not text:
        return {}
    if len(text) > 4000:
        raise HTTPException(422, "MCP 认证凭证过长，请使用更短的令牌或 Header。")
    if text.lower().startswith(("bearer ", "basic ")):
        return {"Authorization": text}
    if text.startswith("{"):
        try:
            value = json.loads(text)
        except (ValueError, TypeError):
            raise HTTPException(422, "MCP 认证 Header 的 JSON 格式无效。") from None
        if not isinstance(value, dict):
            raise HTTPException(422, "MCP 认证 Header 必须是 JSON 对象。")
        pairs = value.items()
    elif ":" in text:
        pairs = [text.split(":", 1)]
    else:
        return {"Authorization": f"Bearer {text}"}
    headers = {}
    for name, item in pairs:
        name, item = str(name).strip(), str(item).strip()
        lower = name.lower()
        if (
            not HEADER_NAME.fullmatch(name)
            or len(name) > 100
            or lower in RESERVED_HEADERS
            or lower.startswith("mcp-")
            or not item
            or len(item) > 3000
            or any(ord(char) < 32 for char in item)
        ):
            raise HTTPException(422, "MCP 认证 Header 包含不支持或受保护的字段。")
        headers[name] = item
    if not headers:
        raise HTTPException(422, "MCP 认证 Header 不能为空。")
    return headers


def signature(config: dict, key: str) -> str:
    values = {name: config.get(name) for name in (
        "tools_enabled", "tools_connection_mode", "tools_mcp_url",
        "tools_mcp_config", "tools_mcp_fingerprint",
        "file_access_root", "local_sandbox_mode", "local_sandbox_enabled",
    )}
    return hashlib.sha256(json.dumps([values, key], sort_keys=True).encode()).hexdigest()


class MCPClient:
    def __init__(self, address: str, key: str = "", *, transport=None):
        self.address = endpoint({"tools_mcp_url": address})
        headers = {"Accept": "application/json, text/event-stream", "Accept-Encoding": "identity"}
        headers.update(authentication_headers(key))
        self.client = httpx.Client(headers=headers, timeout=20, trust_env=False,
                                   follow_redirects=False, transport=transport)
        self.sequence = 0
        self.session_id = None
        self.version = None
        self.deadline = time.monotonic() + 20

    def close(self):
        if self.session_id:
            try:
                self.client.delete(self.address, timeout=3)
            except httpx.HTTPError:
                pass
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    @staticmethod
    def _decode(data: bytes, content_type: str, expected_id):
        try:
            text = data.decode("utf-8")
            if content_type.startswith("text/event-stream"):
                messages = []
                # A stream may contain an incomplete next event after the
                # complete result; inspect only events terminated by a blank line.
                for event in text.replace("\r\n", "\n").split("\n\n")[:-1]:
                    lines = [line[5:].lstrip(" ") for line in event.split("\n") if line.startswith("data:")]
                    if lines and "\n".join(lines).strip():
                        messages.append(json.loads("\n".join(lines), parse_constant=_reject_json_constant))
                matches = [value for value in messages if isinstance(value, dict) and value.get("id") == expected_id]
                value = matches[-1] if matches else None
            elif content_type.startswith("application/json"):
                value = json.loads(text, parse_constant=_reject_json_constant)
            else:
                value = None
            if not isinstance(value, dict) or value.get("jsonrpc") != "2.0" or value.get("id") != expected_id:
                raise ValueError
            if value.get("error") is not None:
                raise HTTPException(502, "MCP 服务拒绝了请求，请检查工具名称、参数和服务器权限。")
            if not isinstance(value.get("result"), dict):
                raise ValueError
            return value["result"]
        except (ValueError, UnicodeDecodeError, TypeError):
            raise HTTPException(502, "MCP 返回的 JSON-RPC 数据格式不正确。") from None

    def _post(self, method: str, params=None, *, notification=False):
        self.sequence += 1
        request_id = self.sequence
        body = {"jsonrpc": "2.0", "method": method}
        if not notification:
            body["id"] = request_id
        if params is not None:
            body["params"] = params
        started = time.monotonic()
        remaining = self.deadline - started
        if remaining <= 0:
            raise HTTPException(503, "MCP 请求超过时间限制。")
        try:
            with self.client.stream("POST", self.address, json=body, timeout=remaining) as response:
                if not 200 <= response.status_code < 300:
                    raise HTTPException(502, f"MCP 请求未通过（HTTP {response.status_code}）。")
                if notification:
                    return None
                session = response.headers.get("Mcp-Session-Id")
                if session:
                    if self.session_id and session != self.session_id:
                        raise HTTPException(502, "MCP 会话标识在请求中发生变化。")
                    if len(session) > 1024 or any(ord(char) < 33 or ord(char) > 126 for char in session):
                        raise HTTPException(502, "MCP 会话标识不正确。")
                    self.session_id = session
                    self.client.headers["Mcp-Session-Id"] = session
                data = bytearray()
                for part in response.iter_bytes():
                    data.extend(part)
                    if len(data) > MAX_RESPONSE_BYTES or time.monotonic() > self.deadline:
                        raise HTTPException(502, "MCP 响应超过大小或时间限制。")
                    # An SSE response can remain open after its JSON-RPC result.
                    # Return as soon as a complete matching event has arrived.
                    if response.headers.get("content-type", "").startswith("text/event-stream") and b"\n\n" in data.replace(b"\r\n", b"\n"):
                        try:
                            result = self._decode(bytes(data), "text/event-stream", request_id)
                        except HTTPException as error:
                            if error.detail != "MCP 返回的 JSON-RPC 数据格式不正确。":
                                raise
                        else:
                            return result
                return self._decode(bytes(data), response.headers.get("content-type", ""), request_id)
        except httpx.HTTPError:
            raise HTTPException(503, "无法连接 MCP 服务，请检查地址、密钥和服务状态。") from None

    def initialize(self):
        result = self._post("initialize", {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "DeskAura", "version": "0.1.0"},
        })
        version = result.get("protocolVersion")
        if version not in PROTOCOL_VERSIONS:
            raise HTTPException(502, "MCP 服务使用的协议版本暂不支持。")
        if not isinstance(result.get("capabilities"), dict) or not isinstance(result["capabilities"].get("tools"), dict):
            raise HTTPException(502, "MCP 服务未声明工具调用能力。")
        self.version = version
        self.client.headers["MCP-Protocol-Version"] = version
        self._post("notifications/initialized", notification=True)
        return result

    def list_tools(self) -> list[dict]:
        tools, cursors, cursor = [], set(), None
        for _ in range(10):
            result = self._post("tools/list", {"cursor": cursor} if cursor else {})
            page = result.get("tools")
            if not isinstance(page, list):
                raise HTTPException(502, "MCP 未返回有效的工具列表。")
            for tool in page:
                if (not isinstance(tool, dict) or not isinstance(tool.get("name"), str)
                        or not tool["name"].strip() or len(tool["name"]) > 200
                        or not isinstance(tool.get("inputSchema"), dict)):
                    raise HTTPException(502, "MCP 工具定义不完整。")
                tools.append(tool)
                if len(tools) > MAX_TOOLS:
                    raise HTTPException(502, "MCP 工具数量超过 200 个，请缩小服务器的暴露范围。")
            cursor = result.get("nextCursor")
            if not cursor:
                if len({tool["name"] for tool in tools}) != len(tools):
                    raise HTTPException(502, "MCP 返回了重复的工具名称。")
                return tools
            if not isinstance(cursor, str) or len(cursor) > 2000 or cursor in cursors:
                raise HTTPException(502, "MCP 工具分页数据不正确。")
            cursors.add(cursor)
        raise HTTPException(502, "MCP 工具列表分页过多。")

    def call(self, name: str, arguments: dict):
        known = self.list_tools()
        if name not in {tool["name"] for tool in known}:
            raise HTTPException(404, "此工具不在当前 MCP 服务公开的工具列表中。")
        result = self._post("tools/call", {"name": name, "arguments": arguments})
        if not isinstance(result.get("content"), list):
            raise HTTPException(502, "MCP 工具未返回有效的结果。")
        # Preserve structured data while bounding what enters the next model turn.
        encoded = json.dumps(result, ensure_ascii=False, allow_nan=False)
        if len(encoded) > 16000:
            return {"isError": bool(result.get("isError")), "truncated": True,
                    "content": [{"type": "text", "text": encoded[:15000]}]}
        return result


def prepare_mcp(action: dict, config: dict, root: Path, cwd: Path, *, store=None) -> dict:
    modern = store is not None and store._read_file().get("tools_mcp_config") is not None
    if not modern:
        endpoint(config)
    tool = action.get("tool")
    arguments = action.get("arguments", {})
    if (not isinstance(tool, str) or not tool.strip() or len(tool) > 200
            or any(ord(char) < 32 for char in tool) or not isinstance(arguments, dict)):
        raise HTTPException(422, "MCP 调用需要工具名称和 JSON 对象参数。")
    try:
        preview = json.dumps({"tool": tool, "arguments": arguments}, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        raise HTTPException(422, "MCP 参数不是有效的 JSON 对象。") from None
    if len(preview) > 12000:
        raise HTTPException(422, "MCP 参数超过 12000 字，请拆分调用。")
    payload = {
        "operation": "mcp", "path": str(cwd), "root": str(root),
        "tool": tool, "arguments": arguments, "content": preview,
        "runtime": "MCP", "timeout": 20, "created_at": time.time(),
        # The endpoint itself is never shown in approval cards or model output.
        "warning": "不是沙箱：MCP 工具按其服务器的权限执行，可能访问工作空间之外的文件和网络。",
    }
    if modern:
        from .mcp_services import resolve_registered_tool
        from .mcp_configuration import configuration_fingerprint
        server, tool = resolve_registered_tool(store, action)
        payload.update({"mcp_server": server, "tool": tool, "modern_mcp": True,
                        "endpoint_fingerprint": configuration_fingerprint(store)})
    else:
        payload["endpoint_fingerprint"] = hashlib.sha256(endpoint(config).encode()).hexdigest()
    return payload


def execute_mcp(payload: dict, store) -> dict:
    config = store.get()
    if payload.get("modern_mcp"):
        from .mcp_configuration import configuration_fingerprint, stored_configuration
        from .mcp_transport import exchange
        if (configuration_fingerprint(store) != payload.get("endpoint_fingerprint")
                or payload.get("config_signature") != signature(config, credential(store))):
            raise HTTPException(409, "MCP 配置或工具权限已变化，请重新请求调用。")
        server = stored_configuration(store, private=True)["mcpServers"].get(payload["mcp_server"])
        if not server or payload["tool"] in server.get("disabledTools", []):
            raise HTTPException(403, "MCP 服务不存在或工具已被禁用。")
        result = exchange(server, payload["tool"], payload["arguments"])
        return {"operation": "mcp", "server": payload["mcp_server"], "tool": payload["tool"],
                "result": result, "text": "MCP 工具返回错误。" if result.get("isError") else "MCP 工具已返回结果。"}
    current = hashlib.sha256(endpoint(config).encode()).hexdigest()
    if current != payload.get("endpoint_fingerprint"):
        raise HTTPException(409, "MCP 服务地址已变化，请重新请求调用。")
    if payload.get("config_signature") != signature(config, credential(store)):
        raise HTTPException(409, "MCP 配置或访问权限已变化，请重新请求调用。")
    with MCPClient(endpoint(config), credential(store)) as client:
        client.initialize()
        result = client.call(payload["tool"], payload["arguments"])
    return {"operation": "mcp", "tool": payload["tool"], "result": result,
            "text": "MCP 工具返回错误。" if result.get("isError") else "MCP 工具已返回结果。"}
