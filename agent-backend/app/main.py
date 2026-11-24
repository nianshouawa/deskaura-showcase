"""Local-only Agent API for DeskAura."""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import Field

from .graph import CompanionGraph
from .schemas import ChatRequest, ChatResponse, InteractionState
from .schemas import SpeechRequest
from .speech import generate_speech, speech_status
from .config import ConfigStore, ModelSettings, CURRENT_ROLE, normalized_role, role_scope
from .roles import RoleStore
from .persona import PersonaError, store_for
from pydantic import BaseModel
from .recognition import transcribe, recognition_status
from .chat_capabilities import fetch_chat_capabilities, validate_chat_attachments
from .connectivity import ConnectivityProofs
from .tools_module import tools_status, test_tools
from .mcp_routes import build_mcp_router
from . import vision
import asyncio
import json
import httpx
from collections import defaultdict
from pathlib import Path

app = FastAPI(title="DeskAura Agent", version="0.1.0")
agent = CompanionGraph()
config_store = ConfigStore()
app.include_router(build_mcp_router(lambda: config_store))
role_store = RoleStore(config_store)
session_locks = defaultdict(asyncio.Lock)
connectivity = ConnectivityProofs()
diagnostic_locks = defaultdict(asyncio.Lock)


@app.middleware("http")
async def role_context(request: Request, call_next):
    try:
        role_id = normalized_role(request.headers.get("X-DeskAura-Role") or
                                  request.query_params.get("role_id") or config_store.active_role())
    except HTTPException as error:
        return JSONResponse(status_code=error.status_code, content={"detail": error.detail})
    token = CURRENT_ROLE.set(role_id)
    try:
        return await call_next(request)
    finally:
        CURRENT_ROLE.reset(token)

@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    # Pydantic embeds the rejected input in errors: never echo audio, images or keys.
    fields = ['.'.join(str(part) for part in item['loc'] if part != 'body') for item in error.errors()[:4]]
    return JSONResponse(status_code=422, content={'detail': '输入格式不符合要求，请检查：' + '、'.join(fields)})


