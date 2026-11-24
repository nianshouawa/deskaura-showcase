import json

from fastapi.testclient import TestClient
import app.main as motion
from app.validation import validate_clip

EMOTIONS = ("angry", "shy", "nervous", "affectionate", "tired")
GESTURES = ("think", "thinking_loop", "wave", "point")


def test_requested_clips_are_independent_new_generations_with_consistent_indexes():
    root = motion.CLOUD_LIBRARY_DIR.parent
    indexes = {name: {clip["id"]: clip for clip in json.loads((root / name).read_text(encoding="utf-8"))["motions"]}
               for name in ("motion_library_manifest.json", "cloud_motion_library.json", "emotion_motion_library.json")}
    tasks = set()
    for key in tuple("emotion_" + emotion for emotion in EMOTIONS) + GESTURES:
        ident = "cloud_" + key
        clip = validate_clip(motion._archived(ident))
        assert clip["revision"] == ("user-refinement-v10" if key in {
            "emotion_angry", "emotion_nervous", "emotion_affectionate", "emotion_shy"
        } else "user-refinement-v9")
        assert clip["source"] == "Tencent TokenHub HY-3D-Motion"
        assert clip["model"] == "hy-3d-motion"
        assert clip["prompt"] and clip["generated_at"] and len(clip["raw_sha256"]) == 64
        assert clip["loop"] is (key.startswith("emotion_") or key == "thinking_loop")
        tasks.add(clip["task_id"])
        for name, entries in indexes.items():
            if name == "motion_library_manifest.json" or key.startswith("emotion_") == (name == "emotion_motion_library.json"):
                assert entries[ident]["task_id"] == clip["task_id"]
                assert entries[ident]["loop"] is clip["loop"]
    assert len(tasks) == 9


def test_new_emotion_clips_are_selected_without_archived_fallback(monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Local reply archives must not call a paid generation API")
    monkeypatch.setattr(motion.tencent_motion, "generate", forbidden)
    monkeypatch.setattr(motion.hy_motion, "generate", forbidden)
    client = TestClient(motion.app)
    for emotion in EMOTIONS:
        response = client.get("/api/motion/emotion/" + emotion)
        assert response.status_code == 200
        result = response.json()["motion"]
        assert result["id"] == "cloud_emotion_" + emotion
        assert result["archive_fallback"] is False
        assert client.get(result["url"]).json()["source"] == "Tencent TokenHub HY-3D-Motion"
