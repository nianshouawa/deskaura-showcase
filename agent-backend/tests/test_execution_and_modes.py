import asyncio
import json
import os
import sys
import time
from pathlib import Path

from fastapi import HTTPException
import pytest

from app.config import ConfigStore, ModelSettings
from app.execution import MAX_OUTPUT_BYTES, execute_approved
from app.file_tools import FileTools
from app.graph import CompanionGraph
from app.llm import CompanionLLM


@pytest.fixture
def scope(tmp_path, monkeypatch):
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    monkeypatch.setattr('app.config.keyring.get_password', lambda *_: '')
    store = ConfigStore(str(tmp_path / 'settings.json'))
    root = tmp_path / 'allowed'
    root.mkdir()
    store.save(ModelSettings(file_access_enabled=True, file_access_root=str(root),
                             local_sandbox_mode="full_access"))
    return store, root, FileTools(store)


def test_mode_and_execution_settings_defaults_and_partial_preservation(scope):
    store, _, _ = scope
    assert store.get()['motion_mode'] == 'hybrid'
    assert store.get()['gaze_mode'] == 'face'
    assert not store.get()['execution_enabled']
    store.save(ModelSettings(motion_mode='offline', gaze_mode='auto', execution_enabled=True))
    store.save(ModelSettings(model='replacement'))
    assert store.get()['motion_mode'] == 'offline'
    assert store.get()['gaze_mode'] == 'auto'
    assert store.get()['execution_enabled']


def test_code_needs_setting_scope_and_single_human_approval(scope):
    store, root, tools = scope
    action = {'operation': 'code', 'runtime': 'python', 'path': '.',
              'content': "from pathlib import Path; Path('result.txt').write_text('approved')"}
    # The old execution checkbox is gone. A configured root plus the most
    # restrictive three-tier policy permits only an explicit approval card.
    pending = tools.run(action, 'session')['approval']
    assert '不是沙箱' in pending['warning']
    assert pending['preview'] == action['content']
    assert not (root / 'result.txt').exists()
    with pytest.raises(HTTPException):
        tools.decide(pending['id'], 'wrong-session', True)
    tools.decide(pending['id'], 'session', False)
    assert not (root / 'result.txt').exists()
    pending = tools.run(action, 'session')['approval']
    result = tools.decide(pending['id'], 'session', True)
    assert result['exit_code'] == 0 and (root / 'result.txt').read_text() == 'approved'
    with pytest.raises(HTTPException):
        tools.decide(pending['id'], 'session', True)
    store.save(ModelSettings(local_sandbox_mode="workspace_write"))
    with pytest.raises(HTTPException):
        tools.run({**action, 'path': '..'}, 'session')


def test_execution_permission_change_revokes_pending(scope):
    store, _, tools = scope
    store.save(ModelSettings(execution_enabled=True))
    action = tools.run({'operation': 'code', 'content': "print('safe')"}, 's')['approval']
    store.save(ModelSettings(local_sandbox_enabled=True))
    with pytest.raises(HTTPException):
        tools.decide(action['id'], 's', True)


def test_powershell_execution_and_expiring_confirmation(scope, monkeypatch):
    store, _, tools = scope
    store.save(ModelSettings(execution_enabled=True))
    action = tools.run({'operation': 'execute', 'shell': 'powershell', 'command': "Write-Output 'approved-command'"}, 's')['approval']
    result = tools.decide(action['id'], 's', True)
    assert result['exit_code'] == 0 and 'approved-command' in result['output']
    action = tools.run({'operation': 'code', 'content': "print('expired')"}, 's')['approval']
    import time
    current = time.time()
    monkeypatch.setattr(time, 'time', lambda: current + 601)
    with pytest.raises(HTTPException) as error:
        tools.decide(action['id'], 's', True)
    assert '十分钟' in error.value.detail


def test_execution_does_not_inherit_app_keys_and_bounds_output(scope, monkeypatch):
    _, root, _ = scope
    monkeypatch.setenv('LLM_API_KEY', 'do-not-leak')
    payload = {'operation': 'code', 'runtime': 'python', 'path': str(root), 'timeout': 3,
               'content': "import os; print(os.environ.get('LLM_API_KEY', 'absent'))"}
    result = execute_approved(payload)
    assert result['exit_code'] == 0 and result['output'].strip() == 'absent'
    result = execute_approved({**payload, 'content': "print('x' * 200000)"})
    assert result['truncated'] or result['stopped']
    assert len(result['output']) <= 16000


