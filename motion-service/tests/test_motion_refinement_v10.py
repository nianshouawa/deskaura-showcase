import json

from fastapi.testclient import TestClient
import app.main as motion
from app.validation import validate_clip

EMOTIONS = ("angry", "nervous", "disgusted", "shy", "affectionate")
STANDBY = ("look_around",)


def test_requested_v10_clips_have_distinct_tasks_and_consistent_indexes():
    root = motion.CLOUD_LIBRARY_DIR.parent
    indexes = {name: {item["id"]: item for item in json.loads((root / name).read_text(encoding="utf-8"))["motions"]}
               for name in ("motion_library_manifest.json", "cloud_motion_library.json", "emotion_motion_library.json")}
    tasks = set()
    for key in tuple("emotion_" + emotion for emotion in EMOTIONS) + tuple("standby_" + key for key in STANDBY):
        ident = "cloud_" + key
        clip = validate_clip(motion._archived(ident))
        assert clip["revision"] == "user-refinement-v10"
        assert clip["source"] == "Tencent TokenHub HY-3D-Motion"
        assert clip["model"] == "hy-3d-motion" and clip["loop"] is True
        assert len(clip["raw_sha256"]) == 64 and clip["task_id"] and clip["generated_at"]
        assert clip["quality"]["max_degrees_per_frame"] <= 30
        assert clip["quality"]["root_horizontal_range_m"] <= .65
        tasks.add(clip["task_id"])
        assert indexes["motion_library_manifest.json"][ident]["task_id"] == clip["task_id"]
        index = "emotion_motion_library.json" if key.startswith("emotion_") else "cloud_motion_library.json"
        assert indexes[index][ident]["task_id"] == clip["task_id"]
    assert len(tasks) == 6


def test_new_v10_emotions_resolve_offline_without_paid_calls(monkeypatch):
    async def no_generation(*args, **kwargs):
        raise AssertionError("Local emotions must not generate")
    monkeypatch.setattr(motion.tencent_motion, "generate", no_generation)
    monkeypatch.setattr(motion.hy_motion, "generate", no_generation)
    client = TestClient(motion.app)
    for emotion in EMOTIONS:
        result = client.get("/api/motion/emotion/" + emotion).json()["motion"]
        assert result["id"] == "cloud_emotion_" + emotion and not result["archive_fallback"]
        assert client.get(result["url"]).json()["source"] == "Tencent TokenHub HY-3D-Motion"


def test_stretch_source_is_the_original_generation():
    clip = motion._archived("cloud_standby_stretch")
    assert clip["prompt"] == "Standing stretch, slowly lift both arms wide overhead apart, then lower to sides, feet planted, no jumping."
    assert clip.get("revision") is None
