"""MCP settings endpoints; the parent app supplies its current role store."""
from collections.abc import Callable

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .config import ModelSettings
from .mcp_configuration import stored_configuration
from .mcp_services import refresh_services, services_status, set_tool_enabled


class ConfigurationInput(BaseModel):
    config: dict
    reconnect: bool = True


class RefreshInput(BaseModel):
    server: str | None = Field(default=None, min_length=1, max_length=100)


class ToolPreferenceInput(BaseModel):
    server: str = Field(min_length=1, max_length=100)
    tool: str = Field(min_length=1, max_length=200)
    enabled: bool


def build_mcp_router(store_provider: Callable) -> APIRouter:
    router = APIRouter(prefix="/api/tools/mcp")

    @router.get("")
    async def get_services():
        return services_status(store_provider())

    @router.post("/refresh")
    async def refresh(payload: RefreshInput | None = None):
        return await refresh_services(store_provider(), payload.server if payload else None)

    @router.put("/config")
    async def save(payload: ConfigurationInput):
        store = store_provider()
        store.save(ModelSettings(tools_mcp_config=payload.config))
        return await refresh_services(store) if payload.reconnect else services_status(store)

    @router.put("/tool")
    async def tool_preference(payload: ToolPreferenceInput):
        return set_tool_enabled(store_provider(), payload.server, payload.tool, payload.enabled)

    @router.get("/export")
    async def export():
        return stored_configuration(store_provider(), private=True)

    return router
