"""Independent speech status and Bailian native TTS contracts; never paid API calls."""
import asyncio
import io
import json
import wave
from types import SimpleNamespace
import httpx
import pytest
from fastapi import HTTPException
from app import recognition, speech
from app.config import ConfigStore, ModelSettings


def wav_audio(frames=100, rate=24000):
    data = io.BytesIO()
    with wave.open(data, 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(rate)
        output.writeframes(b'\x01\x00' * frames)
    return data.getvalue()


@pytest.fixture
def store(tmp_path, monkeypatch):
    secrets = {}
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    monkeypatch.setattr('app.config.keyring.get_password', lambda service, name: secrets.get(name))
    monkeypatch.setattr('app.config.keyring.set_password', lambda service, name, key: secrets.update({name: key}))
    monkeypatch.setattr('app.config.keyring.delete_password', lambda service, name: secrets.pop(name, None))
    result = ConfigStore(str(tmp_path / 'config.json'))
    speech._verification.clear()
    recognition._recognition_verification.clear()
    return result


def configure_bailian(store):
    store.save(ModelSettings(audio_enabled=True, audio_provider='dashscope', audio_format='wav',
        audio_base_url='https://dashscope.aliyuncs.com/api/v1', audio_model='qwen3-tts-flash',
        audio_voice='Cherry', audio_api_key='private-tts'))


def mock_http(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(speech.httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(handler), **kw))


@pytest.mark.parametrize('base', [
    'https://dashscope.aliyuncs.com', 'https://dashscope.aliyuncs.com/api/v1/',
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation/',
])
def test_bailian_native_endpoint(base):
    expected = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
    assert speech.bailian_speech_endpoint(base) == expected


@pytest.mark.parametrize('base', [
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://dashscope.aliyuncs.com/api/v1/audio/speech',
    'https://user:private@dashscope.aliyuncs.com/api/v1',
    'https://dashscope.aliyuncs.com/api/v1?key=private',
    'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1',
    'http://dashscope.aliyuncs.com/api/v1', 'https://host:invalid/api/v1',
])
def test_bailian_wrong_urls_rejected_without_echo(base):
    with pytest.raises(HTTPException) as error:
        speech.bailian_speech_endpoint(base)
    assert 'private' not in error.value.detail


def test_bailian_request_download_and_audio_credential_isolation(store, monkeypatch):
    configure_bailian(store)
    calls = []
    def provider(request):
        calls.append(request)
        if request.method == 'POST':
            assert request.headers['authorization'] == 'Bearer private-tts'
            assert str(request.url).endswith('/api/v1/services/aigc/multimodal-generation/generation')
            assert json.loads(request.content) == {'model': 'qwen3-tts-flash', 'input': {'text': '你好', 'voice': 'Cherry', 'language_type': 'Auto'}}
            return httpx.Response(200, json={'output': {'audio': {'url': 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/example.wav?Signature=signed'}}})
        assert request.method == 'GET' and request.url.scheme == 'https'
        assert 'authorization' not in request.headers
        assert 'private-tts' not in str(request.url)
        return httpx.Response(200, headers={'content-type': 'audio/wav'}, content=wav_audio())
    mock_http(monkeypatch, provider)
    assert speech.speech_status(store)['provider_verified'] is False
    result = asyncio.run(speech.generate_speech(SimpleNamespace(text='你好'), store))
    assert result.media_type == 'audio/wav' and len(calls) == 2
    assert speech.speech_status(store)['provider_verified']
    assert not recognition.recognition_status(store)['provider_verified']
    assert not recognition.recognition_status(store)['configured']
    assert 'private-tts' not in json.dumps(speech.speech_status(store))


def test_bailian_long_reply_splits_without_losing_text_and_merges_wav(store, monkeypatch):
    configure_bailian(store)
    text = ('这是一个完整句子。' * 150) + '末尾。'
    segments = []
    def provider(request):
        if request.method == 'POST':
            segments.append(json.loads(request.content)['input']['text'])
            return httpx.Response(200, json={'output': {'audio': {'url': 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav'}}})
        return httpx.Response(200, content=wav_audio())
    mock_http(monkeypatch, provider)
    result = asyncio.run(speech.generate_speech(SimpleNamespace(text=text), store))
    assert ''.join(segments) == text and all(0 < len(s) <= 600 for s in segments)
    with wave.open(io.BytesIO(result.body), 'rb') as output:
        assert output.getnframes() == 100 * len(segments)
        assert output.getframerate() == 24000


@pytest.mark.parametrize('url', [
    'https://127.0.0.1/audio.wav', 'https://localhost/audio.wav', 'file:///private',
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.invalid/a.wav',
    'https://user:private@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav',
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com:6006/a.wav',
    'https://other.aliyuncs.com/a.wav',
])
def test_bailian_audio_download_ssrf_guard(url):
    with pytest.raises(HTTPException):
        speech.bailian_audio_url(url)


@pytest.mark.parametrize('response', [
    httpx.Response(200, json={'output': {'audio': {'url': 'https://127.0.0.1/private'}}}),
    httpx.Response(200, json={'error': {'message': 'private-tts'}}),
    httpx.Response(200, json={'code': 'InvalidApiKey', 'message': 'private-tts'}),
    httpx.Response(401, text='private-tts'),
    httpx.Response(403, text='private-tts'),
    httpx.Response(200, content=b'not JSON'),
    httpx.Response(200, content=b'x' * (128 * 1024 + 1)),
])
def test_bailian_bad_result_never_downloads_or_leaks(store, monkeypatch, response):
    configure_bailian(store)
    def provider(request):
        assert request.method == 'POST'
        return response
    mock_http(monkeypatch, provider)
    with pytest.raises(HTTPException) as error:
        asyncio.run(speech.generate_speech(SimpleNamespace(text='你好'), store))
    assert error.value.status_code == 502 and 'private-tts' not in error.value.detail
    assert not speech.speech_status(store)['provider_verified']


def test_bailian_rejects_mismatched_wav_segments_empty_audio_and_redirects(store, monkeypatch):
    for chunks in ([b'not WAV'], [wav_audio(), wav_audio(rate=16000)], [wav_audio(frames=0)]):
        with pytest.raises(HTTPException): speech.merge_bailian_wav(chunks)
    configure_bailian(store)
    def provider(request):
        if request.method == 'POST':
            return httpx.Response(200, json={'output': {'audio': {'url': 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav'}}})
        return httpx.Response(302, headers={'location': 'https://evil.invalid/'})
    mock_http(monkeypatch, provider)
    with pytest.raises(HTTPException) as error:
        asyncio.run(speech.generate_speech(SimpleNamespace(text='你好'), store))
    assert error.value.status_code == 502


@pytest.mark.parametrize('riff_size,data_size', [(0x7fffffbf, 0x7fffff9b), (0xffffffff, 0xffffffff)])
def test_real_bailian_streaming_wav_length_sentinels_are_finalized(riff_size, data_size):
    original = wav_audio(frames=48000)
    streamed = original[:4] + riff_size.to_bytes(4, 'little') + original[8:40] + data_size.to_bytes(4, 'little') + original[44:]
    result, mime = speech.merge_bailian_wav([streamed, streamed])
    assert mime == 'audio/wav'
    assert int.from_bytes(result[4:8], 'little') == len(result) - 8
    assert int.from_bytes(result[40:44], 'little') == len(result) - 44
    with wave.open(io.BytesIO(result), 'rb') as wav:
        assert wav.getnframes() == 96000 and wav.getframerate() == 24000
        assert wav.readframes(96000) == original[44:] * 2


def test_streaming_header_repair_does_not_accept_arbitrary_truncation():
    original = wav_audio()
    for invalid in (original[:-2], original[:4] + (0x7fffffff).to_bytes(4, 'little') + original[8:],
                    original[:40] + (0x7fffff9b).to_bytes(4, 'little') + original[44:]):
        with pytest.raises(HTTPException):
            speech.merge_bailian_wav([invalid])
    streamed = original[:4] + (0x7fffffbf).to_bytes(4, 'little') + original[8:40] + (0x7fffff9b).to_bytes(4, 'little') + original[44:]
    for invalid in (streamed[:-1], streamed[:44]):
        with pytest.raises(HTTPException):
            speech.merge_bailian_wav([invalid])


def test_disabled_speech_services_never_report_verified(store):
    configure_bailian(store)
    store.save(ModelSettings(asr_enabled=True, asr_provider='dashscope', asr_base_url='https://dashscope.aliyuncs.com/compatible-mode/v1',
        asr_model='qwen3-asr-flash', asr_api_key='private-asr'))
    speech.record_verification(store.audio_config(), True, 'provider success')
    recognition.record_recognition_verification(store.asr_config(), True, 'provider success')
    assert speech.speech_status(store)['provider_verified']
    assert recognition.recognition_status(store)['provider_verified']
    store.save(ModelSettings(audio_enabled=False, asr_enabled=False))
    # ASR fingerprints deliberately exclude the enable switch, unlike TTS;
    # neither service may expose a green-capable flag while switched off.
    speech.record_verification(store.audio_config(), True, 'previous provider success')
    assert not speech.speech_status(store)['provider_verified']
    assert not recognition.recognition_status(store)['provider_verified']


def test_stt_and_tts_status_are_separate_configuration_not_health_claim(store, monkeypatch):
    initial = recognition.recognition_status(store)
    assert initial['status'] == 'ok' and initial['kind'] == 'recognition'
    assert not initial['configured'] and not initial['provider_verified']
    store.save(ModelSettings(asr_enabled=True, asr_provider='dashscope', asr_base_url='https://dashscope.aliyuncs.com/compatible-mode/v1',
        asr_model='qwen3-asr-flash', asr_api_key='private-asr'))
    configured = recognition.recognition_status(store)
    assert configured['configured'] and not configured['provider_verified']
    assert not speech.speech_status(store)['configured']
    original = httpx.AsyncClient
    monkeypatch.setattr(recognition.httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={'choices': [{'message': {'content': '你好'}}]})), **kw))
    asyncio.run(recognition.transcribe(wav_audio(), store))
    assert recognition.recognition_status(store)['provider_verified']
    assert not speech.speech_status(store)['provider_verified']
    store.save(ModelSettings(asr_model='qwen3-asr-flash-filetrans'))
    assert not recognition.recognition_status(store)['configured']
    assert not recognition.recognition_status(store)['provider_verified']


def test_status_checks_malformed_urls_without_crashing_or_network(store, monkeypatch):
    configure_bailian(store)
    # Saving now rejects malformed endpoints. Still inspect a legacy/corrupt
    # profile without letting its invalid URL crash a read-only status check.
    value = store._read_file()
    value.update(audio_base_url='https://[broken', asr_enabled=True, asr_provider='dashscope',
                 asr_base_url='https://[broken', asr_model='qwen3-asr-flash')
    store._write_json(store.path, value)
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: pytest.fail('Configuration check is local only'))
    assert not speech.speech_status(store)['configured']
    assert not recognition.recognition_status(store)['configured']


@pytest.mark.parametrize('model', ['qwen-plus', 'qwen3-tts-flash-realtime', 'qwen3-tts-vc-flash', 'qwen3-tts-vd-flash'])
def test_bailian_incompatible_tts_models_fail_before_network(store, monkeypatch, model):
    configure_bailian(store)
    store.save(ModelSettings(audio_model=model))
    monkeypatch.setattr(speech.httpx, 'AsyncClient', lambda **kw: pytest.fail('Must not make paid request'))
    with pytest.raises(HTTPException):
        speech.build_speech_request('你好', store.audio_config())
