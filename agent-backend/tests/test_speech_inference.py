"""Common TTS form protocol selection, without external provider requests."""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.config import AUDIO_DEFAULTS, ConfigStore, ModelSettings
from app import speech


@pytest.mark.parametrize("address,model,legacy,expected", [
    ("https://dashscope.aliyuncs.com/api/v1", "qwen3-tts-flash", "compatible", "dashscope"),
    ("https://workspace.cn-beijing.maas.aliyuncs.com/api/v1", "qwen3-tts-flash", "compatible", "dashscope"),
    ("https://custom.example/api/v1", "qwen3-tts-flash", "compatible", "dashscope"),
    ("https://api.elevenlabs.io/v1", "eleven_multilingual_v2", "dashscope", "elevenlabs"),
    ("https://custom.example/v1", "eleven_multilingual_v2", "compatible", "elevenlabs"),
    ("https://eastasia.tts.speech.microsoft.com", "azure-speech", "compatible", "azure"),
    ("https://custom.example/cognitiveservices/v1", "custom", "compatible", "azure"),
    ("https://custom.example", "azure-speech", "compatible", "azure"),
    ("https://easyvoice.ae/api/v1", "kokoro-82m", "azure", "easyvoice"),
    ("https://api.siliconflow.cn/v1", "FunAudioLLM/CosyVoice2-0.5B", "dashscope", "compatible"),
    ("http://localhost:8004/v1", "local-tts", "elevenlabs", "compatible"),
    ("https://custom.example/v1/audio/speech", "qwen3-tts-flash", "dashscope", "compatible"),
])
def test_protocol_is_selected_without_platform_field(address, model, legacy, expected):
    cfg = {**AUDIO_DEFAULTS, "audio_base_url": address, "audio_model": model,
           "audio_provider": legacy, "api_key": "private-key"}
    assert speech.provider_name(cfg) == expected


def test_bailian_common_form_automatically_uses_native_wav():
    cfg = {**AUDIO_DEFAULTS, "audio_base_url": "https://dashscope.aliyuncs.com/api/v1",
           "audio_model": "qwen3-tts-flash", "audio_voice": "Cherry", "api_key": "private-key"}
    endpoint, headers, body, fmt, sample_rate = speech.build_speech_request("你好", cfg)
    assert endpoint.endswith("/api/v1/services/aigc/multimodal-generation/generation")
    assert headers == {"Authorization": "Bearer private-key"}
    assert body["json"]["input"]["voice"] == "Cherry"
    assert fmt == "wav" and sample_rate == 24000
    assert cfg["audio_format"] == "mp3"


@pytest.mark.parametrize("address,model,voice,expected_header,expected_suffix", [
    ("https://api.elevenlabs.io/v1", "eleven_multilingual_v2", "voice-id", "xi-api-key", "/text-to-speech/voice-id"),
    ("https://eastasia.tts.speech.microsoft.com", "azure-speech", "zh-CN-XiaoxiaoNeural",
     "Ocp-Apim-Subscription-Key", "/cognitiveservices/v1"),
    ("https://api.siliconflow.cn/v1", "FunAudioLLM/CosyVoice2-0.5B", "voice-id",
     "Authorization", "/audio/speech"),
])
def test_common_form_uses_matching_authentication(address, model, voice, expected_header, expected_suffix):
    cfg = {**AUDIO_DEFAULTS, "audio_base_url": address, "audio_model": model, "audio_voice": voice,
           "audio_provider": "dashscope", "api_key": "private-key"}
    endpoint, headers, _, _, _ = speech.build_speech_request("hello", cfg)
    assert endpoint.endswith(expected_suffix)
    assert expected_header in headers
    assert len({header for header in ("xi-api-key", "Ocp-Apim-Subscription-Key", "Authorization")
                if header in headers}) == 1


def test_saved_legacy_platform_cannot_break_a_new_compatible_connection(tmp_path, monkeypatch):
    secrets = {}
    monkeypatch.setattr("app.config.keyring.get_password", lambda service, name: secrets.get(name))
    monkeypatch.setattr("app.config.keyring.set_password", lambda service, name, value: secrets.update({name: value}))
    store = ConfigStore(str(tmp_path / "config.json"))
    store.save(ModelSettings(audio_enabled=True, audio_provider="dashscope",
                             audio_base_url="https://api.siliconflow.cn/v1",
                             audio_model="FunAudioLLM/CosyVoice2-0.5B", audio_voice="voice-id",
                             audio_api_key="private-key"))
    real_client, requests = httpx.AsyncClient, []

    def provider(request):
        requests.append(request)
        assert request.url.path == "/v1/audio/speech"
        assert request.headers["authorization"] == "Bearer private-key"
        assert json.loads(request.content)["model"] == "FunAudioLLM/CosyVoice2-0.5B"
        return httpx.Response(200, content=b"ID3local-fixture", headers={"content-type": "audio/mpeg"})

    monkeypatch.setattr(speech.httpx, "AsyncClient",
                        lambda **options: real_client(transport=httpx.MockTransport(provider), **options))
    assert speech.speech_status(store)["provider"] == "compatible"
    assert speech.speech_status(store)["configured"] is True
    response = asyncio.run(speech.generate_speech(SimpleNamespace(text="hello"), store))
    assert response.body == b"ID3local-fixture"
    assert response.headers["X-Audio-Provider"] == "compatible"
    assert len(requests) == 1
    assert speech.speech_status(store)["provider_verified"] is True


def test_inferred_bailian_generator_does_not_require_hidden_format_or_platform(tmp_path, monkeypatch):
    secrets = {}
    monkeypatch.setattr("app.config.keyring.get_password", lambda service, name: secrets.get(name))
    monkeypatch.setattr("app.config.keyring.set_password", lambda service, name, value: secrets.update({name: value}))
    store = ConfigStore(str(tmp_path / "config.json"))
    store.save(ModelSettings(audio_enabled=True, audio_base_url="https://dashscope.aliyuncs.com/api/v1",
                             audio_model="qwen3-tts-flash", audio_voice="Cherry", audio_api_key="private-key"))
    calls = []

    async def generate(text, cfg):
        calls.append((text, speech.provider_name(cfg), speech.output_format(cfg, "dashscope")))
        return b"RIFF-fixture", "audio/wav"

    monkeypatch.setattr(speech, "generate_bailian_audio", generate)
    assert speech.speech_status(store)["configured"] is True
    result = asyncio.run(speech.generate_speech(SimpleNamespace(text="你好"), store))
    assert result.media_type == "audio/wav"
    assert result.headers["X-Audio-Provider"] == "dashscope"
    assert calls == [("你好", "dashscope", "wav")]
