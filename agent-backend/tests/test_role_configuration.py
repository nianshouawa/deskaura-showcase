import json

import pytest
from fastapi import HTTPException

from app.config import ConfigStore, ModelSettings, role_scope
from app.roles import RoleStore
from app.file_tools import FileTools
from app.connectivity import ConnectivityProofs


@pytest.fixture
def profiles(tmp_path, monkeypatch):
    values = {}
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setattr("app.config.keyring.get_password", lambda service, name: values.get(name))
    monkeypatch.setattr("app.config.keyring.set_password", lambda service, name, value: values.update({name: value}))
    monkeypatch.setattr("app.config.keyring.delete_password", lambda service, name: values.pop(name, None))
    return ConfigStore(str(tmp_path / "config.json")), values


def test_separate_role_configuration_and_keys(profiles):
    store, secrets = profiles
    with role_scope("alpha"):
        store.save(ModelSettings(model="alpha-model", api_key="alpha-private", persona_text="甲"))
        alpha_path = store.path
    with role_scope("beta"):
        store.save(ModelSettings(model="beta-model", api_key="beta-private", persona_text="乙"))
        assert store.get()["model"] == "beta-model"
        assert store._get_key() == "beta-private"
    with role_scope("alpha"):
        assert store.get()["model"] == "alpha-model"
        assert store.get()["persona_text"] == "甲"
        assert store._get_key() == "alpha-private"
        assert "private" not in json.dumps(store.get())
    assert len(secrets) == 2
    assert "private" not in alpha_path.read_text()

def test_recovering_missing_role_metadata_never_replaces_saved_configuration(profiles):
    store, _ = profiles
    store.save(ModelSettings(model="default-model", api_key="default-private"))
    with role_scope("existing"):
        store.save(ModelSettings(model="saved-role-model", persona_text="保留的人设", api_key="role-private"))
    roles = RoleStore(store)
    assert not roles.metadata("existing")
    roles.upsert("existing", {"name": "Recovered"})
    with role_scope("existing"):
        assert store.get()["model"] == "saved-role-model"
        assert store.get()["persona_text"] == "保留的人设"
        assert store._get_key() == "role-private"


def test_role_create_snapshot_export_delete_preserves_source(profiles, tmp_path):
    store, _ = profiles
    store.save(ModelSettings(model="initial", api_key="global-private"))
    roles = RoleStore(store)
    source = tmp_path / "model.vrm"
    source.write_bytes(b"model")
    roles.upsert("one", {"name": "One", "model_path": str(source)})
    roles.upsert("two", {"name": "Two", "model_path": str(source)})
    with role_scope("one"):
        store.save(ModelSettings(model="one-only", api_key="one-private"))
    with role_scope("two"):
        assert store.get()["model"] == "initial"
        assert store._get_key() == "global-private"
    exported = roles.export("one")
    assert exported["settings"]["model"] == "one-only"
    assert exported["secrets_included"] is False
    assert "one-private" not in json.dumps(exported)
    roles.delete("one")
    assert not roles.directory("one").exists()
    assert roles.directory("two").exists()
    assert source.read_bytes() == b"model"


def test_role_export_can_be_imported_without_secret_values(profiles):
    store, _ = profiles
    store.save(ModelSettings(model="initial"))
    roles = RoleStore(store)
    roles.upsert("one", {"name": "One"})
    roles.upsert("two", {"name": "Two"})
    with role_scope("one"):
        store.save(ModelSettings(model="imported-model", persona_text="新设定", api_key="private-secret"))
    snapshot = roles.export("one")
    snapshot["settings"]["api_key_masked"] = "sk-******"
    result = roles.import_config("two", snapshot)
    assert result["settings"]["model"] == "imported-model"
    with role_scope("two"):
        assert store.get()["persona_text"] == "新设定"
        assert store._get_key() != "private-secret"


def test_permission_card_cannot_cross_roles_and_sandbox_fails_closed(profiles, tmp_path):
    store, _ = profiles
    root = tmp_path / "allowed"
    root.mkdir()
    tools = FileTools(store)
    with role_scope("one"):
        store.save(ModelSettings(file_access_root=str(root), local_sandbox_mode="full_access"))
        approval = tools.run({"operation": "code", "content": "print('safe')"}, "s")["approval"]
    with role_scope("two"):
        store.save(ModelSettings(file_access_root=str(root)))
        with pytest.raises(HTTPException):
            tools.decide(approval["id"], "s", True)
        store.save(ModelSettings(local_operation_mode="full_approval", local_sandbox_enabled=True))
        with pytest.raises(HTTPException):
            tools.run({"operation": "code", "content": "print('blocked')"}, "s")


