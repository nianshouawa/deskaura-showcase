from fastapi.testclient import TestClient
from app.main import app


def test_serves_archived_idle_instead_of_old_presets():
    """The legacy procedural presets are gone; offline means archived idle."""
    response = TestClient(app).post("/api/motion/generate", json={"prompt": "?????", "priority": "high"})
    assert response.status_code == 200
    motion = response.json()["motion"]
    assert motion["kind"] == "hymotion"
    assert motion["id"] in {"cloud_wave", "cloud_idle"}


def test_legacy_preset_endpoints_are_deleted():
    client = TestClient(app)
    assert client.get("/api/motion/presets").status_code == 404
    assert client.get("/api/motion/preset/wave").status_code == 404
