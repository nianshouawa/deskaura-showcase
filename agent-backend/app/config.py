"""Local model configuration stored without exposing API keys over HTTP."""

import json
import os
import hashlib
import threading
import ipaddress
from urllib.parse import urlsplit
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

import keyring
from fastapi import HTTPException
from pydantic import BaseModel, Field
from .mcp_configuration import (
    configuration_fingerprint, prepare_configuration, save_secrets, stored_configuration,
)

SERVICE_NAME = "DeskAura"
KEY_USERNAME = "llm-api-key"
TTS_KEY_USERNAME = "tts-api-key"
ASR_KEY_USERNAME = "asr-api-key"
MOTION_KEY_USERNAME = "motion-api-key"
CURRENT_ROLE: ContextVar[str] = ContextVar("deskaura_role", default="default")
_CONFIG_LOCK = threading.RLock()
MODULE_DEFAULTS = {
    "brain_tag": "", "brain_connection_mode": "cloud",
    "persona_tag": "", "persona_text": "", "persona_template": "无",
    "persona_connection_mode": "cloud",
    "persona_embedding_base_url": "https://api.openai.com/v1",
    "persona_embedding_model": "text-embedding-3-small",
    "memory_tag": "", "memory_provider": "memu", "memory_retrieve_method": "rag",
    "memory_llm_tag": "", "memory_llm_base_url": "https://api.openai.com/v1",
    "memory_llm_model": "gpt-4o-mini",
    "memory_embedding_tag": "", "memory_embedding_base_url": "https://api.openai.com/v1",
    "memory_embedding_model": "text-embedding-3-small",
    "memory_connection_mode": "cloud",
    "hearing_tag": "", "hearing_connection_mode": "cloud",
    "voice_tag": "", "voice_connection_mode": "cloud",
    "motion_tag": "", "motion_connection_mode": "cloud",
    "persona_local_provider": "external", "memory_local_provider": "external",
    "hearing_local_provider": "external",
    "vision_enabled": True, "vision_tag": "", "vision_connection_mode": "local",
    "vision_local_provider": "built_in", "vision_camera_id": "",
    "vision_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "vision_model": "qwen-vl-plus",
    "tools_enabled": True, "tools_tag": "", "tools_connection_mode": "local",
    "tools_mcp_url": "",
    "memory_path": "",
    "click_feedback_enabled": True,
}
EXTRA_SECRET_FIELDS = {
    "persona_embedding_api_key": "persona-embedding-api-key",
    "memory_llm_api_key": "memory-llm-api-key",
    "memory_embedding_api_key": "memory-embedding-api-key",
    "vision_api_key": "vision-api-key",
    "tools_mcp_api_key": "tools-mcp-api-key",
    "motion_worker_api_key": "motion-worker-api-key",
}


def private_model_endpoint(address: str) -> bool:
    """Only explicit loopback/LAN addresses qualify for keyless local mode."""
    try:
        parsed = urlsplit(address)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.port == 0 or any(char.isspace() for char in address)):
            return False
        host = parsed.hostname.lower().rstrip(".")
        if host == "localhost" or host.endswith(".localhost"):
            return True
        ip = ipaddress.ip_address(host)
        return ip.is_loopback or ip.is_private and not ip.is_unspecified and not ip.is_multicast
    except (ValueError, TypeError):
        return False


def brain_connection_mode(value: dict, address: str) -> str:
    """Migrate only the historical explicit local Ollama endpoint."""
    if "brain_connection_mode" in value:
        return "local" if value["brain_connection_mode"] == "local" else "cloud"
    try:
        if private_model_endpoint(address) and urlsplit(address).port == 11434:
            return "local"
    except (ValueError, TypeError):
        pass
    return "cloud"


def brain_provider(address: str, deployment: str) -> str:
    try:
        if deployment == "local" and private_model_endpoint(address) and urlsplit(address).port == 11434:
            return "ollama"
    except (ValueError, TypeError):
        pass
    return "openai"