def test_connectivity_proofs_are_isolated(profiles):
    store, _ = profiles
    proofs = ConnectivityProofs()
    with role_scope("one"):
        signature = proofs.signature("chat", store)
        token = proofs.issue("chat", signature)
        assert proofs.confirm(token, True, store)
    with role_scope("two"):
        assert not proofs.status("chat", store)["client_verified"]
        proofs.revoke("chat")
    with role_scope("one"):
        assert proofs.status("chat", store)["client_verified"]


def test_new_conversation_clears_only_current_role_offense(profiles, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    from app.session_store import SessionStore
    store, _ = profiles
    monkeypatch.setattr(main, "config_store", store)
    monkeypatch.setattr(main.agent, "sessions", SessionStore(str(tmp_path / "sessions.db")))
    store.set_offended(True, "alpha")
    store.set_offended(True, "beta")
    client = TestClient(main.app)
    result = client.post("/api/chat/sessions", headers={"X-DeskAura-Role": "alpha"})
    assert result.status_code == 200
    assert not store.offended("alpha")
    assert store.offended("beta")
    assert client.get("/api/chat/sessions", headers={"X-DeskAura-Role": "beta"}).json()["sessions"] == []
    assert client.get("/api/chat/sessions/" + result.json()["id"],
                      headers={"X-DeskAura-Role": "beta"}).status_code == 403


def test_persona_uses_the_saved_role_configuration(profiles, monkeypatch):
    import asyncio
    from app.persona import PersonaStore, retrieve_persona
    store, secrets = profiles
    with role_scope("alpha"):
        store.save(ModelSettings(persona_text="名称：小雨\n身份：精灵",
                                 persona_embedding_api_key="embedding-private", persona_tag="小雨设定"))
        persona = PersonaStore(config_store=store)
        assert persona.get("alpha")["text"].startswith("名称：小雨")
        assert persona.get("alpha")["embedding"]["tag"] == "小雨设定"
        assert persona._path("alpha") == store.path
        async def embed(*args):
            return [[1., .2]]
        monkeypatch.setattr(persona, "_embed", embed)
        assert asyncio.run(persona.test("alpha"))["ok"]
        store.save(ModelSettings(persona_embedding_model="new-model"))
        assert not persona.get("alpha")["status"]["verified"]
    assert not persona.get("beta")["text"]
    assert any(name.startswith("persona-embedding-api-key:") for name in secrets)
    with role_scope("beta"):
        store.save(ModelSettings(persona_text="名称：小风"))
        assert "小风" in asyncio.run(retrieve_persona("你是谁", store))
        assert "小雨" not in asyncio.run(retrieve_persona("你是谁", store))


def test_role_modules_never_infer_green_from_saved_configuration(profiles, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    store, _ = profiles
    monkeypatch.setattr(main, "config_store", store)
    with role_scope("alpha"):
        store.save(ModelSettings(api_key="private-key", brain_tag="Alpha", audio_enabled=False))
    client = TestClient(main.app)
    headers = {"X-DeskAura-Role": "alpha"}
    state = client.get("/api/modules/brain/status", headers=headers).json()
    assert state["enabled"] and state["tag"] == "Alpha"
    assert not state["verified"]
    assert not client.get("/api/modules/persona/status", headers=headers).json()["verified"]
    assert client.get("/api/modules/voice/status", headers=headers).json()["detail"] == "已停用"


def test_deleted_offended_role_is_not_recreated(profiles):
    store, _ = profiles
    roles = RoleStore(store)
    roles.upsert("one", {"name": "One"})
    store.set_offended(True, "one")
    roles.delete("one")
    assert not roles.directory("one").exists()


def test_persona_http_import_and_detection_share_role_config(profiles, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    store, _ = profiles
    monkeypatch.setattr(main, "config_store", store)
    client = TestClient(main.app)
    headers = {"X-DeskAura-Role": "alpha"}
    result = client.post("/api/persona/import?filename=character.txt", content="角色：小雨".encode(), headers=headers)
    assert result.is_success and result.json()["text"] == "角色：小雨"
    # Import is an editor action, not an implicit save.
    assert client.get("/api/settings/model", headers=headers).json()["persona_text"] == ""
    result = client.post("/api/modules/persona/test", headers=headers)
    assert result.is_success and result.json()["verified"] is False
    assert "填写" in result.json()["detail"]


def test_directory_input_cannot_authorize_working_directory_by_accident(tmp_path):
    from fastapi.testclient import TestClient
    from app import main
    client = TestClient(main.app)
    for value in ("", "  "):
        assert client.post("/api/local/directory", json={"path": value}).status_code == 422
    result = client.post("/api/local/directory", json={"path": str(tmp_path)})
    assert result.is_success and result.json()["path"] == str(tmp_path.resolve())
