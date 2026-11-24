"""Provider contracts are mocked: these checks never use a paid API or real key."""
import asyncio
import base64
import json
import httpx
import pytest
from fastapi import HTTPException
from app import recognition
from app.config import ConfigStore, ModelSettings

AUDIO = b'RIFF' + bytes(4) + b'WAVE' + bytes(100)

@pytest.mark.parametrize('text,expected', [
    ('嗯，呃，我我想打开设置。', '我想打开设置。'),
    ('打开文件，嗯，然后帮我查看。', '打开文件，然后帮我查看。'),
    ('嗯', '嗯'), ('嗯。', '嗯。'), ('呃字怎么写？', '呃字怎么写？'),
    ('不要删除文件，不不，我是说不要删除任何文件。', '不要删除文件，不不，我是说不要删除任何文件。'),
    ('把 15 改成 50，哦不，是 55。', '把 15 改成 50，哦不，是 55。'),
    ('打开那个文件，那个“嗯，呃，我我”不要改。', '打开那个文件，那个“嗯，呃，我我”不要改。'),
    ('嗯，运行 `print("嗯，呃")`，不要运行其他代码。', '运行 `print("嗯，呃")`，不要运行其他代码。'),
    (r'呃，打开 C:\项目\嗯，先别删。', r'打开 C:\项目\嗯，先别删。'),
])
def test_conservative_transcript_cleanup_preserves_meaning_and_literals(text, expected):
    assert recognition.clean_transcript(text) == expected


