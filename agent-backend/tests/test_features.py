import asyncio
import base64
import json
from fastapi.testclient import TestClient
import httpx
import pytest
from fastapi import HTTPException
from app.config import ConfigStore, ModelSettings
from app.llm import CompanionLLM, VALID_EMOTIONS
from app.graph import CompanionGraph
from app.schemas import ChatResponse
from app import speech, main

def test_motion_opt_in():
    assert len(VALID_EMOTIONS) == 14
    for raw in ({}, {'motion_needed': 'true'}, {'motion_needed': 1}, {'motion_needed': True}):
        assert not CompanionLLM._normalize(raw)['motion_needed']
    assert CompanionLLM._normalize({'motion_needed': True, 'motion_prompt': 'standing salute'})['motion_needed']
    assert not CompanionLLM._normalize({})['offended_cleared']
    assert CompanionLLM._normalize({'offended_cleared': True})['offended_cleared']


def test_interaction_offense_state_persists_and_exposes_endpoint(tmp_path, monkeypatch):
    store, _ = make_store(tmp_path, monkeypatch)
    client = TestClient(main.app)
    assert store.get()['offended'] is False
    assert client.post('/api/interaction/offended', json={'offended': True}).json() == {'offended': True}
    assert ConfigStore(str(tmp_path / 'config.json')).offended() is True
    assert client.get('/api/settings/model').json()['offended'] is True
    assert client.post('/api/interaction/offended', json={'offended': False}).json() == {'offended': False}
    assert store.get()['offended'] is False

def test_archive_only_chat_and_serialization(tmp_path, monkeypatch):
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    graph = CompanionGraph()
    class Motion:
        async def emotion_loop(self, emotion):
            return {'id': f'cloud_emotion_{emotion}', 'kind': 'hymotion', 'url': '/clip', 'duration': 8, 'loop': True, 'emotion': emotion}
        async def route(self, *args, **kwargs):
            raise AssertionError('ordinary chat reached GPU')
    graph.motion = Motion()
    for emotion in VALID_EMOTIONS:
        result = asyncio.run(graph._motion({'response': {'emotion': emotion}}))
        response = ChatResponse(text='hello', emotion=emotion, motion=result['motion'], demo_mode=False)
        assert response.model_dump()['motion']['loop']

def make_store(tmp_path, monkeypatch):
    secrets = {}
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    monkeypatch.setattr('app.config.keyring.get_password', lambda service, name: secrets.get(name))
    monkeypatch.setattr('app.config.keyring.set_password', lambda service, name, key: secrets.update({name: key}))
    monkeypatch.setattr('app.config.keyring.delete_password', lambda service, name: secrets.pop(name, None))
    store = ConfigStore(str(tmp_path / 'config.json'))
    monkeypatch.setattr(main, 'config_store', store)
    return store, secrets

def test_audio_settings_preserved_and_secret_separate(tmp_path, monkeypatch):
    store, secrets = make_store(tmp_path, monkeypatch)
    store.save(ModelSettings(audio_enabled=True, audio_api_key='private-tts', audio_voice='test'))
    store.save(ModelSettings(model='changed'))
    assert store.get()['audio_enabled'] and store.get()['audio_voice'] == 'test'
    assert secrets == {'tts-api-key': 'private-tts'}
    assert 'private-tts' not in store.path.read_text() + json.dumps(store.get())
    store.clear_audio_key()
    assert not store.get()['audio_has_api_key']

def test_audio_proxy_disabled_stream_and_sanitized_error(tmp_path, monkeypatch):
    store, _ = make_store(tmp_path, monkeypatch)
    client = TestClient(main.app)
    assert client.post('/api/audio/speech', json={'text': 'hello'}).status_code == 409
    assert client.post('/api/audio/speech', json={'text': ''}).status_code == 422
    store.save(ModelSettings(audio_enabled=True, audio_api_key='private-tts', audio_base_url='https://mock.invalid/v1'))
    real_client = httpx.AsyncClient
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(200, headers={'content-type': 'audio/mpeg'}, content=b'ID3-fake')
    monkeypatch.setattr(speech.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(provider), **kw))
    result = client.post('/api/audio/speech', json={'text': 'hello'})
    assert result.content == b'ID3-fake'
    assert json.loads(calls[0].content)['response_format'] == 'mp3'
    assert calls[0].headers['authorization'] == 'Bearer private-tts'
    monkeypatch.setattr(speech.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(lambda r: httpx.Response(401, text='private-tts')), **kw))
    result = client.post('/api/audio/speech', json={'text': 'hello'})
    assert result.status_code == 502 and 'private-tts' not in result.text

def test_audio_status_reports_configuration_not_provider_verification(tmp_path, monkeypatch):
    store, _ = make_store(tmp_path, monkeypatch)
    client = TestClient(main.app)
    assert client.get('/api/audio/status').json()['detail'] == '已关闭'
    store.save(ModelSettings(audio_enabled=True))
    assert '缺少' in client.get('/api/audio/status').json()['detail']
    store.save(ModelSettings(audio_enabled=True, audio_api_key='private-tts'))
    status = client.get('/api/audio/status')
    assert status.json()['configured'] and not status.json()['provider_verified']
    assert 'private-tts' not in status.text


