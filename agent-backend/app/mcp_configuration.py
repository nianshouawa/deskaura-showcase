"""Validated MCP JSON with role-local credentials kept outside config files."""
import copy
import base64
import hashlib
import json
import re
from urllib.parse import urlsplit

from fastapi import HTTPException

MASK = "********"
MCP_CONFIG_SECRET_USERNAME = "tools-mcp-config-secrets"
MAX_SERVERS = 20
MAX_CONFIG_BYTES = 256000
HEADER_NAME = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")
RESERVED_HEADERS = {"host", "content-length", "content-type", "connection", "transfer-encoding",
                    "accept", "accept-encoding"}


def _failure(detail="MCP JSON 配置格式不正确。"):
    raise HTTPException(422, detail)


def validate_configuration(value: dict) -> dict:
    """Accept the shared mcpServers format without silently dropping fields."""
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        _failure()
    if len(encoded.encode("utf-8")) > MAX_CONFIG_BYTES:
        _failure("MCP JSON 配置不能超过 256 KB。")
    if not isinstance(value, dict) or set(value) != {"mcpServers"} or not isinstance(value["mcpServers"], dict):
        _failure("MCP 配置需要包含 mcpServers 对象。")
    if len(value["mcpServers"]) > MAX_SERVERS:
        _failure("最多配置 20 个 MCP 服务。")
    result = copy.deepcopy(value)
    for name, server in result["mcpServers"].items():
        if (not isinstance(name, str) or not name.strip() or len(name) > 100
                or any(ord(char) < 32 for char in name) or not isinstance(server, dict)):
            _failure("每个 MCP 服务都需要有效的名称和配置对象。")
        if set(server) - {"command", "args", "env", "cwd", "url", "headers", "transport", "type", "disabledTools"}:
            _failure("MCP 服务包含不支持的字段；支持 command、args、env、cwd、url、headers、transport、type、disabledTools。")
        command, url = server.get("command"), server.get("url")
        if bool(command) == bool(url):
            _failure("每个 MCP 服务应填写 command 或 url 中的一项。")
        declared = server.get("transport", server.get("type"))
        if command:
            if (not isinstance(command, str) or len(command) > 2000
                    or any(ord(char) < 32 for char in command)):
                _failure("MCP command 需要有效的程序名或路径。")
            if declared not in (None, "stdio"):
                _failure("command 类型的 MCP 服务只能使用 stdio。")
            args = server.get("args", [])
            if (not isinstance(args, list) or len(args) > 100
                    or any(not isinstance(arg, str) or len(arg) > 8000 or "\x00" in arg for arg in args)):
                _failure("MCP args 需要字符串数组。")
            if "cwd" in server and (not isinstance(server["cwd"], str) or len(server["cwd"]) > 2000 or "\x00" in server["cwd"]):
                _failure("MCP cwd 需要有效的工作目录路径。")
            if "headers" in server:
                _failure("stdio 服务请使用 env，不使用 headers。")
        else:
            if not isinstance(url, str) or len(url) > 2000:
                _failure("MCP url 需要有效的 HTTP(S) 地址。")
            try:
                parsed = urlsplit(url)
                if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                        or parsed.username or parsed.password or parsed.fragment
                        or any(ord(char) < 33 for char in url) or parsed.port == 0):
                    raise ValueError
            except (ValueError, TypeError):
                _failure("MCP url 需要有效的 HTTP(S) 地址；认证请使用 headers。")
            if declared not in (None, "http", "streamable-http", "streamableHttp", "sse"):
                _failure("远程 MCP transport 支持 http、streamable-http 或 sse。")
            if "env" in server or "args" in server or "cwd" in server:
                _failure("远程服务请使用 url 和 headers，不使用 command 参数。")
        for field in ("env", "headers"):
            if field not in server:
                continue
            mapping = server[field]
            if not isinstance(mapping, dict) or len(mapping) > 100:
                _failure(f"MCP {field} 需要字符串键值对象。")
            for key, item in mapping.items():
                if (not isinstance(key, str) or not key or len(key) > 200
                        or not isinstance(item, str) or len(item) > 16000
                        or any(ord(char) < 32 for char in key) or "\x00" in item):
                    _failure(f"MCP {field} 包含无效的键或值。")
                if field == "headers" and (not HEADER_NAME.fullmatch(key)
                        or key.lower() in RESERVED_HEADERS or key.lower().startswith("mcp-")
                        or any(ord(char) < 32 for char in item)):
                    _failure("MCP headers 包含无效或受保护的字段。")
                if field == "env" and "=" in key:
                    _failure("MCP env 变量名称不能包含等号。")
        disabled = server.get("disabledTools", [])
        if (not isinstance(disabled, list) or len(disabled) > 200
                or any(not isinstance(item, str) or not item or len(item) > 200 for item in disabled)):
            _failure("disabledTools 需要工具名称数组。")
        if disabled:
            server["disabledTools"] = list(dict.fromkeys(disabled))
    return result


