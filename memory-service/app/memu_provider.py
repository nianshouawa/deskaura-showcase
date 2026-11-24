"""Real MemU integration, pinned to the public memu-cli 0.10 API.

The old SQLite store is retained as a lossless conversation/relationship
archive.  Once configured, all long-term recall is performed by MemU's
commit_results/progressive_retrieve APIs, never by a relabelled FTS query.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib.metadata
import ipaddress
import json
import math
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import keyring
from pydantic import BaseModel, Field

from .schemas import ConversationIn, MemoryItem
from .store import MemoryStore


class MemoryConfig(BaseModel):
    enabled: bool = True
    tag: str = Field(default="MemU", max_length=80)
    deployment: str = Field(default="cloud", pattern="^(cloud|local)$")
    local_provider: str = Field(default="external", pattern="^(built_in|external)$")
    base_url: str = Field(default="https://api.openai.com/v1", max_length=500)
    model: str = Field(default="text-embedding-3-small", min_length=1, max_length=200)
    api_key: str | None = Field(default=None, max_length=2000)
    memory_path: str = Field(default="", max_length=1000)


def role_key(role_id: str | None) -> str:
    return (str(role_id or "default").strip() or "default")[:128]


def role_digest(role_id: str | None) -> str:
    return hashlib.sha256(role_key(role_id).encode("utf-8")).hexdigest()[:24]


def _masked(key: str) -> str:
    return f"{key[:3]}******{key[-4:]}" if len(key) > 8 else "*" * len(key)


def _validate_endpoint(config: MemoryConfig) -> None:
    if config.deployment == "local" and config.local_provider == "built_in":
        return
    try:
        address = urlsplit(config.base_url)
        valid = (address.scheme in {"http", "https"} and address.hostname and not address.username and
                 not address.password and not address.query and not address.fragment and address.port != 0)
        if valid and config.deployment == "local":
            host = address.hostname.lower().rstrip(".")
            if host != "localhost" and not host.endswith(".localhost"):
                ip = ipaddress.ip_address(host)
                valid = (ip.is_loopback or ip.is_private) and not ip.is_unspecified and not ip.is_multicast
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise ValueError("Embedding 地址无效；本地部署必须使用本机或局域网 HTTP(S) 地址")


class _ValidatedEmbeddingClient:
    """Validate model payloads before the official engine stores any vector."""

    def __init__(self, config) -> None:
        from memu.embedding.http_client import HTTPEmbeddingClient
        self.client = HTTPEmbeddingClient(
            base_url=config.base_url, api_key=config.api_key, embed_model=config.embed_model,
            provider=config.provider, endpoint_overrides=config.endpoint_overrides,
        )

    async def embed(self, texts: list[str]):
        vectors, response = await self.client.embed(texts)
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise RuntimeError("Embedding 向量数量无效")
        dimension = len(vectors[0]) if vectors and isinstance(vectors[0], list) else 0
        if not dimension or any(
            not isinstance(vector, list) or len(vector) != dimension or
            any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector) or
            sum(float(value) ** 2 for value in vector) <= 0 for vector in vectors
        ):
            raise RuntimeError("Embedding 未返回有效向量")
        return vectors, response


class _BuiltinEmbeddingClient:
    """Plug native CPU vectors into MemU's official embedding gateway."""

    def __init__(self, config) -> None:
        self.embed_model = config.embed_model

    async def embed(self, texts: list[str]):
        from deskaura_local.runtime import embed_texts
        vectors = await asyncio.to_thread(embed_texts, texts)
        return vectors, {"provider": "built_in", "model": self.embed_model}


