"""Explicit tests exercise providers, not user history, microphone or config guesses."""
import asyncio
import io
import wave

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main, chat_capabilities as inputs
from app.config import ConfigStore
from test_connectivity import setup_store


def test_active_chat_and_asr_are_single_click_and_do_not_use_graph_or_memory(tmp_path, monkeypatch):
    setup_store(tmp_path, monkeypatch)
    called = []
    async def forbidden(*args, **kwargs):
        raise AssertionError('Diagnostics must not create conversations or memory')
    async def reply(message, memory, relation, history):
        assert memory == '' and relation == {} and history == []
        called.append('chat')
        return {'text': '连接正常。'}, False
    async def transcribe(audio, store):
        with wave.open(io.BytesIO(audio)) as wav:
            assert 1 <= wav.getnframes() / wav.getframerate() <= 4
        called.append('recognition')
        return {'text': '你好，语音连接测试。'}
    monkeypatch.setattr(main.agent, 'invoke', forbidden)
    monkeypatch.setattr(main.agent.llm, 'respond', reply)
    monkeypatch.setattr(main, 'transcribe', transcribe)
    client = TestClient(main.app)
    for kind in ('chat', 'recognition'):
        result = client.post(f'/api/connectivity/{kind}/test')
        assert result.status_code == 200
        assert not main.connectivity.status(kind, main.config_store)['client_verified']
        assert client.post('/api/connectivity/receipt', json={'token': result.json()['verification_id'], 'success': True}).json()['accepted']
        assert main.connectivity.status(kind, main.config_store)['client_verified']
    assert called == ['chat', 'recognition']


def test_failed_or_demo_active_detection_never_stays_green(tmp_path, monkeypatch):
    store = setup_store(tmp_path, monkeypatch)
    token = main.connectivity.issue('chat', main.connectivity.signature('chat', store))
    main.connectivity.confirm(token, True, store)
    async def reply(*args):
        return {'text': 'demo'}, True
    async def failed(*args):
        raise HTTPException(502, '识别失败')
    monkeypatch.setattr(main.agent.llm, 'respond', reply)
    monkeypatch.setattr(main, 'transcribe', failed)
    client = TestClient(main.app)
    assert client.post('/api/connectivity/chat/test').status_code == 502
    assert client.post('/api/connectivity/recognition/test').status_code == 502
    assert not main.connectivity.status('chat', store)['client_verified']
    assert not main.connectivity.status('recognition', store)['client_verified']


def capability_store(tmp_path, monkeypatch):
    monkeypatch.setattr('app.config.keyring.get_password', lambda *_: None)
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    store = ConfigStore(str(tmp_path / 'metadata.json'))
    read = store.get
    # Exercise the legacy direct-brain adapter independently of the new
    # separately configured visual module.
    monkeypatch.setattr(store, 'get', lambda: {k: v for k, v in read().items() if k != 'vision_enabled'})
    return store


def mock_metadata(monkeypatch, payload, status=200):
    original = httpx.AsyncClient
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(status, json=payload)
    monkeypatch.setattr(inputs.httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(handle), **kw))
    inputs._remote_capabilities.clear()
    return requests


def test_remote_capabilities_not_model_name_or_legacy_manual_switch(tmp_path, monkeypatch):
    store = capability_store(tmp_path, monkeypatch)
    from app.config import ModelSettings
    store.save(ModelSettings(base_url='https://provider.invalid/v1', model='qwen3-vl-plus', chat_image_mode='on'))
    requests = mock_metadata(monkeypatch, {'data': [{'id': 'qwen3-vl-plus'}]})
    result = asyncio.run(inputs.fetch_chat_capabilities(store))
    assert result['source'] == 'unknown' and not result['image_input']
    assert len(requests) == 1
    asyncio.run(inputs.fetch_chat_capabilities(store))
    assert len(requests) == 1


def test_metadata_enables_only_implemented_modalities(tmp_path, monkeypatch):
    store = capability_store(tmp_path, monkeypatch)
    from app.config import ModelSettings
    store.save(ModelSettings(base_url='https://provider.invalid/v1', model='custom'))
    mock_metadata(monkeypatch, {'data': [{'id': 'custom', 'input_modalities': ['text', 'image', 'audio', 'video']}]})
    result = asyncio.run(inputs.fetch_chat_capabilities(store))
    assert result['source'] == 'provider' and result['image_input']
    assert not any(result[k] for k in ('audio_input', 'video_input', 'document_input'))


def test_ollama_capabilities_use_show_and_failed_lookup_is_unknown(tmp_path, monkeypatch):
    store = capability_store(tmp_path, monkeypatch)
    from app.config import ModelSettings
    store.save(ModelSettings(base_url='http://localhost:11434/v1', model='custom', brain_connection_mode='local'))
    requests = mock_metadata(monkeypatch, {'capabilities': ['completion', 'vision']})
    result = asyncio.run(inputs.fetch_chat_capabilities(store))
    assert result['source'] == 'provider' and result['image_input']
    assert requests[0].method == 'POST' and str(requests[0].url) == 'http://localhost:11434/api/show'
    mock_metadata(monkeypatch, {'error': 'no'}, 401)
    assert asyncio.run(inputs.fetch_chat_capabilities(store))['source'] == 'unknown'
