"""Configuration normalization must precede writes and preserve page scope."""
import json

import pytest
from fastapi import HTTPException

from app.config import ConfigStore, ModelSettings, role_scope
from app.llm import CompanionLLM


@pytest.fixture
def store(tmp_path, monkeypatch):
    for field in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_PROVIDER"):
        monkeypatch.delenv(field, raising=False)
    monkeypatch.setattr("app.config.keyring.get_password", lambda *args: None)
    monkeypatch.setenv("DESKAURA_CONFIG_PATH", str(tmp_path / "config.json"))
    return ConfigStore()


@pytest.mark.parametrize("address", [
    "https://provider.invalid/path11434", "https://11434.provider.invalid/v1",
    "http://127.0.0.1:11435/11434", "http://127.0.0.1:11434/v1",
])
def test_cloud_never_infers_keyless_ollama_from_port_or_name(store, address):
    with role_scope("cloud"):
        store.save(ModelSettings(base_url=address, brain_connection_mode="cloud"))
        current = store.get()
        assert not current["ready"]
        assert current["provider"] == "openai"
        assert CompanionLLM._configuration()[1] == ""


def test_explicit_local_ollama_and_legacy_endpoint_migration(store):
    with role_scope("local"):
        store.save(ModelSettings(base_url="http://127.0.0.1:11434/v1", brain_connection_mode="local"))
        assert store.get()["ready"] and store.get()["provider"] == "ollama"
        assert CompanionLLM._configuration()[1] == "local"
    with role_scope("legacy"):
        store._write_json(store.path, {"base_url": "http://localhost:11434/v1"})
        assert store.get()["brain_connection_mode"] == "local"
        assert store.get()["provider"] == "ollama"
        store.save(ModelSettings(bubble_enabled=False))
        assert store.get()["brain_connection_mode"] == "local"


def test_default_role_adapter_uses_current_file_before_resolving_provider(store):
    store._write_json(store.path, {"base_url": "http://127.0.0.1:11434/v1",
                                   "model": "local-current", "brain_connection_mode": "local"})
    provider, key, address, model = CompanionLLM._configuration()
    assert (provider, key, address, model) == ("ollama", "local", "http://127.0.0.1:11434/v1", "local-current")


@pytest.mark.parametrize("address", [
    "not-a-url", "ftp://provider.invalid/v1", "https://[broken", "https://provider.invalid:99999/v1",
    "https://name:password@provider.invalid/v1", "https://provider.invalid/v1?key=dummy",
    "https://provider.invalid/{endpoint}", "https://provider.invalid/v1\nsuffix",
])
def test_cloud_endpoint_validation_precedes_credentials_and_file_writes(store, monkeypatch, address):
    writes = []
    monkeypatch.setattr("app.config.keyring.set_password", lambda *args: writes.append(args))
    with pytest.raises(HTTPException) as error:
        store.save(ModelSettings(base_url=address, api_key="dummy-never-saved"))
    assert error.value.status_code == 422
    assert not writes and not store.path.exists()


@pytest.mark.parametrize("module,address_field,other", [
    ("brain", "base_url", {}),
    ("persona", "persona_embedding_base_url", {"persona_local_provider": "external"}),
    ("memory", "memory_embedding_base_url", {"memory_local_provider": "external"}),
    ("hearing", "asr_base_url", {"hearing_local_provider": "external"}),
    ("voice", "audio_base_url", {}),
    ("vision", "vision_base_url", {"vision_local_provider": "external"}),
])
def test_local_external_rejects_cloud_address_before_any_write(store, monkeypatch, module, address_field, other):
    writes = []
    monkeypatch.setattr("app.config.keyring.set_password", lambda *args: writes.append(args))
    with role_scope("local"):
        with pytest.raises(HTTPException) as error:
            store.save(ModelSettings(**{f"{module}_connection_mode": "local",
                                       address_field: "https://provider.invalid/v1",
                                       "api_key": "dummy-never-saved", **other}))
        assert error.value.status_code == 422
        assert not writes
        assert not store.path.exists()


def test_full_operation_endpoints_normalize_to_api_roots(store):
    with role_scope("roots"):
        saved = store.save(ModelSettings(
            base_url="https://provider.invalid/v1/chat/completions/",
            persona_embedding_base_url="https://provider.invalid/v1/embeddings/",
            memory_embedding_base_url="http://127.0.0.1:9000/v1/embeddings/",
            memory_connection_mode="local",
            vision_connection_mode="cloud",
            vision_base_url="https://provider.invalid/v1/chat/completions/",
        ))
        assert saved["base_url"] == "https://provider.invalid/v1"
        assert saved["persona_embedding_base_url"] == "https://provider.invalid/v1"
        assert saved["memory_embedding_base_url"] == "http://127.0.0.1:9000/v1"
        assert saved["vision_base_url"] == "https://provider.invalid/v1"


@pytest.mark.parametrize("module,provider_field", [("hearing", "asr_provider"), ("voice", "audio_provider")])
def test_local_speech_requires_compatible_protocol(store, module, provider_field):
    address_field = "asr_base_url" if module == "hearing" else "audio_base_url"
    with pytest.raises(HTTPException):
        store.save(ModelSettings(**{f"{module}_connection_mode": "local",
                                   address_field: "http://127.0.0.1:9000/v1",
                                   provider_field: "dashscope"}))


def test_builtin_does_not_validate_or_contact_dormant_cloud_endpoint(store):
    saved = store.save(ModelSettings(
        persona_connection_mode="local", persona_local_provider="built_in",
        persona_embedding_base_url="not-a-network-endpoint",
        hearing_connection_mode="local", hearing_local_provider="built_in",
        asr_base_url="not-a-network-endpoint",
    ))
    assert saved["persona_local_provider"] == "built_in"
    assert saved["hearing_local_provider"] == "built_in"


def test_unrelated_save_preserves_old_invalid_module_without_blocking(store):
    store._write_json(store.path, {"audio_base_url": "https://[old-broken", "motion_duration_mode": "auto",
                                   "motion_provider": "tencent_tokenhub", "local_sandbox_mode": "read_only"})
    saved = store.save(ModelSettings(bubble_enabled=False, local_operation_mode="help_me_approve"))
    assert saved["audio_base_url"] == "https://[old-broken"
    assert saved["motion_duration_mode"] == "auto"
    assert saved["motion_provider"] == "tencent_tokenhub"
    assert saved["local_sandbox_mode"] == "read_only"
    assert not saved["bubble_enabled"]
    assert json.loads(store.path.read_text())["local_operation_mode"] == "help_me_approve"


def test_motion_submit_endpoint_is_normalized_to_api_root(store):
    saved = store.save(ModelSettings(
        motion_api_base_url="https://tokenhub.tencentmaas.com/v1/api/3d/submit"
    ))
    assert saved["motion_api_base_url"] == "https://tokenhub.tencentmaas.com/v1/api/3d"
