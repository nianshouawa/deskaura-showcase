"""Tencent TokenHub HY-3D-Motion client.

The service returns an animated FBX download URL, not the legacy SMPL-H
``poses`` payload used by the local HY-Motion worker.  Keep this adapter
separate so callers can decide whether their avatar runtime supports FBX
retargeting before replacing an existing motion clip.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx
from .role_config import CURRENT_ROLE, read_config, key_username

TENCENT_MOTION_BASE_URL = "https://tokenhub.tencentmaas.com/v1/api/3d"
TENCENT_MOTION_MODEL = "hy-3d-motion"
TENCENT_KEYRING_SERVICE = "DeskAura"
TENCENT_KEYRING_USERNAME = "motion-api-key"


def _saved_motion_config() -> dict[str, str]:
    """Read only non-secret provider metadata from the shared settings file."""
    return read_config()


def _saved_motion_key() -> str:
    try:
        import keyring
        return keyring.get_password(TENCENT_KEYRING_SERVICE, key_username(TENCENT_KEYRING_USERNAME)) or ""
    except Exception:
        return ""


class TencentMotionError(RuntimeError):
    """Sanitized Tencent motion provider error."""


class TencentMotionProvider:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str = TENCENT_MOTION_MODEL,
        timeout: float = 180,
        poll_interval: float = 2,
    ) -> None:
        # Never log or expose the key. Settings should pass it from keyring.
        self._explicit_api_key = api_key is not None
        saved = _saved_motion_config()
        self.api_key = (
            str(api_key).strip()
            if api_key is not None
            else ((os.getenv("TENCENT_MOTION_API_KEY", "") if CURRENT_ROLE.get() == "default" else "") or _saved_motion_key()).strip()
        )
        self.base_url = (base_url or os.getenv("TENCENT_MOTION_BASE_URL", "") or
                         str(saved.get("motion_api_base_url") or TENCENT_MOTION_BASE_URL)).rstrip("/")
        self.base_url = self._api_root(self.base_url)
        self.model = (str(saved.get("motion_api_model") or "") or model).strip() or TENCENT_MOTION_MODEL
        self.timeout = max(10.0, float(timeout))
        self.poll_interval = max(.2, float(poll_interval))

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url)

    def capabilities(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "provider": "tencent_tokenhub",
            "model": self.model,
            "format": "FBX",
            "duration_estimation": True,
        }

    async def generate(self, prompt: str, duration: float | None = None) -> dict[str, Any]:
        self.refresh()
        if not prompt.strip():
            raise TencentMotionError("动作描述不能为空")
        if not self.configured:
            raise TencentMotionError("腾讯云动作服务未配置 API Key")
        body: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt[:128],
            "enable_mesh": False,
        }
        if duration is None:
            body["enable_duration_est"] = True
        else:
            body["duration"] = max(1, min(12, int(round(duration))))
            body["enable_duration_est"] = False
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=self.timeout, trust_env=False) as client:
            submit = await self._post(client, "/submit", headers, body)
            task_id = str(submit.get("id") or "").strip()
            if not task_id:
                raise TencentMotionError("腾讯云未返回动作任务编号")
            deadline = asyncio.get_running_loop().time() + self.timeout
            while True:
                query = await self._post(client, "/query", headers, {"model": self.model, "id": task_id})
                status = str(query.get("status") or "").lower()
                if status == "completed":
                    data = query.get("data")
                    if not isinstance(data, list):
                        raise TencentMotionError("腾讯云动作结果格式无效")
                    item = next((value for value in data if isinstance(value, dict) and str(value.get("type", "")).lower() == "fbx"), None)
                    url = str((item or {}).get("url") or "").strip()
                    if not url.startswith(("https://", "http://")):
                        raise TencentMotionError("腾讯云未返回有效动作文件地址")
                    return {
                        "provider": "tencent_tokenhub",
                        "model": self.model,
                        "format": "fbx",
                        "url": url,
                        "task_id": task_id,
                        "duration_source": "manual" if duration is not None else "tencent_native",
                        # The FBX track times are authoritative for native auto
                        # mode; the desktop derives actual duration after parse.
                        "duration": float(body["duration"]) if duration is not None else 0.0,
                    }
                if status in {"failed", "cancelled", "canceled"}:
                    raise TencentMotionError("腾讯云动作生成失败")
                if asyncio.get_running_loop().time() >= deadline:
                    raise TencentMotionError("腾讯云动作生成超时")
                await asyncio.sleep(self.poll_interval)

    def refresh(self) -> None:
        """Refresh credentials/configuration after the settings window saves."""
        saved = _saved_motion_config()
        if not self._explicit_api_key:
            self.api_key = ((os.getenv("TENCENT_MOTION_API_KEY", "") if CURRENT_ROLE.get() == "default" else "") or _saved_motion_key()).strip()
        if saved.get("motion_api_base_url"):
            self.base_url = self._api_root(str(saved["motion_api_base_url"]).strip().rstrip("/"))
        if saved.get("motion_api_model"):
            self.model = str(saved["motion_api_model"]).strip() or self.model

    async def _post(self, client: httpx.AsyncClient, path: str, headers: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await client.post(f"{self.base_url}{path}", headers=headers, json=body)
            if not response.is_success:
                try:
                    value = response.json()
                except ValueError:
                    value = {}
                message = value.get("error", {}).get("message") if isinstance(value.get("error"), dict) else value.get("message")
                detail = str(message or "").strip()[:240]
                suffix = f"：{detail}" if detail and self.api_key not in detail else ""
                if response.status_code == 401:
                    raise TencentMotionError(f"腾讯云 API Key 未通过鉴权{suffix}")
                if response.status_code == 403:
                    raise TencentMotionError(f"腾讯云账户未开通 HY-3D-Motion 或缺少权限{suffix}")
                if response.status_code == 402:
                    raise TencentMotionError(
                        "腾讯云 HY-3D-Motion 免费额度已用完；请在控制台在线推理服务中开通后付费"
                    )
                raise TencentMotionError(f"腾讯云动作接口 HTTP {response.status_code}{suffix}")
            value = response.json()
        except TencentMotionError:
            raise
        except (httpx.HTTPError, ValueError, TypeError):
            raise TencentMotionError("腾讯云动作接口请求失败，请检查地址、密钥和额度") from None
        if not isinstance(value, dict):
            raise TencentMotionError("腾讯云动作接口返回格式无效")
        return value

    @staticmethod
    def _api_root(address: str) -> str:
        """Accept both an API root and a copied submit/query endpoint."""
        root = str(address or TENCENT_MOTION_BASE_URL).strip().rstrip("/")
        for suffix in ("/submit", "/query"):
            if root.endswith(suffix):
                return root[:-len(suffix)].rstrip("/")
        return root
