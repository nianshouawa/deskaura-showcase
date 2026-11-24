import asyncio
import importlib.util
import json
import sqlite3
from pathlib import Path
import pytest
import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.config import ConfigStore, ModelSettings
from app.session_store import SessionStore
from app.file_tools import FileTools
from app import recognition, main
from app.graph import CompanionGraph


@pytest.fixture
def settings(tmp_path, monkeypatch):
    secrets = {}
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    monkeypatch.setattr('app.config.keyring.get_password', lambda service, name: secrets.get(name))
    monkeypatch.setattr('app.config.keyring.set_password', lambda service, name, key: secrets.update({name: key}))
    monkeypatch.setattr('app.config.keyring.delete_password', lambda service, name: secrets.pop(name, None))
    return ConfigStore(str(tmp_path / 'config.json')), secrets


def test_sessions_complete_archive_migration_and_isolation(tmp_path):
    store = SessionStore(str(tmp_path / 'sessions.db'))
    first, second = store.create(), store.create()
    for i in range(31):
        store.append(first['id'], 'user' if i % 2 == 0 else 'assistant', f'line {i}')
    assert len(store.history(first['id'])) == 31
    assert store.history(second['id']) == []
    assert store.rename(first['id'], '新名字')
    reopened = SessionStore(str(store.path))
    assert next(s for s in reopened.list() if s['id'] == first['id'])['title'] == '新名字'
    reopened.delete(first['id'])
    assert not reopened.history(first['id']) and len(reopened.list()) == 1
    with sqlite3.connect(store.path) as conn:
        conn.execute("INSERT INTO turns(session_id,role,content) VALUES ('default','user','旧版记录')")
    assert any(s['id'] == 'default' for s in SessionStore(str(store.path)).list())


def test_settings_preserve_independent_asr_and_file_scope(settings):
    store, secrets = settings
    store.save(ModelSettings(asr_enabled=True, asr_api_key='asr-secret', bubble_enabled=False, file_access_enabled=True, file_access_root='D:/docs'))
    store.save(ModelSettings(model='new-model'))
    assert store.get()['asr_enabled'] and not store.get()['bubble_enabled']
    assert store.get()['file_access_root'] == 'D:/docs'
    assert secrets == {'asr-api-key': 'asr-secret'}
    assert 'asr-secret' not in json.dumps(store.get()) + store.path.read_text()
    store.clear_asr_key()
    assert not store.get()['asr_has_api_key']


def test_file_tools_scope_confirm_backup_and_stale_files(settings, tmp_path):
    store, _ = settings
    root = tmp_path / 'allowed'; root.mkdir()
    tools = FileTools(store)
    with pytest.raises(HTTPException): tools.run({'operation': 'list'}, 'a')
    store.save(ModelSettings(file_access_enabled=True, file_access_root=str(root), local_sandbox_mode="workspace_write"))
    with pytest.raises(HTTPException): tools.run({'operation': 'read', 'path': '../config.json'}, 'a')
    target = root / 'note.txt'; target.write_text('original', encoding='utf-8')
    assert tools.run({'operation': 'read', 'path': 'note.txt'}, 'a')['content'] == 'original'
    assert tools.run({'operation': 'search', 'path': '.', 'query': 'note'}, 'a')['items'][0]['path'] == 'note.txt'
    request = tools.run({'operation': 'update', 'path': 'note.txt', 'content': 'updated'}, 'a')['approval']
    assert target.read_text() == 'original'
    with pytest.raises(HTTPException): tools.decide(request['id'], 'other-session', True)
    result = tools.decide(request['id'], 'a', True)
    assert target.read_text() == 'updated' and Path(result['backup']).read_text() == 'original'
    with pytest.raises(HTTPException): tools.decide(request['id'], 'a', True)
    request = tools.run({'operation': 'delete', 'path': 'note.txt'}, 'a')['approval']
    tools.decide(request['id'], 'a', False)
    assert target.exists()
    request = tools.run({'operation': 'update', 'path': 'note.txt', 'content': 'overwrite'}, 'a')['approval']
    target.write_text('changed elsewhere')
    with pytest.raises(HTTPException): tools.decide(request['id'], 'a', True)
    assert target.read_text() == 'changed elsewhere'
    request = tools.run({'operation': 'delete', 'path': 'note.txt'}, 'a')['approval']
    result = tools.decide(request['id'], 'a', True)
    assert not target.exists() and Path(result['backup']).read_text() == 'changed elsewhere'
    request = tools.run({'operation': 'create', 'path': 'new.md', 'content': 'new content'}, 'a')['approval']
    assert not (root / 'new.md').exists()
    tools.decide(request['id'], 'a', True)
    assert (root / 'new.md').read_text() == 'new content'
    with pytest.raises(HTTPException): tools.run({'operation': 'delete', 'path': '.'}, 'a')
    with pytest.raises(HTTPException): tools.run({'operation': 'create', 'path': 'run.exe', 'content': 'bad'}, 'a')
    with pytest.raises(HTTPException): tools.run({'operation': 'create', 'path': 'big.txt', 'content': 'x' * 12001}, 'a')


