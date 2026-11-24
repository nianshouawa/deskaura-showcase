import json

from fastapi.testclient import TestClient
import app.main as motion
from app.validation import validate_clip

IDS = ["cloud_standby_" + key for key in ("sleep", "sing", "sway", "daydream", "stretch", "look_around")]


def test_six_independent_generated_standby_archives():
    manifest = json.loads((motion.CLOUD_LIBRARY_DIR.parent / "motion_library_manifest.json").read_text(encoding="utf-8"))
    indexed = {item["id"] for item in manifest["motions"]}
    client = TestClient(motion.app)
    tasks = set()
    for ident in IDS:
        clip = validate_clip(motion._archived(ident))
        assert clip["id"] == ident and ident in indexed
        assert clip["source"] == "Tencent TokenHub HY-3D-Motion"
        assert clip["model"] == "hy-3d-motion"
        assert clip["loop"] and clip["generated_at"] and clip["prompt"]
        assert len(clip["raw_sha256"]) == 64
        assert clip["num_frames"] == len(clip["poses"]) == 240
        assert clip["quality"]["max_degrees_per_frame"] <= 30
        assert clip["quality"]["root_horizontal_range_m"] <= .65
        tasks.add(clip["task_id"])
        response = client.get("/api/motion/library/" + ident)
        assert response.status_code == 200
        assert response.json()["loop"] is True
    assert len(tasks) == 6


def test_capabilities_advertise_standby_without_generating(monkeypatch):
    def no_cloud(*args, **kwargs):
        raise AssertionError("Archive discovery must not generate")
    monkeypatch.setattr(motion.tencent_motion, "generate", no_cloud)
    result = TestClient(motion.app).get("/api/motion/capabilities").json()
    assert set(IDS) <= set(result["archive_ids"])
    assert result["archive_count"] >= 30
