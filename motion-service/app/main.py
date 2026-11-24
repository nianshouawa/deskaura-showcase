"""Motion API with explicit online, offline, and hybrid routing policies."""
import json
import os
import time
from pathlib import Path
from uuid import uuid4

import httpx

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .ollama import OllamaMotionPlanner
from .hymotion import HYMotionProvider, HYMotionError, shared_duration_settings
from .tencent_motion import TencentMotionError, TencentMotionProvider
from .emotions import EMOTIONS, EMOTION_IDS
from .validation import validate_clip
from .connection import inspect_worker, worker_address
from .role_config import CURRENT_ROLE, normalized_role, active_role, read_config
from collections.abc import MutableMapping

app = FastAPI(title="DeskAura Motion Service", version="0.1.0")


@app.middleware("http")
async def scope_motion_role(request, call_next):
    try:
        role_id = normalized_role(request.headers.get("X-DeskAura-Role") or active_role())
    except HTTPException as error:
        return JSONResponse({"detail": error.detail}, status_code=error.status_code)
    token = CURRENT_ROLE.set(role_id)
    try:
        return await call_next(request)
    finally:
        CURRENT_ROLE.reset(token)
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
tasks: dict[str, dict] = {}
motion_results: dict[str, dict] = {}
result_roles: dict[str, str] = {}
result_times: dict[str, float] = {}
MAX_RESULT_ITEMS = 32
RESULT_LIFETIME_SECONDS = 900


def _expire_result(ident: str) -> None:
    for mapping in (tasks, motion_results, result_roles, result_times, fbx_results, pending_cloud_checks):
        mapping.pop(ident, None)


def _remember_result(ident: str) -> None:
    now = time.monotonic()
    result_times[ident] = now
    for old, created in list(result_times.items()):
        if old != ident and now - created > RESULT_LIFETIME_SECONDS:
            _expire_result(old)
    while len(result_times) > MAX_RESULT_ITEMS:
        _expire_result(next(iter(result_times)))
# Tencent's online provider returns an FBX download. Keep the downloaded bytes
# behind our own short-lived result endpoint so the desktop never has to know
# provider URLs or bearer credentials.
fbx_results: dict[str, dict] = {}
CLOUD_LIBRARY_DIR = Path(os.getenv("DESKAURA_MOTION_LIBRARY", str(Path(__file__).resolve().parents[1] / "data" / "cloud_motions")))

def _cloud_library_match(prompt: str, relaxed: bool = False) -> dict | None:
    """Match intent, not exact clip names; always return a validated archive."""
    text = prompt.lower()
    terms = {
        "cloud_think": ("think", "thought", "chin", "ponder", "consider", "contemplat", "思考", "想一想", "琢磨", "沉思"),
        "cloud_wave": ("wave", "greet", "hello", "goodbye", "挥手", "招手", "打招呼", "告别", "欢迎"),
        "cloud_nod": ("nod", "agree", "affirm", "点头", "赞同", "同意", "肯定"),
        "cloud_shrug": ("shrug", "helpless", "confus", "耸肩", "无奈", "不清楚"),
        "cloud_point": ("point", "indicat", "指向", "指一指", "指着", "方向"),
        "cloud_clap": ("clap", "applaud", "applause", "拍手", "鼓掌", "赞赏"),
        "cloud_bow": ("bow", "respectful greeting", "thank you gesture", "鞠躬", "弯腰致谢", "行礼", "致歉"),
        "cloud_celebrate": ("celebrat", "cheer", "victory", "庆祝", "欢呼", "胜利", "好耶"),
    }
    for ident, words in terms.items():
        if any(word in text for word in words):
            clip = _archived(ident)
            if clip:
                return clip
    if relaxed:
        emotions = {
            'sad': ('sad', 'sorrow', 'cry', '悲伤', '难过', '哭', '伤心'),
            'happy': ('happy', 'joy', 'excited', '开心', '高兴', '兴奋'),
            'tired': ('tired', 'exhaust', 'sleep', '疲惫', '疲倦', '困'),
            'angry': ('angry', 'anger', '生气', '愤怒'),
            'affectionate': ('affection', 'cute', '撒娇', '可爱'),
            'shy': ('shy', 'bashful', '害羞'),
            'nervous': ('nervous', 'anxious', '紧张', '焦虑'),
            'curious': ('curious', '好奇'),
            'confident': ('confiden', 'proud', '自信'),
        }
        for emotion, words in emotions.items():
            if any(word in text for word in words):
                clip = _archived(EMOTION_IDS[emotion])
                if clip:
                    return clip
    return None


