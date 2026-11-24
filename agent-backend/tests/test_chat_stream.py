"""Real incremental contract with mocked provider; never uses account credentials."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import llm, main
from app.graph import CompanionGraph
from app.session_store import SessionStore
from test_connectivity import setup_store


def test_incremental_json_text_never_discloses_structured_fields():
    raw = '{"emotion":"happy","text":"你好\\n世界\\u0021","file_action":{"command":"hidden"}}'
    seen = ''
    for index in range(len(raw) + 1):
        value = llm.CompanionLLM._stream_text(raw[:index])
        assert value.startswith(seen)
        assert not any(term in value for term in ('emotion', 'file_action', 'hidden'))
        seen = value
    assert seen == '你好\n世界!'
    assert llm.CompanionLLM._stream_text('{"text":"\\uD83D') == ''
    assert llm.CompanionLLM._stream_text('{"text":"\\uD83D\\uDE00') == '😀'
    assert llm.CompanionLLM._stream_text('Here is JSON: {"text":"visible","file_action":"secret"}') == ''


def test_provider_is_streamed_before_completion_and_transport_reused(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'test-not-real')
    monkeypatch.setenv('LLM_BASE_URL', 'https://provider.invalid/v1')
    monkeypatch.setenv('LLM_MODEL', 'qa')
    created, requests, delivered = [], [], []

    class Stream:
        async def __aiter__(self):
            for fragment in ('{"text":"第一句。', '第二句。', '","emotion":"happy"}'):
                if '第二句' in fragment:
                    assert delivered[-1] == '第一句。'
                yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=fragment))])
        async def close(self):
            pass

    class Client:
        def __init__(self, **kwargs):
            created.append(kwargs)
            self.chat = SimpleNamespace(completions=self)
        async def create(self, **kwargs):
            requests.append(kwargs)
            return Stream()
        async def close(self):
            pass

    monkeypatch.setattr(llm, 'AsyncOpenAI', Client)
    async def run():
        adapter = llm.CompanionLLM()
        for _ in range(2):
            delivered.clear()
            async def emit(text):
                delivered.append(text)
            reply, demo = await adapter.respond('你好', '', {}, [], on_delta=emit)
            assert ''.join(delivered) == reply['text'] == '第一句。第二句。'
            assert not demo
    asyncio.run(run())
    assert len(created) == 1 and all(request['stream'] for request in requests)


def test_stream_endpoint_frames_and_verified_receipt(tmp_path, monkeypatch):
    store = setup_store(tmp_path, monkeypatch)
    async def stream(*args):
        yield {'type': 'delta', 'text': '你好'}
        yield {'type': 'delta', 'text': '。'}
        yield {'type': 'state', 'state': {
            'response': {'text': '你好。', 'emotion': 'happy'},
            'motion': {'id': 'cloud_emotion_happy', 'kind': 'hymotion', 'url': '/clip', 'duration': 2},
            'demo_mode': False}}
    monkeypatch.setattr(main.agent, 'stream', stream)
    client = TestClient(main.app)
    response = client.post('/api/chat/stream', json={'message': '你好', 'session_id': 'qa'})
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('application/x-ndjson')
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [event['type'] for event in events] == ['delta', 'delta', 'done']
    assert events[-1]['reply']['text'] == '你好。'
    token = events[-1]['reply']['verification_id']
    assert client.post('/api/connectivity/receipt', json={'token': token, 'success': True}).json()['accepted']
    assert main.connectivity.status('chat', store)['client_verified']
    response = client.post('/api/chat/stream', json={'message': '你好', 'session_id': 'qa'}, headers={'Accept': 'text/event-stream'})
    assert response.headers['content-type'].startswith('text/event-stream')
    assert 'event: delta\ndata: {"text": "你好"}' in response.text
    assert 'event: reply\ndata: {"verification_id"' in response.text


def test_stream_endpoint_publishes_text_barrier_and_motion_before_done(tmp_path, monkeypatch):
    setup_store(tmp_path, monkeypatch)
    async def stream(*args):
        yield {'type': 'delta', 'text': '先说完'}
        yield {'type': 'text_done'}
        yield {'type': 'motion', 'motion': {'id': 'cloud_emotion_happy'}, 'emotion': 'happy', 'gaze_target': 'face'}
        yield {'type': 'state', 'state': {
            'response': {'text': '先说完', 'emotion': 'happy'},
            'motion': {'id': 'cloud_emotion_happy', 'kind': 'hymotion', 'url': '/clip', 'duration': 2},
            'demo_mode': False}}
    monkeypatch.setattr(main.agent, 'stream', stream)
    client = TestClient(main.app)
    response = client.post('/api/chat/stream', json={'message': '你好', 'session_id': 'qa'})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [event['type'] for event in events] == ['delta', 'text_done', 'motion', 'done']
    assert events[2]['motion']['id'] == 'cloud_emotion_happy'
    response = client.post('/api/chat/stream', json={'message': '你好', 'session_id': 'qa'}, headers={'Accept': 'text/event-stream'})
    assert 'event: text_done\ndata: {}\n\n' in response.text
    assert 'event: motion\ndata: ' in response.text


def test_graph_emits_text_done_before_motion_and_motion_before_persistence(tmp_path, monkeypatch):
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    graph = CompanionGraph()
    motion_release, persist_release = asyncio.Event(), asyncio.Event()
    async def context(_):
        return {'context': '', 'relationship': {}}
    async def reply(_, on_delta=None, on_plan=None):
        await on_delta('末句无标点')
        return {'response': {'text': '末句无标点', 'emotion': 'happy', 'gaze_target': 'mouse'}}
    async def motion(_):
        await motion_release.wait()
        return {'motion': {'id': 'generated-qa'}}
    async def persist(_):
        await persist_release.wait()
    monkeypatch.setattr(graph, '_context', context)
    monkeypatch.setattr(graph, '_reply', reply)
    monkeypatch.setattr(graph, '_motion', motion)
    monkeypatch.setattr(graph, '_persist', persist)
    async def run():
        stream = graph.stream('你好', 'qa', None)
        assert (await anext(stream))['type'] == 'delta'
        assert (await anext(stream))['type'] == 'text_done'
        motion_release.set()
        event = await anext(stream)
        assert event == {'type': 'motion', 'motion': {'id': 'generated-qa'}, 'emotion': 'happy', 'gaze_target': 'mouse'}
        persist_release.set()
        assert (await anext(stream))['type'] == 'state'
        await stream.aclose()
    asyncio.run(run())


def test_stream_errors_are_safe_and_disconnect_cancels_graph(tmp_path, monkeypatch):
    setup_store(tmp_path, monkeypatch)
    async def failed(*args):
        yield {'type': 'delta', 'text': '开头'}
        raise RuntimeError('private-key-upstream-traceback')
    monkeypatch.setattr(main.agent, 'stream', failed)
    response = TestClient(main.app).post('/api/chat/stream', json={'message': '你好'})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]['type'] == 'error' and 'private-key' not in response.text


@pytest.mark.parametrize('message,expected', [
    ('今天怎么样', False), ('我已开启屏幕共享，今天开心吗', False),
    ('请看一下我的屏幕', True), ('帮我分析摄像头画面', True),
    ('不要截图，看着屏幕就好', False), ('please describe the camera', True),
])
def test_capture_requires_current_user_intent(message, expected):
    assert CompanionGraph._media_requested(message) is expected


def test_transient_settings_do_not_revoke_proof(tmp_path, monkeypatch):
    store = setup_store(tmp_path, monkeypatch)
    proofs = main.connectivity
    token = proofs.issue('chat', proofs.signature('chat', store))
    proofs.confirm(token, True, store)
    client = TestClient(main.app)
    client.put('/api/settings/model', json={**store.get(), 'gaze_mode': 'auto'})
    assert proofs.status('chat', store)['client_verified']


def test_non_chat_save_preserves_connection_endpoint_and_model(tmp_path, monkeypatch):
    from app.config import ModelSettings
    store = setup_store(tmp_path, monkeypatch)
    store.save(ModelSettings(base_url='https://custom.invalid/v1', model='custom-model'))
    client = TestClient(main.app)
    proofs = main.connectivity
    token = proofs.issue('chat', proofs.signature('chat', store))
    proofs.confirm(token, True, store)
    response = client.put('/api/settings/model', json={'gaze_mode': 'auto', 'bubble_enabled': False})
    assert response.json()['base_url'] == 'https://custom.invalid/v1'
    assert response.json()['model'] == 'custom-model'
    assert proofs.status('chat', store)['client_verified']


def test_graph_stream_cancels_unfinished_response_without_persisting(tmp_path, monkeypatch):
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    graph = CompanionGraph()
    graph.sessions = SessionStore(str(tmp_path / 'isolated.db'))
    cancelled = []
    async def context(_):
        return {'context': '', 'relationship': {}}
    async def reply(_, on_delta=None, on_plan=None):
        try:
            await on_delta('部分回复')
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)
    monkeypatch.setattr(graph, '_context', context)
    monkeypatch.setattr(graph, '_reply', reply)
    async def run():
        stream = graph.stream('你好', 'qa', None)
        assert (await anext(stream))['text'] == '部分回复'
        await stream.aclose()
    asyncio.run(run())
    assert cancelled == [True]
    assert graph.sessions.history('qa') == []
