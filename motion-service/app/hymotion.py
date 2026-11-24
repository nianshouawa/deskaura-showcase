"""HY-Motion worker adapter and SMPL-H result metadata.

The official HY-Motion repository is intentionally kept outside the desktop
bundle because its checkpoints require roughly 24-26 GB VRAM. A worker can
run on a suitable GPU host and expose the small JSON result over HTTP.
"""

import os
import math
from typing import Any

import httpx
from .connection import worker_address
from .role_config import key_username, read_config

AUTOMATIC_DURATION_UNAVAILABLE = '云端原生时长预测器 Text2MotionPrompter 不可用'
AUTOMATIC_DURATION_FAILED = 'HY-Motion 原生时长预测失败，请检查云端 Text2MotionPrompter'


class HYMotionError(RuntimeError):
    """A public, sanitized provider failure, never an upstream traceback."""

    def __init__(self, detail: str, code: str, status: int = 503):
        super().__init__(detail)
        self.detail, self.code, self.status = detail, code, status


def shared_duration_settings() -> tuple[str, float]:
    """Read only timing fields from the shared saved settings, without secrets."""
    value = read_config()
    mode = value.get('motion_duration_mode', os.getenv('HY_MOTION_DURATION_MODE', 'auto'))
    try:
        seconds = float(value.get('motion_duration', os.getenv('HY_MOTION_DURATION', '6')))
        if not math.isfinite(seconds):
            seconds = 6.0
    except (TypeError, ValueError):
        seconds = 6.0
    return ('manual' if mode == 'manual' else 'auto', max(.5, min(seconds, 12.0)))


def _read_shared_worker_url() -> str:
    """从 agent-backend 写入的 config.json 里读用户设置的云端地址。

    两个服务各自是独立进程，不共享内存；用同一个 config 文件传递用户设置。
    读不到或格式不对时返回空串，继续用环境变量。
    """
    try:
        value = read_config().get("motion_worker_url")
        return str(value or "").strip().rstrip("/")
    except Exception:
        return ""


def _read_worker_key() -> str:
    try:
        import keyring
        return keyring.get_password("DeskAura", key_username("motion-worker-api-key")) or ""
    except Exception:
        return ""


class HYMotionProvider:
    """Call a local or remote HY-Motion worker when explicitly enabled."""

    def __init__(self) -> None:
        self.enabled = os.getenv("HY_MOTION_ENABLED", "false").lower() == "true"
        env_url = os.getenv("HY_MOTION_WORKER_URL", "").rstrip("/")
        # 用户在设置里填的地址优先于环境变量
        self.worker_url = _read_shared_worker_url() or env_url
        # 没显式填地址时，只要允许云端且有自定义地址就认为已配置
        self.model_path = os.getenv("HY_MOTION_MODEL_PATH", "")
        self.device = os.getenv("HY_MOTION_DEVICE", "cuda")

    def refresh(self) -> None:
        """重新读一次用户设置（设置面板保存后调用）。"""
        env_url = os.getenv("HY_MOTION_WORKER_URL", "").rstrip("/")
        self.worker_url = _read_shared_worker_url() or env_url

    @property
    def configured(self) -> bool:
        """Return whether a worker endpoint is available for generation."""
        return self.enabled and bool(self.worker_url)

    def capabilities(self) -> dict[str, Any]:
        """Return safe provider metadata for the settings/health UI."""
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "worker_url": self.worker_url,
            "model_path": self.model_path,
            "device": self.device,
            "format": "SMPL-H axis-angle JSON, 52 joints, 30 FPS",
        }

    async def generate(self, prompt: str, duration: float | None = None) -> dict[str, Any]:
        """Omit duration only for the worker's native duration predictor.

        An unavailable native predictor is an explicit error, never a request
        to a conversation model, a random length or an implicit fixed default.
        """
        if not self.configured:
            raise RuntimeError(
                "HY-Motion is not configured. Start hymotion_worker.py on a GPU host."
            )
        body: dict[str, Any] = {"prompt": prompt}
        if duration is not None:
            body["duration"] = duration
        key = _read_worker_key()
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        async with httpx.AsyncClient(timeout=180, trust_env=False, follow_redirects=False) as client:
            response = await client.post(f"{worker_address(self.worker_url)}/generate", json=body, headers=headers)
            if duration is None and response.status_code in {409, 502}:
                try:
                    prediction_error = response.json().get('detail', '')
                except (ValueError, AttributeError):
                    prediction_error = ''
                known_missing = response.status_code == 409 and isinstance(prediction_error, str) and prediction_error.startswith('Automatic duration requires HY-Motion')
                known_failed = response.status_code == 502 and isinstance(prediction_error, str) and prediction_error.startswith('HY-Motion duration prediction failed')
                if known_missing:
                    raise HYMotionError(AUTOMATIC_DURATION_UNAVAILABLE, 'automatic_duration_unavailable', 409)
                if known_failed:
                    raise HYMotionError(AUTOMATIC_DURATION_FAILED, 'automatic_duration_failed', 502)
            response.raise_for_status()
            value = response.json()
        poses = value.get("poses")
        if not isinstance(poses, list) or not poses:
            raise RuntimeError("HY-Motion worker returned no pose frames")
        source = value.get('duration_source')
        if duration is None and source != 'hymotion_native':
            # A legacy worker may silently use its slider default. It cannot
            # prove native prediction, even when it returns valid pose frames.
            raise HYMotionError(AUTOMATIC_DURATION_UNAVAILABLE, 'automatic_duration_unavailable', 409)
        return {
            "fps": int(value.get("fps", 30)),
            "poses": poses,
            "trans": value.get("trans", []),
            "duration": len(poses) / int(value.get("fps", 30)),
            "duration_source": 'hymotion_native' if duration is None else source or 'manual',
        }