def _api_address(address: str, label: str, suffix: str = "") -> str:
    """Validate a saved endpoint before any credential or metadata write."""
    address = str(address).strip().rstrip("/")
    try:
        parsed = urlsplit(address)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.port == 0 or
                any(char.isspace() or ord(char) < 32 for char in address) or
                any(char in address for char in "{}<>")):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, f"{label}需要有效的 HTTP(S) 地址，不能包含账号、密钥、查询参数或占位符") from None
    if suffix and parsed.path.rstrip("/").endswith(suffix):
        address = address[:-len(suffix)].rstrip("/")
    return address


def _validate_protocol_patch(payload: dict, touched: set[str]) -> None:
    """A bad old module must not prevent saving an unrelated page."""
    groups = [
        ("brain", "base_url", "大脑 API 地址", "/chat/completions",
         {"base_url", "model", "api_key", "brain_connection_mode"}),
        ("persona", "persona_embedding_base_url", "人设 Embedding 地址", "/embeddings",
         {"persona_embedding_base_url", "persona_embedding_model", "persona_embedding_api_key",
          "persona_connection_mode", "persona_local_provider"}),
        ("memory", "memory_embedding_base_url", "记忆 Embedding 地址", "/embeddings",
         {"memory_embedding_base_url", "memory_embedding_model", "memory_embedding_api_key",
          "memory_connection_mode", "memory_local_provider"}),
        ("hearing", "asr_base_url", "听觉 API 地址", "",
         {"asr_base_url", "asr_provider", "asr_model", "asr_api_key",
          "hearing_connection_mode", "hearing_local_provider"}),
        ("voice", "audio_base_url", "语音 API 地址", "",
         {"audio_base_url", "audio_provider", "audio_model", "audio_api_key", "voice_connection_mode"}),
        ("vision", "vision_base_url", "视觉 API 地址", "/chat/completions",
         {"vision_base_url", "vision_model", "vision_api_key", "vision_connection_mode", "vision_local_provider"}),
    ]
    for module, field, label, suffix, inputs in groups:
        if not touched.intersection(inputs):
            continue
        local = payload.get(f"{module}_connection_mode") == "local"
        if local and payload.get(f"{module}_local_provider") == "built_in":
            continue
        payload[field] = _api_address(payload[field], label, suffix)
        if local and not private_model_endpoint(payload[field]):
            raise HTTPException(422, f"本地{label}必须指向本机或局域网；云端服务请选择云端 API 调用")
        provider_field = {"hearing": "asr_provider", "voice": "audio_provider"}.get(module)
        if local and provider_field and payload.get(provider_field, "compatible") != "compatible":
            raise HTTPException(422, "本地听觉与语音服务需要兼容协议，请选择通用兼容接口")
    if touched.intersection({"motion_worker_url", "motion_connection_mode"}):
        address = str(payload.get("motion_worker_url", "")).strip()
        if address:
            payload["motion_worker_url"] = _api_address(address, "动作 Worker 地址")
            if payload.get("motion_connection_mode") == "local" and not private_model_endpoint(address):
                raise HTTPException(422, "本地动作 Worker 请使用本机或局域网地址")
    if touched.intersection({"motion_api_base_url", "motion_api_key"}):
        address = _api_address(payload["motion_api_base_url"], "动作 API 地址")
        for suffix in ("/submit", "/query"):
            if address.endswith(suffix):
                address = address[:-len(suffix)].rstrip("/")
        payload["motion_api_base_url"] = address
    if touched.intersection({"memory_path"}):
        value = str(payload.get("memory_path") or "").strip()
        if value:
            path = Path(value).expanduser()
            if not path.is_absolute() or path == Path(path.anchor):
                raise HTTPException(422, "记忆路径必须是具体文件夹的绝对路径")
            payload["memory_path"] = str(path)