def _secrets(store) -> dict:
    try:
        raw = store._read_secret(MCP_CONFIG_SECRET_USERNAME) or "{}"
        value = json.loads(raw)
        if isinstance(value, dict) and isinstance(value.get("_chunks"), int):
            if not 1 <= value["_chunks"] <= 500:
                return {}
            raw = "".join(store._read_secret(f"{MCP_CONFIG_SECRET_USERNAME}-{index}") for index in range(value["_chunks"]))
            if value.get("_encoding") == "base64":
                raw = base64.b64decode(raw).decode("utf-8")
            value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}


def secret_records(store) -> dict[str, str]:
    raw = store._read_secret(MCP_CONFIG_SECRET_USERNAME)
    records = {MCP_CONFIG_SECRET_USERNAME: raw} if raw else {}
    try:
        count = json.loads(raw).get("_chunks", 0)
        if isinstance(count, int) and 0 < count <= 500:
            records.update({f"{MCP_CONFIG_SECRET_USERNAME}-{index}": store._read_secret(
                f"{MCP_CONFIG_SECRET_USERNAME}-{index}") for index in range(count)})
    except (ValueError, TypeError, AttributeError):
        pass
    return records


def save_secrets(store, raw: str) -> None:
    old = secret_records(store)
    # Windows Credential Manager limits each UTF-16 credential blob to 2560
    # bytes. Keep chunks well below that limit, including non-ASCII content.
    encoded = base64.b64encode(raw.encode("utf-8")).decode("ascii")
    chunks = [encoded[index:index + 1000] for index in range(0, len(encoded), 1000)]
    for index, chunk in enumerate(chunks):
        store._save_secret(f"{MCP_CONFIG_SECRET_USERNAME}-{index}", chunk)
    store._save_secret(MCP_CONFIG_SECRET_USERNAME, json.dumps({"_chunks": len(chunks), "_encoding": "base64"}))
    for name in set(old) - {MCP_CONFIG_SECRET_USERNAME, *(f"{MCP_CONFIG_SECRET_USERNAME}-{index}" for index in range(len(chunks)))}:
        store._delete_secret(name)


def stored_configuration(store, stored: dict | None = None, *, private=False) -> dict:
    value = store._read_file() if stored is None else stored
    configured = value.get("tools_mcp_config")
    if configured is None:
        url = str(value.get("tools_mcp_url") or "").strip()
        if not url:
            return {"mcpServers": {}}
        server = {"url": url}
        key = store.secret("tools_mcp_api_key")
        if key:
            from .mcp_client import authentication_headers
            server["headers"] = authentication_headers(key) if private else {
                name: MASK for name in authentication_headers(key)
            }
        return {"mcpServers": {"MCP": server}}
    result = copy.deepcopy(configured)
    if not isinstance(result, dict) or not isinstance(result.get("mcpServers"), dict):
        return {"mcpServers": {}}
    secrets = _secrets(store)
    for name, server in result["mcpServers"].items():
        for field in ("env", "headers"):
            for key, item in server.get(field, {}).items():
                if private:
                    server[field][key] = secrets.get(name, {}).get(field, {}).get(key, "" if item == MASK else item)
                else:
                    server[field][key] = MASK if item else ""
    return result


def prepare_configuration(store, value: dict) -> tuple[dict, str]:
    result = validate_configuration(value)
    previous = stored_configuration(store, private=True)["mcpServers"]
    secrets = {}
    for name, server in result["mcpServers"].items():
        for field in ("env", "headers"):
            for key, item in server.get(field, {}).items():
                if item == MASK:
                    old = previous.get(name, {}).get(field, {}).get(key)
                    if old is None:
                        _failure("新增的 MCP 凭证不能使用掩码占位符，请填写实际值。")
                    item = old
                secrets.setdefault(name, {}).setdefault(field, {})[key] = item
                server[field][key] = MASK if item else ""
    return result, json.dumps(secrets, ensure_ascii=True, allow_nan=False)


def configuration_fingerprint(store, value: dict | None = None) -> str:
    return hashlib.sha256(json.dumps(stored_configuration(store, value, private=True),
                                     sort_keys=True, ensure_ascii=True).encode()).hexdigest()


def service_transport(server: dict) -> str:
    if server.get("command"):
        return "stdio"
    declared = server.get("transport", server.get("type"))
    if declared == "sse" or declared is None and urlsplit(server.get("url", "")).path.rstrip("/").endswith("/sse"):
        return "sse"
    return "http"


def tool_identifier(server_name: str, tool_name: str) -> str:
    readable = re.sub(r"[^a-zA-Z0-9_-]", "_", tool_name)[:70]
    suffix = hashlib.sha256((server_name + "\0" + tool_name).encode()).hexdigest()[:12]
    return f"mcp_{readable}_{suffix}"
