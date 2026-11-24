"""Vision is face tracking only; it must never claim image understanding."""
import asyncio
import time

import pytest
from fastapi import HTTPException

from app import vision


class VisionStore:
    def __init__(self, **patch):
        self.values = {
            "vision_enabled": True,
            "vision_camera_id": "camera-a",
            "vision_connection_mode": "local",
            "vision_local_provider": "built_in",
            **patch,
        }

    def get(self):
        return dict(self.values)

    def secret(self, _):
        return ""


@pytest.fixture(autouse=True)
def clear_state(monkeypatch):
    monkeypatch.setattr(vision, "_records", {})
    monkeypatch.setattr(vision, "_revisions", {})


def test_face_detection_is_the_only_visual_contract():
    store = VisionStore()
    result = asyncio.run(vision.record_detection(store, 1, .92))
    state = vision.status(store)
    assert "人脸" in result["text"]
    assert state["verified"] and state["purpose"] == "face_tracking"
    assert "image_understanding" not in state


def test_no_face_or_disabled_module_is_red():
    store = VisionStore()
    with pytest.raises(HTTPException, match="未检测到人脸"):
        asyncio.run(vision.record_detection(store, 0, 0))
    disabled = VisionStore(vision_enabled=False)
    with pytest.raises(HTTPException, match="已停用"):
        asyncio.run(vision.record_detection(disabled, 1, .9))
    assert vision.status(disabled)["detail"] == "已停用"


def test_camera_change_invalidates_face_proof():
    store = VisionStore()
    asyncio.run(vision.record_detection(store, 1, .9))
    assert vision.status(store)["verified"]
    store.values["vision_camera_id"] = "camera-b"
    assert not vision.status(store)["verified"]


def test_expired_face_proof_does_not_stay_green():
    store = VisionStore()
    asyncio.run(vision.record_detection(store, 1, .9))
    vision._records["default"]["at"] = time.time() - 601
    assert not vision.status(store)["verified"]


def test_live_face_proof_updates_module_and_rejects_another_camera(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    from app.config import ConfigStore, ModelSettings, role_scope
    store = ConfigStore(str(tmp_path / "config.json"))
    monkeypatch.setattr(main, "config_store", store)
    with role_scope("momo"):
        store.save(ModelSettings(vision_camera_id="camera-a"))
    headers = {"X-DeskAura-Role": "momo"}
    client = TestClient(main.app)
    rejected = client.post("/api/modules/vision/test", headers=headers,
        json={"faces": 1, "confidence": .9, "camera_id": "camera-b"})
    assert rejected.status_code == 409
    accepted = client.post("/api/modules/vision/test", headers=headers,
        json={"faces": 1, "confidence": .9, "camera_id": "camera-a"})
    token = accepted.json()["verification_id"]
    assert client.post("/api/connectivity/receipt", headers=headers,
        json={"token": token, "success": True}).json()["accepted"]
    state = client.get("/api/modules/vision/status", headers=headers).json()
    assert state["verified"] and state["client_verified"]