def test_asr_wav_multipart_separate_credentials_and_errors(settings, monkeypatch):
    store, _ = settings
    audio = b'RIFF' + bytes(4) + b'WAVE' + bytes(100)
    with pytest.raises(HTTPException): asyncio.run(recognition.transcribe(audio, store))
    store.save(ModelSettings(asr_enabled=True, asr_api_key='asr-private', asr_base_url='https://mock.invalid/v1/audio/transcriptions', asr_model='sensevoice'))
    calls = []
    real_client = httpx.AsyncClient
    def provider(request):
        calls.append(request)
        assert request.headers['authorization'] == 'Bearer asr-private'
        assert str(request.url).endswith('/v1/audio/transcriptions')
        assert b'recording.wav' in request.content and b'audio/wav' in request.content and b'sensevoice' in request.content
        return httpx.Response(200, json={'text': '你好，我说完了。'})
    monkeypatch.setattr(recognition.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(provider), **kw))
    assert asyncio.run(recognition.transcribe(audio, store))['text'] == '你好，我说完了。'
    with pytest.raises(HTTPException): asyncio.run(recognition.transcribe(b'not audio', store))
    assert len(calls) == 1
    monkeypatch.setattr(recognition.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(lambda r: httpx.Response(403, text='asr-private')), **kw))
    with pytest.raises(HTTPException) as error: asyncio.run(recognition.transcribe(audio, store))
    assert 'asr-private' not in error.value.detail and '403' in error.value.detail


def test_session_routes_and_memory_delete_failure(settings, tmp_path, monkeypatch):
    store, _ = settings
    monkeypatch.setattr(main, 'config_store', store)
    monkeypatch.setattr(main.agent, 'sessions', SessionStore(str(tmp_path / 'sessions.db')))
    monkeypatch.setattr(main.agent, 'files', FileTools(store))
    client = TestClient(main.app)
    session = client.post('/api/chat/sessions').json()
    assert client.patch('/api/chat/sessions/' + session['id'], json={'title': '测试会话'}).is_success
    assert client.get('/api/chat/sessions').json()['sessions'][0]['title'] == '测试会话'
    async def failed(*args): raise RuntimeError()
    monkeypatch.setattr(main.agent.memory, 'delete_session', failed)
    assert client.delete('/api/chat/sessions/' + session['id']).status_code == 503
    assert len(main.agent.sessions.list()) == 1
    async def ok(*args): pass
    monkeypatch.setattr(main.agent.memory, 'delete_session', ok)
    assert client.delete('/api/chat/sessions/' + session['id']).is_success
    assert main.agent.sessions.list() == []


def test_file_proposal_never_claims_execution(settings, tmp_path, monkeypatch):
    store, _ = settings
    root = tmp_path / 'documents'; root.mkdir()
    store.save(ModelSettings(file_access_enabled=True, file_access_root=str(root), local_sandbox_mode="workspace_write"))
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    graph = CompanionGraph(); graph.files = FileTools(store)
    async def respond(*args):
        return {'text': '我已经创建了', 'emotion': 'neutral', 'file_action': {'operation': 'create', 'path': 'note.txt', 'content': 'hello'}}, False
    monkeypatch.setattr(graph.llm, 'respond', respond)
    result = asyncio.run(graph._reply({'message': 'create note.txt', 'context': '', 'relationship': {}, 'session_id': 'a'}))
    assert result['response']['file_approval'] and '尚未修改' in result['response']['text']
    assert not (root / 'note.txt').exists()