def _archived(ident: str) -> dict | None:
    """Load one archived cloud clip, or None when it was never generated."""
    path = CLOUD_LIBRARY_DIR / f"{ident}.json"
    try:
        return validate_clip(json.loads(path.read_text(encoding="utf-8"))) if path.exists() else None
    except (ValueError, TypeError, OSError):
        return None


def _archived_reply(data: dict, duration: float | None = None) -> dict:
    """Serve a validated clip through the same result endpoint the client uses."""
    task_id = str(uuid4())
    result_roles[task_id] = CURRENT_ROLE.get()
    motion_results[task_id] = {k: data[k] for k in ("fps", "poses", "trans", "duration") if k in data}
    tasks[task_id] = {"task_id": task_id, "status": "completed",
            "motion": {"id": data["id"], "kind": "hymotion",
                       "url": f"/api/motion/result/{task_id}", "duration": duration or data["duration"],
                       "source_duration": data["duration"], "duration_source": 'local_selection' if duration else 'archive',
                       "role_id": CURRENT_ROLE.get()}}
    _remember_result(task_id)
    return tasks[task_id]


ollama_planner = OllamaMotionPlanner()

class MotionRequest(BaseModel):
    """A textual motion request."""
    prompt: str = Field(min_length=1, max_length=500)
    duration: float | None = Field(default=None, ge=0.5, le=20)
    # Never pass this to the cloud predictor. It controls archived common gestures only.
    local_duration: float | None = Field(default=None, ge=0.5, le=20)
    priority: str = Field(default="low", pattern="^(high|medium|low)$")
    mode: str = Field(default='hybrid', pattern='^(online|offline|hybrid)$')

