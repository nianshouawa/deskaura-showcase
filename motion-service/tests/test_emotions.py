from fastapi.testclient import TestClient
import app.main as motion
from app.emotions import EMOTIONS, EMOTION_IDS
from app.validation import validate_clip

def test_real_emotion_archives_and_no_gpu(monkeypatch):
    async def forbidden(*a, **kw):
        raise AssertionError('emotion request must never generate')
    monkeypatch.setattr(motion.hy_motion, 'generate', forbidden)
    client = TestClient(motion.app)
    assert len(EMOTIONS) == 14
    for emotion, ident in EMOTION_IDS.items():
        result = client.get('/api/motion/emotion/' + emotion)
        assert result.status_code == 200
        spec = result.json()['motion']
        assert spec['id'] == ident and spec['loop'] and not spec['archive_fallback']
        data = motion._archived(ident)
        assert data['source'] in {'AutoDL HY-Motion-1.0-Lite', 'AutoDL HY-Motion-1.0', 'Tencent TokenHub HY-3D-Motion'} and data['generated_at'] and data['prompt']
        validate_clip(data)
        assert client.get(spec['url']).json()['poses'] == data['poses']
    assert client.get('/api/motion/emotion/unknown').status_code == 422

def test_missing_archive_never_generates(tmp_path, monkeypatch):
    monkeypatch.setattr(motion, 'CLOUD_LIBRARY_DIR', tmp_path)
    assert TestClient(motion.app).get('/api/motion/emotion/happy').status_code == 503


def test_missing_specific_reply_uses_normal_reply_before_idle(monkeypatch):
    original = motion._archived
    monkeypatch.setattr(motion, '_archived', lambda ident: None if ident == EMOTION_IDS['shy'] else original(ident))
    spec = TestClient(motion.app).get('/api/motion/emotion/shy').json()['motion']
    assert spec['id'] == EMOTION_IDS['neutral']
    assert spec['emotion'] == 'neutral' and spec['archive_fallback']


def test_idle_is_only_last_resort_after_both_reply_archives_missing(monkeypatch):
    original = motion._archived
    missing = {EMOTION_IDS['shy'], EMOTION_IDS['neutral']}
    monkeypatch.setattr(motion, '_archived', lambda ident: None if ident in missing else original(ident))
    spec = TestClient(motion.app).get('/api/motion/emotion/shy').json()['motion']
    assert spec['id'] == 'cloud_idle' and spec['archive_fallback']
