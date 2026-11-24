"""Official SDK transports used by the multi-server MCP registry."""
import asyncio
from contextlib import AsyncExitStack
from datetime import timedelta
import json
import os

import anyio
from fastapi import HTTPException
import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client

from .mcp_configuration import service_transport

MAX_TOOLS = 200


def _http_client_factory(headers=None, auth=None, timeout=None):
    return httpx.AsyncClient(headers=headers, auth=auth, timeout=timeout or 20,
                             trust_env=False, follow_redirects=False)


async def _exchange(server: dict, tool: str | None, arguments: dict | None) -> dict:
    with anyio.fail_after(22):
        async with AsyncExitStack() as stack:
            transport = service_transport(server)
            if transport == "stdio":
                errlog = stack.enter_context(open(os.devnull, "w"))
                streams = await stack.enter_async_context(stdio_client(StdioServerParameters(
                    command=server["command"], args=server.get("args", []),
                    env=server.get("env"), cwd=server.get("cwd"),
                ), errlog=errlog))
            elif transport == "sse":
                streams = await stack.enter_async_context(sse_client(
                    server["url"], headers=server.get("headers"),
                    timeout=15, sse_read_timeout=20, httpx_client_factory=_http_client_factory,
                ))
            else:
                client = await stack.enter_async_context(_http_client_factory(
                    headers=server.get("headers"), timeout=httpx.Timeout(15, read=20)))
                streams = await stack.enter_async_context(streamable_http_client(
                    server["url"], http_client=client))
            session = await stack.enter_async_context(ClientSession(
                streams[0], streams[1], read_timeout_seconds=timedelta(seconds=20)))
            initialized = await session.initialize()
            if initialized.capabilities.tools is None:
                raise HTTPException(502, "MCP 服务未声明工具调用能力。")
            tools, cursors, cursor = [], set(), None
            for _ in range(10):
                page = await session.list_tools(cursor=cursor)
                if len(page.model_dump_json()) > 1024 * 1024:
                    raise HTTPException(502, "MCP 工具清单超过 1 MB，请缩小服务暴露范围。")
                tools.extend(item.model_dump(mode="json", by_alias=True, exclude_none=True) for item in page.tools)
                if len(tools) > MAX_TOOLS:
                    raise HTTPException(502, "MCP 工具超过 200 个，请缩小服务暴露范围。")
                cursor = page.nextCursor
                if not cursor:
                    break
                if cursor in cursors or len(cursor) > 2000:
                    raise HTTPException(502, "MCP 工具分页不正确。")
                cursors.add(cursor)
            else:
                raise HTTPException(502, "MCP 工具分页过多。")
            names = [item["name"] for item in tools]
            if any(not name.strip() or len(name) > 200 or any(ord(char) < 32 for char in name) for name in names):
                raise HTTPException(502, "MCP 工具名称不正确。")
            if len(names) != len(set(names)):
                raise HTTPException(502, "MCP 服务返回了重复的工具名称。")
            if tool is None:
                return {"server_info": initialized.serverInfo.model_dump(
                    mode="json", by_alias=True, exclude_none=True), "tools": tools,
                    "instructions": str(initialized.instructions or "")[:3000]}
            if tool not in names:
                raise HTTPException(404, "该工具不在当前 MCP 服务的工具列表中。")
            result = await session.call_tool(tool, arguments=arguments or {})
            value = result.model_dump(mode="json", by_alias=True, exclude_none=True)
            encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
            if len(encoded) > 16000:
                return {"isError": bool(value.get("isError")), "truncated": True,
                        "content": [{"type": "text", "text": encoded[:15000]}]}
            return value


def exchange(server: dict, tool: str | None = None, arguments: dict | None = None) -> dict:
    """Run SDK sessions in a worker thread, never in an application's event loop."""
    try:
        return asyncio.run(_exchange(server, tool, arguments))
    except HTTPException:
        raise
    except (Exception, BaseExceptionGroup):
        raise HTTPException(503, "无法连接 MCP 服务，请检查程序是否安装、地址、凭证和服务状态。") from None
