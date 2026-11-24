import asyncio
import io
import wave

import httpx
import pytest

from app.config import ConfigStore, ModelSettings, private_model_endpoint, role_scope
from app.llm import CompanionLLM
from app.recognition import recognition_status, transcribe
from app.schemas import SpeechRequest
from app.speech import speech_status, generate_speech


@pytest.mark.parametrize("address,expected", [
    ("http://127.0.0.1:9000/v1", True),
    ("http://localhost:9000/v1", True),
    ("http://192.168.1.20:9000/v1", True),
    ("https://example.com/v1", False),
    ("http://127.0.0.1.example.com/v1", False),
    ("http://name:password@127.0.0.1/v1", False),
    ("file:///C:/models", False),
])
def test_keyless_mode_is_only_for_explicit_private_endpoints(address, expected):
    assert private_model_endpoint(address) is expected


def test_local_deployment_consumes_saved_mode_for_all_three_modules(tmp_path, monkeypatch):
    monkeypatch.setattr("keyring.get_password", lambda *args: None)
    monkeypatch.setenv("DESKAURA_CONFIG_PATH", str(tmp_path / "config.json"))
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    store = ConfigStore()
    with role_scope("local-role"):
        store.save(ModelSettings(
            brain_connection_mode="local", base_url="http://127.0.0.1:9000/v1", model="local-chat",
            hearing_connection_mode="local", asr_enabled=True,
            asr_base_url="http://127.0.0.1:9001/v1", asr_model="local-asr",
            voice_connection_mode="local", audio_enabled=True,
            audio_base_url="http://127.0.0.1:9002/v1", audio_model="local-tts",
        ))
        assert store.get()["ready"]
        assert CompanionLLM._configuration()[1] == "local"
        assert recognition_status(store)["configured"]
        assert speech_status(store)["configured"]

        calls = []
        original = httpx.AsyncClient
        def handle(request):
            calls.append(request)
            if request.url.path.endswith("/audio/transcriptions"):
                return httpx.Response(200, json={"text": "本地识别成功"})
            return httpx.Response(200, headers={"content-type": "audio/mpeg"}, content=b"ID3local-audio")
        monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handle), **kw))
        data = io.BytesIO()
        with wave.open(data, "wb") as target:
            target.setnchannels(1); target.setsampwidth(2); target.setframerate(16000)
            target.writeframes(bytes(32000))
        assert asyncio.run(transcribe(data.getvalue(), store))["text"] == "本地识别成功"
        assert asyncio.run(generate_speech(SpeechRequest(text="你好"), store)).body == b"ID3local-audio"
        assert len(calls) == 2 and all("authorization" not in call.headers for call in calls)