class _RoleProvider:
    """One adapter per role avoids refresh races between concurrent requests."""
    MAX_ROLES = 64
    STALE_SECONDS = 1800

    def __init__(self, factory):
        object.__setattr__(self, "_factory", factory)
        object.__setattr__(self, "_providers", {})
        object.__setattr__(self, "_last_used", {})

    def _prune(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        providers = object.__getattribute__(self, "_providers")
        last_used = object.__getattribute__(self, "_last_used")
        for role, touched in list(last_used.items()):
            if now - touched >= self.STALE_SECONDS:
                providers.pop(role, None)
                last_used.pop(role, None)
        if len(providers) <= self.MAX_ROLES:
            return
        for role, _ in sorted(last_used.items(), key=lambda item: item[1])[:len(providers) - self.MAX_ROLES]:
            providers.pop(role, None)
            last_used.pop(role, None)

    def _current(self):
        role_id = CURRENT_ROLE.get()
        providers = object.__getattribute__(self, "_providers")
        last_used = object.__getattribute__(self, "_last_used")
        self._prune()
        if role_id not in providers:
            providers[role_id] = object.__getattribute__(self, "_factory")()
        last_used[role_id] = time.monotonic()
        return providers[role_id]
    def __getattr__(self, name):
        return getattr(self._current(), name)
    def __setattr__(self, name, value):
        setattr(self._current(), name, value)
    @property
    def configured(self):
        return self._current().configured


hy_motion = _RoleProvider(HYMotionProvider)
tencent_motion = _RoleProvider(TencentMotionProvider)
PROOF_TTL_SECONDS = 600


class _RoleProofs(MutableMapping):
    """Existing proof operations stay scoped to the request's current role."""
    MAX_ROLES = 64
    STALE_SECONDS = 1200

    def __init__(self):
        self.roles: dict[str, dict] = {}

    def _prune(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        for role, state in list(self.roles.items()):
            touched = state.get("at", 0) if isinstance(state, dict) else 0
            if touched and now - touched >= self.STALE_SECONDS:
                self.roles.pop(role, None)
        if len(self.roles) <= self.MAX_ROLES:
            return
        oldest = sorted(self.roles, key=lambda role: self.roles[role].get("at", 0))
        for role in oldest[:len(self.roles) - self.MAX_ROLES]:
            self.roles.pop(role, None)

    def _current(self):
        self._prune()
        return self.roles.setdefault(CURRENT_ROLE.get(), {})
    def __getitem__(self, key):
        return self._current()[key]
    def __setitem__(self, key, value):
        state = self._current()
        state[key] = value
        state["at"] = time.monotonic()
    def __delitem__(self, key):
        del self._current()[key]
    def __iter__(self):
        return iter(self._current())
    def __len__(self):
        return len(self._current())


motion_connectivity = _RoleProofs()
pending_cloud_checks: dict[str, dict] = {}


def _selected_provider() -> str:
    """Read the provider selection shared with agent-backend.

    Tencent TokenHub returns FBX which the desktop validates and canonicalizes
    to SMPL-H before playback. Keep selection explicit so choosing Tencent can
    never silently fall through to an unrelated HY-Motion Worker.
    """
    value = read_config()
    selected = str(value.get("motion_provider", "")).strip()
    if selected in {"hymotion", "tencent_tokenhub"}:
        return selected
    return "hymotion"


TENCENT_FBX_READY_DETAIL = "腾讯 API 已返回 FBX，等待桌面解析与回读验证"


def _tencent_detail() -> str:
    """Return a stable, non-secret status for the configured Tencent branch."""
    tencent_motion.refresh()
    if not tencent_motion.configured:
        return "腾讯云动作服务未配置 API Key"
    return "尚未验证腾讯动作生成与播放"


def _tencent_api_error(error: Exception) -> str:
    """Keep provider failures actionable without exposing upstream details."""
    if isinstance(error, TencentMotionError):
        return str(error)
    return "腾讯云动作接口请求失败，请检查地址、密钥和额度"


async def _cache_tencent_fbx(result: dict) -> tuple[str, float]:
    """Download and validate one Tencent FBX before exposing it to WebView.

    The API's result URL is deliberately not forwarded to the client. This
    prevents URL query tokens and provider-specific details from entering the
    renderer or logs. A minimum binary/header check catches HTML error pages.
    """
    url = str(result.get("url") or "").strip()
    if not url.startswith(("https://", "http://")):
        raise TencentMotionError("腾讯云未返回有效动作文件地址")
    try:
        async with httpx.AsyncClient(timeout=90, trust_env=False, follow_redirects=True) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                output = bytearray()
                async for chunk in response.aiter_bytes():
                    output.extend(chunk)
                    if len(output) > 64 * 1024 * 1024:
                        raise TencentMotionError("腾讯云动作文件超过 64 MB")
                data = bytes(output)
    except (httpx.HTTPError, OSError):
        raise TencentMotionError("腾讯云动作文件下载失败") from None
    if len(data) < 64:
        raise TencentMotionError("腾讯云动作文件为空或不完整")
    header = data[:256]
    # Binary FBX starts with this signature; ASCII FBX starts with a semicolon.
    if not (header.startswith(b"Kaydara FBX Binary") or b"FBXHeaderExtension" in header or header.startswith(b"; FBX")):
        raise TencentMotionError("腾讯云返回的文件不是有效 FBX")
    ident = str(uuid4())
    duration = float(result.get("duration") or 0)
    fbx_results[ident] = {
        "bytes": data,
        "duration": duration,
        "duration_source": result.get("duration_source", "tencent_native"),
        "provider": "tencent_tokenhub",
        "role_id": CURRENT_ROLE.get(),
        "at": time.monotonic(),
    }
    _remember_result(ident)
    # Every online reply can produce a new asset. Bound its cache to prevent
    # long conversations from gradually exhausting process memory.
    for old_id, old in list(fbx_results.items()):
        if old_id != ident and time.monotonic() - old["at"] > 900:
            _expire_result(old_id)
    while len(fbx_results) > 8 or sum(len(value["bytes"]) for value in fbx_results.values()) > 128 * 1024 * 1024:
        oldest = next((key for key in fbx_results if key != ident), None)
        if oldest is None:
            break
        _expire_result(oldest)
    return ident, duration


def _worker_signature() -> tuple:
    """Bind receipts to a worker configuration, not a browser window or mode."""
    if _selected_provider() == "tencent_tokenhub":
        tencent_motion.refresh()
        # A replaced key must revoke a former successful proof too. The digest
        # remains private to this in-memory signature.
        import hashlib
        digest = hashlib.sha256(tencent_motion.api_key.encode()).hexdigest()
        return (CURRENT_ROLE.get(), "tencent_tokenhub", tencent_motion.configured, tencent_motion.base_url, tencent_motion.model, digest, *shared_duration_settings())
    hy_motion.refresh()
    try:
        url = worker_address(hy_motion.worker_url)
    except ValueError:
        url = hy_motion.worker_url
    return (CURRENT_ROLE.get(), hy_motion.enabled, url, hy_motion.model_path, hy_motion.device, *shared_duration_settings())


def _sync_connectivity() -> tuple:
    signature = _worker_signature()
    now = time.monotonic()
    if motion_connectivity.get('signature') != signature:
        motion_connectivity.clear()
        motion_connectivity.update(signature=signature, provider_verified=False,
            client_verified=False, client_attempted=False, at=0,
            detail='尚未验证在线生成')
        _clear_role_pending()
    elif motion_connectivity.get('at') and now - motion_connectivity['at'] >= PROOF_TTL_SECONDS:
        motion_connectivity.update(provider_verified=False, client_verified=False,
            at=0, detail='验证已过期，请重新检测')
    for ident, pending in list(pending_cloud_checks.items()):
        if (pending.get("role_id", "default") == CURRENT_ROLE.get() and pending['signature'] != signature) or now - pending['at'] >= PROOF_TTL_SECONDS:
            pending_cloud_checks.pop(ident, None)
    return signature


def _fail_connectivity(signature: tuple, detail: str) -> None:
    if signature != _sync_connectivity():
        return
    motion_connectivity.update(provider_verified=False, client_verified=False,
        client_attempted=True, at=0, detail=detail)
    _clear_role_pending()


def _clear_role_pending() -> None:
    for ident, value in list(pending_cloud_checks.items()):
        if value.get("role_id", "default") == CURRENT_ROLE.get():
            pending_cloud_checks.pop(ident, None)


class MotionReceipt(BaseModel):
    result_id: str = Field(min_length=1, max_length=100)
    success: bool = True


@app.post('/api/motion/receipt')
def motion_receipt(payload: MotionReceipt):
    signature = _sync_connectivity()
    pending = pending_cloud_checks.get(payload.result_id)
    if pending and pending.get("role_id", "default") != CURRENT_ROLE.get():
        return {"accepted": False}
    pending = pending_cloud_checks.pop(payload.result_id, None)
    accepted = bool(payload.success and pending and pending['signature'] == signature
        and pending.get('read_back') and time.monotonic() - pending['at'] < PROOF_TTL_SECONDS)
    if accepted:
        motion_connectivity.update(provider_verified=True, client_verified=True,
            client_attempted=True, at=time.monotonic(), detail='正常 · 在线生成与数据回读通过')
    elif pending and pending['signature'] == signature:
        _fail_connectivity(signature, '客户端回读验证失败')
    return {'accepted': accepted}


@app.get('/api/motion/status')
async def motion_status():
    """Read shared evidence and worker readiness; never invoke generation."""
    if _selected_provider() == "tencent_tokenhub":
        signature = _sync_connectivity()
        configured = tencent_motion.configured
        provider_verified = bool(motion_connectivity.get('provider_verified'))
        client_verified = bool(motion_connectivity.get('client_verified'))
        return {
            'configured': configured,
            'verified': bool(configured and provider_verified and client_verified),
            'provider_verified': provider_verified,
            'client_verified': client_verified,
            'client_attempted': bool(motion_connectivity.get('client_attempted')),
            'detail': motion_connectivity.get('detail') if signature == motion_connectivity.get('signature') and provider_verified
                else ("尚未验证腾讯动作生成与播放" if configured else _tencent_detail()),
            'provider': 'tencent_tokenhub',
            'format': 'FBX',
        }
    signature = _sync_connectivity()
    connection = await inspect_worker(hy_motion)
    if signature != _sync_connectivity():
        return {'configured': hy_motion.configured, 'verified': False,
            'provider_verified': False, 'client_verified': False, 'client_attempted': False,
            'detail': '配置已改变，请重新验证'}
    if not connection.get('ready'):
        _fail_connectivity(signature, connection.get('detail') or '云端未就绪')
    verified = bool(hy_motion.configured and connection.get('ready')
        and motion_connectivity.get('provider_verified') and motion_connectivity.get('client_verified'))
    return {'configured': hy_motion.configured, 'verified': verified,
        'provider_verified': bool(motion_connectivity.get('provider_verified')),
        'client_verified': bool(motion_connectivity.get('client_verified')),
        'client_attempted': bool(motion_connectivity.get('client_attempted')),
        'detail': motion_connectivity.get('detail', '尚未验证在线生成')}

@app.get("/health")
def health() -> dict[str, str | bool]:
    if _selected_provider() == "tencent_tokenhub":
        tencent_motion.refresh()
        return {"status": "ok", "provider": "tencent-tokenhub", "cloud_verified": False,
                "configured": tencent_motion.configured, "format": "FBX",
                "ollama_model": ollama_planner.model}
    hy_motion.refresh()
    provider = "hy-motion" if hy_motion.configured else "archived"
    return {"status": "ok", "provider": provider, "cloud_verified": False, "ollama_model": ollama_planner.model}

@app.post("/api/motion/cloud-test")
async def test_cloud_chain():
    """Explicit generation round-trip. Never counts a preset fallback as success."""
    import math
    if _selected_provider() == "tencent_tokenhub":
        signature = _sync_connectivity()
        _fail_connectivity(signature, '正在验证腾讯 API')
        if not tencent_motion.configured:
            detail = "腾讯云动作服务未配置 API Key"
            _fail_connectivity(signature, detail)
            return {"verified": False, "provider_verified": False, "client_verified": False,
                    "detail": detail, "provider": "tencent_tokenhub", "format": "FBX"}
        try:
            duration_mode, seconds = shared_duration_settings()
            result = await tencent_motion.generate(
                "A person gently nods once while standing.",
                seconds if duration_mode == 'manual' else None,
            )
            if result.get('format') != 'fbx' or not str(result.get('url') or '').startswith(('http://', 'https://')):
                raise TencentMotionError("腾讯云返回的动作文件格式无效")
            ident, duration = await _cache_tencent_fbx(result)
            if signature != _sync_connectivity():
                return {"verified": False, "detail": "生成期间配置已改变，请重新验证",
                        "provider": "tencent_tokenhub", "format": "FBX"}
            motion_connectivity.update(
                provider_verified=True, client_verified=False, client_attempted=True,
                at=time.monotonic(), detail=TENCENT_FBX_READY_DETAIL,
            )
            pending_cloud_checks[ident] = {'signature': signature, 'at': time.monotonic(), 'read_back': False, 'role_id': CURRENT_ROLE.get()}
            return {"verified": True, "provider_verified": True, "client_verified": False,
                    "kind": "fbx", "format": "FBX", "duration": duration,
                    "duration_source": result.get("duration_source", "tencent_native"),
                    "result_url": f"/api/motion/fbx/{ident}",
                    "detail": TENCENT_FBX_READY_DETAIL}
        except Exception as error:
            detail = _tencent_api_error(error)
            _fail_connectivity(signature, detail)
            return {"verified": False, "provider_verified": False, "client_verified": False,
                    "detail": detail, "provider": "tencent_tokenhub", "format": "FBX"}
    signature = _sync_connectivity()
    _fail_connectivity(signature, '正在验证在线生成')
    if not hy_motion.configured:
        _fail_connectivity(signature, '云端未配置；已有归档仍可用')
        return {"verified": False, "detail": "云端未配置；已有归档仍可用"}
    try:
        connection = await inspect_worker(hy_motion)
        if not connection.get('ready'):
            _fail_connectivity(signature, connection['detail'])
            return {"verified": False, "detail": connection['detail']}
        # Test the actual saved path, including conversation prediction when
        # the optional native predictor is absent. Health alone is never proof.
        duration_mode, seconds = shared_duration_settings()
        result = await hy_motion.generate("A person gently nods once while standing.", seconds if duration_mode == 'manual' else None)
        frames = result["poses"]
        fps = result["fps"]
        if not isinstance(fps, (int, float)) or fps <= 0:
            raise ValueError("无效帧率")
        if not frames or any(not isinstance(frame, list) or len(frame) < 66 or
            len(frame) % 3 or any(not isinstance(v, (int, float)) or
            not math.isfinite(v) for v in frame) for frame in frames):
            raise ValueError("云端返回无效骨骼数据")
        task_id = str(uuid4())
        if signature != _sync_connectivity():
            return {'verified': False, 'detail': '生成期间配置已改变，请重新验证'}
        motion_results[task_id] = result
        result_roles[task_id] = CURRENT_ROLE.get()
        _remember_result(task_id)
        pending_cloud_checks[task_id] = {'signature': signature, 'at': time.monotonic(), 'read_back': False, 'role_id': CURRENT_ROLE.get()}
        motion_connectivity.update(provider_verified=True, client_verified=False,
            client_attempted=True, at=time.monotonic(), detail='云端生成成功，等待客户端验证数据回读')
        return {"verified": True, "kind": "hymotion", "frames": len(frames),
                "fps": fps, "result_url": f"/api/motion/result/{task_id}",
                "detail": "云端生成成功，等待客户端验证数据回读"}
    except Exception as error:
        detail = error.detail if isinstance(error, HYMotionError) else '在线生成失败，请检查云端模型、隧道和接口配置'
        _fail_connectivity(signature, detail)
        return {"verified": False, "detail": detail}

@app.get("/api/motion/capabilities")
def capabilities():
    """Expose local motion provider readiness and configuration."""
    hy_motion.refresh()
    identifiers = sorted({'cloud_idle', 'cloud_thinking_loop', 'cloud_think', 'cloud_wave', 'cloud_nod',
                          'cloud_bow', 'cloud_clap', 'cloud_celebrate', 'cloud_point', 'cloud_shrug',
                          *('cloud_standby_' + key for key in ('sleep', 'sing', 'sway', 'daydream', 'stretch', 'look_around')),
                          *EMOTION_IDS.values()})
    available = [ident for ident in identifiers if _archived(ident) is not None]
    selected = _selected_provider()
    return {"archived": bool(available), "offline_available": len(available) == len(identifiers),
            "archive_count": len(available), "archive_ids": available,
            "ollama": ollama_planner.base_url, "provider": selected,
            "hy_motion": hy_motion.capabilities(),
            "tencent_tokenhub": tencent_motion.capabilities()}


@app.get('/api/motion/connection')
async def connection_status():
    """Read-only tunnel and model readiness check; never starts generation."""
    if _selected_provider() == "tencent_tokenhub":
        _sync_connectivity()
        return {
            "reachable": bool(motion_connectivity.get('provider_verified')),
            "ready": bool(motion_connectivity.get('provider_verified') and motion_connectivity.get('client_verified')),
            "provider": "tencent_tokenhub",
            "format": "FBX",
            "detail": motion_connectivity.get("detail") or ("尚未验证腾讯动作生成与播放" if tencent_motion.configured else _tencent_detail()),
        }
    return await inspect_worker(hy_motion)


@app.post("/api/motion/reload")
def reload_worker():
    """重新读取设置里的云端地址（设置面板保存后调用）。"""
    _sync_connectivity()
    if _selected_provider() == "tencent_tokenhub":
        tencent_motion.refresh()
        return {"ok": True, "provider": "tencent_tokenhub", "format": "FBX",
                "configured": tencent_motion.configured, "worker_url": hy_motion.worker_url,
                "detail": _tencent_detail()}
    return {"ok": True, "provider": "hymotion", "worker_url": hy_motion.worker_url, "configured": hy_motion.configured}

@app.post("/api/motion/rewrite")
async def rewrite_motion(payload: MotionRequest):
    """Rewrite a prompt locally with Ollama for HY-Motion-compatible wording."""
    return {"prompt": await ollama_planner.rewrite(payload.prompt), "model": ollama_planner.model}

@app.post("/api/motion/generate")
async def generate(payload: MotionRequest):
    """Generate online requests and match offline requests to the local library."""
    selected_provider = _selected_provider()
    use_rewrite = (
        payload.mode in {'online', 'hybrid'}
        and
        payload.priority == "high"
        and os.getenv("OLLAMA_MOTION_REWRITE", "false").lower() == "true"
    )
    rewritten = await ollama_planner.rewrite(payload.prompt) if use_rewrite else payload.prompt
    duration_mode, saved_seconds = shared_duration_settings()
    duration = payload.duration
    if duration is None and duration_mode == 'manual':
        duration = saved_seconds
    # Explicit/common gestures respect the same user's manual choice in
    # offline mode and hybrid fallback. Emotion reply loops use another route
    # and remain speech-bound, never stopped by this clip/playback setting.
    local_duration = duration if duration is not None else payload.local_duration

    if selected_provider == "tencent_tokenhub" and payload.mode in {"online", "hybrid"}:
        signature = _sync_connectivity()
        try:
            result = await tencent_motion.generate(rewritten, duration)
            if result.get('format') != 'fbx' or not str(result.get('url') or '').startswith(('http://', 'https://')):
                raise TencentMotionError("腾讯云返回的动作文件格式无效")
            ident, actual_duration = await _cache_tencent_fbx(result)
            if signature != _sync_connectivity():
                raise TencentMotionError("生成期间配置已改变，请重试")
            pending_cloud_checks[ident] = {'signature': signature, 'at': time.monotonic(), 'read_back': False, 'role_id': CURRENT_ROLE.get()}
            motion_connectivity.update(
                provider_verified=True, client_verified=False, client_attempted=True,
                at=time.monotonic(), detail=TENCENT_FBX_READY_DETAIL,
            )
            tasks[ident] = {
                "task_id": ident, "status": "completed",
                "motion": {"id": ident, "kind": "fbx", "url": f"/api/motion/fbx/{ident}",
                           "duration": actual_duration, "duration_source": result.get("duration_source", "tencent_native"),
                           "role_id": CURRENT_ROLE.get()},
            }
            return tasks[ident]
        except Exception as error:
            detail = _tencent_api_error(error)
            _fail_connectivity(signature, detail)
            if payload.mode == "online":
                raise HTTPException(
                    status_code=502,
                    detail=detail,
                    headers={'X-DeskAura-Motion-Error': 'tencent_generation_failed'},
                ) from None

    # Online replies and explicit online/hybrid performances generate live.
    # Ordinary hybrid/offline replies use emotion_loop before reaching here.
    signature = _sync_connectivity()
    failure = None
    if selected_provider == "hymotion" and payload.mode in {'online', 'hybrid'} and hy_motion.configured:
        try:
            # Preview/direct callers do not always send seconds. The saved
            # manual setting is authoritative there as well as in chat turns.
            result = await hy_motion.generate(rewritten, duration)
            task_id = str(uuid4())
            motion_results[task_id] = result
            result_roles[task_id] = CURRENT_ROLE.get()
            _remember_result(task_id)
            tasks[task_id] = {
                "task_id": task_id,
                "status": "completed",
                "motion": {
                    "id": task_id,
                    "kind": "hymotion",
                    "url": f"/api/motion/result/{task_id}",
                    "duration": result["duration"],
                    "duration_source": result.get('duration_source', 'worker_default' if duration is None else 'manual'),
                    "role_id": CURRENT_ROLE.get(),
                },
            }
            return tasks[task_id]
        except (httpx.HTTPError, RuntimeError, ValueError) as error:
            failure = error if isinstance(error, HYMotionError) else None
            _fail_connectivity(signature, failure.detail if failure else '在线动作生成失败，请检查云端连接')

    if payload.mode == 'online':
        detail = failure.detail if failure else '在线动作生成失败，请检查云端连接'
        _fail_connectivity(signature, detail)
        raise HTTPException(status_code=failure.status if failure else 503, detail=detail,
            headers={'X-DeskAura-Motion-Error': failure.code if failure else 'generation_failed'})

    archived = _cloud_library_match(rewritten, relaxed=True)
    if archived:
        result = _archived_reply(archived, local_duration)
        result['motion']['archive_fallback'] = payload.mode in {'online', 'hybrid'}
        return result
    idle = _archived("cloud_idle")
    if idle:
        result = _archived_reply(idle, local_duration)
        result['motion']['archive_fallback'] = payload.mode == 'hybrid'
        return result
    raise HTTPException(status_code=503, detail="No motion available: worker offline and no archived clip")

@app.get("/api/motion/emotions")
def emotion_library():
    return {"emotions": [{"emotion": emotion, "name": name, "id": EMOTION_IDS[emotion], "available": _archived(EMOTION_IDS[emotion]) is not None} for emotion, name in EMOTIONS.items()]}

@app.get("/api/motion/emotion/{emotion}")
def emotion_loop(emotion: str):
    emotion = 'neutral' if emotion == 'normal' else emotion
    if emotion not in EMOTION_IDS:
        raise HTTPException(status_code=422, detail='Unknown emotion')
    data = None
    selected_emotion = emotion
    for candidate in dict.fromkeys((emotion, 'neutral')):
        clip = _archived(EMOTION_IDS[candidate])
        if clip and clip.get('emotion') == candidate and clip.get('source') in {
            'AutoDL HY-Motion-1.0-Lite', 'AutoDL HY-Motion-1.0', 'Tencent TokenHub HY-3D-Motion'
        } and clip.get('generated_at'):
            data, selected_emotion = clip, candidate
            break
    fallback = data is None or selected_emotion != emotion
    data = data or _archived('cloud_idle')
    if data is None:
        raise HTTPException(status_code=503, detail='Emotion archive unavailable; no cloud generation requested')
    return {"motion": {"id": data['id'], "kind": "hymotion", "url": f"/api/motion/library/{data['id']}", "duration": data['duration'], "loop": True, "emotion": selected_emotion, "archive_fallback": fallback}}

@app.get("/api/motion/library/{motion_id}")
def cloud_library_motion(motion_id: str):
    if not motion_id.startswith("cloud_") or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789_' for c in motion_id):
        raise HTTPException(status_code=404, detail="Cloud motion not found")
    path = CLOUD_LIBRARY_DIR / f"{motion_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Cloud motion not found")
    data = json.loads(path.read_text(encoding="utf-8"))
    return {key: data[key] for key in ("id", "fps", "poses", "trans", "duration", "loop", "name", "source", "model", "generated_at", "quality") if key in data}

@app.get("/api/motion/{task_id}")
def task(task_id: str):
    if task_id in result_times and time.monotonic() - result_times[task_id] > RESULT_LIFETIME_SECONDS:
        _expire_result(task_id)
    if task_id not in tasks or tasks[task_id].get("motion", {}).get("role_id", "default") != CURRENT_ROLE.get():
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks[task_id]

@app.get("/api/motion/result/{task_id}")
def motion_result(task_id: str):
    """Return SMPL-H axis-angle frames for the VRM retargeter."""
    if task_id in result_times and time.monotonic() - result_times[task_id] > RESULT_LIFETIME_SECONDS:
        _expire_result(task_id)
    if task_id not in motion_results:
        raise HTTPException(status_code=404, detail="Motion result not found")
    if result_roles.get(task_id, "default") != CURRENT_ROLE.get():
        raise HTTPException(status_code=404, detail="Motion result not found")
    _sync_connectivity()
    if task_id in pending_cloud_checks:
        pending_cloud_checks[task_id]['read_back'] = True
    return motion_results[task_id]


@app.get("/api/motion/fbx/{task_id}")
def fbx_result(task_id: str):
    """Read a previously downloaded FBX; receipts require this actual readback."""
    value = fbx_results.get(task_id)
    if not value:
        raise HTTPException(status_code=404, detail="Motion result not found")
    if value.get("role_id", "default") != CURRENT_ROLE.get():
        raise HTTPException(status_code=404, detail="Motion result not found")
    if time.monotonic() - value["at"] > 900:
        _expire_result(task_id)
        raise HTTPException(status_code=410, detail="Motion result expired")
    _sync_connectivity()
    if task_id in pending_cloud_checks:
        pending_cloud_checks[task_id]["read_back"] = True
    return Response(value["bytes"], media_type="application/octet-stream",
                    headers={"Cache-Control": "private, max-age=600"})
