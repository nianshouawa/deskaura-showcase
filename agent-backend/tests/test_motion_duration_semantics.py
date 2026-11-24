"""Main reply timing stays local; HY auto resolves native/conversation prediction."""
import asyncio

import httpx
import pytest

from app.config import ConfigStore, ModelSettings
from app.graph import CompanionGraph
from app.llm import CompanionLLM
from app.schemas import MotionSpec
from app.services import MotionClient, MotionServiceError


def test_normalize_keeps_only_explicit_local_gesture_duration():
    base = {'motion_prompt': 'wave', 'local_motion_duration': 4.2}
    assert 'local_motion_duration' not in CompanionLLM._normalize(base)
    assert CompanionLLM._normalize({**base, 'motion_needed': True})['local_motion_duration'] == 4.2
    for invalid in (True, 'NaN', 'inf', '-inf'):
        assert CompanionLLM._normalize_duration(invalid) is None


def make_graph(tmp_path, monkeypatch, mode):
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    monkeypatch.setattr('app.config.keyring.get_password', lambda *_: None)
    graph = CompanionGraph()
    graph.config_store = ConfigStore(str(tmp_path / 'config.json'))
    graph.config_store.save(ModelSettings(motion_mode=mode, motion_duration_mode='auto'))
    return graph


@pytest.mark.parametrize('mode', ['online', 'offline', 'hybrid'])
def test_reply_is_speech_bound_but_explicit_local_timing_is_separate(tmp_path, monkeypatch, mode):
    graph = make_graph(tmp_path, monkeypatch, mode)
    calls = []

    class Motion:
        async def emotion_loop(self, emotion):
            return {'id': 'cloud_emotion_' + emotion, 'kind': 'hymotion', 'url': '/clip', 'duration': 5}

        async def route(self, prompt, priority, **kwargs):
            calls.append((prompt, kwargs))
            return {'id': 'generated', 'kind': 'hymotion', 'url': '/clip', 'duration': 5}

    graph.motion = Motion()
    reply = asyncio.run(graph._motion({'response': {'emotion': 'curious', 'motion_prompt': 'a person thinks with a hand on chin'}, 'relationship': {}}))['motion']
    assert reply['reply_motion'] and reply['loop'] and reply['playback'] == 'speech'
    if mode == 'online':
        assert 'think' not in calls[-1][0] and 'chin' not in calls[-1][0]
        assert calls[-1][1]['duration'] is None
        assert 'local_duration' not in calls[-1][1]
    action = asyncio.run(graph._motion({'response': {'motion_needed': True, 'motion_prompt': 'wave hello', 'local_motion_duration': 3.5}, 'relationship': {}}))['motion']
    assert not action['loop'] and not action['reply_motion'] and action['playback'] == 'once'
    assert calls[-1][1]['duration'] is None and calls[-1][1]['local_duration'] == 3.5


def test_native_predictor_failure_survives_both_backends_without_private_details(tmp_path, monkeypatch):
    graph = make_graph(tmp_path, monkeypatch, 'online')
    real_client = httpx.AsyncClient

    def fail(_):
        return httpx.Response(409, headers={'X-DeskAura-Motion-Error': 'automatic_duration_unavailable'}, json={'detail': 'private-credential'})

    monkeypatch.setattr('app.services.httpx.AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(fail), **kw))
    result = asyncio.run(graph._motion({'response': {'motion_needed': True, 'motion_prompt': 'wave'}, 'relationship': {}}))
    motion = MotionSpec.model_validate(result['motion'])
    assert 'Text2MotionPrompter' in motion.generation_error and 'private' not in motion.generation_error

    def unknown(_):
        return httpx.Response(500, headers={'X-DeskAura-Motion-Error': 'private-credential'}, text='secret')

    monkeypatch.setattr('app.services.httpx.AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(unknown), **kw))
    with pytest.raises(MotionServiceError, match='在线动作生成失败'):
        asyncio.run(MotionClient().route('wave'))
