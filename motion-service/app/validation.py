"""Reject malformed skeletal data before serving or archiving it."""
import math

def validate_clip(data):
    finite = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
    fps, poses = data.get('fps'), data.get('poses')
    if not finite(fps) or fps <= 0 or not isinstance(poses, list) or len(poses) < 2:
        raise ValueError('Invalid fps or frames')
    if any(not isinstance(row, list) or len(row) != 156 or not all(map(finite, row)) for row in poses):
        raise ValueError('Expected finite 52-joint SMPL-H frames')
    duration = data.get('duration')
    if not finite(duration) or abs(duration - len(poses) / fps) > 1 / fps:
        raise ValueError('Invalid duration')
    trans = data.get('trans')
    if not isinstance(trans, list) or len(trans) != len(poses) or any(not isinstance(row, list) or len(row) != 3 or not all(map(finite, row)) for row in trans):
        raise ValueError('Invalid translation')
    return data
