"""Automatic cloud length selection and local timing; no real cloud calls."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import app.main as motion
from app import hymotion


def test_auto_409_is_specific_sanitized_and_never_reported_as_tunnel_failure(monkeypatch):
    monkeypatch.setattr(motion.hy_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.hy_motion), 'configured', property(lambda self: True))

    async def fail(*_):
        raise hymotion.HYMotionError(hymotion.AUTOMATIC_DURATION_UNAVAILABLE, 'automatic_duration_unavailable', 409)

    monkeypatch.setattr(motion.hy_motion, 'generate', fail)
    response = TestClient(motion.app).post('/api/motion/generate', json={'prompt': 'nod once', 'mode': 'online'})
    assert response.status_code == 409
    assert response.headers['X-DeskAura-Motion-Error'] == 'automatic_duration_unavailable'
    assert response.json()['detail'] == hymotion.AUTOMATIC_DURATION_UNAVAILABLE


def test_native_auto_requires_real_generation_readback_and_receipt(tmp_path, monkeypatch):
    config = tmp_path / 'settings.json'
    config.write_text(json.dumps({'motion_duration_mode': 'auto'}))
    monkeypatch.setenv('DESKAURA_CONFIG_PATH', str(config))
    monkeypatch.setattr(motion.hy_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.hy_motion), 'configured', property(lambda self: True))

    async def inspect(_):
        return {'ready': True, 'automatic_duration': True}

    calls = []
    async def generate(prompt, duration):
        calls.append(duration)
        return {'fps': 30, 'poses': [[0] * 66] * 150, 'duration': 5,
                'duration_source': 'hymotion_native'}

    monkeypatch.setattr(motion, 'inspect_worker', inspect)
    monkeypatch.setattr(motion.hy_motion, 'generate', generate)
    motion.motion_connectivity.clear()
    motion.pending_cloud_checks.clear()
    client = TestClient(motion.app)
    result = client.post('/api/motion/cloud-test').json()
    assert result['verified'] and calls == [None]
    assert not client.get('/api/motion/status').json()['verified']
    clip = client.get(result['result_url']).json()
    assert clip['duration_source'] == 'hymotion_native'
    assert client.post('/api/motion/receipt', json={'result_id': result['result_url'].rsplit('/', 1)[-1]}).json()['accepted']
    assert client.get('/api/motion/status').json()['verified']
    async def fail(*_):
        raise RuntimeError('private-upstream-error')
    monkeypatch.setattr(motion.hy_motion, 'generate', fail)
    assert not client.post('/api/motion/cloud-test').json()['verified']
    assert not client.get('/api/motion/status').json()['verified']
    motion.motion_connectivity.clear()
    motion.pending_cloud_checks.clear()


def test_local_common_duration_does_not_modify_archived_frames_or_cloud_duration(monkeypatch):
    client = TestClient(motion.app)
    response = client.post('/api/motion/generate', json={
        'prompt': 'wave hello', 'mode': 'offline', 'local_duration': 3.0,
    }).json()
    spec = response['motion']
    assert spec['duration'] == 3.0 and spec['duration_source'] == 'local_selection'
    clip = client.get(spec['url']).json()
    assert clip['duration'] == spec['source_duration']
    assert len(clip['poses']) / clip['fps'] == spec['source_duration']

    calls = []
    monkeypatch.setattr(motion.hy_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.hy_motion), 'configured', property(lambda self: True))

    async def generate(prompt, duration):
        calls.append(duration)
        return {'duration': 2, 'fps': 30, 'poses': [[0] * 66]}

    monkeypatch.setattr(motion.hy_motion, 'generate', generate)
    assert client.post('/api/motion/generate', json={
        'prompt': 'wave hello', 'mode': 'online', 'local_duration': 3,
    }).is_success
    assert calls == [None], 'A conversation-selected local duration reached the cloud predictor'


def test_direct_generation_honors_saved_manual_seconds_and_explicit_override(tmp_path, monkeypatch):
    config = tmp_path / 'settings.json'
    config.write_text(json.dumps({'motion_duration_mode': 'manual', 'motion_duration': 8.5}))
    monkeypatch.setenv('DESKAURA_CONFIG_PATH', str(config))
    monkeypatch.setattr(motion.hy_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.hy_motion), 'configured', property(lambda self: True))
    calls = []
    async def generate(prompt, duration):
        calls.append(duration)
        return {'duration': duration, 'fps': 30, 'poses': [[0] * 156]}
    monkeypatch.setattr(motion.hy_motion, 'generate', generate)
    client = TestClient(motion.app)
    saved = client.post('/api/motion/generate', json={'prompt': 'wave twice', 'mode': 'online'})
    assert saved.status_code == 200 and saved.json()['motion']['duration_source'] == 'manual'
    explicit = client.post('/api/motion/generate', json={'prompt': 'wave twice', 'mode': 'online', 'duration': 3})
    assert explicit.status_code == 200
    assert calls == [8.5, 3.0]
    local = client.post('/api/motion/generate', json={'prompt': 'wave twice', 'mode': 'offline', 'local_duration': 2})
    assert local.status_code == 200
    assert local.json()['motion']['duration'] == 8.5
    assert local.json()['motion']['source_duration'] != 8.5
    assert calls == [8.5, 3.0], 'Offline mode unexpectedly called the worker'


@pytest.mark.parametrize('status,detail,code', [
    (409, 'Automatic duration requires HY-Motion PromptRewriter; private-upstream-data', 'automatic_duration_unavailable'),
    (502, 'HY-Motion duration prediction failed; private-upstream-data', 'automatic_duration_failed'),
])
def test_adapter_auto_native_failure_never_requests_estimated_or_random_duration(monkeypatch, status, detail, code):
    monkeypatch.setenv('HY_MOTION_ENABLED', 'true')
    monkeypatch.setenv('HY_MOTION_WORKER_URL', 'http://worker.invalid')
    monkeypatch.setattr(hymotion, '_read_shared_worker_url', lambda: '')
    calls = []
    real_client = httpx.AsyncClient
    def respond(request):
        calls.append((str(request.url), json.loads(request.content)))
        return httpx.Response(status, json={'detail': detail})

    monkeypatch.setattr(hymotion.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    with pytest.raises(hymotion.HYMotionError) as error:
        asyncio.run(hymotion.HYMotionProvider().generate('nod once'))
    assert error.value.code == code and error.value.status == status
    assert 'private' not in error.value.detail
    assert calls == [('http://worker.invalid/generate', {'prompt': 'nod once'})]
    assert not hasattr(hymotion.HYMotionProvider, '_predict_duration')


@pytest.mark.parametrize('duration,worker_source', [(None, 'hymotion_native'), (3.5, 'manual')])
def test_adapter_native_and_manual_never_call_conversation_prediction(monkeypatch, duration, worker_source):
    monkeypatch.setenv('HY_MOTION_ENABLED', 'true')
    monkeypatch.setenv('HY_MOTION_WORKER_URL', 'http://worker.invalid')
    monkeypatch.setattr(hymotion, '_read_shared_worker_url', lambda: '')
    real_client = httpx.AsyncClient
    calls = []
    def respond(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={'fps': 30, 'poses': [[0] * 156] * 105,
            'duration': 3.5, 'duration_source': worker_source})
    monkeypatch.setattr(hymotion.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    result = asyncio.run(hymotion.HYMotionProvider().generate('wave', duration))
    assert result['duration_source'] == worker_source and len(calls) == 1
    assert calls[0] == ({'prompt': 'wave'} if duration is None else {'prompt': 'wave', 'duration': 3.5})


@pytest.mark.parametrize('status,detail', [(409, 'unrelated conflict'), (502, 'bad gateway'), (503, 'offline')])
def test_adapter_unrelated_failures_are_not_duration_retry_success(monkeypatch, status, detail):
    monkeypatch.setenv('HY_MOTION_ENABLED', 'true')
    monkeypatch.setenv('HY_MOTION_WORKER_URL', 'http://worker.invalid')
    monkeypatch.setattr(hymotion, '_read_shared_worker_url', lambda: '')
    calls = []
    real_client = httpx.AsyncClient
    def respond(request):
        calls.append(json.loads(request.content))
        return httpx.Response(status, json={'detail': detail})
    monkeypatch.setattr(hymotion.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(hymotion.HYMotionProvider().generate('wave'))
    assert len(calls) == 1


@pytest.mark.parametrize('source', [None, 'manual', 'conversation_model', 'worker_default'])
def test_auto_rejects_unproven_or_non_native_worker_duration(monkeypatch, source):
    monkeypatch.setenv('HY_MOTION_ENABLED', 'true')
    monkeypatch.setenv('HY_MOTION_WORKER_URL', 'http://worker.invalid')
    monkeypatch.setattr(hymotion, '_read_shared_worker_url', lambda: '')
    real_client = httpx.AsyncClient
    calls = []
    def respond(request):
        calls.append((str(request.url), json.loads(request.content)))
        value = {'fps': 30, 'poses': [[0] * 156] * 90, 'duration': 3}
        if source is not None:
            value['duration_source'] = source
        return httpx.Response(200, json=value)
    monkeypatch.setattr(hymotion.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    with pytest.raises(hymotion.HYMotionError) as error:
        asyncio.run(hymotion.HYMotionProvider().generate('nod once'))
    assert error.value.code == 'automatic_duration_unavailable'
    assert calls == [('http://worker.invalid/generate', {'prompt': 'nod once'})]
