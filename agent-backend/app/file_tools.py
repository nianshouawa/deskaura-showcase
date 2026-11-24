"""Local tools with separate access scopes and approval policies."""
import hashlib
import json
import os
import shutil
import sqlite3
from pathlib import Path
from uuid import uuid4
from fastapi import HTTPException
from .local_permissions import require_operation, sandbox_mode

TEXT_EXTENSIONS = {'.txt', '.md', '.csv', '.json', '.log', '.py', '.js', '.ts', '.vue', '.css', '.html', '.xml', '.yaml', '.yml', '.ini', '.toml'}
OPERATIONS = {'list', 'search', 'read', 'create', 'update', 'delete', 'mkdir', 'move', 'copy', 'execute', 'code', 'mcp'}


class FileTools:
    def __init__(self, config):
        self.config = config
        self.db = config.base_path.parent / 'file-approvals.db'
        self.backups = config.base_path.parent / 'file-backups'
        with sqlite3.connect(self.db) as conn:
            conn.execute('CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, session_id TEXT, payload TEXT)')

    def target(self, name: str) -> tuple[Path, Path]:
        cfg = self.config.get()
        if not cfg.get('file_access_root'):
            raise HTTPException(409, '请先在设置中填写授权文件目录。')
        original_root = Path(cfg['file_access_root'])
        current = original_root
        while current != current.parent:
            if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
                raise HTTPException(403, '授权目录不能经过符号链接或目录联接。')
            current = current.parent
        root = original_root.resolve(strict=True)
        if not root.is_dir() or root == Path(root.anchor):
            raise HTTPException(422, '授权目录不能是磁盘根目录，请选择具体文件夹。')
        if str(name).startswith(('\\\\?\\', '\\\\.\\')):
            raise HTTPException(403, '不允许设备路径或备用数据流。')
        source = Path(name)
        candidate = source if source.is_absolute() else root / source
        # Reject Windows alternate streams, device paths and links, including ancestors.
        if any(':' in part for part in candidate.parts[1:]):
            raise HTTPException(403, '不允许设备路径或备用数据流。')
        target = candidate.resolve()
        if sandbox_mode(cfg) != "full_access" and not target.is_relative_to(root):
            raise HTTPException(403, '目标超出授权目录。')
        current = candidate
        while current != root and current != current.parent:
            if current.is_symlink() or (hasattr(current, 'is_junction') and current.is_junction()):
                raise HTTPException(403, '文件工具不跟随符号链接或目录联接。')
            current = current.parent
        return root, target

    @staticmethod
    def display_path(target: Path, root: Path) -> str:
        return str(target.relative_to(root)) if target.is_relative_to(root) else str(target)

    @staticmethod
    def fingerprint(target: Path) -> str:
        if not target.exists():
            return 'missing'
        if not target.is_file() or target.stat().st_size > 1024 * 1024:
            raise HTTPException(422, '仅支持不超过 1 MB 的普通文件；不支持删除目录。')
        return hashlib.sha256(target.read_bytes()).hexdigest()

    def run(self, action: dict, session_id: str) -> dict:
        op = action.get('operation')
        if op not in OPERATIONS:
            raise HTTPException(422, '不支持的文件操作。')
        cfg = self.config.get()
        access = require_operation(cfg, op)
        root, target = self.target(str(action.get('path') or '.'))
        if op in {'execute', 'code', 'mcp'}:
            if not target.is_dir():
                raise HTTPException(422, '运行位置必须是现有文件夹。')
            if op == "mcp":
                from .mcp_client import prepare_mcp, signature, credential
                payload = prepare_mcp(action, cfg, root, target, store=self.config)
                payload["config_signature"] = signature(cfg, credential(self.config))
            else:
                from .execution import prepare_execution
                payload = prepare_execution(action, root, target)
            mode = str(cfg.get('local_operation_mode', 'request_approval'))
            from .config import normalized_role
            payload["role_id"] = normalized_role()
            payload["sandbox_mode"] = access
            # "帮我批准" allows low-risk file creation/updates without a
            # second click, but keeps deletion and process execution explicit.
            # "完全批准" still respects path/type/size guards and runs the
            # already validated operation directly.
            if mode == 'full_approval':
                return self._perform(payload)
            if mode == 'help_me_approve' and op in {'code', 'execute'}:
                return self._propose(payload, session_id)
            return self._propose(payload, session_id)
        if op in {'list', 'search'}:
            if not target.is_dir():
                raise HTTPException(422, '请选择授权目录内的文件夹。')
            items = []
            count = 0
            query = str(action.get('query', '')).casefold()[:100]
            for directory, dirs, names in os.walk(target, followlinks=False):
                dirs[:] = sorted(d for d in dirs if not (Path(directory) / d).is_symlink() and not getattr(Path(directory) / d, 'is_junction', lambda: False)())
                for name in sorted(dirs + names):
                    count += 1
                    item = Path(directory) / name
                    if item.is_symlink() or getattr(item, 'is_junction', lambda: False)():
                        continue
                    if op == 'list' or query in name.casefold():
                        items.append({'path': self.display_path(item, root), 'directory': item.is_dir()})
                    if len(items) >= 200 or count >= 5000:
                        return {'items': items, 'truncated': True}
                if op == 'list':
                    break
            return {'items': items, 'truncated': False}
        if target == root or target == Path(target.anchor):
            raise HTTPException(403, '不能修改授权目录或磁盘根目录本身。')
        if op in {"mkdir", "move", "copy"}:
            cfg = self.config.get()
            destination = None
            if op == "mkdir":
                if target.exists() or not target.parent.is_dir():
                    raise HTTPException(409, "文件夹已存在或父目录不存在。")
                fingerprint = "missing"
            else:
                fingerprint = self.fingerprint(target)
                if fingerprint == "missing":
                    raise HTTPException(404, "源文件不存在。")
                if target.suffix.lower() not in TEXT_EXTENSIONS:
                    raise HTTPException(422, "复制和移动仅支持授权目录中的普通文本文件。")
                _, destination = self.target(str(action.get("destination") or ""))
                if destination == root or destination.exists() or not destination.parent.is_dir():
                    raise HTTPException(409, "目标文件已存在或父目录不存在。")
                if destination.suffix.lower() not in TEXT_EXTENSIONS:
                    raise HTTPException(422, "目标必须是受支持的文本文件。")
            from .config import normalized_role
            payload = {"operation": op, "path": str(target), "root": str(root),
                       "destination": str(destination) if destination else "",
                       "fingerprint": fingerprint, "role_id": normalized_role(),
                       "sandbox_mode": access,
                       "content": f"{op}: {target}" + (f"\n→ {destination}" if destination else "")}
            mode = cfg.get("local_operation_mode", "request_approval")
            if mode == "full_approval" or mode == "help_me_approve" and op in {"mkdir", "copy"}:
                return self._perform(payload)
            return self._propose(payload, session_id)
        if op == 'read':
            self.fingerprint(target)
            if target.suffix.lower() not in TEXT_EXTENSIONS:
                raise HTTPException(422, '此工具只读取文本类文件，不解析二进制、模型或 Office 文件。')
            return {'path': str(target), 'content': target.read_text(encoding='utf-8-sig')[:16000]}
        if op in {'create', 'update'} and target.suffix.lower() not in TEXT_EXTENSIONS:
            raise HTTPException(422, '仅允许创建、修改文本类文件。')
        content = str(action.get('content') or '')
        if len(content) > 12000:
            raise HTTPException(422, '待写入文本超过 12000 字，请拆分文件，确保确认卡片能展示完整内容。')
        fingerprint = self.fingerprint(target)
        if op == 'create' and fingerprint != 'missing':
            raise HTTPException(409, '文件已存在，请使用修改操作并确认覆盖内容。')
        if op != 'create' and fingerprint == 'missing':
            raise HTTPException(404, '目标文件不存在。')
        if not target.parent.is_dir():
            raise HTTPException(422, '父目录不存在，请选择已有目录。')
        payload = {'operation': op, 'path': str(target), 'root': str(root), 'content': content, 'fingerprint': fingerprint}
        from .config import normalized_role
        payload["role_id"] = normalized_role()
        payload["sandbox_mode"] = access
        mode = str(self.config.get().get('local_operation_mode', 'request_approval'))
        if mode == 'full_approval' or (mode == 'help_me_approve' and op in {'create', 'update'}):
            return self._perform(payload)
        return self._propose(payload, session_id)

    def _perform(self, payload: dict, token: str | None = None) -> dict:
        """Apply an already validated payload without creating a confirmation."""
        from .config import normalized_role
        if payload.get("role_id", "default") != normalized_role():
            raise HTTPException(409, "角色已变化，请重新请求操作。")
        access = require_operation(self.config.get(), payload["operation"])
        if payload.get("sandbox_mode", access) != access:
            raise HTTPException(409, "沙盒权限已变化，请重新请求操作。")
        root, target = self.target(payload['path'])
        if payload['operation'] in {'execute', 'code', 'mcp'}:
            if not target.is_dir() or str(root) != payload['root'] or self.config.get().get("local_sandbox_enabled"):
                raise HTTPException(409, '执行权限或授权目录已变化，请重新请求。')
            if payload["operation"] == "mcp":
                from .mcp_client import execute_mcp
                return execute_mcp(payload, self.config)
            from .execution import execute_approved
            return execute_approved(payload)
        if str(root) != payload['root'] or self.fingerprint(target) != payload['fingerprint']:
            raise HTTPException(409, '授权目录或目标文件已变化，请重新请求。')
        if payload["operation"] == "mkdir":
            target.mkdir()
            return {"text": f"已创建文件夹：{target}", "operation": "mkdir", "path": str(target)}
        if payload["operation"] in {"move", "copy"}:
            _, destination = self.target(payload["destination"])
            if destination.exists() or not destination.parent.is_dir():
                raise HTTPException(409, "目标文件已变化，请重新请求。")
            self.backups.mkdir(parents=True, exist_ok=True)
            backup = self.backups / ((token or uuid4().hex) + "-" + target.name)
            shutil.copy2(target, backup)
            # Exclusive creation prevents a race from overwriting a new file.
            with target.open("rb") as source, destination.open("xb") as output:
                shutil.copyfileobj(source, output)
            if payload["operation"] == "move":
                target.unlink()
            return {"operation": payload["operation"], "path": str(target),
                    "destination": str(destination), "backup": str(backup),
                    "text": f"已完成 {payload['operation']}：{target} → {destination}；恢复副本：{backup}"}
        backup = None
        if target.exists():
            self.backups.mkdir(parents=True, exist_ok=True)
            token = token or uuid4().hex
            backup = self.backups / (token + '-' + target.name)
            shutil.copy2(target, backup)
        if payload['operation'] == 'delete':
            target.unlink()
        elif payload['operation'] == 'create':
            with target.open('x', encoding='utf-8') as file:
                file.write(payload['content'])
        else:
            target.write_text(payload['content'], encoding='utf-8')
        return {'text': f"已完成 {payload['operation']}：{target}" + (f"；恢复副本：{backup}" if backup else ''), 'backup': str(backup) if backup else None}

    def _propose(self, payload, session_id):
        token = uuid4().hex
        with sqlite3.connect(self.db) as conn:
            conn.execute('DELETE FROM pending WHERE session_id=?', (session_id,))
            conn.execute('INSERT INTO pending VALUES (?,?,?)', (token, session_id, json.dumps(payload)))
        return {'approval': self._approval(token, payload),
                'status': '等待用户点击确认；尚未修改文件或执行命令，不得声称已完成。'}

    @staticmethod
    def _approval(token, payload):
        return {'id': token, 'operation': payload['operation'], 'path': payload['path'],
                             'preview': payload['content'][:12000],
                             **({key: payload[key] for key in ('runtime', 'timeout', 'warning')} if payload['operation'] in {'execute', 'code', 'mcp'} else {})}

    def pending(self, session_id):
        from .config import normalized_role
        with sqlite3.connect(self.db) as conn:
            row = conn.execute('SELECT id,payload FROM pending WHERE session_id=?', (session_id,)).fetchone()
        if not row:
            return None
        payload = json.loads(row[1])
        if payload.get("role_id", "default") != normalized_role():
            return None
        return self._approval(row[0], payload)

    def attach_continuation(self, token, session_id, value):
        with sqlite3.connect(self.db) as conn:
            row = conn.execute('SELECT payload FROM pending WHERE id=? AND session_id=?', (token, session_id)).fetchone()
            if row:
                payload = json.loads(row[0])
                payload["continuation"] = value
                conn.execute('UPDATE pending SET payload=? WHERE id=? AND session_id=?',
                             (json.dumps(payload), token, session_id))

    def discard(self, session_id):
        with sqlite3.connect(self.db) as conn:
            conn.execute('DELETE FROM pending WHERE session_id=?', (session_id,))

    def decide(self, token: str, session_id: str, approve: bool):
        with sqlite3.connect(self.db) as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT payload FROM pending WHERE id=? AND session_id=?', (token, session_id)).fetchone()
            if not row:
                raise HTTPException(404, '确认请求已失效或不属于此会话。')
            conn.execute('DELETE FROM pending WHERE id=?', (token,))
        if not approve:
            return {'text': '已取消，没有修改文件或执行命令。'}
        payload = json.loads(row[0])
        from .config import normalized_role
        if payload.get("role_id", "default") != normalized_role():
            raise HTTPException(409, "角色已变化，请重新请求操作。")
        root, target = self.target(payload['path'])
        if payload['operation'] in {'execute', 'code', 'mcp'}:
            import time
            if time.time() - payload.get('created_at', 0) > 600:
                raise HTTPException(409, '执行确认已超过十分钟，请重新请求并检查命令。')
            cfg = self.config.get()
            if cfg.get("local_sandbox_enabled") or str(root) != payload['root'] or not target.is_dir():
                raise HTTPException(409, '执行权限或授权目录已变化，请重新请求并确认。')
        result = self._perform(payload, token)
        if payload.get("continuation"):
            result["_continuation"] = payload["continuation"]
        return result