def normalized_role(role_id: str | None = None) -> str:
    value = str(role_id if role_id is not None else CURRENT_ROLE.get()).strip()
    if not value or len(value) > 128 or any(ord(char) < 32 for char in value):
        if value:
            raise HTTPException(422, "角色标识无效")
        return "default"
    return value


def role_slug(role_id: str) -> str:
    return hashlib.sha256(role_id.encode("utf-8")).hexdigest()[:24]


@contextmanager
def role_scope(role_id: str):
    token = CURRENT_ROLE.set(normalized_role(role_id))
    try:
        yield
    finally:
        CURRENT_ROLE.reset(token)
INTERACTION_DEFAULTS = {
    "chat_image_mode": "auto",
    "asr_enabled": False, "asr_provider": "compatible", "asr_base_url": "https://api.siliconflow.cn/v1",
    "asr_model": "FunAudioLLM/SenseVoiceSmall", "asr_language": "",
    "bubble_enabled": True, "file_access_enabled": False, "file_access_root": "",
    "motion_mode": "hybrid", "gaze_mode": "face", "gaze_enabled": True, "standby_enabled": True, "execution_enabled": False,
    # New local-operation policy.  The two boolean fields above are retained
    # as migration aliases for old profiles, but the UI should expose only
    # this single risk level and the sandbox switch.
    "local_operation_mode": "request_approval",
    "local_sandbox_enabled": False,
    "local_sandbox_mode": "read_only",
    "click_feedback_enabled": True,
    "motion_provider": "hymotion",
    "motion_api_base_url": "https://tokenhub.tencentmaas.com/v1/api/3d",
    "motion_api_model": "hy-3d-motion",
    "brain_enabled": True, "persona_enabled": True, "memory_enabled": True,
    "motion_enabled": True,
}
AUDIO_DEFAULTS = {
    "audio_enabled": False, "audio_provider": "compatible",
    "audio_base_url": "https://api.openai.com/v1", "audio_model": "gpt-4o-mini-tts",
    "audio_voice": "alloy", "audio_format": "mp3", "audio_speed": 1.0, "audio_sample_rate": 24000,
}


