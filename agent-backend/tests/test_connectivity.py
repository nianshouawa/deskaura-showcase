"""A health response, configured key or generated file is not a client proof."""
from fastapi.testclient import TestClient
from fastapi.responses import Response
from app import main
from app.config import ConfigStore, ModelSettings
from app.connectivity import ConnectivityProofs


def setup_store(tmp_path, monkeypatch):
    keys = {}
    monkeypatch.setattr('app.config.keyring.get_password', lambda _, name: keys.get(name))
    monkeypatch.setattr('app.config.keyring.set_password', lambda _, name, key: keys.update({name: key}))
    store = ConfigStore(str(tmp_path / 'config.json'))
    store.save(ModelSettings(audio_enabled=True, audio_api_key='private-audio', asr_enabled=True, asr_api_key='private-asr', api_key='private-chat'))
    monkeypatch.setattr(main, 'config_store', store)
    monkeypatch.setattr(main, 'connectivity', ConnectivityProofs())
    return store


def test_receipts_are_kind_specific_single_use_configuration_bound_and_expire(tmp_path, monkeypatch):
    store = setup_store(tmp_path, monkeypatch)
    proofs = main.connectivity
    signature = proofs.signature('speech', store)
    token = proofs.issue('speech', signature)
    assert not proofs.status('speech', store)['client_verified']
    assert proofs.confirm(token, True, store)
    assert proofs.status('speech', store)['client_verified']
    assert not proofs.status('recognition', store)['client_verified']
    assert not proofs.confirm(token, True, store)
    proofs.records['speech']['at'] -= 601
    assert not proofs.status('speech', store)['client_verified']
    token = proofs.issue('speech', signature)
    store.save(ModelSettings(audio_voice='different'))
    assert not proofs.confirm(token, True, store)
    assert not proofs.status('speech', store)['client_verified']


def test_speech_stays_red_until_client_playback_and_failure_revokes(tmp_path, monkeypatch):
    setup_store(tmp_path, monkeypatch)
    monkeypatch.setattr(main, 'speech_status', lambda _: {'enabled': True, 'configured': True, 'provider_verified': True, 'detail': '服务商已返回音频'})
    async def generate(*args, **kwargs):
        return Response(b'audio', media_type='audio/wav')
    monkeypatch.setattr(main, 'generate_speech', generate)
    client = TestClient(main.app)
    response = client.post('/api/audio/speech', json={'text': 'hello'})
    token = response.headers['x-deskaura-verification']
    assert 'private' not in token
    assert not client.get('/api/audio/speech/status').json()['verified']
    assert client.post('/api/connectivity/receipt', json={'token': token, 'success': True}).json()['accepted']
    assert client.get('/api/audio/speech/status').json()['verified']
    client.post('/api/connectivity/speech/failure')
    assert not client.get('/api/audio/speech/status').json()['verified']


def test_unsaved_preview_cannot_verify_saved_settings(tmp_path, monkeypatch):
    store = setup_store(tmp_path, monkeypatch)
    async def generate(*args, **kwargs):
        return Response(b'audio', media_type='audio/wav')
    monkeypatch.setattr(main, 'generate_speech', generate)
    client = TestClient(main.app)
    response = client.post('/api/audio/preview', json={**store.get(), 'audio_voice': 'unsaved', 'text': 'hello'})
    assert response.status_code == 200
    assert 'x-deskaura-verification' not in response.headers
    assert not main.connectivity.status('speech', store)['client_verified']


def test_recognition_requires_received_nonempty_text_and_receipt(tmp_path, monkeypatch):
    setup_store(tmp_path, monkeypatch)
    async def transcribe(*args):
        return {'text': 'hello'}
    monkeypatch.setattr(main, 'transcribe', transcribe)
    monkeypatch.setattr(main, 'recognition_status', lambda _: {'enabled': True, 'configured': True, 'provider_verified': True, 'detail': '已识别'})
    client = TestClient(main.app)
    result = client.post('/api/audio/transcribe', content=b'test').json()
    assert not client.get('/api/audio/recognition/status').json()['verified']
    client.post('/api/connectivity/receipt', json={'token': result['verification_id'], 'success': True})
    assert client.get('/api/audio/recognition/status').json()['verified']
    assert not client.get('/api/audio/speech/status').json()['verified']


def test_disable_reenable_cannot_resurrect_proof_or_inflight_ticket(tmp_path, monkeypatch):
    store = setup_store(tmp_path, monkeypatch)
    proofs = main.connectivity
    token = proofs.issue('speech', proofs.signature('speech', store))
    assert proofs.confirm(token, True, store)
    signature = proofs.signature('speech', store)
    pending = proofs.issue('speech', signature)
    client = TestClient(main.app)
    assert client.put('/api/settings/model', json={'audio_enabled': False}).is_success
    assert client.put('/api/settings/model', json={'audio_enabled': True}).is_success
    assert signature != proofs.signature('speech', store)
    assert not proofs.status('speech', store)['client_verified']
    assert not proofs.confirm(pending, True, store)
