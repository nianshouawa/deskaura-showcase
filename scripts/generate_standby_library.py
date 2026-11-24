"""Explicit, bounded Tencent generation and separately reviewed archive install."""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import httpx

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / "build" / "standby-library"
sys.path.insert(0, str(ROOT / "motion-service"))
from app.validation import validate_clip
from motion_quality import metrics

SPECS = {
    "sleep": ("打瞌睡", "Standing dozing, head slowly dips then lifts, arms loose beside thighs, feet planted, no walking or falling."),
    "sing": ("轻声哼唱", "Standing humming a melody, gentle rhythmic head nods, one hand keeps time low outside waist, feet planted."),
    "sway": ("原地轻晃", "Standing relaxed, gently sway weight left and right, arms loose beside thighs, feet planted, no steps."),
    "daydream": ("安静发呆", "Standing daydreaming, slowly tilt head upward then sideways, arms loose beside thighs, feet planted."),
    "stretch": ("伸懒腰", "Standing stretch, slowly lift both arms wide overhead apart, then lower to sides, feet planted, no jumping."),
    "look_around": ("环顾四周", "Standing quietly, slowly look left then right then forward, arms relaxed beside thighs, feet planted."),
}
CLIP_IDS = {key: f"cloud_standby_{key}" for key in SPECS}
CLIP_METADATA = {key: {"standby": key} for key in SPECS}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked(path, key):
    clip = validate_clip(json.loads(path.read_text(encoding="utf-8")))
    if clip.get("id") != CLIP_IDS[key] or clip.get("source") != "Tencent TokenHub HY-3D-Motion":
        raise RuntimeError("Unexpected standby provenance")
    if clip.get("prompt") != SPECS[key][1] or not clip.get("task_id") or not clip.get("generated_at"):
        raise RuntimeError("Incomplete standby provenance")
    quality = metrics(clip)
    if quality["max_degrees_per_frame"] > 30 or quality["root_horizontal_range_m"] > .65:
        raise RuntimeError(f"Standby numerical gate failed: {key}")
    return clip


