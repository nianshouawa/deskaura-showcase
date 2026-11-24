import pytest
from fastapi import HTTPException

from app.config import ConfigStore, ModelSettings
from app.file_tools import FileTools


def test_mkdir_copy_move_and_approval(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.keyring.get_password", lambda *_: "")
    root = tmp_path / "scope"
    root.mkdir()
    store = ConfigStore(str(tmp_path / "config.json"))
    store.save(ModelSettings(file_access_root=str(root), local_sandbox_mode="workspace_write"))
    tools = FileTools(store)
    pending = tools.run({"operation": "mkdir", "path": "sub"}, "s")["approval"]
    assert not (root / "sub").exists()
    tools.decide(pending["id"], "s", True)
    (root / "a.txt").write_text("hello")
    pending = tools.run({"operation": "copy", "path": "a.txt", "destination": "sub/b.txt"}, "s")["approval"]
    tools.decide(pending["id"], "s", True)
    assert (root / "a.txt").read_text() == (root / "sub/b.txt").read_text() == "hello"
    pending = tools.run({"operation": "move", "path": "sub/b.txt", "destination": "c.txt"}, "s")["approval"]
    tools.decide(pending["id"], "s", True)
    assert not (root / "sub/b.txt").exists()
    assert (root / "c.txt").read_text() == "hello"
    with pytest.raises(HTTPException):
        tools.run({"operation": "move", "path": "a.txt", "destination": "../outside.txt"}, "s")
    with pytest.raises(HTTPException):
        tools.run({"operation": "copy", "path": "a.txt", "destination": "c.txt"}, "s")


def test_help_approve_does_not_silently_move_files(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.keyring.get_password", lambda *_: "")
    root = tmp_path / "scope"
    root.mkdir()
    store = ConfigStore(str(tmp_path / "config.json"))
    store.save(ModelSettings(file_access_root=str(root), local_operation_mode="help_me_approve", local_sandbox_mode="workspace_write"))
    tools = FileTools(store)
    assert tools.run({"operation": "mkdir", "path": "sub"}, "s")["operation"] == "mkdir"
    (root / "a.txt").write_text("hello")
    assert tools.run({"operation": "copy", "path": "a.txt", "destination": "b.txt"}, "s")["operation"] == "copy"
    pending = tools.run({"operation": "move", "path": "a.txt", "destination": "c.txt"}, "s")
    assert pending["approval"] and (root / "a.txt").exists()
