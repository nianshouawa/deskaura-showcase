import hashlib
import json

from fastapi.testclient import TestClient
import app.main as motion
from app.validation import validate_clip


def test_fearful_is_the_exact_pre_v10_archive_with_its_original_provenance():
    path = motion.CLOUD_LIBRARY_DIR / "cloud_emotion_fearful.json"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == "7b130c0e52749b991f1a86fcb78f009dac3d576d0ddc075b86a49402b5e13d1d"
    clip = validate_clip(motion._archived("cloud_emotion_fearful"))
    assert clip["source"] == "AutoDL HY-Motion-1.0"
    assert clip["generated_at"] == "2026-11-03T20:41:04.938442+00:00"
    for name in ("motion_library_manifest.json", "emotion_motion_library.json"):
        entries = json.loads((motion.CLOUD_LIBRARY_DIR.parent / name).read_text(encoding="utf-8"))["motions"]
        metadata = next(item for item in entries if item["id"] == clip["id"])
        assert metadata["source"] == clip["source"]
        assert metadata["request_sha256"] == clip["request_sha256"]


def test_sway_current_generation_has_consistent_indexes():
    clip = validate_clip(motion._archived("cloud_standby_sway"))
    assert clip["revision"] == "user-refinement-v12" and clip["loop"] is True
    assert clip["source"] == "Tencent TokenHub HY-3D-Motion"
    assert clip["task_id"] and len(clip["raw_sha256"]) == 64
    for name in ("motion_library_manifest.json", "cloud_motion_library.json"):
        entries = json.loads((motion.CLOUD_LIBRARY_DIR.parent / name).read_text(encoding="utf-8"))["motions"]
        assert next(item for item in entries if item["id"] == clip["id"])["task_id"] == clip["task_id"]


def test_restored_fearful_is_selected_without_generation_or_fallback(monkeypatch):
    async def no_generation(*args, **kwargs):
        raise AssertionError("Restored archive must not trigger paid generation")
    monkeypatch.setattr(motion.tencent_motion, "generate", no_generation)
    monkeypatch.setattr(motion.hy_motion, "generate", no_generation)
    result = TestClient(motion.app).get("/api/motion/emotion/fearful").json()["motion"]
    assert result["id"] == "cloud_emotion_fearful" and not result["archive_fallback"]
