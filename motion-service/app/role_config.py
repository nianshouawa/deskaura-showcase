"""Read-only per-character configuration shared with agent-backend."""
from __future__ import annotations
from contextvars import ContextVar
import hashlib
import json
import os
from pathlib import Path

from fastapi import HTTPException

CURRENT_ROLE: ContextVar[str] = ContextVar("deskaura_motion_role", default="default")


def normalized_role(value: str | None) -> str:
    text = str(value or "default").strip()
    if not text:
        return "default"
    if len(text) > 128 or any(ord(char) < 32 for char in text):
        raise HTTPException(422, "角色标识无效")
    return text


def role_slug(role_id: str) -> str:
    return hashlib.sha256(role_id.encode("utf-8")).hexdigest()[:24]


def active_role() -> str:
    path = os.getenv("DESKAURA_CONFIG_PATH", "").strip()
    if path:
        try:
            return normalized_role(json.loads((Path(path).parent / "active-role.json").read_text(encoding="utf-8")).get("role_id"))
        except (OSError, ValueError, TypeError, AttributeError, HTTPException):
            pass
    return "default"


def config_path() -> Path | None:
    value = os.getenv("DESKAURA_CONFIG_PATH", "").strip()
    if not value:
        return None
    base = Path(value)
    role_id = CURRENT_ROLE.get()
    return base if role_id == "default" else base.parent / "roles" / role_slug(role_id) / "config.json"


def read_config() -> dict:
    path = config_path()
    if path is not None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError, TypeError):
            pass
    return {}


def key_username(username: str) -> str:
    role_id = CURRENT_ROLE.get()
    return username if role_id == "default" else f"{username}:{role_slug(role_id)}"
