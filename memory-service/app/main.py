"""HTTP API for the local DeskAura memory provider."""
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .schemas import ConversationIn, InteractionIn, RelationshipUpdate
from .store import MemoryStore
from .memu_provider import MemoryConfig, MemURegistry

app = FastAPI(title="DeskAura Memory Service", version="0.1.0")


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    # Never echo rejected API keys or conversation content in validation errors.
    return JSONResponse(status_code=422, content={"detail": "记忆配置或输入格式不符合要求，请检查字段。"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://localhost:5173",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)
store = MemoryStore()
_registry: MemURegistry | None = None


def registry() -> MemURegistry:
    global _registry
    if _registry is None or _registry.archive is not store:
        _registry = MemURegistry(store)
    return _registry


def request_role(request: Request, fallback: str = "default") -> str:
    role = (request.headers.get("X-DeskAura-Role") or request.query_params.get("role_id") or fallback).strip()
    if not role or len(role) > 128 or any(ord(character) < 32 for character in role):
        raise HTTPException(422, "角色标识无效")
    return role

@app.get("/health")
def health() -> dict[str, str]:
    """Expose a lightweight container health check."""
    return {"status": "ok"}

@app.delete('/api/memory/sessions/{session_id}')
def delete_session(session_id: str, request: Request):
    registry().delete_session(request_role(request), session_id)
    return {'ok': True}

@app.post("/api/memory/conversations")
async def add_conversation(payload: ConversationIn, request: Request):
    """Persist high-confidence memories extracted from a conversation."""
    role = request_role(request, payload.role_id)
    return await registry().add_conversation(role, payload.model_copy(update={"role_id": role}))

@app.get("/api/memory/search")
async def search(query: str, request: Request, top_k: int = Query(default=8, ge=1, le=20)):
    """Find memories relevant to a query."""
    return await registry().search(request_role(request), query, top_k)

@app.get("/api/memory/categories")
def categories(request: Request):
    """Get category totals."""
    return registry().archive_for(request_role(request)).categories()

@app.get("/api/memory/status")
def status(request: Request):
    """Get current memory and relationship status."""
    role = request_role(request)
    return {**registry().archive_for(role).status(), "provider": registry().provider_info(role)}

@app.get("/api/memory/provider")
def provider(request: Request):
    """Return provider selection and capability without exposing API keys."""
    return registry().provider_info(request_role(request))

@app.post("/api/memory/relationship")
def update_relationship(payload: RelationshipUpdate, request: Request):
    """Apply an auditable relationship change."""
    return registry().archive_for(request_role(request, payload.role_id)).update_relationship(payload.delta, payload.reason)

@app.post("/api/memory/interaction")
def record_interaction(payload: InteractionIn, request: Request):
    """Apply the configured relationship interaction rules."""
    return registry().archive_for(request_role(request, payload.role_id)).record_interaction(payload.message, payload.user_emotion)

@app.get("/api/memory/proactive")
def proactive_messages(request: Request):
    """Return any special-date or reunion prompts for the desktop client."""
    return {"messages": registry().archive_for(request_role(request)).proactive_messages()}


@app.get("/api/memory/config")
def get_config(request: Request):
    return registry().get_config(request_role(request))


@app.put("/api/memory/config")
def save_config(payload: MemoryConfig, request: Request):
    try:
        return registry().save_config(request_role(request), payload)
    except ValueError:
        raise HTTPException(422, "Embedding 地址需要有效的 HTTP(S) 根地址，不能包含账号或密码") from None


@app.delete("/api/memory/config/key")
def clear_key(request: Request):
    return registry().clear_key(request_role(request))


@app.post("/api/memory/test")
async def test_config(request: Request):
    return await registry().test(request_role(request))


@app.delete("/api/memory/roles/{role_id}")
def delete_role(role_id: str):
    try:
        return registry().delete_role(role_id)
    except (ValueError, RuntimeError):
        raise HTTPException(409, "角色记忆删除失败，请重试") from None