class ModelSettings(BaseModel):
    """Editable non-secret model settings and an optional replacement key."""

    base_url: str = Field(default="https://api.openai.com/v1", max_length=500)
    model: str = Field(default="gpt-4o-mini", max_length=200)
    api_key: str | None = Field(default=None, max_length=1000)
    motion_duration: float | None = Field(default=None, ge=0.5, le=12)
    # auto 只使用动作模型原生预测；manual 固定用 motion_duration。
    motion_duration_mode: str | None = Field(default=None, pattern="^(auto|manual)$")
    motion_worker_url: str | None = Field(default=None, max_length=500)
    motion_worker_api_key: str | None = Field(default=None, max_length=2000)
    audio_enabled: bool = False
    audio_provider: str = Field(default="compatible", pattern="^(compatible|easyvoice|elevenlabs|azure|dashscope)$")
    audio_base_url: str = Field(default="https://api.openai.com/v1", max_length=500)
    audio_model: str = Field(default="gpt-4o-mini-tts", min_length=1, max_length=200)
    audio_voice: str = Field(default="alloy", min_length=1, max_length=200)
    audio_format: str = Field(default="mp3", pattern="^(mp3|wav|pcm|opus|aac|flac)$")
    audio_speed: float = Field(default=1.0, ge=0.5, le=2.0)
    audio_sample_rate: int = Field(default=24000, ge=8000, le=48000)
    audio_api_key: str | None = Field(default=None, max_length=1000)
    asr_enabled: bool = False
    asr_provider: str = Field(default="compatible", pattern="^(compatible|dashscope)$")
    asr_base_url: str = Field(default="https://api.siliconflow.cn/v1", max_length=500)
    asr_model: str = Field(default="FunAudioLLM/SenseVoiceSmall", min_length=1, max_length=200)
    asr_language: str = Field(default="", max_length=16, pattern="^[a-zA-Z-]*$")
    asr_api_key: str | None = Field(default=None, max_length=1000)
    motion_provider: str = Field(default="hymotion", pattern="^(hymotion|tencent_tokenhub)$")
    motion_api_base_url: str = Field(default="https://tokenhub.tencentmaas.com/v1/api/3d", max_length=500)
    motion_api_model: str = Field(default="hy-3d-motion", max_length=200)
    motion_api_key: str | None = Field(default=None, max_length=1000)
    brain_enabled: bool = True
    persona_enabled: bool = True
    memory_enabled: bool = True
    motion_enabled: bool = True
    chat_image_mode: str = Field(default="auto", pattern="^(auto|on|off)$")
    bubble_enabled: bool = True
    file_access_enabled: bool = False
    file_access_root: str = Field(default="", max_length=1000)
    motion_mode: str = Field(default="hybrid", pattern="^(online|offline|hybrid)$")
    gaze_mode: str = Field(default="face", pattern="^(mouse|face|auto)$")
    gaze_enabled: bool = True
    standby_enabled: bool = True
    execution_enabled: bool = False
    local_operation_mode: str = Field(default="request_approval", pattern="^(request_approval|help_me_approve|full_approval)$")
    local_sandbox_enabled: bool = False
    local_sandbox_mode: str = Field(default="read_only", pattern="^(read_only|workspace_write|full_access)$")
    click_feedback_enabled: bool = True
    brain_tag: str = Field(default="", max_length=80)
    brain_connection_mode: str = Field(default="cloud", pattern="^(cloud|local)$")
    persona_tag: str = Field(default="", max_length=80)
    persona_text: str = Field(default="", max_length=100000)
    persona_template: str = Field(default="无", max_length=80)
    persona_connection_mode: str = Field(default="cloud", pattern="^(cloud|local)$")
    persona_embedding_base_url: str = Field(default="https://api.openai.com/v1", max_length=500)
    persona_embedding_model: str = Field(default="text-embedding-3-small", max_length=200)
    persona_embedding_api_key: str | None = Field(default=None, max_length=1000)
    memory_tag: str = Field(default="", max_length=80)
    memory_provider: str = Field(default="memu", pattern="^(memu|sqlite)$")
    memory_retrieve_method: str = Field(default="rag", pattern="^(rag|llm)$")
    memory_path: str = Field(default="", max_length=1000)
    memory_connection_mode: str = Field(default="cloud", pattern="^(cloud|local)$")
    memory_llm_tag: str = Field(default="", max_length=80)
    memory_llm_base_url: str = Field(default="https://api.openai.com/v1", max_length=500)
    memory_llm_model: str = Field(default="gpt-4o-mini", max_length=200)
    memory_llm_api_key: str | None = Field(default=None, max_length=1000)
    memory_embedding_tag: str = Field(default="", max_length=80)
    memory_embedding_base_url: str = Field(default="https://api.openai.com/v1", max_length=500)
    memory_embedding_model: str = Field(default="text-embedding-3-small", max_length=200)
    memory_embedding_api_key: str | None = Field(default=None, max_length=1000)
    hearing_tag: str = Field(default="", max_length=80)
    hearing_connection_mode: str = Field(default="cloud", pattern="^(cloud|local)$")
    voice_tag: str = Field(default="", max_length=80)
    voice_connection_mode: str = Field(default="cloud", pattern="^(cloud|local)$")
    motion_tag: str = Field(default="", max_length=80)
    motion_connection_mode: str = Field(default="cloud", pattern="^(cloud|local)$")
    persona_local_provider: str = Field(default="external", pattern="^(built_in|external)$")
    memory_local_provider: str = Field(default="external", pattern="^(built_in|external)$")
    hearing_local_provider: str = Field(default="external", pattern="^(built_in|external)$")
    vision_enabled: bool = True
    vision_tag: str = Field(default="", max_length=80)
    vision_connection_mode: str = Field(default="local", pattern="^(cloud|local)$")
    vision_local_provider: str = Field(default="built_in", pattern="^(built_in|external)$")
    vision_camera_id: str = Field(default="", max_length=512)
    vision_base_url: str = Field(default="https://dashscope.aliyuncs.com/compatible-mode/v1", max_length=500)
    vision_model: str = Field(default="qwen-vl-plus", min_length=1, max_length=200)
    vision_api_key: str | None = Field(default=None, max_length=2000)
    tools_enabled: bool = True
    tools_tag: str = Field(default="", max_length=80)
    tools_connection_mode: str = Field(default="local", pattern="^(cloud|local)$")
    tools_mcp_url: str = Field(default="", max_length=1000)
    tools_mcp_api_key: str | None = Field(default=None, max_length=2000)
    tools_mcp_config: dict | None = None


