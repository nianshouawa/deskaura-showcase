"""Motion configuration, generation evidence and assets stay per character."""
import json
import time

import pytest
from fastapi.testclient import TestClient

import app.main as motion
from app.role_config import CURRENT_ROLE, key_username, read_config, role_slug


@pytest.fixture
def roles(tmp_path, monkeypatch):
    config = tmp_path / "config.json"
    config.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("DESKAURA_CONFIG_PATH", str(config))
    for role, duration in (("character-a", 3), ("character-b", 7)):
        path = tmp_path / "roles" / role_slug(role) / "config.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({
            "motion_provider": "hymotion",
            "motion_worker_url": f"https://{role}.invalid",
            "motion_duration_mode": "manual",
            "motion_duration": duration,
        }), encoding="utf-8")
    return tmp_path


def test_config_and_keyring_name_are_per_role(roles):
    for role, duration in (("character-a", 3), ("character-b", 7)):
        token = CURRENT_ROLE.set(role)
        try:
            assert read_config()["motion_duration"] == duration
            assert key_username("motion-api-key") == f"motion-api-key:{role_slug(role)}"
        finally:
            CURRENT_ROLE.reset(token)
    assert read_config() == {}
    assert key_username("motion-api-key") == "motion-api-key"


def test_tencent_credentials_do_not_fall_back_to_another_role(roles, monkeypatch):
    from app import tencent_motion
    calls = []
    monkeypatch.setenv("TENCENT_MOTION_API_KEY", "default-role-environment-only")
    monkeypatch.setattr("keyring.get_password", lambda service, username: calls.append(username) or "")
    token = CURRENT_ROLE.set("character-a")
    try:
        provider = tencent_motion.TencentMotionProvider()
        assert not provider.configured
        assert calls == [f"motion-api-key:{role_slug('character-a')}"]
    finally:
        CURRENT_ROLE.reset(token)


def test_results_and_receipts_cannot_cross_roles_or_revoke_other_role_proof(roles, monkeypatch):
    generated = []

    class Provider:
        enabled = True
        model_path = ""
        device = "cuda"
        configured = True
        def __init__(self):
            self.worker_url = read_config().get("motion_worker_url", "")
        def refresh(self):
            pass
        async def generate(self, prompt, duration):
            generated.append((CURRENT_ROLE.get(), self.worker_url, duration))
            return {"fps": 30, "duration": duration, "poses": [[0] * 156] * 2}

    async def inspect(_):
        return {"ready": True}

    monkeypatch.setattr(motion, "hy_motion", motion._RoleProvider(Provider))
    monkeypatch.setattr(motion, "motion_connectivity", motion._RoleProofs())
    monkeypatch.setattr(motion, "inspect_worker", inspect)
    monkeypatch.setattr(motion, "pending_cloud_checks", {})
    monkeypatch.setattr(motion, "motion_results", {})
    monkeypatch.setattr(motion, "result_roles", {})
    monkeypatch.setattr(motion, "tasks", {})
    client = TestClient(motion.app)
    a, b = {"X-DeskAura-Role": "character-a"}, {"X-DeskAura-Role": "character-b"}
    result_a = client.post("/api/motion/cloud-test", headers=a).json()
    url_a = result_a["result_url"]
    result_id = url_a.rsplit("/", 1)[-1]
    # Merely checking B must not clear A's pending generation.
    assert not client.get("/api/motion/status", headers=b).json()["verified"]
    assert client.get(url_a, headers=b).status_code == 404
    assert not client.post("/api/motion/receipt", headers=b, json={"result_id": result_id}).json()["accepted"]
    assert client.get(url_a, headers=a).is_success
    assert client.post("/api/motion/receipt", headers=a, json={"result_id": result_id}).json()["accepted"]
    assert client.get("/api/motion/status", headers=a).json()["verified"]
    assert not client.get("/api/motion/status", headers=b).json()["verified"]
    response_b = client.post("/api/motion/generate", headers=b, json={"prompt": "wave", "mode": "online"}).json()
    assert response_b["motion"]["role_id"] == "character-b"
    assert client.get(f"/api/motion/{response_b['task_id']}", headers=a).status_code == 404
    assert client.get(f"/api/motion/{response_b['task_id']}", headers=b).is_success
    assert generated == [
        ("character-a", "https://character-a.invalid", 3),
        ("character-b", "https://character-b.invalid", 7),
    ]


def test_fbx_readback_is_owned_by_originating_role(roles, monkeypatch):
    monkeypatch.setattr(motion, "fbx_results", {
        "role-owned-fbx": {"bytes": b"test-fbx", "at": time.monotonic(), "role_id": "character-a"},
    })
    monkeypatch.setattr(motion, "_sync_connectivity", lambda: ())
    client = TestClient(motion.app)
    url = "/api/motion/fbx/role-owned-fbx"
    assert client.get(url, headers={"X-DeskAura-Role": "character-b"}).status_code == 404
    assert client.get(url, headers={"X-DeskAura-Role": "character-a"}).content == b"test-fbx"


def test_invalid_role_does_not_silently_fall_back_to_default(roles):
    response = TestClient(motion.app).get("/health", headers={"X-DeskAura-Role": "x" * 129})
    assert response.status_code == 422
