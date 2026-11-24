"""Secret masking and model configuration tests."""

from app.config import ConfigStore, ModelSettings


def test_persona_defaults_to_none_and_preserves_saved_choices(tmp_path, monkeypatch):
    from app.persona import PersonaSettings

    monkeypatch.setattr("app.config.keyring.get_password", lambda *_: "")
    path = tmp_path / "config.json"
    store = ConfigStore(str(path))
    assert store.get()["persona_template"] == "无"
    assert ModelSettings().persona_template == PersonaSettings().template == "无"
    store.save(ModelSettings(persona_template="温柔陪伴", persona_text="已保存的人设"))
    reopened = ConfigStore(str(path))
    assert reopened.get()["persona_template"] == "温柔陪伴"
    reopened.save(ModelSettings(persona_template="无"))
    assert reopened.get()["persona_template"] == "无"
    assert reopened.get()["persona_text"] == "已保存的人设"


def test_standby_is_independent_and_preserved_by_partial_gaze_saves(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.keyring.get_password", lambda *_: "")
    store = ConfigStore(str(tmp_path / "config.json"))
    assert store.get()["standby_enabled"] is True
    saved = store.save(ModelSettings(standby_enabled=False, gaze_enabled=True, gaze_mode="mouse"))
    assert saved["standby_enabled"] is False and saved["gaze_enabled"] is True
    saved = store.save(ModelSettings(gaze_enabled=False))
    assert saved["standby_enabled"] is False and saved["gaze_enabled"] is False
    saved = store.save(ModelSettings(standby_enabled=True))
    assert saved["standby_enabled"] is True and saved["gaze_enabled"] is False


def test_settings_mask_key(tmp_path, monkeypatch):
    values = {}
    monkeypatch.setattr("app.config.keyring.get_password", lambda *_: values.get("key"))
    monkeypatch.setattr("app.config.keyring.set_password", lambda *args: values.update(key=args[2]))
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    store = ConfigStore(str(tmp_path / "config.json"))
    result = store.save(ModelSettings(api_key="sk-test-secret", model="test-model"))
    assert result["has_api_key"] is True
    assert "secret" not in str(result["api_key_masked"])
    assert result["model"] == "test-model"
    for field in ('api_key_masked', 'audio_api_key_masked', 'asr_api_key_masked'):
        assert '*' in result[field]
        assert 'secret' not in result[field]


def test_local_operation_policy_is_persisted_and_legacy_gates_migrate(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.keyring.get_password", lambda *_: "")
    store = ConfigStore(str(tmp_path / "config.json"))
    saved = store.save(ModelSettings(local_operation_mode="help_me_approve"))
    assert saved["local_operation_mode"] == "help_me_approve"
    assert saved["file_access_enabled"] is True
    assert saved["execution_enabled"] is True
    store.save(ModelSettings(local_operation_mode="request_approval", local_sandbox_enabled=False))
    current = store.get()
    assert current["local_operation_mode"] == "request_approval"
    assert current["local_sandbox_enabled"] is False