class ConfigStore:
    """Persist model metadata in JSON and secrets in Windows Credential Manager."""

    def __init__(self, path: str | None = None) -> None:
        configured = path or os.getenv("DESKAURA_CONFIG_PATH", "./data/config.json")
        self.base_path = Path(configured)
        self.base_path.parent.mkdir(parents=True, exist_ok=True)
        self.apply_to_environment()

    @property
    def path(self) -> Path:
        role_id = normalized_role()
        return self.base_path if role_id == "default" else self.base_path.parent / "roles" / role_slug(role_id) / "config.json"

    def active_role(self) -> str:
        try:
            value = json.loads((self.base_path.parent / "active-role.json").read_text(encoding="utf-8"))
            return normalized_role(value.get("role_id", "default"))
        except (OSError, ValueError, TypeError, HTTPException):
            return "default"

    @staticmethod
    def _write_json(path: Path, value: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + ".tmp")
        with _CONFIG_LOCK:
            temporary.write_text(json.dumps(value, ensure_ascii=True, indent=2), encoding="utf-8")
            temporary.replace(path)

    def activate(self, role_id: str) -> None:
        self._write_json(self.base_path.parent / "active-role.json", {"role_id": normalized_role(role_id)})

    @staticmethod
    def _key_username(username: str) -> str:
        role_id = normalized_role()
        return username if role_id == "default" else f"{username}:{role_slug(role_id)}"

    @classmethod
    def _read_secret(cls, username: str) -> str:
        try:
            return keyring.get_password(SERVICE_NAME, cls._key_username(username)) or ""
        except keyring.errors.KeyringError:
            return ""

    @classmethod
    def _save_secret(cls, username: str, value: str) -> None:
        keyring.set_password(SERVICE_NAME, cls._key_username(username), value.strip())

    @classmethod
    def _delete_secret(cls, username: str) -> None:
        try:
            keyring.delete_password(SERVICE_NAME, cls._key_username(username))
        except keyring.errors.PasswordDeleteError:
            pass

    def secret(self, field: str) -> str:
        return self._read_secret(EXTRA_SECRET_FIELDS[field])

    def _interaction_state_path(self, role_id: str | None = None) -> Path:
        role_id = normalized_role(role_id)
        directory = self.base_path.parent if role_id == "default" else self.base_path.parent / "roles" / role_slug(role_id)
        return directory / "interaction.json"

    def _read_interaction_state(self, role_id: str | None = None) -> dict:
        try:
            value = json.loads(self._interaction_state_path(role_id).read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _role_key(role_id: str | None) -> str:
        value = str(role_id or "default").strip()
        return value[:128] or "default"

    def offended(self, role_id: str | None = None) -> bool:
        """Whether a particular avatar carries the interaction offense state."""
        key = normalized_role(role_id)
        state = self._read_interaction_state(key)
        if "offended" in state:
            return bool(state["offended"])
        # Read the old shared interaction map once during migration, but never
        # write another character's state into it.
        legacy = self._read_interaction_state("default").get("roles", {})
        return bool(legacy.get(key, False)) if key != "default" and isinstance(legacy, dict) else False

    def set_offended(self, value: bool, role_id: str | None = None) -> bool:
        """Persist one avatar's offense state; it must survive app restarts."""
        key = normalized_role(role_id)
        state = self._read_interaction_state(key)
        state["offended"] = bool(value)
        self._write_json(self._interaction_state_path(key), state)
        return bool(value)

    def get(self, role_id: str | None = None) -> dict[str, str | bool]:
        """Return safe settings with only a masked key indicator."""
        value = self._read_file()
        key = self._get_key()
        mode = str(value.get("local_operation_mode", "request_approval")).strip().lower()
        if mode not in {"request_approval", "help_me_approve", "full_approval"}:
            mode = "request_approval"
        address = str(value.get("base_url", os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")))
        deployment = brain_connection_mode(value, address)
        role = normalized_role(role_id)
        default_memory_path = (self.base_path.parent / "memu" if role == "default" else
                               self.base_path.parent / "roles" / role_slug(role) / "memu")
        default_role_directory = self.base_path.parent if role == "default" else self.base_path.parent / "roles" / role_slug(role)
        stored_memory_path = str(value.get("memory_path") or "").strip()
        if stored_memory_path and Path(stored_memory_path).expanduser().resolve() == default_role_directory.resolve():
            stored_memory_path = str(default_memory_path)
        return {
            "base_url": address,
            "model": value.get("model", os.getenv("LLM_MODEL", "gpt-4o-mini")),
            "api_key_masked": self._mask(key),
            "has_api_key": bool(key),
            "ready": bool(key) or deployment == "local" and private_model_endpoint(address),
            "provider": brain_provider(address, deployment),
            "motion_duration": self.motion_duration(),
            "motion_duration_mode": self.motion_duration_mode(),
            "motion_worker_url": self.motion_worker_url(),
            **{field: value.get(field, default) for field, default in AUDIO_DEFAULTS.items()},
            "audio_has_api_key": bool(self._get_audio_key()),
            "audio_api_key_masked": self._mask(self._get_audio_key()),
            **{field: value.get(field, default) for field, default in INTERACTION_DEFAULTS.items()},
            **{field: value.get(field, default) for field, default in MODULE_DEFAULTS.items()},
            "memory_path": stored_memory_path or str(default_memory_path),
            "brain_connection_mode": deployment,
            "asr_has_api_key": bool(self._get_asr_key()),
            "asr_api_key_masked": self._mask(self._get_asr_key()),
            "offended": self.offended(role_id),
            "local_operation_mode": mode,
            "local_sandbox_enabled": bool(value.get("local_sandbox_enabled", False)),
            "motion_api_key_masked": self._mask(self._get_motion_key()),
            "motion_has_api_key": bool(self._get_motion_key()),
            **{field + "_masked": self._mask(self.secret(field)) for field in EXTRA_SECRET_FIELDS},
            **{field.removesuffix("_api_key") + "_has_api_key": bool(self.secret(field)) for field in EXTRA_SECRET_FIELDS},
            "tools_mcp_config": stored_configuration(self, value),
            "tools_mcp_fingerprint": configuration_fingerprint(self, value),
        }

    def motion_worker_url(self) -> str:
        """用户在设置里指定的云端 worker 地址（空表示用后端默认）。"""
        value = self._read_file().get("motion_worker_url")
        if value is None:
            value = os.getenv("HY_MOTION_WORKER_URL", "")
        return str(value or "").strip().rstrip("/")

    def motion_duration(self) -> float:
        """Effective HY-Motion clip length in seconds (0.5–12, model limit)."""
        value = self._read_file().get("motion_duration")
        if value is None:
            value = os.getenv("HY_MOTION_DURATION", "6")
        try:
            return max(0.5, min(float(value), 12.0))
        except (TypeError, ValueError):
            return 6.0

    def motion_duration_mode(self) -> str:
        """Auto requires native duration prediction; manual uses saved seconds."""
        value = self._read_file().get("motion_duration_mode")
        if value is None:
            value = os.getenv("HY_MOTION_DURATION_MODE", "auto")
        text = str(value or "").strip().lower()
        return text if text in {"auto", "manual"} else "auto"

    def save(self, settings: ModelSettings) -> dict[str, str | bool]:
        with _CONFIG_LOCK:
            return self._save_locked(settings)

    def _save_locked(self, settings: ModelSettings) -> dict[str, str | bool]:
        """Save metadata, optionally replace the key, and refresh the process env."""
        existing = self._read_file()
        effective = self.get()
        payload = {
            "base_url": settings.base_url.rstrip("/") if 'base_url' in settings.model_fields_set else effective['base_url'],
            "model": settings.model if 'model' in settings.model_fields_set else effective['model'],
        }
        if settings.motion_duration is not None:
            payload["motion_duration"] = max(0.5, min(float(settings.motion_duration), 12.0))
        else:
            existing_duration = existing.get("motion_duration")
            if existing_duration is not None:
                payload["motion_duration"] = existing_duration
        if settings.motion_duration_mode is not None:
            payload["motion_duration_mode"] = settings.motion_duration_mode
        else:
            existing_mode = self._read_file().get("motion_duration_mode")
            if existing_mode is not None:
                payload["motion_duration_mode"] = existing_mode
        if settings.motion_worker_url is not None:
            payload["motion_worker_url"] = settings.motion_worker_url.strip().rstrip("/")
        else:
            existing_url = self._read_file().get("motion_worker_url")
            if existing_url is not None:
                payload["motion_worker_url"] = existing_url
        for field, default in AUDIO_DEFAULTS.items():
            payload[field] = getattr(settings, field) if field in settings.model_fields_set else existing.get(field, default)
        for field, default in {**INTERACTION_DEFAULTS, **MODULE_DEFAULTS}.items():
            payload[field] = getattr(settings, field) if field in settings.model_fields_set else existing.get(field, default)
        if "brain_connection_mode" not in settings.model_fields_set and "brain_connection_mode" not in existing:
            payload["brain_connection_mode"] = brain_connection_mode(existing, payload["base_url"])
        _validate_protocol_patch(payload, settings.model_fields_set)
        mcp_secrets = None
        if "tools_mcp_config" in settings.model_fields_set and settings.tools_mcp_config is not None:
            payload["tools_mcp_config"], mcp_secrets = prepare_configuration(self, settings.tools_mcp_config)
        elif "tools_mcp_config" in existing:
            payload["tools_mcp_config"] = existing["tools_mcp_config"]
        mode = str(payload.get("local_operation_mode", "request_approval")).strip().lower()
        if mode not in {"request_approval", "help_me_approve", "full_approval"}:
            mode = "request_approval"
        payload["local_operation_mode"] = mode
        payload["local_sandbox_enabled"] = bool(payload.get("local_sandbox_enabled", False))
        if "local_sandbox_mode" in settings.model_fields_set and "local_sandbox_enabled" not in settings.model_fields_set:
            # The visible access selector replaces the obsolete OS-sandbox toggle.
            payload["local_sandbox_enabled"] = False
        # Compatibility for older callers: non-request modes enable the old
        # gates, while the new mode remains the source of truth.
        if mode in {"help_me_approve", "full_approval"}:
            payload["file_access_enabled"] = True
            payload["execution_enabled"] = True
        if settings.asr_api_key and settings.asr_api_key.strip():
            self._save_secret(ASR_KEY_USERNAME, settings.asr_api_key)
        if settings.audio_api_key and settings.audio_api_key.strip():
            self._save_secret(TTS_KEY_USERNAME, settings.audio_api_key)
        if settings.motion_api_key and settings.motion_api_key.strip():
            self._save_secret(MOTION_KEY_USERNAME, settings.motion_api_key)
        for field, username in EXTRA_SECRET_FIELDS.items():
            key = getattr(settings, field)
            if key and key.strip():
                self._save_secret(username, key)
        if mcp_secrets is not None:
            save_secrets(self, mcp_secrets)
        self._write_json(self.path, payload)
        if settings.api_key is not None and settings.api_key.strip():
            new_key = settings.api_key.strip()
            self._save_secret(KEY_USERNAME, new_key)
            if normalized_role() == "default":
                os.environ["LLM_API_KEY"] = new_key
        self.apply_to_environment()
        return self.get()

    def clear_key(self) -> dict[str, str | bool]:
        """Delete the stored LLM key while preserving endpoint settings."""
        try:
            keyring.delete_password(SERVICE_NAME, self._key_username(KEY_USERNAME))
        except keyring.errors.PasswordDeleteError:
            pass
        if normalized_role() == "default":
            os.environ.pop("LLM_API_KEY", None)
        return self.get()

    def apply_to_environment(self) -> None:
        """Expose the persisted configuration to the LLM adapter."""
        if normalized_role() != "default":
            return
        value = self._read_file()
        if value.get("base_url"):
            os.environ["LLM_BASE_URL"] = str(value["base_url"])
            os.environ["LLM_PROVIDER"] = brain_provider(value["base_url"], brain_connection_mode(value, value["base_url"]))
        if value.get("model"):
            os.environ["LLM_MODEL"] = str(value["model"])
        key = self._get_key()
        if key:
            os.environ["LLM_API_KEY"] = key

    @classmethod
    def _get_audio_key(cls) -> str:
        return cls._read_secret(TTS_KEY_USERNAME)

    def audio_config(self):
        value = self._read_file()
        return {**{field: value.get(field, default) for field, default in AUDIO_DEFAULTS.items()},
                "voice_connection_mode": value.get("voice_connection_mode", "cloud"),
                'api_key': self._get_audio_key()}

    def clear_audio_key(self):
        try:
            keyring.delete_password(SERVICE_NAME, self._key_username(TTS_KEY_USERNAME))
        except keyring.errors.PasswordDeleteError:
            pass
        return self.get()

    @classmethod
    def _get_asr_key(cls):
        return cls._read_secret(ASR_KEY_USERNAME)

    def asr_config(self):
        return {**self.get(), 'api_key': self._get_asr_key()}

    def clear_asr_key(self):
        try:
            keyring.delete_password(SERVICE_NAME, self._key_username(ASR_KEY_USERNAME))
        except keyring.errors.PasswordDeleteError:
            pass
        return self.get()

    @classmethod
    def _get_motion_key(cls) -> str:
        return cls._read_secret(MOTION_KEY_USERNAME)

    def motion_api_config(self) -> dict:
        value = self._read_file()
        return {
            "provider": value.get("motion_provider", "hymotion"),
            "base_url": value.get("motion_api_base_url", "https://tokenhub.tencentmaas.com/v1/api/3d"),
            "model": value.get("motion_api_model", "hy-3d-motion"),
            "api_key": self._get_motion_key(),
        }

    def clear_motion_key(self):
        try:
            keyring.delete_password(SERVICE_NAME, self._key_username(MOTION_KEY_USERNAME))
        except keyring.errors.PasswordDeleteError:
            pass
        return self.get()

    def _read_file(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    @staticmethod
    def _mask(value: str) -> str:
        if not value:
            return ""
        if len(value) <= 8:
            return "*" * len(value)
        return f"{value[:3]}{'*' * 6}{value[-4:]}"

    @classmethod
    def _get_key(cls) -> str:
        env_key = os.getenv("LLM_API_KEY", "").strip() if normalized_role() == "default" else ""
        if env_key:
            return env_key
        return cls._read_secret(KEY_USERNAME)
