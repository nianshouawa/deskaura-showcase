"""Per-character persona documents with genuine embedding-based retrieval."""

from __future__ import annotations

import hashlib
import asyncio
import io
import json
import math
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, Field

from .config import ConfigStore, ModelSettings, normalized_role, private_model_endpoint, role_scope, role_slug


class PersonaEmbedding(BaseModel):
    deployment: str = Field(default="cloud", pattern="^(cloud|local)$")
    local_provider: str = Field(default="external", pattern="^(built_in|external)$")
    tag: str = Field(default="人设检索", max_length=80)
    base_url: str = Field(default="https://api.openai.com/v1", max_length=500)
    model: str = Field(default="text-embedding-3-small", min_length=1, max_length=200)
    api_key: str | None = Field(default=None, max_length=2000)


class PersonaSettings(BaseModel):
    enabled: bool = True
    template: str = Field(default="无", max_length=80)
    text: str = Field(default="", max_length=100000)
    embedding: PersonaEmbedding = Field(default_factory=PersonaEmbedding)


class PersonaError(RuntimeError):
    pass


def _role(role_id: str | None) -> str:
    return (str(role_id or "default").strip() or "default")[:128]


def _digest(role_id: str | None) -> str:
    return role_slug(_role(role_id))


def _mask(key: str) -> str:
    return f"{key[:3]}******{key[-4:]}" if len(key) > 8 else "*" * len(key)


