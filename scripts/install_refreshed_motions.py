"""Install a complete reviewed generation batch, with a hash-verified backup.

Use --stage to download raw cloud artifacts, then --install only after review.
No source model, user setting or source archive is deleted.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'motion-service'))
from app.validation import validate_clip


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage', action='store_true')
    parser.add_argument('--install', action='store_true')
    args = parser.parse_args()
    stage = ROOT / 'build/motion-refresh-v2'
    catalog = json.loads((ROOT / 'scripts/motion_refresh_catalog.json').read_text(encoding='utf-8'))
    if args.stage:
        import keyring
        import paramiko
        stage.mkdir(parents=True, exist_ok=True)
        ssh = paramiko.SSHClient()
        ssh.load_system_host_keys()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect('region-46.seetacloud.com', port=54890, username='root',
                    password=keyring.get_password('DeskAura', 'autodl-ssh'), timeout=20)
        try:
            with ssh.open_sftp() as sftp:
                for item in catalog['motions']:
                    sftp.get('/root/autodl-tmp/motion-refresh-v2/' + item['id'] + '.json', str(stage / (item['id'] + '.json')))
        finally:
            ssh.close()
    clips = []
    for item in catalog['motions']:
        data = validate_clip(json.loads((stage / (item['id'] + '.json')).read_text(encoding='utf-8')))
        assert data['id'] == item['id'] and data['model'] == catalog['model']
        assert data['source'] == catalog['source'] and data['generated_at']
        assert data['loop'] == item['loop']
        assert data['quality']['max_degrees_per_frame'] <= 30
        clips.append(data)
    assert len(clips) == 24
    report = {key: catalog[key] for key in ('version', 'model', 'source')}
    report['checkpoint_sha256'] = clips[0]['checkpoint_sha256']
    assert all(clip['checkpoint_sha256'] == report['checkpoint_sha256'] for clip in clips)
    report['motions'] = [{key: value for key, value in clip.items() if key not in ('poses', 'trans')} for clip in clips]
    (stage / 'motion_library_manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if not args.install:
        print('Staged and validated', len(clips), 'clips:', stage)
        return
    destination = ROOT / 'motion-service/data'
    backup = ROOT / 'build' / ('motion-library-backup-install-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir()
    hashes = {}
    for original in list((destination / 'cloud_motions').glob('*.json')) + list(destination.glob('*library*.json')):
        relative = original.relative_to(destination)
        copied = backup / relative
        copied.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original, copied)
        assert digest(original) == digest(copied)
        hashes[str(relative)] = digest(copied)
    (backup / 'sha256.json').write_text(json.dumps(hashes, indent=2), encoding='utf-8')
    # Every input is validated before touching an installed clip. All prior bytes
    # are recoverable from the verified backup, including the old index files.
    try:
        for clip in clips:
            path = destination / 'cloud_motions' / (clip['id'] + '.json')
            shutil.copy2(stage / path.name, path)
        shutil.copy2(stage / 'motion_library_manifest.json', destination / 'motion_library_manifest.json')
        for name, entries in (('emotion_motion_library.json', [c for c in report['motions'] if c.get('emotion')]),
                              ('cloud_motion_library.json', [c for c in report['motions'] if not c.get('emotion')])):
            (destination / name).write_text(json.dumps({**report, 'motions': entries}, ensure_ascii=False, indent=2), encoding='utf-8')
    except Exception:
        for relative in hashes:
            shutil.copy2(backup / relative, destination / relative)
        raise
    print(json.dumps({'installed': len(clips), 'model': catalog['model'], 'backup': str(backup)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