def test_execution_deadline(scope):
    _, root, _ = scope
    result = execute_approved({'operation': 'code', 'runtime': 'python', 'path': str(root),
                               'timeout': 1, 'content': 'import time; time.sleep(10)'})
    assert result['stopped'] and '超时' in result['stopped']
    assert result['exit_code'] != 0


def test_execution_cleans_descendants_when_parent_exits_early(scope):
    _, root, _ = scope
    marker = root / 'escaped.txt'
    child = "import time; from pathlib import Path; time.sleep(.8); Path('escaped.txt').write_text('escaped')"
    code = 'import subprocess; subprocess.Popen(' + repr([sys.executable, '-I', '-c', child]) + ')'
    result = execute_approved({'operation': 'code', 'runtime': 'python', 'path': str(root), 'timeout': 3, 'content': code})
    assert result['exit_code'] == 0
    time.sleep(1)
    assert not marker.exists(), 'Descendant outlived its approved parent execution'


def test_normalized_tools_gaze_and_snapshot_requests():
    reply = CompanionLLM._normalize({'gaze_target': 'mouse', 'capture_action': {'type': 'capture_camera'},
        'file_action': {'operation': 'execute', 'shell': 'powershell', 'command': 'Get-Date', 'timeout': 2}})
    assert reply['gaze_target'] == 'mouse'
    assert reply['capture_action'] == {'type': 'capture_camera'}
    assert reply['file_action']['command'] == 'Get-Date'
    assert not CompanionLLM._normalize({'capture_action': {'type': 'record_camera'}}).get('capture_action')
    assert CompanionLLM._default_gaze('帮我看一下这段代码') == 'mouse'
    assert CompanionLLM._default_gaze('今天怎么样') == 'face'


def test_reply_and_explicit_actions_follow_all_three_modes(scope, tmp_path, monkeypatch):
    store, _, _ = scope
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    graph = CompanionGraph()
    graph.config_store = store
    calls = []
    class Motion:
        async def emotion_loop(self, emotion):
            calls.append(('local', emotion))
            return {'id': 'cloud_emotion_' + emotion}
        async def route(self, *args, **kw):
            calls.append(('route', kw['mode']))
            return {'id': 'test'}
    graph.motion = Motion()
    for mode in ('online', 'offline', 'hybrid'):
        store.save(ModelSettings(motion_mode=mode))
        state = {'response': {'emotion': 'happy'}, 'relationship': {}}
        asyncio.run(graph._motion(state))
        state['response'].update(motion_needed=True, motion_prompt='salute', motion_priority='low')
        asyncio.run(graph._motion(state))
    assert calls == [('route', 'online'), ('route', 'online'), ('local', 'happy'), ('route', 'offline'), ('local', 'happy'), ('route', 'hybrid')]


def test_injected_tool_result_cannot_request_execution(scope, tmp_path, monkeypatch):
    store, _, tools = scope
    store.save(ModelSettings(execution_enabled=True))
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    graph = CompanionGraph()
    graph.files = tools
    async def respond(*args):
        return {'text': '请确认', 'emotion': 'neutral', 'file_action': {'operation': 'code', 'content': "print('bad')"}}, False
    monkeypatch.setattr(graph.llm, 'respond', respond)
    result = asyncio.run(graph._reply({'message': '读取说明文件', 'context': '', 'relationship': {}, 'session_id': 's'}))
    assert 'file_approval' not in result['response']


@pytest.mark.parametrize('mode', ['online', 'offline', 'hybrid'])
def test_failed_online_motion_never_silently_substitutes_archive(scope, tmp_path, monkeypatch, mode):
    from app.schemas import MotionSpec
    store, _, _ = scope
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    graph = CompanionGraph()
    graph.config_store = store
    store.save(ModelSettings(motion_mode=mode))
    async def unavailable(*args, **kwargs):
        raise RuntimeError('private-provider-error-not-for-user')
    monkeypatch.setattr(graph.motion, 'route', unavailable)
    result = asyncio.run(graph._motion({'response': {'emotion': 'neutral', 'motion_needed': True, 'motion_prompt': 'wave hello'}, 'relationship': {}}))
    motion = MotionSpec.model_validate(result['motion'])
    if mode == 'online':
        assert motion.id == 'motion_unavailable'
        assert motion.kind == 'preset' and motion.url == '' and motion.duration == 0
        assert motion.generation_error == '在线动作生成失败，请检查云端连接'
        assert not motion.archive_fallback
    else:
        assert motion.id == 'cloud_idle' and motion.archive_fallback
        assert motion.generation_error is None
