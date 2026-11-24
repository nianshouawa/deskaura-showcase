"""Explicitly approved local process execution. This is not an OS sandbox."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from fastapi import HTTPException
from .execution_job import ProcessTreeJob

MAX_OUTPUT_BYTES = 64 * 1024
MAX_CODE_CHARACTERS = 12000


def prepare_execution(action: dict, root: Path, cwd: Path) -> dict:
    """Freeze exactly what the human will inspect; nothing is executed here."""
    operation = action.get('operation')
    timeout = action.get('timeout', 20)
    try:
        timeout = max(1, min(int(timeout), 60))
    except (TypeError, ValueError):
        timeout = 20
    if operation == 'execute':
        command = str(action.get('command') or action.get('content') or '').strip()
        shell = str(action.get('shell') or 'powershell').lower()
        if shell not in {'powershell', 'cmd'}:
            raise HTTPException(422, '命令仅支持 PowerShell 或 cmd。')
        content = command
        runtime = shell
    else:
        content = str(action.get('content') or '').strip()
        runtime = str(action.get('runtime') or 'python').lower()
        if runtime not in {'python', 'javascript'}:
            raise HTTPException(422, '代码仅支持 Python 或 JavaScript。')
    if not content or len(content) > MAX_CODE_CHARACTERS or '\0' in content:
        raise HTTPException(422, '命令或代码必须为 1–12000 字，且不能含空字符。')
    return {'operation': operation, 'path': str(cwd), 'root': str(root),
            'content': content, 'runtime': runtime, 'timeout': timeout,
            'created_at': time.time(),
            'warning': '不是沙箱：批准后按当前用户权限运行，可访问授权目录之外的系统资源。'}


def _environment() -> dict:
    # Never pass app credentials (LLM_API_KEY etc.) to model-authored processes.
    allowed = {'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC',
               'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
               'COMMONPROGRAMFILES', 'HOMEDRIVE', 'HOMEPATH', 'PROCESSOR_ARCHITECTURE'}
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    env.update(PYTHONIOENCODING='utf-8', PYTHONUTF8='1')
    return env


def _command(payload: dict) -> list[str]:
    runtime = payload['runtime']
    content = payload['content']
    if runtime == 'python':
        # In the packaged sidecar sys.executable is DeskAura's bootloader, not Python.
        executable = shutil.which('python') if getattr(sys, 'frozen', False) else sys.executable
        arguments = ['-I', '-c', content]
    elif runtime == 'javascript':
        executable, arguments = shutil.which('node'), ['--eval', content]
    elif runtime == 'powershell':
        executable = shutil.which('powershell.exe') or shutil.which('pwsh')
        arguments = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', content]
    else:
        executable = shutil.which('cmd.exe')
        arguments = ['/d', '/s', '/c', content]
    if not executable:
        raise HTTPException(409, '找不到所选运行时；请使用电脑已安装的 Python、Node.js 或 PowerShell。')
    return [executable, *arguments]


def _stop_tree(process):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW, timeout=5, check=False)
    else:
        import signal
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=5)


def execute_approved(payload: dict) -> dict:
    """Run one approved process with deadline, bounded output and no console flash."""
    arguments = _command(payload)
    reason = None
    with ProcessTreeJob() as job, tempfile.TemporaryFile() as output:
        process = subprocess.Popen(arguments, cwd=payload['path'], env=_environment(),
                                   stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                   creationflags=(subprocess.CREATE_NO_WINDOW | job.creation_flags()) if os.name == 'nt' else 0,
                                   start_new_session=os.name != 'nt')
        try:
            job.attach_and_resume(process)
        except Exception:
            process.kill()
            process.wait(timeout=5)
            raise
        deadline = time.monotonic() + payload['timeout']
        while process.poll() is None:
            if time.monotonic() >= deadline:
                reason = '执行超时，已终止进程树'
                _stop_tree(process)
                break
            if os.fstat(output.fileno()).st_size > MAX_OUTPUT_BYTES:
                reason = '输出超过 64 KB，已终止进程树'
                _stop_tree(process)
                break
            time.sleep(.025)
        # Closing the job also kills descendants whose immediate parent already
        # exited. Approved runs cannot leave a background process behind.
        job.close()
        output.seek(0)
        data = output.read(MAX_OUTPUT_BYTES + 1)
    truncated = len(data) > MAX_OUTPUT_BYTES
    text = data[:MAX_OUTPUT_BYTES].decode('utf-8', errors='replace')
    if len(text) > 16000:
        text, truncated = text[:16000], True
    return {'operation': payload['operation'], 'path': payload['path'],
            'exit_code': process.returncode, 'output': text,
            'truncated': truncated, 'stopped': reason,
            'text': (reason or f'进程已结束，退出码 {process.returncode}') + ('；输出已截断' if truncated else '') +
                    ('\n' + text if text else '\n（无输出）')}
