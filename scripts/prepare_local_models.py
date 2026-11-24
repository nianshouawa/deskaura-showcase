"""Fetch the pinned, redistributable CPU models used by a DeskAura build.

This build-time script never runs on application startup. Downloads are bounded,
streamed to temporary files, then atomically installed in an owned model folder.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1] / "local-models"
EMBED_REV = "75c43b069aac4d136ba6bc1122f995fedcfd2781"
ASR_REV = "2365baeacb507f821a0c8120fcee3d484dba7a07"
EMBED = f"https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/{EMBED_REV}"
ASR = f"https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/{ASR_REV}"
FILES = {
    "embedding/model_quantized.onnx": (f"{EMBED}/onnx/model_quantized.onnx", 30_000_000),
    "embedding/tokenizer.json": (f"{EMBED}/tokenizer.json", 2_000_000),
    "embedding/config.json": (f"{EMBED}/config.json", 100_000),
    "embedding/README.md": (f"{EMBED}/README.md", 100_000),
    "embedding/LICENSE": ("https://raw.githubusercontent.com/FlagOpen/FlagEmbedding/master/LICENSE", 100_000),
    "hearing/model.int8.onnx": (f"{ASR}/model.int8.onnx", 300_000_000),
    "hearing/tokens.txt": (f"{ASR}/tokens.txt", 2_000_000),
    "hearing/LICENSE": (f"{ASR}/LICENSE", 100_000),
    "hearing/LICENSE-SenseVoice": ("https://raw.githubusercontent.com/FunAudioLLM/SenseVoice/main/LICENSE", 100_000),
    "hearing/README.md": (f"{ASR}/README.md", 200_000),
    # Public model-author fixtures, not a user's microphone recording.
    "fixtures/sensevoice-zh.wav": (f"{ASR}/test_wavs/zh.wav", 2_000_000),
}


def download(item: tuple[str, tuple[str, int]]) -> tuple[str, dict]:
    name, (url, maximum) = item
    target = ROOT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.is_file() or not target.stat().st_size:
        temporary = target.with_suffix(target.suffix + ".download")
        try:
            with httpx.Client(timeout=httpx.Timeout(240, connect=25), follow_redirects=True) as client:
                with client.stream("GET", url) as response:
                    response.raise_for_status()
                    length = 0
                    with temporary.open("wb") as file:
                        for chunk in response.iter_bytes(1024 * 1024):
                            length += len(chunk)
                            if length > maximum:
                                raise ValueError(f"Model size exceeded for {name}")
                            file.write(chunk)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    digest = hashlib.sha256()
    with target.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return name, {"bytes": target.stat().st_size, "sha256": digest.hexdigest(), "source": url}


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        manifest = dict(pool.map(download, FILES.items()))
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"files": len(manifest), "bytes": sum(item["bytes"] for item in manifest.values())}))


if __name__ == "__main__":
    main()
