import asyncio

from app.config import ConfigStore
from app.session_store import SessionStore


def test_sessions_are_scoped_by_role(tmp_path):
    store = SessionStore(str(tmp_path / "sessions.db"))
    alpha = store.create("alpha")
    beta = store.create("beta")
    default = store.create()
    assert [row["id"] for row in store.list("alpha")] == [alpha["id"]]
    assert [row["id"] for row in store.list("beta")] == [beta["id"]]
    assert [row["id"] for row in store.list()] == [default["id"]]
    assert not store.belongs(alpha["id"], "beta")
    assert not store.belongs(alpha["id"], "default")


def test_offended_state_is_scoped_by_role(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.keyring.get_password", lambda *args: None)
    store = ConfigStore(str(tmp_path / "config.json"))
    store.set_offended(True, "alpha")
    assert store.offended("alpha")
    assert not store.offended("beta")
    assert not store.offended()
    store.set_offended(False, "alpha")
    assert not store.offended("alpha")