@pytest.fixture
def bailian(tmp_path, monkeypatch):
    secrets = {}
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    monkeypatch.setattr('app.config.keyring.get_password', lambda service, name: secrets.get(name))
    monkeypatch.setattr('app.config.keyring.set_password', lambda service, name, key: secrets.update({name: key}))
    monkeypatch.setattr('app.config.keyring.delete_password', lambda service, name: secrets.pop(name, None))
    store = ConfigStore(str(tmp_path / 'config.json'))
    store.save(ModelSettings(asr_enabled=True, asr_provider='dashscope', asr_api_key='asr-private',
        asr_base_url='https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        asr_model='qwen3-asr-flash'))
    return store, secrets


def mock_provider(monkeypatch, handler):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(recognition.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))


@pytest.mark.parametrize('base,expected', [
    ('https://dashscope.aliyuncs.com', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'),
    ('https://dashscope-intl.aliyuncs.com/compatible-mode/', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'),
    (' https://space.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/ ', 'https://space.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'),
    ('https://space.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions/', 'https://space.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions'),
    ('http://127.0.0.1:6007/v1', 'http://127.0.0.1:6007/v1/chat/completions'),
])
def test_bailian_endpoint_normalization(base, expected):
    assert recognition.recognition_endpoint(base, 'dashscope') == expected


@pytest.mark.parametrize('base', [
    'https://dashscope.aliyuncs.com/api/v1',
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    'https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions',
    'https://dashscope.aliyuncs.com/compatible-mode/v1/audio/speech',
    'https://user:private@dashscope.aliyuncs.com/compatible-mode/v1',
    'https://dashscope.aliyuncs.com/compatible-mode/v1?api_key=private',
    'https://dashscope.aliyuncs.com/compatible-mode/v1#private',
    'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    'http://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://[invalid', 'https://host:wrong/v1', 'ws://host/v1',
])
def test_wrong_bailian_endpoints_rejected_without_echoing_secret(base):
    with pytest.raises(HTTPException) as error:
        recognition.recognition_endpoint(base, 'dashscope')
    assert error.value.status_code == 422 and 'private' not in error.value.detail


@pytest.mark.parametrize('language', ['', 'zh', 'en'])
def test_bailian_json_audio_contract_and_no_secret_in_settings(bailian, monkeypatch, language):
    store, secrets = bailian
    store.save(ModelSettings(model='separate-chat', asr_language=language))
    assert store.get()['asr_provider'] == 'dashscope'
    assert not store.get()['audio_enabled']
    assert secrets == {'asr-api-key': 'asr-private'}
    assert 'asr-private' not in json.dumps(store.get()) + store.path.read_text()
    calls = []
    def provider(request):
        calls.append(request)
        assert str(request.url) == 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
        assert request.headers['authorization'] == 'Bearer asr-private'
        assert request.headers['content-type'] == 'application/json'
        payload = json.loads(request.content)
        assert payload['model'] == 'qwen3-asr-flash' and payload['stream'] is False
        assert payload['asr_options'] == ({'enable_itn': False, 'language': language} if language else {'enable_itn': False})
        assert len(payload['messages']) == 1 and payload['messages'][0]['role'] == 'user'
        part = payload['messages'][0]['content'][0]
        assert part['type'] == 'input_audio'
        mime, data = part['input_audio']['data'].split(',', 1)
        assert mime == 'data:audio/wav;base64' and base64.b64decode(data) == AUDIO
        assert 'asr-private' not in request.content.decode()
        return httpx.Response(200, json={'choices': [{'message': {'content': '  你好，我说完了。  '}}]})
    mock_provider(monkeypatch, provider)
    assert asyncio.run(recognition.transcribe(AUDIO, store)) == {'text': '你好，我说完了。'}
    assert len(calls) == 1  # No fallback, paid retries or alternate providers.


@pytest.mark.parametrize('status', [400, 401, 403, 404, 429, 500, 302])
def test_bailian_failure_is_actionable_and_never_leaks_response(bailian, monkeypatch, status):
    store, _ = bailian
    mock_provider(monkeypatch, lambda r: httpx.Response(status, text='asr-private provider traceback', headers={'location': 'https://other.invalid/'}))
    with pytest.raises(HTTPException) as error:
        asyncio.run(recognition.transcribe(AUDIO, store))
    assert error.value.status_code == 502 and str(status) in error.value.detail
    assert 'asr-private' not in error.value.detail and 'traceback' not in error.value.detail


@pytest.mark.parametrize('payload,status', [
    ({'choices': [{'message': {'content': ''}}]}, 422),
    ({'choices': [{'message': {'content': None}}]}, 422),
    ({'choices': [{'message': {'content': 'x' * 4001}}]}, 422),
    ({'choices': []}, 502), ({'choices': [None]}, 502),
    ({'choices': [{'message': {'content': [{'text': 'not the contract'}]}}]}, 502),
    ({'error': {'message': 'asr-private'}}, 502), ({'text': 'wrong protocol'}, 502),
    ([], 502), (None, 502),
])
def test_bailian_response_validation(bailian, monkeypatch, payload, status):
    store, _ = bailian
    mock_provider(monkeypatch, lambda r: httpx.Response(200, content=json.dumps(payload)))
    with pytest.raises(HTTPException) as error:
        asyncio.run(recognition.transcribe(AUDIO, store))
    assert error.value.status_code == status and 'asr-private' not in error.value.detail


@pytest.mark.parametrize('model', ['qwen3-asr-flash-filetrans', 'qwen3-asr-flash-realtime', 'qwen-plus', 'qwen-tts', ' '])
def test_bailian_wrong_models_fail_before_any_network_call(bailian, monkeypatch, model):
    store, _ = bailian
    store.save(ModelSettings(asr_model=model))
    monkeypatch.setattr(recognition.httpx, 'AsyncClient', lambda **kw: pytest.fail('Must not call a provider'))
    with pytest.raises(HTTPException) as error:
        asyncio.run(recognition.transcribe(AUDIO, store))
    assert error.value.status_code == 422


def test_bailian_encoded_size_and_missing_key_fail_before_network(bailian, monkeypatch):
    store, _ = bailian
    monkeypatch.setattr(recognition.httpx, 'AsyncClient', lambda **kw: pytest.fail('Must not call a provider'))
    with pytest.raises(HTTPException) as error:
        asyncio.run(recognition.transcribe(AUDIO + bytes(7_600_000), store))
    assert error.value.status_code == 422 and '10 MB' in error.value.detail
    store.clear_asr_key()
    with pytest.raises(HTTPException) as error:
        asyncio.run(recognition.transcribe(AUDIO, store))
    assert error.value.status_code == 409


def test_bailian_bounds_invalid_json_and_timeouts(bailian, monkeypatch):
    store, _ = bailian
    real_client = httpx.AsyncClient
    for body in (b'not JSON', b'x' * (128 * 1024 + 1)):
        monkeypatch.setattr(recognition.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=body)), **kw))
        with pytest.raises(HTTPException) as error:
            asyncio.run(recognition.transcribe(AUDIO, store))
        assert error.value.status_code == 502
    def timeout(request):
        raise httpx.ReadTimeout('asr-private', request=request)
    monkeypatch.setattr(recognition.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(timeout), **kw))
    with pytest.raises(HTTPException) as error:
        asyncio.run(recognition.transcribe(AUDIO, store))
    assert error.value.status_code == 502 and 'asr-private' not in error.value.detail


def test_legacy_configuration_defaults_to_multipart(tmp_path, monkeypatch):
    monkeypatch.setattr('app.config.keyring.get_password', lambda *a: None)
    path = tmp_path / 'legacy.json'
    path.write_text(json.dumps({'asr_model': 'old-asr', 'asr_base_url': 'https://old.invalid/v1'}))
    store = ConfigStore(str(path))
    assert store.get()['asr_provider'] == 'compatible'
    assert recognition.recognition_endpoint(store.get()['asr_base_url'], 'compatible') == 'https://old.invalid/v1/audio/transcriptions'
    store.save(ModelSettings(model='chat'))
    assert store.get()['asr_model'] == 'old-asr'
