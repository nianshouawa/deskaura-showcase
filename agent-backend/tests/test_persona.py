"""Persona documents are per-role and embeddings are really validated."""

import asyncio
import io
import json

import pytest

from app.persona import PersonaError, PersonaStore


@pytest.fixture
def personas(tmp_path, monkeypatch):
    keys = {}
    monkeypatch.setattr("keyring.get_password", lambda service, name: keys.get(name))
    monkeypatch.setattr("keyring.set_password", lambda service, name, key: keys.__setitem__(name, key))
    monkeypatch.setattr("keyring.delete_password", lambda service, name: keys.pop(name, None))
    return PersonaStore(tmp_path)


def test_role_persona_persistence_and_secret_masking(personas):
    saved = personas.save("a", {"text": "角色名称：小雨", "embedding": {"api_key": "secret-persona-key"}})
    assert saved["text"] == "角色名称：小雨"
    assert saved["embedding"]["has_api_key"]
    assert "secret-persona-key" not in str(saved)
    assert "secret-persona-key" not in personas._path("a").read_text(encoding="utf-8")
    assert personas.get("b")["text"] == ""
    assert not personas.get("b")["embedding"]["has_api_key"]


def test_persona_builds_vectors_and_retrieves(personas, monkeypatch):
    personas.save("a", {"text": "角色名称：小雨\n身份：精灵\n性格：勇敢\n说话风格：简洁",
                        "embedding": {"api_key": "secret-persona-key"}})
    calls = []

    async def embed(role, texts):
        calls.extend(texts)
        return [[1.0, float("精灵" in text), .3] for text in texts]

    monkeypatch.setattr(personas, "_embed", embed)
    result = asyncio.run(personas.test("a"))
    assert result["ok"]
    assert calls
    assert personas._index("a").exists()
    assert "精灵" in asyncio.run(personas.retrieve("a", "你是谁"))
    assert not asyncio.run(personas.retrieve("b", "你是谁"))


def test_persona_real_http_embedding_validation(personas, monkeypatch):
    import httpx

    personas.save("a", {"text": "角色：小雨", "embedding": {"api_key": "secret-persona-key"}})
    seen = []

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            seen.append((url, kwargs["json"]))
            return httpx.Response(200, request=httpx.Request("POST", url),
                json={"data": [{"index": 0, "embedding": [1, .2]}]})

    monkeypatch.setattr("app.persona.httpx.AsyncClient", Client)
    assert asyncio.run(personas._embed("a", ["hello"])) == [[1, .2]]
    assert seen[0][0].endswith("/embeddings")


def test_persona_failure_revokes_green(personas, monkeypatch):
    personas.save("a", {"text": "角色：小雨", "embedding": {"api_key": "secret-persona-key"}})

    async def fail(*args):
        raise PersonaError("Embedding 调用失败")

    personas._states["a"] = {"verified": True, "detail": "正常"}
    monkeypatch.setattr(personas, "_embed", fail)
    assert not asyncio.run(personas.test("a"))["ok"]
    assert not personas.get("a")["status"]["verified"]


def test_document_import_text_json_docx(personas):
    assert personas.import_document("a", "intro.txt", "我是精灵".encode())["text"] == "我是精灵"
    assert "身份" in personas.import_document("a", "intro.json", '{"身份":"精灵"}'.encode())["text"]
    from docx import Document
    document = Document()
    document.add_paragraph("性格：勇敢")
    content = io.BytesIO()
    document.save(content)
    assert "勇敢" in personas.import_document("a", "intro.docx", content.getvalue())["text"]
    with pytest.raises(PersonaError):
        personas.import_document("a", "file.exe", b"binary")


@pytest.mark.parametrize("url", [
    "https://example.com/v1?key=secret", "https://example.com/v1#secret",
    "https://host:wrong/v1", "https://[bad", "http://127.0.0.1:0/v1",
])
def test_persona_rejects_unsafe_embedding_endpoint(personas, url):
    with pytest.raises(PersonaError):
        personas.save("a", {"text": "角色：小雨", "embedding": {"base_url": url}})


def test_persona_external_local_requires_private_url_but_builtin_ignores_stale_url(personas):
    with pytest.raises(PersonaError):
        personas.save("a", {"text": "角色：小雨", "embedding": {"deployment": "local"}})
    saved = personas.save("a", {"text": "角色：小雨", "embedding": {
        "deployment": "local", "local_provider": "built_in", "base_url": ""}})
    assert saved["embedding"]["local_provider"] == "built_in"