async def generate(args):
    config = Path(os.environ.get("LOCALAPPDATA", "")) / "com.deskaura.app" / "config.json"
    os.environ.setdefault("DESKAURA_CONFIG_PATH", str(config))
    from app.role_config import CURRENT_ROLE, active_role
    from app.tencent_motion import TencentMotionProvider
    CURRENT_ROLE.set(args.role or active_role())
    provider = TencentMotionProvider(timeout=300)
    if not provider.configured:
        raise RuntimeError("Active role has no saved motion API key")
    STAGE.mkdir(parents=True, exist_ok=True)
    for key in args.ids:
        ident = CLIP_IDS[key]
        target = STAGE / f"{ident}.json"
        if target.exists():
            checked(target, key)
            print(json.dumps({"already_staged": ident}), flush=True)
            continue
        name, prompt = SPECS[key]
        if len(prompt) > 128:
            raise RuntimeError("Motion prompt exceeds provider limit")
        raw = STAGE / f"{ident}.fbx"
        receipt = STAGE / f"{ident}.receipt.json"
        if not raw.exists() or not receipt.exists():
            print(json.dumps({"generating": ident}), flush=True)
            result = await provider.generate(prompt, 8)
            async with httpx.AsyncClient(timeout=120, trust_env=False, follow_redirects=True) as client:
                response = await client.get(result["url"])
                response.raise_for_status()
                content = response.content
            if not 64 <= len(content) <= 64 * 1024 * 1024 or not content.startswith(b"Kaydara FBX Binary"):
                raise RuntimeError("Provider returned invalid binary FBX")
            raw.write_bytes(content)
            receipt.write_text(json.dumps({
                "task_id": result["task_id"], "model": result["model"],
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "raw_sha256": sha(raw), "prompt": prompt,
            }, indent=2), encoding="utf-8")
        provenance = json.loads(receipt.read_text(encoding="utf-8"))
        if provenance["raw_sha256"] != sha(raw) or provenance["prompt"] != prompt:
            raise RuntimeError("Raw generation receipt mismatch")
        canonical = STAGE / f"{ident}.canonical.json"
        subprocess.run(["node", str(ROOT / "scripts/inspect_motion_fbx.mjs"), str(raw),
                        "--canonical-output", str(canonical)], check=True, capture_output=True)
        data = validate_clip(json.loads(canonical.read_text(encoding="utf-8")))
        clip = {**data, **provenance, **CLIP_METADATA[key], "id": ident, "name": name, "kind": "hymotion",
                "loop": CLIP_METADATA[key].get("loop", True), "source": "Tencent TokenHub HY-3D-Motion",
                "requested_duration": 8, "num_frames": len(data["poses"]),
                "raw_candidate": raw.name, "conversion": "production decodeTencentFbxSkeleton, 30 FPS; no authored poses",
                "quality": metrics(data)}
        target.write_text(json.dumps(clip, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        checked(target, key)
        print(json.dumps({"staged": ident, "frames": len(data["poses"]),
                          "duration": data["duration"], "quality": clip["quality"]}), flush=True)


def install(args):
    if not args.reviewed:
        raise RuntimeError("Install requires --reviewed after actual-avatar review")
    clips = [checked(STAGE / f"{CLIP_IDS[key]}.json", key) for key in args.ids]
    destination = ROOT / "motion-service/data"
    indexes = [destination / name for name in ("cloud_motion_library.json", "motion_library_manifest.json")]
    if any(clip.get("emotion") for clip in clips):
        indexes.append(destination / "emotion_motion_library.json")
    targets = [destination / "cloud_motions" / f"{clip['id']}.json" for clip in clips] + indexes
    backup = STAGE / ("backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    backup.mkdir()
    snapshots = {path: path.read_bytes() if path.exists() else None for path in targets}
    for path, content in snapshots.items():
        if content is not None:
            (backup / path.name).write_bytes(content)
    (backup / "sha256.json").write_text(json.dumps({
        str(path.relative_to(ROOT)): hashlib.sha256(content).hexdigest() if content is not None else None
        for path, content in snapshots.items()
    }, indent=2), encoding="utf-8")
    metadata = [{key: value for key, value in clip.items() if key not in ("poses", "trans")} for clip in clips]
    try:
        for clip in clips:
            path = destination / "cloud_motions" / f"{clip['id']}.json"
            shutil.copy2(STAGE / path.name, path)
            if sha(path) != sha(STAGE / path.name):
                raise RuntimeError("Installed clip hash mismatch")
        for path in indexes:
            index = json.loads(snapshots[path])
            ids = {clip["id"] for clip in clips}
            selected = metadata if path.name == "motion_library_manifest.json" else [
                item for item in metadata if bool(item.get("emotion")) == (path.name == "emotion_motion_library.json")]
            index["motions"] = [item for item in index["motions"] if item["id"] not in ids] + selected
            path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        for path, content in snapshots.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(content)
        raise
    print(json.dumps({"installed": [clip["id"] for clip in clips], "backup": str(backup)}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("generate", "install"))
    parser.add_argument("--ids", nargs="+", choices=list(SPECS), default=list(SPECS))
    parser.add_argument("--role")
    parser.add_argument("--reviewed", action="store_true")
    args = parser.parse_args()
    if len(set(args.ids)) != len(args.ids):
        parser.error("Duplicate standby IDs")
    asyncio.run(generate(args)) if args.operation == "generate" else install(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # HTTP errors can include provider-signed URLs. Only expose our own
        # sanitized provider errors, never raw request exceptions or key data.
        from app.tencent_motion import TencentMotionError
        print(str(error) if isinstance(error, TencentMotionError) else
              f"Standby operation failed ({type(error).__name__}); inspect local staged artifacts.", file=sys.stderr)
        sys.exit(1)