class MemURegistry:
    """Own one archive, MemU index and credential namespace per character."""

    def __init__(self, archive: MemoryStore) -> None:
        self.archive = archive
        self.config_path = Path(os.getenv("DESKAURA_CONFIG_PATH", str(archive.path.parent / "config.json")))
        self.root = self.config_path.parent / "roles"
        self.root.mkdir(parents=True, exist_ok=True)
        self._archives: dict[str, MemoryStore] = {"default": archive}
        self._services: dict[str, tuple[str, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._states: dict[str, dict[str, Any]] = {}
        self._role_last_used: dict[str, float] = {"default": time.monotonic()}
        self._max_role_state = 64

    def _touch_role(self, role: str) -> None:
        self._role_last_used[role] = time.monotonic()
        self._prune_role_state()

    def _prune_role_state(self) -> None:
        """Bound role-scoped MemU handles and locks in the service process."""
        if len(self._role_last_used) <= self._max_role_state:
            return
        keep = {"default"}
        candidates = sorted(
            (role for role in self._role_last_used if role not in keep),
            key=self._role_last_used.get,
        )
        for role in candidates[: max(0, len(self._role_last_used) - self._max_role_state)]:
            cached = self._services.pop(role, None)
            if cached:
                cached[1].database.close()
            self._archives.pop(role, None)
            self._locks.pop(role, None)
            self._states.pop(role, None)
            self._role_last_used.pop(role, None)

    def _directory(self, role_id: str | None) -> Path:
        directory = self.config_path.parent if role_key(role_id) == "default" else self.root / role_digest(role_id)
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def _storage_directory(self, role_id: str | None) -> Path:
        """Portable MemU bridging root containing memory/ and skill/ Markdown."""
        configured = str(self._shared_settings(role_id).get("memory_path") or "").strip()
        if not configured:
            directory = self._directory(role_id) / "memu"
            directory.mkdir(parents=True, exist_ok=True)
            (directory / "memory").mkdir(exist_ok=True)
            (directory / "skill").mkdir(exist_ok=True)
            return directory
        directory = Path(configured).expanduser()
        if not directory.is_absolute() or directory == Path(directory.anchor):
            raise ValueError("记忆路径必须是具体文件夹的绝对路径")
        if directory.is_file():
            directory = directory.parent
        role_directory = self._directory(role_id)
        if directory.resolve() == role_directory.resolve():
            legacy = role_directory
            directory = role_directory / "memu"
            directory.mkdir(parents=True, exist_ok=True)
            for track in ("memory", "skill"):
                source, target = legacy / track, directory / track
                if source.is_dir():
                    shutil.copytree(source, target, dirs_exist_ok=True)
            old_manifest = legacy / f".deskaura-memu-markdown.{role_digest(role_id)}.json"
            new_manifest = directory / ".memory_manifest.json"
            if old_manifest.is_file() and not new_manifest.exists():
                shutil.copy2(old_manifest, new_manifest)
        current = directory
        while current != current.parent:
            if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
                raise ValueError("记忆路径不能经过符号链接或目录联接")
            current = current.parent
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "memory").mkdir(exist_ok=True)
        (directory / "skill").mkdir(exist_ok=True)
        return directory

    def _index_directory(self, role_id: str | None) -> Path:
        """SQLite archive/index location kept separate from the Markdown store."""
        target = self._directory(role_id)
        configured = str(self._shared_settings(role_id).get("memory_path") or "").strip()
        if configured:
            legacy = Path(configured).expanduser()
            if legacy.is_file():
                legacy = legacy.parent
            if legacy != target and legacy.is_dir():
                for filename in (
                    "memory.db", "memu.db", "memu-builtin.db",
                    "memu.db-wal", "memu.db-shm", "memu-builtin.db-wal", "memu-builtin.db-shm",
                ):
                    source, destination = legacy / filename, target / filename
                    if source.is_file() and not destination.exists():
                        shutil.copy2(source, destination)
        return target

    @staticmethod
    def _safe_markdown_name(name: str, fallback: str) -> str:
        value = re.sub(r"[^0-9A-Za-z._-]+", "-", str(name or "")).strip("-._")
        return (value or fallback)[:160]

    @staticmethod
    def _markdown_manifest(role_id: str | None, base: Path) -> Path:
        return base / ".memory_manifest.json"

    @staticmethod
    def _read_markdown_manifest(path: Path) -> dict[str, str]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return {str(key): str(item) for key, item in value.items()} if isinstance(value, dict) else {}
        except (OSError, ValueError, TypeError):
            return {}

    def _markdown_paths(self, base: Path) -> dict[str, tuple[Path, str]]:
        result = {}
        for track in ("memory", "skill"):
            directory = base / track
            if not directory.is_dir():
                continue
            for path in sorted(directory.glob("*.md")):
                result[path.relative_to(base).as_posix()] = (path, track)
        return result

    async def _import_markdown(self, role_id: str | None, service) -> int:
        """Commit Markdown files changed outside DeskAura back into MemU."""
        base = self._storage_directory(role_id)
        manifest_path = self._markdown_manifest(role_id, base)
        manifest = self._read_markdown_manifest(manifest_path)
        current, changed = {}, []
        from memu.hosts.bridging.recall_files import read_recall_file
        for relative, (path, track) in self._markdown_paths(base).items():
            try:
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
            except OSError:
                continue
            current[relative] = digest
            if manifest.get(relative) == digest:
                continue
            try:
                item = read_recall_file(path, track)
            except (OSError, ValueError, TypeError):
                continue
            item["name"] = str(item.get("name") or path.stem).strip()
            if item["name"]:
                changed.append(item)
        if changed:
            await service.commit_results(recall_files=changed, user={"user_id": role_key(role_id)})
            self._validate_vectors(service)
        manifest_path.write_text(json.dumps(current, ensure_ascii=True, indent=2), encoding="utf-8")
        return len(changed)

    def _mirror_markdown(self, role_id: str | None, service) -> int:
        """Mirror all role recall files to MemU-compatible Markdown files."""
        base = self._storage_directory(role_id)
        database = getattr(service, "database", service)
        records = database.recall_file_repo.list_recall_files(
            {"user_id": role_key(role_id)})
        expected, manifest, used = set(), {}, set()
        for record in records.values():
            track = record.track if record.track in {"memory", "skill"} else "memory"
            directory = base / track
            directory.mkdir(parents=True, exist_ok=True)
            stem = self._safe_markdown_name(record.name, record.id)
            candidate, suffix = stem, 2
            while f"{track}/{candidate}.md" in used:
                candidate = f"{stem}-{suffix}"
                suffix += 1
            relative = f"{track}/{candidate}.md"
            used.add(relative)
            path = base / relative
            text = (
                f"---\nname: {record.name}\ndescription: {record.description or ''}\n---\n"
                f"{record.content or ''}"
            )
            path.write_text(text, encoding="utf-8")
            manifest[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
            expected.add(relative)
        # Imported Markdown is now represented by MemU records, so stale mirrored
        # files can be removed without discarding uncommitted user edits.
        for relative, (path, _track) in self._markdown_paths(base).items():
            if relative not in expected:
                path.unlink(missing_ok=True)
        self._markdown_manifest(role_id, base).write_text(
            json.dumps(manifest, ensure_ascii=True, indent=2), encoding="utf-8")
        return len(records)

    def _deletion_directory(self, role_id: str | None) -> Path:
        """Validate owned paths before opening a database or deleting anything."""
        role = role_key(role_id)
        directory = self.config_path.parent if role == "default" else self.root / role_digest(role)
        if directory.is_symlink() or getattr(directory, "is_junction", lambda: False)():
            raise ValueError("角色目录不能是链接")
        if role != "default" and (
            directory.resolve().parent != self.root.resolve() or directory.resolve().name != role_digest(role)
        ):
            raise ValueError("角色目录无效")
        for filename in ("memory.db", "memory.db-wal", "memory.db-shm",
                         "memu.db", "memu.db-wal", "memu.db-shm",
                         "memu-builtin.db", "memu-builtin.db-wal", "memu-builtin.db-shm"):
            target = directory / filename
            if target.is_symlink() or getattr(target, "is_junction", lambda: False)():
                raise ValueError("记忆数据库不能是链接")
        return directory

    def archive_for(self, role_id: str | None) -> MemoryStore:
        role = role_key(role_id)
        self._touch_role(role)
        path = self._index_directory(role) / "memory.db"
        current = self._archives.get(role)
        if current is not None and Path(current.path).resolve() == path.resolve():
            return current
        self._archives[role] = MemoryStore(str(path))
        return self._archives[role]

    def _key_name(self, role_id: str | None) -> str:
        return "memory-embedding-api-key" + (f":{role_digest(role_id)}" if role_key(role_id) != "default" else "")

    def _get_key(self, role_id: str | None) -> str:
        try:
            return keyring.get_password("DeskAura", self._key_name(role_id)) or ""
        except keyring.errors.KeyringError:
            return ""

    def _config_path(self, role_id: str | None) -> Path:
        return self.config_path if role_key(role_id) == "default" else self._directory(role_id) / "config.json"

    def _shared_settings(self, role_id: str | None) -> dict[str, Any]:
        try:
            value = json.loads(self._config_path(role_id).read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (ValueError, OSError):
            return {}

    def _metadata(self, role_id: str | None) -> dict[str, Any]:
        value = self._shared_settings(role_id)
        return {
            "enabled": value.get("memory_enabled", True),
            "tag": value.get("memory_tag", "MemU"),
            "deployment": value.get("memory_connection_mode", "cloud"),
            "local_provider": value.get("memory_local_provider", "external"),
            "base_url": value.get("memory_embedding_base_url", "https://api.openai.com/v1"),
            "model": value.get("memory_embedding_model", "text-embedding-3-small"),
            "memory_path": value.get("memory_path", ""),
        }

    def _signature(self, role_id: str | None) -> str:
        return hashlib.sha256(json.dumps({
            **self._metadata(role_id), "key": self._get_key(role_id),
        }, sort_keys=True).encode("utf-8")).hexdigest()

    def configured(self, role_id: str | None) -> bool:
        value = self._shared_settings(role_id)
        return any(key.startswith("memory_") for key in value) or os.getenv("MEMORY_PROVIDER", "").lower() == "memu"

    def get_config(self, role_id: str | None) -> dict[str, Any]:
        config = MemoryConfig(**self._metadata(role_id)).model_dump(exclude={"api_key"})
        config["memory_path"] = str(self._storage_directory(role_id))
        key = self._get_key(role_id)
        return {
            **config, "provider": "memu", "has_api_key": bool(key),
            "api_key_masked": _masked(key), "status": self.provider_info(role_id),
        }

    def save_config(self, role_id: str | None, config: MemoryConfig) -> dict[str, Any]:
        _validate_endpoint(config)
        path = self._config_path(role_id)
        if config.api_key and config.api_key.strip():
            keyring.set_password("DeskAura", self._key_name(role_id), config.api_key.strip())
        value = {**self._shared_settings(role_id),
                 "memory_enabled": config.enabled, "memory_tag": config.tag,
                 "memory_provider": "memu", "memory_connection_mode": config.deployment,
                 "memory_local_provider": config.local_provider,
                 "memory_embedding_base_url": config.base_url, "memory_embedding_model": config.model}
        value["memory_path"] = config.memory_path
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=True, indent=2), encoding="utf-8")
        temporary.replace(path)
        role = role_key(role_id)
        self._touch_role(role)
        cached = self._services.pop(role, None)
        if cached:
            cached[1].database.close()
        self._states.pop(role, None)
        return self.get_config(role)

    def clear_key(self, role_id: str | None) -> dict[str, Any]:
        try:
            keyring.delete_password("DeskAura", self._key_name(role_id))
        except keyring.errors.PasswordDeleteError:
            pass
        role = role_key(role_id)
        self._touch_role(role)
        cached = self._services.pop(role, None)
        if cached:
            cached[1].database.close()
        self._states.pop(role, None)
        return self.get_config(role_id)

    def provider_info(self, role_id: str | None) -> dict[str, Any]:
        # Existing installations remain readable until the user saves a MemU
        # profile.  It is explicitly labelled legacy, not MemU.
        if not self.configured(role_id):
            return {"requested": "memu", "active": "sqlite", "available": True, "verified": False,
                    "fallback": True, "method": "fts5", "detail": "旧版记忆归档；请配置 MemU Embedding"}
        try:
            version = importlib.metadata.version("memu-cli")
        except importlib.metadata.PackageNotFoundError:
            return {"requested": "memu", "active": None, "available": False, "verified": False,
                    "fallback": False, "detail": "未安装 MemU 运行库"}
        config = MemoryConfig(**self._metadata(role_id))
        if not config.enabled:
            return {"requested": "memu", "active": None, "available": False, "verified": False,
                    "fallback": False, "detail": "记忆已停用", "version": version}
        ready = bool(self._get_key(role_id)) or config.deployment == "local"
        try:
            _validate_endpoint(config)
        except ValueError:
            ready = False
        if self._builtin(config):
            try:
                from deskaura_local.runtime import model_available
                ready = model_available("embedding")
            except (ImportError, OSError):
                ready = False
        state = self._states.get(role_key(role_id), {})
        if state.get("signature") != self._signature(role_id):
            state = {}
        return {"requested": "memu", "active": "memu", "available": ready,
                "verified": state.get("verified", False), "fallback": False, "method": "embedding",
                "version": version, "detail": state.get("detail") or ("尚未检测" if ready else
                    "内置向量模型文件或运行库缺失" if self._builtin(config) else "请配置 Embedding 密钥")}

    @staticmethod
    def _builtin(config: MemoryConfig) -> bool:
        return config.deployment == "local" and config.local_provider == "built_in"

    def _service(self, role_id: str | None):
        from memu import MemoryService
        from memu.embedding.gateway import EMBEDDING_CLIENT_BUILDERS

        config = MemoryConfig(**self._metadata(role_id))
        if not config.enabled:
            raise RuntimeError("记忆已停用")
        _validate_endpoint(config)
        key = self._get_key(role_id)
        if not key and config.deployment != "local":
            raise RuntimeError("请配置 Embedding 密钥")
        role = role_key(role_id)
        self._touch_role(role)
        signature = self._signature(role_id)
        cached = self._services.get(role)
        if cached and cached[0] == signature:
            return cached[1]
        if cached:
            cached[1].database.close()
        EMBEDDING_CLIENT_BUILDERS["deskaura_httpx"] = _ValidatedEmbeddingClient
        EMBEDDING_CLIENT_BUILDERS["deskaura_builtin"] = _BuiltinEmbeddingClient
        profile = {"provider": "openai", "client_backend": "deskaura_httpx",
                   "base_url": config.base_url.rstrip("/"), "api_key": key or "local",
                   "embed_model": config.model}
        # Keep the bundled model's dimensions separate from any pre-existing
        # cloud vectors. Both indexes derive from the same lossless archive.
        filename = "memu.db"
        if self._builtin(config):
            from deskaura_local.runtime import EMBEDDING_MODEL
            profile.update(client_backend="deskaura_builtin", embed_model=EMBEDDING_MODEL,
                           base_url="http://127.0.0.1", api_key="local")
            filename = "memu-builtin.db"
        service = MemoryService(
            database_config={"metadata_store": {"provider": "sqlite",
                "dsn": f"sqlite:///{(self._index_directory(role) / filename).as_posix()}"}},
            embedding_profiles={"default": profile},
            progressive_retrieve_config={"file": {"top_k": 8}, "resource": {"enabled": False}},
        )
        self._services[role] = signature, service
        return service

    @staticmethod
    def _validate_vectors(service) -> None:
        """Refuse a successful HTTP reply containing empty/non-finite vectors."""
        vectors = [row.embedding for row in service.database.recall_files.values()]
        if vectors and any(not vector or any(not math.isfinite(float(x)) for x in vector) for vector in vectors):
            raise RuntimeError("Embedding 未返回有效向量")

    async def _migrate(self, role_id: str | None, service) -> None:
        archive = self.archive_for(role_id)
        with archive._connection() as connection:
            rows = connection.execute("SELECT id, session_id, user_message FROM conversations ORDER BY id").fetchall()
        existing = service.database.recall_file_repo.list_recall_files()
        # A transport failure can occur after the file row was inserted but
        # before its searchable segments were committed. Re-submit those
        # partial records rather than treating the name alone as completion.
        names = {
            row.name for row in existing.values()
            if service.database.recall_file_segment_repo.list_segments_for_file(row.id)
        }
        for row in rows:
            name = f"session/{hashlib.sha256(row['session_id'].encode()).hexdigest()[:20]}/{row['id']}"
            if name in names:
                continue
            text = row["user_message"].strip()
            if not text:
                continue
            await service.commit_results(recall_files=[{
                "name": name, "track": "memory", "description": text[:200],
                "content": f"# 对话中的用户信息\n\n{text}",
            }], user={"user_id": role_key(role_id)})
            names.add(name)
        self._validate_vectors(service)

    async def test(self, role_id: str | None) -> dict[str, Any]:
        role = role_key(role_id)
        signature = self._signature(role)
        lock = self._locks.setdefault(role, asyncio.Lock())
        self._states[role] = {"verified": False, "detail": "检测中"}
        try:
            async with lock:
                service = self._service(role)
                await asyncio.wait_for(self._import_markdown(role, service), timeout=120)
                # The test lives in an independent in-memory MemU database so
                # it can prove write+embedding+retrieve without polluting history.
                from memu import MemoryService
                probe = MemoryService(database_config={"metadata_store": {"provider": "inmemory"}},
                                      embedding_profiles=service.embedding_profiles)
                try:
                    await asyncio.wait_for(probe.commit_results(recall_files=[{
                        "name": "deskaura-connectivity", "track": "memory",
                        "description": "DeskAura 记忆链路检测", "content": "# 检测\n\n记忆链路检测专用。",
                    }], user={"user_id": role}), timeout=45)
                    self._validate_vectors(probe)
                    result = await asyncio.wait_for(probe.progressive_retrieve("记忆链路检测", {"user_id": role}), timeout=45)
                    if not result.get("segments") and not result.get("files"):
                        raise RuntimeError("MemU 未检索到检测记录")
                finally:
                    probe.database.close()
                await asyncio.wait_for(self._migrate(role, service), timeout=120)
                self._mirror_markdown(role, service)
            if signature != self._signature(role):
                raise RuntimeError("记忆配置已改变")
            self._states[role] = {"verified": True, "detail": "正常", "signature": signature}
        except Exception:
            self._states[role] = {"verified": False, "detail": "MemU 检测失败，请检查 Embedding 地址、模型、密钥与额度",
                                  "signature": signature}
        return {"ok": self._states[role]["verified"], "provider": self.provider_info(role)}

    async def add_conversation(self, role_id: str | None, payload: ConversationIn) -> dict[str, Any]:
        memories = self.archive_for(role_id).add_conversation(payload)
        if not self.configured(role_id):
            return {"memories": memories, "provider": self.provider_info(role_id)}
        role = role_key(role_id)
        signature = self._signature(role)
        try:
            async with self._locks.setdefault(role, asyncio.Lock()):
                if signature != self._signature(role):
                    raise RuntimeError("记忆配置已改变")
                service = self._service(role)
                await asyncio.wait_for(self._import_markdown(role, service), timeout=120)
                await asyncio.wait_for(self._migrate(role, service), timeout=120)
                self._mirror_markdown(role, service)
            if signature != self._signature(role):
                raise RuntimeError("记忆配置已改变")
            self._states[role] = {"verified": True, "detail": "正常", "signature": signature}
        except Exception:
            self._states[role] = {"verified": False, "detail": "本轮已归档；MemU 索引失败，待连接恢复后重试",
                                  "signature": signature}
        return {"memories": memories, "provider": self.provider_info(role)}

    async def search(self, role_id: str | None, query: str, top_k: int) -> dict[str, Any]:
        if not self.configured(role_id):
            return {"memories": self.archive_for(role_id).search(query, top_k),
                    "provider": self.provider_info(role_id)}
        role = role_key(role_id)
        signature = self._signature(role)
        try:
            async with self._locks.setdefault(role, asyncio.Lock()):
                if signature != self._signature(role):
                    raise RuntimeError("记忆配置已改变")
                service = self._service(role)
                await asyncio.wait_for(self._import_markdown(role, service), timeout=120)
                result = await asyncio.wait_for(service.progressive_retrieve(query or "用户的重要信息", {"user_id": role}), timeout=45)
            if signature != self._signature(role):
                raise RuntimeError("记忆配置已改变")
            memories = []
            seen = set()
            for item in result.get("segments", []):
                text = str(item.get("text") or item.get("content") or "").strip()
                if not text or text in seen:
                    continue
                seen.add(text)
                memories.append(MemoryItem(
                    id=int(hashlib.sha256(str(item.get("id", text)).encode()).hexdigest()[:12], 16),
                    category="relationship", content=text, confidence=.8,
                    created_at=datetime.now(timezone.utc)))
                if len(memories) >= top_k:
                    break
            prior = self._states.get(role, {})
            verified = bool(memories) or bool(prior.get("verified") and prior.get("signature") == signature)
            self._states[role] = {"verified": verified, "detail": "正常" if verified else "尚未检测",
                                  "signature": signature}
            return {"memories": memories, "provider": self.provider_info(role)}
        except Exception:
            self._states[role] = {"verified": False, "detail": "MemU 检索失败，请检查配置与连接",
                                  "signature": signature}
            # Never silently switch configured MemU back to keyword recall.
            return {"memories": [], "provider": self.provider_info(role)}

    def delete_session(self, role_id: str | None, session_id: str) -> None:
        role = role_key(role_id)
        self._touch_role(role)
        directory = self._index_directory(role)
        index_paths = [directory / name for name in ("memu.db", "memu-builtin.db") if (directory / name).exists()]
        if index_paths:
            # Index deletion is a local database operation. Do not require an
            # enabled module, saved credentials or a reachable Embedding API.
            from memu.app.settings import DatabaseConfig, UserConfig
            from memu.database.factory import build_database

            cached = self._services.pop(role, None)
            if cached:
                cached[1].database.close()
            for index_path in index_paths:
                database = build_database(
                    config=DatabaseConfig(metadata_store={"provider": "sqlite",
                        "dsn": f"sqlite:///{index_path.as_posix()}"}),
                    user_model=UserConfig().model,
                )
                try:
                    prefix = f"session/{hashlib.sha256(session_id.encode()).hexdigest()[:20]}/"
                    files = database.recall_file_repo.list_recall_files({"user_id": role})
                    for item in files.values():
                        if not item.name.startswith(prefix):
                            continue
                        database.recall_file_segment_repo.delete_segments_for_file(item.id)
                        database.recall_file_repo.clear_recall_files({"id": item.id})
                    self._mirror_markdown(role, database)
                finally:
                    database.close()
        # Keep source conversations intact if local index removal failed.
        self.archive_for(role).delete_session(session_id)

    def delete_role(self, role_id: str | None) -> dict[str, Any]:
        """Delete only the explicitly selected character's owned records."""
        role = role_key(role_id)
        self._touch_role(role)
        if role == "default":
            raise ValueError("不能删除默认兼容空间")
        self._deletion_directory(role)
        directory = self._index_directory(role)
        archive = self.archive_for(role)
        with archive._connection() as connection:
            for table in ("conversations", "memories", "relationship_events", "relationship_daily"):
                connection.execute(f"DELETE FROM {table}")
        # Clearing MemU tables is recoverable only via the user's exports;
        # the source model file is deliberately never touched.
        cached = self._services.pop(role, None)
        if cached:
            cached[1].database.close()
        for filename in ("memu.db", "memu.db-wal", "memu.db-shm",
                         "memu-builtin.db", "memu-builtin.db-wal", "memu-builtin.db-shm"):
            (directory / filename).unlink(missing_ok=True)
        memory_directory = self._storage_directory(role)
        manifest_path = self._markdown_manifest(role, memory_directory)
        for relative in self._read_markdown_manifest(manifest_path):
            target = memory_directory / relative
            if target.is_file() and target.resolve().is_relative_to(memory_directory.resolve()):
                target.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        self.clear_key(role)
        self._archives.pop(role, None)
        self._role_last_used.pop(role, None)
        self._states.pop(role, None)
        return {"ok": True}
