"""Start one DeskAura API service from source or a PyInstaller bundle."""

import argparse
import json
import os
import sys
from pathlib import Path

import uvicorn


def configure_paths(service: str, data_dir: Path) -> tuple[str, int]:
    """Add the selected service package path and configure its local database."""
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    sys.path.insert(0, str(root))
    service_dir = root / service
    sys.path.insert(0, str(service_dir))
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    os.environ.setdefault("OLLAMA_MODEL", "qwen3.5:4b")
    os.environ.setdefault("OLLAMA_MOTION_REWRITE", "true")
    os.environ.setdefault("DESKAURA_CONFIG_PATH", str(data_dir / "config.json"))
    if service == "memory-service":
        os.environ.setdefault("MEMORY_DATABASE_PATH", str(data_dir / "memory.db"))
        return "app.main:app", 8001
    if service == "motion-service":
        os.environ.setdefault("MOTION_DATABASE_PATH", str(data_dir / "motions.db"))
        # 与 agent-backend 共用同一份 config.json，让设置面板里改的云端地址能生效。
        os.environ.setdefault("DESKAURA_CONFIG_PATH", str(data_dir / "config.json"))
        # 默认启用云端 HY-Motion（真·骨酪动作），worker 不可达时自动降级本地 preset。
        # 云端 worker：AutoDL V100，经本机 AutoDL.exe SSH 隧道暴露于 http://127.0.0.1:6006
        os.environ.setdefault("HY_MOTION_ENABLED", "true")
        os.environ.setdefault("HY_MOTION_WORKER_URL", "http://127.0.0.1:6006")
        return "app.main:app", 8002
    os.environ.setdefault("SESSION_DATABASE_PATH", str(data_dir / "sessions.db"))
    os.environ.setdefault("DESKAURA_CONFIG_PATH", str(data_dir / "config.json"))
    os.environ.setdefault("MEMORY_SERVICE_URL", "http://127.0.0.1:8001")
    os.environ.setdefault("MOTION_SERVICE_URL", "http://127.0.0.1:8002")
    return "app.main:app", 8000


def main() -> None:
    """Parse CLI arguments and run Uvicorn on localhost."""
    parser = argparse.ArgumentParser()
    parser.add_argument("service", choices=("memory-service", "motion-service", "agent-backend", "self-test"))
    parser.add_argument("--data-dir", default=str(Path.cwd() / "data"))
    args = parser.parse_args()
    if args.service == "self-test":
        # Exercise dynamic imports in the actual PyInstaller artifact without
        # opening ports, reading user credentials or making a paid API call.
        configure_paths("memory-service", Path(args.data_dir))
        from memu import MemoryService
        from pypdf import PdfReader
        from docx import Document
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client
        from sse_starlette.sse import EventSourceResponse
        import jsonschema
        jsonschema.validate({"check": True}, {"type": "object"})
        service = MemoryService(database_config={"metadata_store": {"provider": "inmemory"}})
        service.database.close()
        assert PdfReader and Document and ClientSession and streamable_http_client and EventSourceResponse
        from deskaura_local.runtime import embed_texts, model_directory, transcribe_wav
        vectors = embed_texts(["角色设定和长期记忆", "角色的人设与重要回忆"])
        assert len(vectors) == 2 and len(vectors[0]) >= 128
        transcript = transcribe_wav((model_directory() / "fixtures" / "sensevoice-zh.wav").read_bytes())
        assert transcript.strip()
        print(json.dumps({"memu_runtime": True, "document_imports": True,
                          "builtin_embedding": True, "builtin_hearing": True, "mcp_runtime": True}), flush=True)
        return
    app, port = configure_paths(args.service, Path(args.data_dir))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
