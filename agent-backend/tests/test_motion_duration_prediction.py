"""Semantic motion timing reuses the configured model, without chat/tool effects."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import llm, main
from test_connectivity import setup_store


@pytest.mark.parametrize('raw,expected', [(2.3, 2.3), (8, 8), (.1, .67), (30, 12)])
def test_duration_prediction_is_prompt_based_and_bounded(monkeypatch, raw, expected):
    monkeypatch.setenv('LLM_API_KEY', 'test-not-real')
    monkeypatch.setenv('LLM_BASE_URL', 'https://provider.invalid/v1')
    monkeypatch.setenv('LLM_MODEL', 'configured-model')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    requests = []
    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=self)
        async def create(self, **kwargs):
            requests.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'duration': raw})))])
    monkeypatch.setattr(llm, 'AsyncOpenAI', Client)
    prompt = 'Jump twice with open arms, then return to standing.'
    result = asyncio.run(llm.CompanionLLM().predict_motion_duration(prompt))
    assert result == expected
    request = requests[0]
    assert request['model'] == 'configured-model' and request['temperature'] == 0
    assert len(request['messages']) == 2 and request['messages'][-1]['content'] == prompt
    assert 'tools' not in request and 'response_format' not in request
    assert '不要随机选择' in request['messages'][0]['content']


@pytest.mark.parametrize('raw', [True, '5秒', None, -1, 0, float('nan'), float('inf')])
def test_invalid_model_duration_is_an_error_not_a_fallback(monkeypatch, raw):
    monkeypatch.setenv('LLM_API_KEY', 'test-not-real')
    async def create(**kwargs):
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'duration': raw})))])
    async def client(*args):
        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    adapter = llm.CompanionLLM()
    monkeypatch.setattr(adapter, '_connected_client', client)
    with pytest.raises(HTTPException):
        asyncio.run(adapter.predict_motion_duration('nod once'))


def test_missing_key_does_not_invent_demo_duration(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', '')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    with pytest.raises(HTTPException) as error:
        asyncio.run(llm.CompanionLLM().predict_motion_duration('nod once'))
    assert error.value.status_code == 409


def test_endpoint_does_not_make_a_turn_touch_memory_or_green_chat(tmp_path, monkeypatch):
    store = setup_store(tmp_path, monkeypatch)
    calls = []
    async def predict(prompt):
        calls.append(prompt)
        return 3.4
    async def forbidden(*args, **kwargs):
        raise AssertionError('Timing must not run chat graph or memory')
    monkeypatch.setattr(main.agent.llm, 'predict_motion_duration', predict)
    monkeypatch.setattr(main.agent, 'invoke', forbidden)
    monkeypatch.setattr(main.agent.llm, 'respond', forbidden)
    client = TestClient(main.app)
    before = client.get('/api/chat/sessions').json()
    response = client.post('/api/motion/duration', json={'prompt': 'wave three times'})
    assert response.status_code == 200
    assert response.json() == {'duration': 3.4, 'duration_source': 'conversation_model'}
    assert calls == ['wave three times']
    assert client.get('/api/chat/sessions').json() == before
    assert not main.connectivity.status('chat', store)['client_verified']


def test_endpoint_failure_is_sanitized_and_no_config_is_rejected(tmp_path, monkeypatch):
    setup_store(tmp_path, monkeypatch)
    async def fail(prompt):
        raise RuntimeError('private-provider-key')
    monkeypatch.setattr(main.agent.llm, 'predict_motion_duration', fail)
    client = TestClient(main.app)
    response = client.post('/api/motion/duration', json={'prompt': 'wave'})
    assert response.status_code == 502 and 'private' not in response.text
    monkeypatch.setattr(main.config_store, 'get', lambda: {'ready': False})
    assert client.post('/api/motion/duration', json={'prompt': 'wave'}).status_code == 409
