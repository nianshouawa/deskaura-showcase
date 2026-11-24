"""Native models are an explicit local choice, never a silent API fallback."""

import asyncio
from pathlib import Path

import pytest

from app.config import ConfigStore, ModelSettings, role_scope
from app.connectivity import ConnectivityProofs
from app.persona import PersonaStore
from app.recognition import recognition_fingerprint, recognition_status, transcribe
from deskaura_local import runtime


@pytest.fixture
def local_store(tmp_path, monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setattr("keyring.get_password", lambda *args: None)
    return ConfigStore(str(tmp_path / "config.json"))


def test_bundled_persona_uses_native_vectors_without_api(local_store, monkeypatch):
    monkeypatch.setattr("app.persona.httpx.AsyncClient", lambda **kwargs: pytest.fail("builtin must not call HTTP"))
    calls = []

    def embed(texts):
        calls.extend(texts)
        return [[1.0, .4, .2] for _ in texts]

    monkeypatch.setattr(runtime, "embed_texts", embed)
    with role_scope("alice"):
        local_store.save(ModelSettings(persona_connection_mode="local", persona_local_provider="built_in",
                                       persona_text="角色名称：小雨\n身份：森林精灵"))
    personas = PersonaStore(config_store=local_store)
    result = asyncio.run(personas.test("alice"))
    assert result["ok"] and calls
    assert "森林精灵" in asyncio.run(personas.retrieve("alice", "你是谁"))
    assert not asyncio.run(personas.retrieve("bob", "你是谁"))


def test_bundled_asr_does_not_use_saved_cloud_url_or_require_key(local_store, monkeypatch):
    monkeypatch.setattr("app.recognition.httpx.AsyncClient", lambda **kwargs: pytest.fail("builtin must not call HTTP"))
    monkeypatch.setattr(runtime, "transcribe_wav", lambda data, language: "嗯，呃，我我想打开设置。")
    monkeypatch.setattr(runtime, "model_available", lambda kind: kind == "hearing")
    with role_scope("alice"):
        local_store.save(ModelSettings(asr_enabled=True, hearing_connection_mode="local",
                                       hearing_local_provider="built_in"))
        assert recognition_status(local_store)["configured"]
        fixture = b"RIFF" + bytes(4) + b"WAVE" + bytes(100)
        assert asyncio.run(transcribe(fixture, local_store)) == {"text": "我想打开设置。"}
        assert recognition_status(local_store)["provider_verified"]


def test_missing_bundled_model_is_not_reported_available(local_store, monkeypatch, tmp_path):
    monkeypatch.setenv("DESKAURA_LOCAL_MODELS_DIR", str(tmp_path / "missing"))
    with role_scope("alice"):
        local_store.save(ModelSettings(asr_enabled=True, hearing_connection_mode="local",
                                       hearing_local_provider="built_in"))
        assert not recognition_status(local_store)["configured"]
        assert not recognition_status(local_store)["provider_verified"]
    assert runtime.model_directory() == tmp_path / "missing"
    assert not runtime.model_available("embedding")


def test_recognition_proofs_expire_on_deployment_and_builtin_switch(local_store):
    proofs = ConnectivityProofs()
    with role_scope("alice"):
        local_store.save(ModelSettings(asr_enabled=True))
        original = proofs.signature("recognition", local_store)
        native_fingerprint = recognition_fingerprint(local_store.asr_config())
        local_store.save(ModelSettings(hearing_connection_mode="local", asr_base_url="http://127.0.0.1:8003/v1"))
        assert proofs.signature("recognition", local_store) != original
        local_signature = proofs.signature("recognition", local_store)
        local_store.save(ModelSettings(hearing_local_provider="built_in"))
        assert proofs.signature("recognition", local_store) != local_signature
        assert recognition_fingerprint(local_store.asr_config()) != native_fingerprint


def test_real_bundled_embedding_and_speech_fixture():
    if not runtime.model_available("embedding") or not runtime.model_available("hearing"):
        pytest.skip("Full installation model assets are not present")
    import numpy as np
    vectors = np.asarray(runtime.embed_texts(["我喜欢爵士音乐", "我爱听爵士乐", "请帮我修复电脑"]))
    assert vectors.shape[0] == 3 and vectors.shape[1] > 0
    assert np.isfinite(vectors).all()
    assert np.allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-5)
    assert np.dot(vectors[0], vectors[1]) > np.dot(vectors[0], vectors[2])
    fixture = Path(__file__).parents[1] / "app" / "assets" / "connectivity.wav"
    text = runtime.transcribe_wav(fixture.read_bytes())
    assert text.strip() and any("\u3400" <= char <= "\u9fff" for char in text)