def test_provider_endpoints_auth_and_pcm():
    from app.speech import build_speech_request, playable_audio
    from app.config import AUDIO_DEFAULTS
    cfg = {**AUDIO_DEFAULTS, 'api_key': 'secret', 'audio_base_url': 'https://example.invalid/v1/audio/speech/'}
    endpoint, headers, body, _, _ = build_speech_request('hello', cfg)
    assert endpoint == 'https://example.invalid/v1/audio/speech'
    assert headers['Authorization'] == 'Bearer secret'
    cfg.update(audio_provider='elevenlabs', audio_base_url='https://api.elevenlabs.io/v1', audio_voice='voice-id')
    endpoint, headers, body, _, _ = build_speech_request('hello', cfg)
    assert endpoint.endswith('/text-to-speech/voice-id') and headers == {'xi-api-key': 'secret'}
    assert body['json']['model_id'] == cfg['audio_model']
    cfg.update(audio_provider='azure', audio_base_url='https://eastus.tts.speech.microsoft.com', audio_voice='zh-CN-XiaoxiaoNeural')
    endpoint, headers, body, _, _ = build_speech_request('<hello & world>', cfg)
    assert headers['Ocp-Apim-Subscription-Key'] == 'secret'
    assert b'&lt;hello &amp; world&gt;' in body['content']
    audio, mime = playable_audio(b'\x00\x01' * 100, 'application/octet-stream', 'pcm', 24000)
    assert audio[:4] == b'RIFF' and mime == 'audio/wav'


def test_preview_uses_unsaved_values_does_not_persist_and_reports_plan(tmp_path, monkeypatch):
    store, _ = make_store(tmp_path, monkeypatch)
    store.save(ModelSettings(audio_api_key='private-tts', audio_base_url='https://easyvoice.ae/api/v1'))
    original = store.path.read_bytes()
    real_client = httpx.AsyncClient
    calls = []
    def provider(request):
        calls.append(request)
        if json.loads(request.content)['voice'] == 'alloy':
            return httpx.Response(403, json={'error': {'code': 'plan_required', 'message': 'private-tts'}})
        return httpx.Response(200, content=b'RIFF\x00\x00\x00\x00WAVE\x00\x00', headers={'content-type': 'audio/wav'})
    monkeypatch.setattr(speech.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(provider), **kw))
    client = TestClient(main.app)
    payload = {'text': 'Hello', 'audio_base_url': 'https://easyvoice.ae/api/v1/audio/speech', 'audio_voice': 'af_aoede'}
    result = client.post('/api/audio/preview', json=payload)
    assert result.status_code == 200 and result.headers['content-type'] == 'audio/wav'
    assert str(calls[-1].url).endswith('/v1/audio/speech') and '/speech/audio/' not in str(calls[-1].url)
    assert store.path.read_bytes() == original
    result = client.post('/api/audio/preview', json={**payload, 'audio_voice': 'alloy'})
    assert 'af_aoede' in result.json()['detail'] and 'private-tts' not in result.text
    count = len(calls)
    result = client.post('/api/audio/preview', json={**payload, 'text': '你好'})
    assert result.status_code == 422 and len(calls) == count


def test_audio_bytes_override_misleading_labels_and_reject_non_audio():
    from app.speech import playable_audio
    audio, mime = playable_audio(b'ID3-example', 'audio/wav', 'wav', 24000)
    assert mime == 'audio/mpeg' and audio.startswith(b'ID3')
    data = json.dumps({'audio': base64.b64encode(b'ID3-example').decode(), 'format': 'mp3'}).encode()
    assert playable_audio(data, 'application/json', 'wav', 24000)[1] == 'audio/mpeg'
    pcm = b'\xff\xff\x00\x00' * 100
    wrapped, mime = playable_audio(pcm, 'application/octet-stream', 'pcm', 24000)
    assert mime == 'audio/wav' and wrapped.startswith(b'RIFF') and wrapped[44:] == pcm
    for content, mime, requested in [(b'<html>login</html>', 'text/html', 'mp3'), (b'{"error":"no"}', 'application/json', 'mp3'), (b'\x00', 'audio/pcm', 'pcm'), (b'', 'audio/mpeg', 'mp3')]:
        with pytest.raises(HTTPException): playable_audio(content, mime, requested, 24000)


def test_failed_network_invalidates_previous_provider_verification(tmp_path, monkeypatch):
    store, _ = make_store(tmp_path, monkeypatch)
    store.save(ModelSettings(audio_enabled=True, audio_api_key='verification-test', audio_base_url='https://network.invalid/v1'))
    speech.record_verification(store.audio_config(), True, 'previous success')
    real_client = httpx.AsyncClient
    def fail(request): raise httpx.ConnectError('do not expose verification-test', request=request)
    monkeypatch.setattr(speech.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(fail), **kw))
    client = TestClient(main.app)
    result = client.post('/api/audio/speech', json={'text': 'hello'})
    assert result.status_code == 502 and 'verification-test' not in result.text
    assert not client.get('/api/audio/status').json()['provider_verified']
