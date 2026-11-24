"""Read-only status and attachment validation without contacting paid providers."""
from fastapi.testclient import TestClient
from app import main
from app.config import ConfigStore, ModelSettings


def configured_store(tmp_path, monkeypatch):
    monkeypatch.setattr('app.config.keyring.get_password', lambda *args: None)
    store = ConfigStore(str(tmp_path / 'isolated.json'))
    monkeypatch.setattr(main, 'config_store', store)
    async def metadata(_):
        return {'image_input': False, 'source': 'unknown', 'provider_verified': False}
    monkeypatch.setattr(main, 'fetch_chat_capabilities', metadata)
    return store


def test_two_independent_speech_statuses_and_capabilities(tmp_path, monkeypatch):
    store = configured_store(tmp_path, monkeypatch)
    client = TestClient(main.app)
    for path in ('recognition', 'speech'):
        value = client.get(f'/api/audio/{path}/status').json()
        assert value['status'] == 'ok' and not value['configured'] and not value['provider_verified']
    store.save(ModelSettings(model='custom-text', chat_image_mode='off'))
    assert not client.get('/api/chat/capabilities').json()['image_input']
    store.save(ModelSettings(model='custom-vision', chat_image_mode='on'))
    value = client.get('/api/chat/capabilities').json()
    assert not value['image_input'] and value['source'] == 'unknown' and not value['provider_verified']


def test_rejected_payload_never_echoes_keys_or_attachment_bytes(tmp_path, monkeypatch):
    configured_store(tmp_path, monkeypatch)
    client = TestClient(main.app)
    rejected = 'private-file-content-not-for-errors'
    response = client.post('/api/chat/send', json={'message': 'x', 'attachments': [{'name': 'bad.png', 'kind': 'image', 'mime_type': 'image/png', 'content': rejected}]})
    assert response.status_code == 422 and rejected not in response.text
    response = client.put('/api/settings/model', json={'audio_provider': 'wrong', 'api_key': 'never-echo-this-secret'})
    assert response.status_code == 422 and 'never-echo-this-secret' not in response.text


def test_image_capability_checked_before_chat_generation(tmp_path, monkeypatch):
    store = configured_store(tmp_path, monkeypatch)
    store.save(ModelSettings(model='text-only', chat_image_mode='off'))
    async def forbidden(*args, **kwargs):
        raise AssertionError('Must not generate')
    monkeypatch.setattr(main.agent, 'invoke', forbidden)
    content = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII='
    response = TestClient(main.app).post('/api/chat/send', json={'message': 'what', 'attachments': [{'kind': 'image', 'name': 'tiny.png', 'mime_type': 'image/png', 'content': content}]})
    assert response.status_code == 422 and '尚未允许图片' in response.json()['detail']


def test_bounded_raw_chat_body_precedes_json_parse(tmp_path, monkeypatch):
    configured_store(tmp_path, monkeypatch)
    response = TestClient(main.app).post('/api/chat/send', content=b'x' * (18 * 1024 * 1024 + 1), headers={'content-type': 'application/json', 'origin': 'http://tauri.localhost'})
    assert response.status_code == 413 and '数据过大' in response.json()['detail']
    assert response.headers['access-control-allow-origin'] == 'http://tauri.localhost'


def test_chat_body_limit_does_not_consume_cors_preflight():
    response = TestClient(main.app).options('/api/chat/send', headers={
        'origin': 'http://tauri.localhost', 'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
    })
    assert response.status_code == 200
    assert response.headers['access-control-allow-origin'] == 'http://tauri.localhost'
