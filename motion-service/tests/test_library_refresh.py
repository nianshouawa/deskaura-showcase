import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient
import app.main as motion
from app.validation import validate_clip


def test_full_refreshed_library_provenance_and_frames():
    root = Path(__file__).resolve().parents[2]
    catalog = json.loads((root / 'scripts/motion_refresh_catalog.json').read_text(encoding='utf-8'))
    manifest = json.loads((motion.CLOUD_LIBRARY_DIR.parent / 'motion_library_manifest.json').read_text(encoding='utf-8'))
    assert len(catalog['motions']) == 24
    assert {item['id'] for item in catalog['motions']} <= {item['id'] for item in manifest['motions']}
    client = TestClient(motion.app)
    for item in catalog['motions']:
        data = motion._archived(item['id'])
        validate_clip(data)
        if data['source'] == 'Tencent TokenHub HY-3D-Motion':
            assert data['model'] == 'hy-3d-motion'
            assert data['task_id'] and len(data['raw_sha256']) == 64
            assert data['revision'] in {'user-refinement-v9', 'user-refinement-v10'}
        else:
            assert data['source'] == 'AutoDL HY-Motion-1.0'
            assert data['model'] == 'HY-Motion-1.0'
            assert data['checkpoint_sha256'] == manifest['checkpoint_sha256']
            assert data['request_sha256'] == hashlib.sha256(json.dumps(data['generation'], sort_keys=True).encode()).hexdigest()
        assert data['loop'] == item['loop']
        assert data['num_frames'] == len(data['poses'])
        assert data['quality']['max_degrees_per_frame'] <= 30
        assert data['quality']['root_horizontal_range_m'] <= .65
        response = client.get('/api/motion/library/' + item['id'])
        assert response.status_code == 200
        assert response.json()['source'] == data['source']


def test_library_id_cannot_escape_directory():
    client = TestClient(motion.app)
    for ident in ('manifest', 'cloud_no_such_motion', 'cloud_%2fsecret'):
        assert client.get('/api/motion/library/' + ident).status_code == 404


def test_emotion_rejects_unverified_provenance(monkeypatch):
    original = motion._archived

    def unverified(ident):
        data = original(ident)
        if ident == 'cloud_emotion_happy':
            return {**data, 'source': 'unverified'}
        return data

    monkeypatch.setattr(motion, '_archived', unverified)
    response = TestClient(motion.app).get('/api/motion/emotion/happy')
    assert response.json()['motion']['archive_fallback'] is True
    assert response.json()['motion']['id'] == 'cloud_emotion_neutral'
    assert response.json()['motion']['emotion'] == 'neutral'