class BoundedChatBody:
    """Bound raw multipart-free JSON before the decoder allocates image payloads."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('path') not in {'/api/chat/send', '/api/chat/stream'}:
            return await self.app(scope, receive, send)
        maximum = 18 * 1024 * 1024
        parts, length = [], 0
        while True:
            part = await receive()
            if part['type'] == 'http.disconnect':
                return
            length += len(part.get('body', b''))
            if length > maximum:
                return await JSONResponse(status_code=413, content={'detail': '本轮附件数据过大，请减少文件或压缩图片。'})(scope, receive, send)
            parts.append(part)
            if not part.get('more_body', False):
                break
        index = 0
        async def replay():
            nonlocal index
            if index < len(parts):
                item = parts[index]
                index += 1
                return item
            return await receive()
        await self.app(scope, replay, send)


app.add_middleware(BoundedChatBody)
# Keep CORS outermost so even an early size rejection remains readable by WebView.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://localhost:5173", "http://tauri.localhost",
                   "https://tauri.localhost", "tauri://localhost"],
    allow_methods=["*"], allow_headers=["*"], expose_headers=['X-DeskAura-Verification'],
)

class SessionTitle(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class RoleMetadata(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    model_path: str = Field(default="", max_length=2000)
    description: str = Field(default="", max_length=2000)


@app.post("/api/roles/{role_id}")
def save_role(role_id: str, payload: RoleMetadata):
    return role_store.upsert(role_id, payload.model_dump())


@app.post("/api/roles/{role_id}/activate")
def activate_role(role_id: str):
    if not role_store.metadata(role_id):
        raise HTTPException(404, "请先在主页创建角色记录")
    config_store.activate(role_id)
    return {"ok": True, "role_id": role_id}


@app.get("/api/roles/{role_id}/export")
def export_role(role_id: str):
    with role_scope(normalized_role(role_id)):
        return role_store.export(role_id)

@app.post("/api/roles/{role_id}/import")
async def import_role(role_id: str, request: Request):
    try:
        snapshot = await request.json()
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(422, "角色配置文件不是有效 JSON") from None
    with role_scope(normalized_role(role_id)):
        return role_store.import_config(role_id, snapshot)


@app.delete("/api/roles/{role_id}")
async def delete_role(role_id: str):
    # Close the memory worker's SQLite handles before removing the owned role
    # directory (Windows refuses to remove an open database).
    try:
        await agent.memory.delete_role(role_id)
    except Exception:
        raise HTTPException(503, "记忆模块未能释放角色数据，请恢复模块后重试删除") from None
    for session in agent.sessions.list(role_id):
        agent.files.discard(session["id"])
    agent.sessions.delete_role(role_id)
    role_store.delete(role_id)
    return {"ok": True}


@app.get("/api/persona/status")
def persona_status():
    return store_for(config_store).get(normalized_role())["status"]


@app.post("/api/persona/test")
async def test_persona():
    return await store_for(config_store).test(normalized_role())


@app.post("/api/persona/import")
async def import_persona(request: Request, filename: str = ""):
    maximum = 10 * 1024 * 1024
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > maximum:
            raise HTTPException(413, "文档不能超过 10 MB")
    try:
        return store_for(config_store).import_document(normalized_role(), filename, bytes(data))
    except PersonaError as error:
        raise HTTPException(422, str(error)) from None


@app.get("/api/local/sandbox")
def sandbox_status():
    return {"available": False,
            "file_access_modes": ["read_only", "workspace_write", "full_access"],
            "detail": "文件工具实际执行只读或工作空间边界；命令、代码和 MCP 需要完全访问权限。"}


@app.post("/api/local/directory")
async def validate_directory(request: Request):
    value = await request.json()
    text = str(value.get("path", "")).strip()
    if not text:
        raise HTTPException(422, "请输入或选择需要授权的具体文件夹。")
    candidate = Path(text)
    try:
        resolved = candidate.resolve(strict=True)
        if (not resolved.is_dir() or resolved == Path(resolved.anchor) or
                candidate.is_symlink() or getattr(candidate, "is_junction", lambda: False)()):
            raise ValueError()
    except (OSError, ValueError):
        raise HTTPException(422, "请选择现有的具体文件夹，不能使用磁盘根目录或链接。") from None
    return {"path": str(resolved)}

@app.post('/api/interaction/offended')
def set_interaction_offended(payload: InteractionState):
    """Persist the offense interaction state triggered by body clicks."""
    return {'offended': config_store.set_offended(payload.offended, payload.role_id)}

@app.get('/api/interaction/offended')
def get_interaction_offended(role_id: str | None = None):
    role_id = normalized_role(role_id)
    return {'offended': config_store.offended(role_id), 'role_id': role_id}

@app.get('/api/chat/sessions')
def sessions(role_id: str | None = None):
    return {'sessions': agent.sessions.list(normalized_role(role_id))}

@app.post('/api/chat/sessions')
def new_session(role_id: str | None = None):
    role_id = normalized_role(role_id)
    config_store.set_offended(False, role_id)
    return agent.sessions.create(role_id)

@app.get('/api/chat/sessions/{session_id}')
def session_history(session_id: str):
    ensure_session_role(session_id)
    return {'messages': agent.sessions.history(session_id), 'file_approval': agent.files.pending(session_id)}

def ensure_session_role(session_id: str) -> None:
    if not agent.sessions.belongs(session_id, normalized_role()):
        raise HTTPException(403, "此对话不属于当前角色")

@app.patch('/api/chat/sessions/{session_id}')
def rename_session(session_id: str, payload: SessionTitle):
    ensure_session_role(session_id)
    if not agent.sessions.rename(session_id, payload.title):
        raise HTTPException(404, '对话不存在。')
    return {'ok': True}

@app.delete('/api/chat/sessions/{session_id}')
async def delete_session(session_id: str):
    ensure_session_role(session_id)
    async with session_locks[session_id]:
        try:
            await agent.memory.delete_session(session_id)
        except Exception:
            raise HTTPException(503, '记忆服务不可用，未删除；请稍后重试，避免残留记忆。') from None
        agent.sessions.delete(session_id)
        agent.files.discard(session_id)
    return {'ok': True}

@app.delete('/api/settings/asr/key')
def clear_asr_key():
    connectivity.revoke('recognition')
    return config_store.clear_asr_key()

@app.delete('/api/settings/motion/key')
def clear_motion_key():
    """Remove the optional motion-provider key from the OS credential store."""
    return config_store.clear_motion_key()

@app.get('/api/settings/motion')
def get_motion_settings():
    cfg = config_store.motion_api_config()
    return {
        "provider": cfg["provider"],
        "base_url": cfg["base_url"],
        "model": cfg["model"],
        "has_api_key": bool(cfg["api_key"]),
        "api_key_masked": config_store.get().get("motion_api_key_masked", ""),
    }

@app.post('/api/audio/transcribe')
async def recognize(request: Request):
    signature = connectivity.signature('recognition', config_store)
    audio = bytearray()
    async for chunk in request.stream():
        audio.extend(chunk)
        if len(audio) > 8 * 1024 * 1024:
            raise HTTPException(413, '录音不能超过 8 MB。')
    try:
        result = await transcribe(bytes(audio), config_store)
    except Exception:
        connectivity.fail('recognition', signature)
        raise
    if signature == connectivity.signature('recognition', config_store):
        result['verification_id'] = connectivity.issue('recognition', signature)
    return result

class FileDecision(BaseModel):
    session_id: str = Field(max_length=128)
    approve: bool

@app.post('/api/files/approval/{token}')
async def file_decision(token: str, payload: FileDecision):
    ensure_session_role(payload.session_id)
    async with session_locks[payload.session_id]:
        try:
            # Process deadlines must not block ASR, interruption or health requests.
            result = await asyncio.to_thread(agent.files.decide, token, payload.session_id, payload.approve)
        except (OSError, UnicodeError):
            raise HTTPException(422, '本地操作失败，请检查文件权限、运行时及工作目录。') from None
        try:
            result = await agent.summarize_tool_result(payload.session_id, result)
        except Exception:
            result.pop("_continuation", None)
            result = {**result, "text": result["text"] + "\n当前步骤已处理，但后续任务未能继续，请检查连接后重新请求。"}
        agent.sessions.append(payload.session_id, 'assistant', result['text'])
        return result

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


class MotionDurationRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)


@app.post('/api/motion/duration')
async def predict_motion_duration(payload: MotionDurationRequest):
    """Motion-service fallback only; does not create turns, memory or tools."""
    signature = connectivity.signature('chat', config_store)
    if not config_store.get()['ready']:
        raise HTTPException(409, '自动时长需要已连接的对话模型，或改用手动时长')
    try:
        duration = await agent.llm.predict_motion_duration(payload.prompt)
        if signature != connectivity.signature('chat', config_store):
            raise HTTPException(409, '对话配置已改变，请重试动作生成')
        return {'duration': duration, 'duration_source': 'conversation_model'}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, '动作时长预测失败，请检查对话模型配置，或改用手动时长') from None

@app.post('/api/audio/speech')
async def speech(payload: SpeechRequest):
    return await verified_speech(payload)

async def verified_speech(payload, *, preview=False):
    signature = connectivity.signature('speech', config_store)
    # Unsaved previews must never verify the different, saved configuration.
    matches = True
    if preview:
        saved = config_store.audio_config()
        matches = all(value == saved.get(key) for key, value in payload.model_dump().items() if key.startswith('audio_') and key != 'audio_api_key')
        matches = matches and (not payload.audio_api_key or payload.audio_api_key.strip() == saved['api_key'])
    try:
        response = await generate_speech(payload, config_store, override=payload if preview else None, preview=preview)
    except Exception:
        if matches:
            connectivity.fail('speech', signature)
        raise
    if matches and signature == connectivity.signature('speech', config_store):
        response.headers['X-DeskAura-Verification'] = connectivity.issue('speech', signature)
    return response

class SpeechPreviewRequest(ModelSettings):
    text: str = Field(min_length=1, max_length=4000)

@app.post('/api/audio/preview')
async def speech_preview(payload: SpeechPreviewRequest):
    return await verified_speech(payload, preview=True)

class VerificationReceipt(BaseModel):
    token: str = Field(min_length=16, max_length=100)
    success: bool


@app.post('/api/connectivity/{kind}/test')
async def active_test(kind: str):
    """Explicit short provider tests, never chat history, memory or microphone input."""
    if kind not in {'chat', 'recognition'}:
        raise HTTPException(404, '未知检测类型')
    lock = diagnostic_locks[(normalized_role(), kind)]
    if lock.locked():
        raise HTTPException(409, '检测中，请稍候')
    async with lock:
        signature = connectivity.signature(kind, config_store)
        try:
            if kind == 'recognition':
                fixture = Path(__file__).parent / 'assets' / 'connectivity.wav'
                result = await transcribe(fixture.read_bytes(), config_store)
            else:
                if not config_store.get().get("brain_enabled", True):
                    raise HTTPException(409, "大脑模块已停用")
                if not config_store.get()['ready']:
                    raise HTTPException(409, '缺少对话配置')
                reply, demo = await agent.llm.respond('连接检测，请仅回复：连接正常。不要请求动作或工具。', '', {}, [])
                if demo or not reply.get('text', '').strip():
                    raise HTTPException(502, '模型未返回有效回复')
                result = {'text': reply['text']}
            if signature != connectivity.signature(kind, config_store):
                raise HTTPException(409, '配置已改变，请重新检测')
            return {**result, 'verification_id': connectivity.issue(kind, signature)}
        except HTTPException:
            connectivity.fail(kind, signature, '异常')
            raise
        except Exception:
            connectivity.fail(kind, signature, '异常')
            raise HTTPException(502, '检测失败，请检查地址、模型与权限') from None

@app.post('/api/connectivity/receipt')
def verification_receipt(payload: VerificationReceipt):
    return {'accepted': connectivity.confirm(payload.token, payload.success, config_store)}

@app.post('/api/connectivity/{kind}/failure')
def client_failure(kind: str):
    if kind not in {'chat', 'recognition', 'speech', 'vision'}:
        raise HTTPException(404, '未知检测类型')
    connectivity.fail(kind, connectivity.signature(kind, config_store), '客户端链路失败 · 请查看对应分区提示并重新检测')
    return {'ok': True}

def audio_chain_status(kind, value):
    receipt = connectivity.status(kind, config_store)
    verified = bool(value['enabled'] and value['configured'] and value['provider_verified'] and receipt['client_verified'])
    detail = receipt['client_detail'] if value['enabled'] and value['configured'] and (value['provider_verified'] or receipt['client_detail'].startswith('客户端')) else value['detail']
    return {**value, **receipt, 'verified': verified, 'detail': detail}

@app.get('/api/audio/status')
def audio_status():
    return audio_chain_status('speech', speech_status(config_store))

@app.get('/api/audio/speech/status')
def synthesis_status():
    return audio_chain_status('speech', speech_status(config_store))

@app.get('/api/audio/recognition/status')
def transcription_status():
    return audio_chain_status('recognition', recognition_status(config_store))

@app.get('/api/chat/status')
def conversation_status():
    cfg = config_store.get()
    configured = bool(cfg['ready'] and cfg.get("brain_enabled", True))
    result = connectivity.status('chat', config_store)
    return {**result, 'enabled': cfg.get("brain_enabled", True), 'configured': configured, 'verified': configured and result['client_verified'],
            'detail': result['client_detail'] if configured else '缺少对话模型配置 · 演示不算验证'}


MODULE_FIELDS = {
    "brain": ("brain_enabled", "brain_tag"),
    "persona": ("persona_enabled", "persona_tag"),
    "memory": ("memory_enabled", "memory_tag"),
    "tools": ("tools_enabled", "tools_tag"),
    "vision": ("vision_enabled", "vision_tag"),
    "hearing": ("asr_enabled", "hearing_tag"),
    "voice": ("audio_enabled", "voice_tag"),
    "motion": ("motion_enabled", "motion_tag"),
}


@app.get("/api/modules/{kind}/status")
async def module_status(kind: str):
    if kind not in MODULE_FIELDS:
        raise HTTPException(404, "未知角色模块")
    cfg = config_store.get()
    enabled_field, tag_field = MODULE_FIELDS[kind]
    base = {"enabled": bool(cfg.get(enabled_field)), "tag": cfg.get(tag_field, "")}
    if not base["enabled"]:
        return {**base, "verified": False, "detail": "已停用"}
    try:
        if kind == "brain":
            status = conversation_status()
        elif kind == "hearing":
            status = transcription_status()
        elif kind == "voice":
            status = synthesis_status()
        elif kind == "persona":
            status = persona_status()
        elif kind == "memory":
            value = await agent.memory.relationship()
            status = value.get("provider", {})
        elif kind == "tools":
            status = tools_status(config_store)
        elif kind == "vision":
            status = vision.status(config_store)
            receipt = connectivity.status("vision", config_store)
            status = {**status, **receipt, "provider_verified": status["verified"],
                      "verified": status["verified"] and receipt["client_verified"]}
        else:
            async with httpx.AsyncClient(timeout=12, trust_env=False,
                                         headers={"X-DeskAura-Role": normalized_role()}) as client:
                response = await client.get(f"{agent.motion.base_url}/api/motion/status")
                response.raise_for_status()
                status = response.json()
        return {**status, **base, "verified": status.get("verified") is True,
                "detail": status.get("detail") or ("正常" if status.get("verified") is True else "尚未检测")}
    except Exception:
        return {**base, "verified": False, "detail": "模块连接异常"}


@app.post("/api/modules/{kind}/test")
async def module_test(kind: str, request: Request):
    if kind not in MODULE_FIELDS:
        raise HTTPException(404, "未知角色模块")
    if not config_store.get().get(MODULE_FIELDS[kind][0]):
        raise HTTPException(409, "此模块已停用")
    if kind == "persona":
        await test_persona()
    elif kind == "memory":
        async with httpx.AsyncClient(timeout=180, trust_env=False,
                                     headers={"X-DeskAura-Role": normalized_role()}) as client:
            try:
                response = await client.post(f"{agent.memory.base_url}/api/memory/test")
                response.raise_for_status()
            except httpx.HTTPError:
                raise HTTPException(503, "记忆模块检测失败，请检查配置与连接") from None
    elif kind == "tools":
        await test_tools(config_store)
    elif kind == "vision":
        try:
            payload = await request.json()
            faces, confidence = int(payload["faces"]), float(payload["confidence"])
            if faces < 1 or not 0 <= confidence <= 1:
                raise ValueError()
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            raise HTTPException(422, "请从设置页打开摄像头完成人脸检测") from None
        if "camera_id" in payload and payload["camera_id"] != config_store.get().get("vision_camera_id", ""):
            raise HTTPException(409, "摄像头配置已改变，请重新检测")
        fingerprint = connectivity.signature("vision", config_store)
        try:
            result = await vision.record_detection(config_store, faces, confidence)
            if fingerprint != connectivity.signature("vision", config_store):
                raise HTTPException(409, "视觉配置已改变")
            return {**result, "verification_id": connectivity.issue("vision", fingerprint)}
        except Exception:
            connectivity.fail("vision", fingerprint, "异常")
            raise
    else:
        # Audio/FBX checks finish in the desktop so parser/playback failures
        # cannot hide behind a successful provider HTTP response.
        raise HTTPException(409, "请通过角色模块的检测按钮完成客户端验证")
    return await module_status(kind)

@app.get('/api/chat/capabilities')
async def chat_inputs():
    return await fetch_chat_capabilities(config_store)

@app.delete('/api/settings/audio/key')
def clear_audio_key():
    connectivity.revoke('speech')
    return config_store.clear_audio_key()

@app.post("/api/chat/send", response_model=ChatResponse)
async def send(payload: ChatRequest):
    CURRENT_ROLE.set(normalized_role(payload.role_id))
    ensure_session_role(payload.session_id)
    if payload.attachments:
        validate_chat_attachments(payload.attachments, config_store.get(), await fetch_chat_capabilities(config_store))
    signature = connectivity.signature('chat', config_store)
    try:
        async with session_locks[payload.session_id]:
            if agent.files.pending(payload.session_id):
                raise HTTPException(409, "请先确认或取消当前等待批准的操作。")
            state = await agent.invoke(payload.message, payload.session_id, payload.user_emotion,
                                       [a.model_dump() for a in payload.attachments], payload.role_id)
    except Exception:
        if not agent.files.pending(payload.session_id):
            connectivity.fail('chat', signature)
        raise
    return _chat_result(state, signature)


def _chat_result(state, signature):
    token = None
    if not state['demo_mode'] and state['response']['text'].strip() and signature == connectivity.signature('chat', config_store):
        token = connectivity.issue('chat', signature)
    else:
        connectivity.fail('chat', signature, '演示或空回复不算模型验证成功')
    return {
        "text": state["response"]["text"],
        "emotion": state["response"]["emotion"],
        "motion": state["motion"],
        "demo_mode": state["demo_mode"],
        "system_action": state["response"].get("system_action"),
        "file_approval": state['response'].get('file_approval'),
        "gaze_target": state['response'].get('gaze_target', 'face'),
        "capture_action": state['response'].get('capture_action'),
        "media_request": state['response'].get('media_request'),
        "verification_id": token,
    }


@app.post('/api/chat/stream')
async def stream_chat(payload: ChatRequest, request: Request):
    """SSE/NDJSON text plus one final response; disconnect cancels upstream."""
    CURRENT_ROLE.set(normalized_role(payload.role_id))
    ensure_session_role(payload.session_id)
    if payload.attachments:
        validate_chat_attachments(payload.attachments, config_store.get(), await fetch_chat_capabilities(config_store))
    signature = connectivity.signature('chat', config_store)
    sse = 'text/event-stream' in request.headers.get('accept', '')

    def frame(value):
        if not sse:
            return json.dumps(value, ensure_ascii=False) + '\n'
        event = 'reply' if value['type'] == 'done' else value['type']
        data = value['reply'] if value['type'] == 'done' else {key: item for key, item in value.items() if key != 'type'}
        return 'event: ' + event + '\ndata: ' + json.dumps(data, ensure_ascii=False) + '\n\n'

    async def events():
        try:
            async with session_locks[payload.session_id]:
                if agent.files.pending(payload.session_id):
                    raise HTTPException(409, "请先确认或取消当前等待批准的操作。")
                async for event in agent.stream(payload.message, payload.session_id, payload.user_emotion,
                                                [a.model_dump() for a in payload.attachments], payload.role_id):
                    if event['type'] == 'state':
                        value = {'type': 'done', 'reply': ChatResponse.model_validate(_chat_result(event['state'], signature)).model_dump()}
                    else:
                        value = event
                    yield frame(value)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if not agent.files.pending(payload.session_id):
                connectivity.fail('chat', signature)
            detail = error.detail if isinstance(error, HTTPException) else '回复中断，请检查网络、模型或服务状态后重试。'
            yield frame({'type': 'error', 'detail': detail})

    return StreamingResponse(events(), media_type='text/event-stream' if sse else 'application/x-ndjson', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.get("/api/memory/status")
async def memory_status():
    try:
        return await agent.memory.relationship()
    except Exception:
        return {"memory_count": 0, "relationship_score": 10, "relationship_level": 1}

@app.get("/api/proactive")
async def proactive_messages():
    """Return special-date and reunion messages from long-term memory."""
    try:
        return {"messages": await agent.memory.proactive_messages()}
    except Exception:
        return {"messages": []}

@app.get("/api/settings/model")
def get_model_settings():
    """Return model settings without exposing the API key."""
    return {**config_store.get(), 'audio_revision': connectivity.revisions.get(connectivity._record_key('speech'), 0)}

@app.put("/api/settings/model")
def update_model_settings(payload: ModelSettings):
    """Persist model settings and optionally replace the API key."""
    previous = {kind: connectivity.signature(kind, config_store) for kind in ('chat', 'recognition', 'speech', 'vision')}
    try:
        return config_store.save(payload)
    finally:
        for kind, signature in previous.items():
            if signature != connectivity.signature(kind, config_store):
                connectivity.revoke(kind)

@app.put('/api/settings/motion')
def update_motion_settings(payload: ModelSettings):
    """Save motion provider metadata and keep the API key in Credential Manager."""
    # Reuse the single settings store so old installations retain every field.
    return config_store.save(payload)

@app.delete("/api/settings/model/key")
def clear_model_key():
    """Remove the API key from Windows Credential Manager."""
    connectivity.revoke('chat')
    return config_store.clear_key()
