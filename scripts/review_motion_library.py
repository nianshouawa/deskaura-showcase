"""Render generated SMPL-H body keyframes, on the GPU host, for visual review."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial.transform import Rotation


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory')
    parser.add_argument('--offset', type=int, default=0)
    parser.add_argument('--count', type=int, default=8)
    parser.add_argument('--seed', type=int)
    args = parser.parse_args()
    directory = Path(args.directory)
    assets = Path('/root/autodl-tmp/HY-Motion-1.0/scripts/gradio/static/assets/dump_wooden')
    rest = np.fromfile(assets / 'j_template.bin', dtype=np.float32).reshape(-1, 3)[:22]
    parents = np.fromfile(assets / 'kintree.bin', dtype=np.int32)[:22]
    catalog = json.loads(Path(__file__).with_name('motion_refresh_catalog.json').read_text())['motions']
    entries = [item for item in catalog if (directory / (item['id'] + '.json')).exists()]
    entries = entries[args.offset:args.offset + args.count]
    canvas = Image.new('RGB', (1080, len(entries) * 240), '#141924')
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
    for row, item in enumerate(entries):
        path = directory / (item['id'] + (f'-seed{args.seed}' if args.seed is not None else '') + '.json')
        data = json.loads(path.read_text())
        poses = np.asarray(data['poses'])[:, :66].reshape(-1, 22, 3)
        trans = np.asarray(data['trans'])
        draw.text((8, row * 240 + 4), f"{item['id']}  seed={data.get('seed', data.get('generation', {}).get('seed'))}  {data['duration']}s", fill='white', font=font)
        for col, frame in enumerate(np.linspace(0, len(poses) - 1, 6).astype(int)):
            local = Rotation.from_rotvec(poses[frame]).as_matrix()
            world = np.zeros_like(local)
            joints = np.zeros((22, 3))
            for joint in range(22):
                parent = parents[joint]
                if parent < 0:
                    world[joint] = local[joint]
                    joints[joint] = rest[joint]
                else:
                    world[joint] = world[parent] @ local[joint]
                    joints[joint] = joints[parent] + world[parent] @ (rest[joint] - rest[parent])
            # 3/4 front view; fixed scale and anchor across frames, no auto-fitting.
            joints += trans[frame] - trans[0]
            projection = np.column_stack((joints[:, 0] * .72 + joints[:, 2] * .69, -joints[:, 1]))
            points = projection * 100 + [90 + col * 180, row * 240 + 110]
            for joint in range(1, 22):
                color = '#86c5ff' if joint in (1, 4, 7, 10, 13, 16, 18, 20) else '#ffb38a'
                a, b = points[parents[joint]], points[joint]
                draw.line((tuple(a), tuple(b)), fill=color, width=4)
            for point in points:
                x, y = point
                draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill='white')
            head = points[15]
            draw.ellipse((head[0] - 6, head[1] - 12, head[0] + 6, head[1]), outline='#dadff5', width=2)
            draw.text((col * 180 + 8, row * 240 + 222), f'{frame / data["fps"]:.1f}s', fill='#aab7ce', font=font)
    path = directory / f'review-{args.offset}.png'
    canvas.save(path)
    print(path)


if __name__ == '__main__':
    main()
