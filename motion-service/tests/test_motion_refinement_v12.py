import json

from fastapi.testclient import TestClient
import app.main as motion
from app.validation import validate_clip


def test_new_sway_keeps_the_complete_generated_timeline():
    clip = validate_clip(motion._archived("cloud_standby_sway"))
    assert clip["revision"] == "user-refinement-v12"
    assert clip["source"] == "Tencent TokenHub HY-3D-Motion"
    assert clip["playback"] == "complete-source-forward-only"
    assert len(clip["poses"]) == clip["num_frames"] == 240
    assert clip["fps"] == 30 and clip["duration"] == 8
    assert clip["quality"]["max_raw_seam_degrees"] < 20
    assert clip["prompt"] == "A relaxed person waits in place, shifting weight between feet with small sideways torso twists and loose arms. Facing front."
    for name in ("cloud_motion_library.json", "motion_library_manifest.json"):
        index = json.loads((motion.CLOUD_LIBRARY_DIR.parent / name).read_text(encoding="utf-8"))
        metadata = next(item for item in index["motions"] if item["id"] == clip["id"])
        assert metadata["task_id"] == clip["task_id"]
        assert metadata["revision"] == "user-refinement-v12"


def test_nervous_source_unchanged_while_runtime_corrects_palm_direction():
    clip = motion._archived("cloud_emotion_nervous")
    assert clip["revision"] == "user-refinement-v10"
    assert clip["prompt"] == "Standing nervously, head slightly bowed, elbows naturally bent, right hand resting over left at abdomen, small fidgets."
    client = TestClient(motion.app)
    result = client.get("/api/motion/emotion/nervous").json()["motion"]
    assert result["id"] == clip["id"] and not result["archive_fallback"]
