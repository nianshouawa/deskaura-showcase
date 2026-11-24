"""Shared, configuration-bound online proof; no real provider requests."""
import pytest
from fastapi.testclient import TestClient
import app.main as motion


@pytest.fixture
def connected(monkeypatch):
    motion.motion_connectivity.clear()
    motion.pending_cloud_checks.clear()
    monkeypatch.setattr(motion.hy_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.hy_motion), 'configured', property(lambda self: True))
    monkeypatch.setattr(motion.hy_motion, 'worker_url', 'https://worker.invalid')
    state = {'ready': True, 'generated': 0, 'now': 100.0}
    monkeypatch.setattr(motion.time, 'monotonic', lambda: state['now'])
    async def inspect(_):
        return {'ready': state['ready'], 'detail': 'ready' if state['ready'] else 'worker offline'}
    async def generate(*_):
        state['generated'] += 1
        return {'duration': 2, 'fps': 30, 'poses': [[0] * 66]}
    monkeypatch.setattr(motion, 'inspect_worker', inspect)
    monkeypatch.setattr(motion.hy_motion, 'generate', generate)
    yield TestClient(motion.app), state
    motion.motion_connectivity.clear()
    motion.pending_cloud_checks.clear()


def issue(client):
    response = client.post('/api/motion/cloud-test')
    assert response.json()['verified']
    url = response.json()['result_url']
    assert client.get(url).is_success
    return url.rsplit('/', 1)[-1]


def test_health_and_configuration_are_not_generation_evidence(connected):
    client, state = connected
    value = client.get('/api/motion/status').json()
    assert value['configured'] and not value['verified']
    assert not value['provider_verified'] and not value['client_verified']
    assert state['generated'] == 0
    response = client.post('/api/motion/cloud-test').json()
    status = client.get('/api/motion/status').json()
    assert status['provider_verified'] and not status['client_verified'] and not status['verified']
    ident = response['result_url'].rsplit('/', 1)[-1]
    assert client.post('/api/motion/receipt', json={'result_id': ident}).json() == {'accepted': False}


def test_readback_receipt_shared_across_clients_and_not_replayable(connected):
    client, state = connected
    ident = issue(client)
    assert client.post('/api/motion/receipt', json={'result_id': ident}).json() == {'accepted': True}
    another_window = TestClient(motion.app)
    assert another_window.get('/api/motion/status').json()['verified']
    assert state['generated'] == 1
    assert client.post('/api/motion/receipt', json={'result_id': ident}).json() == {'accepted': False}
    assert another_window.get('/api/motion/status').json()['verified']


def test_arbitrary_or_archived_result_cannot_activate_online_proof(connected):
    client, _ = connected
    reply = client.post('/api/motion/generate', json={'prompt': 'wave', 'mode': 'offline'}).json()
    ident = reply['motion']['url'].rsplit('/', 1)[-1]
    assert client.get(reply['motion']['url']).is_success
    for result_id in ('not-a-generated-test', ident):
        assert not client.post('/api/motion/receipt', json={'result_id': result_id}).json()['accepted']
    assert not client.get('/api/motion/status').json()['verified']


def test_configuration_changes_expire_pending_and_shared_proof(connected, monkeypatch):
    client, _ = connected
    ident = issue(client)
    monkeypatch.setattr(motion.hy_motion, 'worker_url', 'https://other-worker.invalid')
    assert not client.post('/api/motion/receipt', json={'result_id': ident}).json()['accepted']
    ident = issue(client)
    assert client.post('/api/motion/receipt', json={'result_id': ident}).json()['accepted']
    monkeypatch.setattr(motion.hy_motion, 'worker_url', 'https://third-worker.invalid')
    assert not client.get('/api/motion/status').json()['verified']


def test_proof_expires_and_disconnect_revokes_it_without_generation(connected):
    client, state = connected
    ident = issue(client)
    assert client.post('/api/motion/receipt', json={'result_id': ident}).json()['accepted']
    state['now'] += 601
    assert not client.get('/api/motion/status').json()['verified']
    ident = issue(client)
    assert client.post('/api/motion/receipt', json={'result_id': ident}).json()['accepted']
    state['ready'] = False
    assert not client.get('/api/motion/status').json()['verified']
    state['ready'] = True
    assert not client.get('/api/motion/status').json()['verified']
    assert state['generated'] == 2


def test_failure_receipt_and_failed_retest_never_leave_stale_green(connected, monkeypatch):
    client, _ = connected
    ident = issue(client)
    assert not client.post('/api/motion/receipt', json={'result_id': ident, 'success': False}).json()['accepted']
    assert not client.get('/api/motion/status').json()['verified']
    ident = issue(client)
    assert client.post('/api/motion/receipt', json={'result_id': ident}).json()['accepted']
    async def failed(*_):
        raise RuntimeError('private-secret-upstream-trace')
    monkeypatch.setattr(motion.hy_motion, 'generate', failed)
    response = client.post('/api/motion/cloud-test')
    assert not response.json()['verified'] and 'private-secret' not in response.text
    assert not client.get('/api/motion/status').json()['verified']


def test_tencent_requires_actual_fbx_readback_and_client_parse_receipt(tmp_path, monkeypatch):
    config = tmp_path / 'settings.json'
    config.write_text('{"motion_provider":"tencent_tokenhub"}', encoding='utf-8')
    monkeypatch.setenv('DESKAURA_CONFIG_PATH', str(config))
    monkeypatch.setattr(motion.tencent_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.tencent_motion), 'configured', property(lambda self: True))
    client = TestClient(motion.app)
    status = client.get('/api/motion/status').json()
    assert status['provider'] == 'tencent_tokenhub'
    assert status['format'] == 'FBX'
    assert status['configured'] is True
    assert status['verified'] is False
    assert '尚未验证' in status['detail']
    health = client.get('/health').json()
    assert health['provider'] == 'tencent-tokenhub'
    assert health['format'] == 'FBX'
    async def generated(*_):
        return {"format": "fbx", "url": "https://cdn.example/generated.fbx", "duration_source": "tencent_native"}
    async def cached(result):
        ident = "qa-tencent"
        motion.fbx_results[ident] = {"bytes": b"Kaydara FBX Binary" + bytes(100), "at": motion.time.monotonic()}
        return ident, 0
    monkeypatch.setattr(motion.tencent_motion, "generate", generated)
    monkeypatch.setattr(motion, "_cache_tencent_fbx", cached)
    info = client.post("/api/motion/cloud-test").json()
    assert info["kind"] == "fbx" and info["provider_verified"] and not info["client_verified"]
    assert not client.get("/api/motion/status").json()["verified"]
    assert client.get(info["result_url"]).content.startswith(b"Kaydara FBX Binary")
    assert client.post("/api/motion/receipt", json={"result_id": "qa-tencent", "success": True}).json()["accepted"]
    assert client.get("/api/motion/status").json()["verified"]
