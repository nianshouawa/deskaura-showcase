"""GPU-host batch generation. Stage candidates; never overwrite the installed library.

Run beside motion_refresh_catalog.json on the AutoDL host. Raw candidates are
retained. Scores flag numerical quality only, not semantic or visual quality.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.request

import numpy as np
from scipy.spatial.transform import Rotation


MODEL = 'HY-Motion-1.0'


def metrics(clip):
    poses = np.asarray(clip['poses'], dtype=float)
    trans = np.asarray(clip['trans'], dtype=float)
    fps = clip['fps']
    if poses.ndim != 2 or poses.shape[1] != 156 or poses.shape[0] < 30 or not np.isfinite(poses).all():
        raise ValueError('Invalid SMPL-H output')
    if trans.shape != (len(poses), 3) or not np.isfinite(trans).all() or fps != 30:
        raise ValueError('Invalid translation or fps')
    rotations = Rotation.from_rotvec(poses[:, :66].reshape(-1, 3)).as_quat().reshape(-1, 22, 4)
    dots = np.abs(np.sum(rotations[1:] * rotations[:-1], axis=-1))
    steps = np.degrees(2 * np.arccos(np.clip(dots, 0, 1)))
    seam = np.degrees(2 * np.arccos(np.clip(np.abs(np.sum(rotations[0] * rotations[-1], axis=-1)), 0, 1)))
    horizontal = trans[:, [0, 2]] - trans[0, [0, 2]]
    result = {
        'p99_degrees_per_frame': round(float(np.percentile(steps, 99)), 3),
        'max_degrees_per_frame': round(float(steps.max()), 3),
        'mean_degrees_per_frame': round(float(steps.mean()), 3),
        'max_raw_seam_degrees': round(float(seam.max()), 3),
        'root_horizontal_range_m': round(float(np.linalg.norm(horizontal, axis=-1).max()), 4),
    }
    return result


def score(stat, loop):
    # Do not reward a frozen sequence as the best speaking/gesture animation.
    frozen = 30 if stat['mean_degrees_per_frame'] < .025 else 0
    return (stat['p99_degrees_per_frame'] + .25 * stat['max_degrees_per_frame']
            + 12 * stat['root_horizontal_range_m']
            + (.025 * stat['max_raw_seam_degrees'] if loop else 0) + frozen)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--only', nargs='*')
    parser.add_argument('--repair', action='store_true', help='Additional candidates using more explicit gesture prompts')
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(Path(__file__).with_name('motion_refresh_catalog.json').read_text())
    with urllib.request.urlopen('http://127.0.0.1:6006/health', timeout=10) as response:
        health = json.load(response)
    if health['status'] != 'ok' or Path(health['model_path']).name != MODEL:
        raise RuntimeError('The standard model must be healthy before generation')
    checkpoint = Path(health['model_path']) / 'latest.ckpt'
    digest = hashlib.sha256()
    with checkpoint.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''): digest.update(block)
    model_sha = digest.hexdigest()
    report = {'version': 2, 'source': catalog['source'], 'model': MODEL,
              'checkpoint_sha256': model_sha, 'motions': []}
    for item in catalog['motions']:
        if args.only and item['id'] not in args.only:
            continue
        item = dict(item)
        if args.repair:
            replacements = {
                'cloud_nod': 'A person nods their head up and down clearly several times in agreement while standing still.',
                'cloud_bow': 'A person bows forward from the waist to greet someone politely, then stands upright again.',
                'cloud_shrug': 'A person shrugs both shoulders slowly while turning both open palms up to show uncertainty, standing in place.',
            }
            item['prompt'] = replacements.get(item['id'], item['prompt'])
        candidates = []
        settings = ((41, 5.0), (59, 5.0)) if args.repair else ((7, 4.0), (23, 3.5))
        for seed, cfg in settings:
            request = {'prompt': item['prompt'], 'duration': item['duration'], 'seed': seed, 'cfg_scale': cfg}
            path = output / f"{item['id']}-seed{seed}.json"
            if path.exists():
                raw = json.loads(path.read_text())
            else:
                print('GENERATE', item['id'], seed, flush=True)
                start = time.monotonic()
                req = urllib.request.Request('http://127.0.0.1:6006/generate',
                    data=json.dumps(request).encode(), headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(req, timeout=300) as response:
                    raw = json.load(response)
                if raw.get('seed') != seed or raw.get('model') != MODEL:
                    raise RuntimeError('Worker did not confirm the requested seed/model')
                raw['generated_at'] = datetime.now(timezone.utc).isoformat()
                raw['generation_seconds'] = round(time.monotonic() - start, 2)
                path.write_text(json.dumps(raw, separators=(',', ':')))
            stat = metrics(raw)
            accepted = stat['max_degrees_per_frame'] <= 30 and stat['root_horizontal_range_m'] <= .65
            candidates.append((score(stat, item['loop']), accepted, raw, request, stat, path.name))
            print(json.dumps({'id': item['id'], 'seed': seed, 'accepted': accepted, **stat}), flush=True)
        eligible = [candidate for candidate in candidates if candidate[1]]
        if not eligible:
            raise RuntimeError(f"Both candidates failed quality gates: {item['id']}")
        _, _, raw, request, stat, raw_path = min(eligible, key=lambda candidate: candidate[0])
        selected = {**item, 'kind': 'hymotion', 'source': catalog['source'], 'model': MODEL,
                    'checkpoint_sha256': model_sha, 'generated_at': raw['generated_at'],
                    'request_sha256': hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest(),
                    'generation': request, 'raw_candidate': raw_path, 'quality': stat,
                    'postprocessing': 'none; runtime quaternion smoothing and loop overlap',
                    **{key: raw[key] for key in ('fps', 'poses', 'trans', 'duration', 'num_frames')}}
        (output / f"{item['id']}.json").write_text(json.dumps(selected, ensure_ascii=False, separators=(',', ':')))
        report['motions'].append({key: value for key, value in selected.items() if key not in ('poses', 'trans')})
        (output / 'motion_library_manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print('SELECTED', item['id'], request['seed'], flush=True)
    print('COMPLETE', len(report['motions']), flush=True)


if __name__ == '__main__':
    main()
