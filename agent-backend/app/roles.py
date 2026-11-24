"""Per-character records. Original model assets are never owned or deleted here."""
from __future__ import annotations

import copy
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from .config import (
    ConfigStore, EXTRA_SECRET_FIELDS, KEY_USERNAME, TTS_KEY_USERNAME,
    ASR_KEY_USERNAME, MOTION_KEY_USERNAME, ModelSettings, normalized_role, role_scope, role_slug,
)
from .mcp_configuration import MASK, secret_records, stored_configuration


class RoleStore:
    def __init__(self, config: ConfigStore):
        self.config = config
        self.root = config.base_path.parent / "roles"

    def directory(self, role_id: str) -> Path:
        role_id = normalized_role(role_id)
        if role_id == "default":
            raise HTTPException(422, "请选择主页中创建的角色")
        target = self.root / role_slug(role_id)
        if target.parent.resolve() != self.root.resolve():
            raise HTTPException(403, "角色目录无效")
        return target

    def metadata(self, role_id: str) -> dict:
        path = self.directory(role_id) / "role.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError, TypeError):
            return {}

    def upsert(self, role_id: str, data: dict) -> dict:
        directory = self.directory(role_id)
        existing = self.metadata(role_id)
        if not existing and not (directory / "config.json").is_file():
            # A one-time snapshot migrates existing installation defaults; it is
            # not a live reference. Later saves cannot mutate another character.
            with role_scope("default"):
                snapshot = self.config._read_file()
                credentials = {name: self.config._read_secret(name) for name in
                               (KEY_USERNAME, TTS_KEY_USERNAME, ASR_KEY_USERNAME,
                                MOTION_KEY_USERNAME, *EXTRA_SECRET_FIELDS.values())}
                credentials.update(secret_records(self.config))
            snapshot.update(local_operation_mode="request_approval", local_sandbox_mode="read_only",
                            local_sandbox_enabled=False, execution_enabled=False,
                            file_access_enabled=False, file_access_root="")
            with role_scope(role_id):
                self.config._write_json(self.config.path, snapshot)
                for name, secret in credentials.items():
                    if secret:
                        self.config._save_secret(name, secret)
        value = {
            **existing, **data, "id": normalized_role(role_id),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "memory_path": str(directory / "memory.db"),
            "config_path": str(directory / "config.json"),
            "session_path": str(self.config.base_path.parent / "sessions.db"),
            "session_namespace": f"{role_id}::",
        }
        self.config._write_json(directory / "role.json", value)
        return value

    def export(self, role_id: str) -> dict:
        metadata = self.metadata(role_id)
        if not metadata:
            raise HTTPException(404, "找不到角色记录")
        with role_scope(role_id):
            # get() contains masked indicators only; no raw credential crosses
            # the HTTP boundary or ends up in the exported JSON.
            settings = self.config.get()
        return {"schema": "deskaura.role.v1", "role": metadata, "settings": settings,
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "secrets_included": False}

    def import_config(self, role_id: str, snapshot: dict) -> dict:
        """Merge a non-secret role export into the selected character."""
        if snapshot.get("schema") != "deskaura.role.v1":
            raise HTTPException(422, "不是 DeskAura 角色配置文件")
        imported = snapshot.get("settings")
        if not isinstance(imported, dict):
            raise HTTPException(422, "角色配置缺少 settings")
        allowed = set(ModelSettings.model_fields)
        sensitive = {name for name in allowed if name.endswith("_api_key") or name in {"api_key"}}
        clean = {
            key: value for key, value in imported.items()
            if key in allowed and key not in sensitive and not key.endswith(("_masked", "_has_api_key"))
        }
        metadata = snapshot.get("role")
        role = self.metadata(role_id)
        if isinstance(metadata, dict):
            for field, limit in (("name", 80), ("description", 500)):
                value = metadata.get(field)
                if isinstance(value, str):
                    role[field] = value.strip()[:limit]
        role["id"] = normalized_role(role_id)
        role["updated_at"] = datetime.now(timezone.utc).isoformat()
        self.config._write_json(self.directory(role_id) / "role.json", role)
        with role_scope(role_id):
            current = self.config._read_file()
            if isinstance(clean.get("tools_mcp_config"), dict):
                clean["tools_mcp_config"] = copy.deepcopy(clean["tools_mcp_config"])
                previous = stored_configuration(self.config, private=True)["mcpServers"]
                for name, server in clean["tools_mcp_config"].get("mcpServers", {}).items():
                    for field in ("env", "headers"):
                        for key, value in server.get(field, {}).items():
                            if value == MASK and key not in previous.get(name, {}).get(field, {}):
                                server[field][key] = ""
            merged = {**current, **clean}
            saved = self.config.save(ModelSettings(**merged))
        return {"role": self.metadata(role_id), "settings": saved, "secrets_included": False}

    def delete(self, role_id: str) -> None:
        directory = self.directory(role_id)
        if directory.is_symlink() or getattr(directory, "is_junction", lambda: False)():
            raise HTTPException(403, "角色目录不能是链接")
        resolved = directory.resolve()
        if resolved.parent != self.root.resolve() or resolved.name != role_slug(role_id):
            raise HTTPException(403, "角色目录无效")
        with role_scope(role_id):
            mcp_credentials = secret_records(self.config)
            for name in (KEY_USERNAME, TTS_KEY_USERNAME, ASR_KEY_USERNAME,
                         MOTION_KEY_USERNAME, *EXTRA_SECRET_FIELDS.values(), *mcp_credentials):
                self.config._delete_secret(name)
        # Do this before deleting the directory: writing offense state after
        # rmtree would recreate the deleted character record.
        legacy_path = self.config._interaction_state_path("default")
        legacy = self.config._read_interaction_state("default")
        if isinstance(legacy.get("roles"), dict) and role_id in legacy["roles"]:
            legacy["roles"].pop(role_id, None)
            self.config._write_json(legacy_path, legacy)
        if directory.exists():
            # Exact hash-named application-owned record only. model_path is
            # metadata, never a filesystem deletion target.
            shutil.rmtree(directory)
        if self.config.active_role() == role_id:
            self.config.activate("default")
