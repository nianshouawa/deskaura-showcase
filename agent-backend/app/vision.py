"""Role-scoped camera and face-detection state for gaze tracking."""
from __future__ import annotations

import hashlib
import json
import time

from fastapi import HTTPException

from .config import normalized_role

_records: dict[str, dict] = {}
_revisions: dict[str, int] = {}
MAX_ROLE_RECORDS = 64


def _prune_role_state(now: float | None = None) -> None:
    """Keep transient camera proofs bounded across repeated role switches."""
    now = time.time() if now is None else now
    stale_before = now - 1200
    for role, value in list(_records.items()):
        if value.get("at", 0) < stale_before:
            _records.pop(role, None)
            _revisions.pop(role, None)
    if len(_records) <= MAX_ROLE_RECORDS:
        return
    oldest = sorted(_records.items(), key=lambda item: item[1].get("at", 0))
    for role, _ in oldest[:len(_records) - MAX_ROLE_RECORDS]:
        _records.pop(role, None)
        _revisions.pop(role, None)
    for role in list(_revisions):
        if role not in _records:
            _revisions.pop(role, None)


def signature(store):
    """Bind a face-detection proof to this role's camera and enabled state."""
    config = store.get()
    value = {name: config.get(name) for name in (
        "vision_enabled", "vision_camera_id",
    )}
    return hashlib.sha256(json.dumps([normalized_role(), value], sort_keys=True).encode()).hexdigest()


def status(store):
    _prune_role_state()
    config = store.get()
    enabled = config.get("vision_enabled", True)
    record = _records.get(normalized_role(), {})
    matches = record.get("signature") == signature(store)
    fresh = matches and time.time() - record.get("at", 0) < 600
    return {
        "enabled": enabled,
        "configured": enabled,
        "verified": bool(enabled and fresh and record.get("verified")),
        "detail": "已停用" if not enabled else (
            record.get("detail", "尚未检测") if fresh else
            "验证已过期 · 请重新检测" if matches else "尚未检测"
        ),
        "camera_id": config.get("vision_camera_id", ""),
        "purpose": "face_tracking",
    }


async def record_detection(store, faces: int, confidence: float):
    """Record a successful local camera frame containing at least one face."""
    if faces < 1:
        raise HTTPException(422, "摄像头画面中未检测到人脸")
    if not 0 <= confidence <= 1:
        raise HTTPException(422, "人脸检测置信度无效")
    role, fingerprint = normalized_role(), signature(store)
    _prune_role_state()
    revision = _revisions.get(role, 0) + 1
    _revisions[role] = revision
    config = store.get()
    if not config.get("vision_enabled", True):
        raise HTTPException(409, "视觉模块已停用")
    _records[role] = {
        "signature": fingerprint,
        "verified": True,
        "at": time.time(),
        "detail": f"正常 · 已检测到 {faces} 张人脸",
    }
    return {"text": f"检测到 {faces} 张人脸，置信度 {confidence:.0%}"}