def _chunks(text: str, max_chars: int = 750) -> list[str]:
    """Keep headings together where possible, with bounded overlapping chunks."""
    clean = text.replace("\x00", "").strip()
    if not clean:
        return []
    result: list[str] = []
    offset = 0
    while offset < len(clean):
        end = min(len(clean), offset + max_chars)
        if end < len(clean):
            boundary = clean.rfind("\n", offset + max_chars // 2, end)
            if boundary > offset:
                end = boundary
        result.append(clean[offset:end].strip())
        if end >= len(clean):
            break
        offset = max(offset + 1, end - 100)
    return [item for item in result if item][:320]


class PersonaStore:
    def __init__(self, root_dir: str | Path | None = None, *, config_store: ConfigStore | None = None) -> None:
        self.config = config_store or ConfigStore(str(Path(root_dir) / "config.json") if root_dir is not None else None)
        self.root = self.config.base_path.parent / "roles"
        self.root.mkdir(parents=True, exist_ok=True)
        self._states: dict[str, dict[str, Any]] = {}

    def _directory(self, role_id: str | None) -> Path:
        path = self.config.base_path.parent if _role(role_id) == "default" else self.root / _digest(role_id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _path(self, role_id: str | None) -> Path:
        return self._directory(role_id) / "config.json"

    def _index(self, role_id: str | None) -> Path:
        return self._directory(role_id) / "persona-index.json"

    def _key(self, role_id: str | None) -> str:
        with role_scope(_role(role_id)):
            return self.config.secret("persona_embedding_api_key")

    def _settings(self, role_id: str | None) -> PersonaSettings:
        with role_scope(_role(role_id)):
            value = self.config.get()
        return PersonaSettings(
            enabled=value["persona_enabled"], template=value["persona_template"], text=value["persona_text"],
            embedding=PersonaEmbedding(
                deployment=value["persona_connection_mode"], tag=value["persona_tag"],
                local_provider=value.get("persona_local_provider", "external"),
                base_url=value["persona_embedding_base_url"], model=value["persona_embedding_model"],
            ),
        )

    def get(self, role_id: str | None) -> dict[str, Any]:
        settings = self._settings(role_id)
        key = self._key(role_id)
        config = settings.model_dump(exclude={"embedding": {"api_key"}})
        config["embedding"].update({"has_api_key": bool(key), "api_key_masked": _mask(key)})
        index_exists = self._index(role_id).exists()
        state = self._states.get(_role(role_id), {})
        if state.get("signature") != self._signature(role_id):
            state = {}
        return {**config, "status": state or {
            "verified": False, "detail": "尚未检测" if index_exists else "尚未建立索引",
        }}

    def save(self, role_id: str | None, payload: PersonaSettings | dict[str, Any]) -> dict[str, Any]:
        settings = payload if isinstance(payload, PersonaSettings) else PersonaSettings.model_validate(payload)
        if not self._builtin(settings.embedding):
            self._validate_url(settings.embedding.base_url)
            if settings.embedding.deployment == "local" and not private_model_endpoint(settings.embedding.base_url):
                raise PersonaError("本地 Embedding 地址需要使用本机或局域网地址")
        with role_scope(_role(role_id)):
            self.config.save(ModelSettings.model_validate({
                **self.config._read_file(), "persona_enabled": settings.enabled,
                "persona_template": settings.template, "persona_text": settings.text,
                "persona_tag": settings.embedding.tag,
                "persona_connection_mode": settings.embedding.deployment,
                "persona_local_provider": settings.embedding.local_provider,
                "persona_embedding_base_url": settings.embedding.base_url,
                "persona_embedding_model": settings.embedding.model,
                "persona_embedding_api_key": settings.embedding.api_key,
            }))
        self._states.pop(_role(role_id), None)
        return self.get(role_id)

    def clear_key(self, role_id: str | None) -> dict[str, Any]:
        with role_scope(_role(role_id)):
            self.config._delete_secret("persona-embedding-api-key")
        self._states.pop(_role(role_id), None)
        return self.get(role_id)

    @staticmethod
    def _validate_url(value: str) -> None:
        try:
            parts = urlsplit(value)
            valid = (parts.scheme in {"http", "https"} and parts.hostname and not parts.username and not parts.password
                     and not parts.query and not parts.fragment and parts.port != 0)
        except ValueError:
            valid = False
        if not valid:
            raise PersonaError("Embedding 地址需要有效的 HTTP(S) API 根地址，不能包含账号或密码")

    async def _embed(self, role_id: str | None, texts: list[str]) -> list[list[float]]:
        settings = self._settings(role_id)
        embedding = settings.embedding
        if self._builtin(embedding):
            try:
                from deskaura_local.runtime import embed_texts
                return await asyncio.to_thread(embed_texts, texts)
            except Exception:
                raise PersonaError("内置人设向量模型运行失败，请检查完整安装包与本地模型文件") from None
        self._validate_url(embedding.base_url)
        if embedding.deployment == "local" and not private_model_endpoint(embedding.base_url):
            raise PersonaError("本地 Embedding 地址需要使用本机或局域网地址")
        key = self._key(role_id)
        if not key and embedding.deployment != "local":
            raise PersonaError("请配置人设 Embedding 密钥")
        base = embedding.base_url.rstrip("/")
        if base.endswith("/embeddings"):
            url = base
        else:
            url = f"{base}/embeddings"
        try:
            async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
                response = await client.post(url, json={"model": embedding.model, "input": texts},
                                             headers={"Authorization": f"Bearer {key or 'local'}"})
                response.raise_for_status()
                value = response.json()
            rows = value.get("data")
            if not isinstance(rows, list) or len(rows) != len(texts):
                raise ValueError()
            ordered = sorted(rows, key=lambda row: int(row.get("index", 0)))
            vectors = [row["embedding"] for row in ordered]
            dimension = len(vectors[0])
            if not dimension or any(not isinstance(vector, list) or len(vector) != dimension or
                any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in vector) or
                sum(float(x) ** 2 for x in vector) <= 0 for vector in vectors):
                raise ValueError()
            return vectors
        except (httpx.HTTPError, ValueError, TypeError, KeyError, IndexError):
            raise PersonaError("Embedding 调用失败，请检查地址、模型、密钥与额度") from None

    @staticmethod
    def _builtin(embedding: PersonaEmbedding) -> bool:
        return embedding.deployment == "local" and embedding.local_provider == "built_in"

    def _signature(self, role_id: str | None) -> str:
        settings = self._settings(role_id)
        value = settings.model_dump(exclude={"embedding": {"api_key"}})
        value["key_hash"] = hashlib.sha256(self._key(role_id).encode()).hexdigest()
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

    async def _build_index(self, role_id: str | None) -> dict[str, Any]:
        signature = self._signature(role_id)
        settings = self._settings(role_id)
        chunks = _chunks(settings.text)
        if not chunks:
            raise PersonaError("请先填写或导入角色设定")
        vectors = []
        for start in range(0, len(chunks), 16):
            vectors.extend(await self._embed(role_id, chunks[start:start + 16]))
        if signature != self._signature(role_id):
            raise PersonaError("人设配置已改变，请重新检测")
        index = {"signature": signature, "chunks": chunks, "vectors": vectors}
        # The complete new index is only committed after every chunk succeeded.
        self._index(role_id).write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
        return index

    async def test(self, role_id: str | None) -> dict[str, Any]:
        role = _role(role_id)
        signature = self._signature(role)
        self._states[role] = {"verified": False, "detail": "检测中"}
        try:
            settings = self._settings(role)
            if not settings.enabled:
                raise PersonaError("人设已停用")
            index = await self._build_index(role)
            query = await self._embed(role, [index["chunks"][0][:160]])
            if len(query[0]) != len(index["vectors"][0]):
                raise PersonaError("Embedding 索引与查询向量维度不一致")
            result = await self.retrieve(role, settings.text[:160])
            if not result:
                raise PersonaError("人设索引回读失败")
            if signature != self._signature(role):
                raise PersonaError("人设配置已改变，请重新检测")
            self._states[role] = {"verified": True, "detail": "正常", "chunks": len(index["chunks"]),
                                  "signature": self._signature(role)}
        except PersonaError as error:
            self._states[role] = {"verified": False, "detail": str(error), "signature": signature}
        except Exception:
            self._states[role] = {"verified": False, "detail": "人设检测失败，请检查文档与 Embedding 配置",
                                  "signature": signature}
        return {"ok": self._states[role]["verified"], **self._states[role]}

    async def retrieve(self, role_id: str | None, query: str, top_k: int = 4) -> str:
        settings = self._settings(role_id)
        if not settings.enabled or not settings.text.strip():
            return ""
        # A short core identity is always available, even before embeddings.
        core = settings.text[:1600]
        if not self._key(role_id) and settings.embedding.deployment != "local":
            return f"角色核心设定（尚未配置向量检索）：\n{core}"
        try:
            index = json.loads(self._index(role_id).read_text(encoding="utf-8"))
            if index.get("signature") != self._signature(role_id):
                index = await self._build_index(role_id)
        except (OSError, ValueError):
            index = await self._build_index(role_id)
        vector = (await self._embed(role_id, [query[:4000] or "角色身份与说话风格"]))[0]
        dimension = len(vector)
        if any(len(value) != dimension for value in index["vectors"]):
            raise PersonaError("Embedding 模型向量维度已变化，请重新检测")
        query_norm = math.sqrt(sum(float(x) ** 2 for x in vector))
        ranked = []
        for text, target in zip(index["chunks"], index["vectors"], strict=True):
            norm = math.sqrt(sum(float(x) ** 2 for x in target))
            score = sum(float(a) * float(b) for a, b in zip(vector, target, strict=True)) / (query_norm * norm) if norm else -1
            ranked.append((score, text))
        snippets = [text for _, text in sorted(ranked, key=lambda item: item[0], reverse=True)[:max(1, min(top_k, 8))]]
        return f"角色核心设定：\n{core}\n\n与本轮相关的人设资料：\n" + "\n\n".join(snippets)

    def import_document(self, role_id: str | None, filename: str, content: bytes) -> dict[str, Any]:
        if len(content) > 10 * 1024 * 1024:
            raise PersonaError("文档不能超过 10 MB")
        suffix = Path(filename).suffix.lower()
        try:
            if suffix in {".txt", ".md", ".json"}:
                try:
                    text = content.decode("utf-8-sig")
                except UnicodeDecodeError:
                    text = content.decode("gb18030")
                if suffix == ".json":
                    text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
            elif suffix == ".pdf":
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(content))
                if reader.is_encrypted:
                    raise PersonaError("请先解密 PDF 再导入")
                text = "\n\n".join(page.extract_text() or "" for page in reader.pages[:150])
            elif suffix == ".docx":
                from docx import Document
                document = Document(io.BytesIO(content))
                parts = [paragraph.text for paragraph in document.paragraphs]
                for table in document.tables:
                    parts.extend(" | ".join(cell.text for cell in row.cells) for row in table.rows)
                text = "\n".join(parts)
            else:
                raise PersonaError("支持 TXT、MD、JSON、PDF、DOCX 文档")
        except PersonaError:
            raise
        except Exception:
            raise PersonaError("文档读取失败，请检查格式；扫描版 PDF 需要先进行文字识别") from None
        text = text.replace("\x00", "").strip()
        if not text:
            raise PersonaError("文档没有可读取的文字；扫描版 PDF 需要先进行文字识别")
        if len(text) > 100000:
            raise PersonaError("文档文字超过 100000 字，请拆分后导入")
        return {"filename": Path(filename).name, "text": text, "characters": len(text)}

    def delete(self, role_id: str | None) -> None:
        """Remove only files owned by this particular persona namespace."""
        if _role(role_id) == "default":
            raise PersonaError("不能删除默认兼容空间")
        self.clear_key(role_id)
        self._index(role_id).unlink(missing_ok=True)


_stores: dict[str, PersonaStore] = {}


def store_for(config_store: ConfigStore) -> PersonaStore:
    key = str(config_store.base_path.resolve())
    store = _stores.get(key)
    if store is None:
        store = _stores[key] = PersonaStore(config_store=config_store)
    return store


async def retrieve_persona(query: str, config_store: ConfigStore) -> str:
    """Use the same current-role settings and credentials as the settings API."""
    return await store_for(config_store).retrieve(normalized_role(), query)
