import httpx
from fastapi.testclient import TestClient
import app.main as motion


def test_online_explicit_gesture_prefers_live_worker(monkeypatch):
    calls = []
    monkeypatch.setattr(motion.hy_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.hy_motion), 'configured', property(lambda self: True))
    async def generated(prompt, duration):
        calls.append(prompt)
        return {'duration': 2, 'fps': 30, 'poses': [[0] * 66]}
    monkeypatch.setattr(motion.hy_motion, 'generate', generated)
    result = TestClient(motion.app).post('/api/motion/generate', json={'prompt': 'wave hello', 'mode': 'online'})
    assert result.status_code == 200 and calls == ['wave hello']
    assert not result.json()['motion']['id'].startswith('cloud_')


def test_offline_matches_intent_without_worker_or_planner(monkeypatch):
    async def forbidden(*args):
        raise AssertionError('offline must not call cloud or rewrite')
    monkeypatch.setattr(motion.hy_motion, 'generate', forbidden)
    monkeypatch.setattr(motion.ollama_planner, 'rewrite', forbidden)
    monkeypatch.setenv('OLLAMA_MOTION_REWRITE', 'true')
    client = TestClient(motion.app)
    for prompt, ident in [('向我行礼', 'cloud_bow'), ('来点胜利的欢呼', 'cloud_celebrate'),
                          ('show applause', 'cloud_clap'), ('sad and sorrowful posture', 'cloud_emotion_sad')]:
        result = client.post('/api/motion/generate', json={'prompt': prompt, 'mode': 'offline', 'priority': 'high'})
        assert result.status_code == 200
        assert result.json()['motion']['id'] == ident


def test_online_failure_never_falls_back_to_related_archive(monkeypatch):
    monkeypatch.setattr(motion.hy_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.hy_motion), 'configured', property(lambda self: True))
    async def fail(*args):
        raise httpx.ConnectError('offline')
    monkeypatch.setattr(motion.hy_motion, 'generate', fail)
    result = TestClient(motion.app).post('/api/motion/generate', json={'prompt': 'ponder quietly', 'mode': 'online'})
    assert result.status_code == 503
    assert '在线动作生成失败' in result.json()['detail']


def test_online_without_config_never_reads_library(monkeypatch):
    monkeypatch.setattr(motion.hy_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.hy_motion), 'configured', property(lambda self: False))
    monkeypatch.setattr(motion, '_archived', lambda *_: (_ for _ in ()).throw(AssertionError('online must not read library')))
    result = TestClient(motion.app).post('/api/motion/generate', json={'prompt': 'wave hello', 'mode': 'online'})
    assert result.status_code == 503


def test_hybrid_explicit_action_generates_and_offline_fallback_is_marked(monkeypatch):
    monkeypatch.setattr(motion.hy_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.hy_motion), 'configured', property(lambda self: True))
    calls = []
    async def generated(prompt, duration):
        calls.append(prompt)
        return {'duration': 2, 'fps': 30, 'poses': [[0] * 66]}
    monkeypatch.setattr(motion.hy_motion, 'generate', generated)
    client = TestClient(motion.app)
    result = client.post('/api/motion/generate', json={'prompt': 'wave hello', 'mode': 'hybrid'})
    assert result.status_code == 200 and calls == ['wave hello']
    assert not result.json()['motion']['id'].startswith('cloud_')
    async def fail(*args):
        raise httpx.ConnectError('offline')
    monkeypatch.setattr(motion.hy_motion, 'generate', fail)
    result = client.post('/api/motion/generate', json={'prompt': 'wave hello', 'mode': 'hybrid'})
    assert result.json()['motion']['id'] == 'cloud_wave'
    assert result.json()['motion']['archive_fallback']


def test_tencent_selection_never_silently_calls_hymotion(tmp_path, monkeypatch):
    config = tmp_path / 'settings.json'
    config.write_text('{"motion_provider":"tencent_tokenhub"}', encoding='utf-8')
    monkeypatch.setenv('DESKAURA_CONFIG_PATH', str(config))
    monkeypatch.setattr(motion.tencent_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.tencent_motion), 'configured', property(lambda self: True))
    async def generated(*args, **kwargs):
        return {
            'provider': 'tencent_tokenhub',
            'format': 'fbx',
            'url': 'https://cdn.example/motion.fbx',
        }
    monkeypatch.setattr(motion.tencent_motion, 'generate', generated)
    async def cached(*_):
        return "downloaded-fbx", 4
    monkeypatch.setattr(motion, "_cache_tencent_fbx", cached)
    async def forbidden(*args, **kwargs):
        raise AssertionError('Tencent selection must not call the HY-Motion worker')
    monkeypatch.setattr(motion.hy_motion, 'generate', forbidden)
    response = TestClient(motion.app).post('/api/motion/generate', json={
        'prompt': 'wave hello', 'mode': 'online',
    })
    assert response.status_code == 200
    assert response.json()["motion"]["kind"] == "fbx"
    assert response.json()["motion"]["url"] == "/api/motion/fbx/downloaded-fbx"


def test_tencent_selection_hybrid_uses_archived_motion(tmp_path, monkeypatch):
    config = tmp_path / 'settings.json'
    config.write_text('{"motion_provider":"tencent_tokenhub"}', encoding='utf-8')
    monkeypatch.setenv('DESKAURA_CONFIG_PATH', str(config))
    monkeypatch.setattr(motion.tencent_motion, 'refresh', lambda: None)
    monkeypatch.setattr(type(motion.tencent_motion), 'configured', property(lambda self: True))
    async def unavailable(*_):
        raise motion.TencentMotionError("腾讯云动作接口请求失败，请检查地址、密钥和额度")
    monkeypatch.setattr(motion.tencent_motion, "generate", unavailable)
    monkeypatch.setattr(motion.hy_motion, 'generate', lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError('Tencent hybrid fallback must not call HY-Motion')))
    response = TestClient(motion.app).post('/api/motion/generate', json={
        'prompt': 'wave hello', 'mode': 'hybrid',
    })
    assert response.status_code == 200
    assert response.json()['motion']['id'] == 'cloud_wave'
    assert response.json()['motion']['archive_fallback'] is True
