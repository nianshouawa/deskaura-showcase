"""Run beside uploaded reference archives on the GPU host; no library overwrite."""
import json
import math
from pathlib import Path
import urllib.request

def stats(poses):
    frames = []
    for row in poses:
        qs = []
        for i in range(22):
            aa = row[i * 3:i * 3 + 3]
            angle = math.sqrt(sum(v * v for v in aa))
            qs.append([math.cos(angle / 2)] + [v * math.sin(angle / 2) / max(angle, 1e-9) for v in aa])
        frames.append(qs)
    angles = sorted(math.degrees(2 * math.acos(min(1, abs(sum(a * b for a, b in zip(q, r))))))
                    for left, right in zip(frames, frames[1:]) for q, r in zip(left, right))
    return {'p99_degrees_per_frame': round(angles[int(len(angles) * .99)], 2),
            'max_degrees_per_frame': round(max(angles), 2)}

root = Path('/root/autodl-tmp/deskaura-motion-comparison')
for emotion in ('angry', 'happy', 'shy'):
    old = json.loads((root / f'{emotion}-lite.json').read_text())
    request = urllib.request.Request('http://127.0.0.1:6006/generate',
        data=json.dumps({'prompt': old['prompt'], 'duration': 8}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=180) as response:
        new = json.load(response)
    (root / f'{emotion}-standard.json').write_text(json.dumps(new))
    print(json.dumps({'emotion': emotion, 'lite': stats(old['poses']), 'standard': stats(new['poses'])}), flush=True)
