"""Read-only quality measurements shared by motion-library tooling."""
import math


def metrics(clip):
    frames = []
    for row in clip["poses"]:
        rotations = []
        for index in range(22):
            xyz = row[index * 3:index * 3 + 3]
            angle = math.sqrt(sum(value * value for value in xyz))
            factor = math.sin(angle / 2) / angle if angle > 1e-9 else .5
            rotations.append([math.cos(angle / 2), *[value * factor for value in xyz]])
        frames.append(rotations)

    def distance(a, b):
        dot = abs(sum(x * y for x, y in zip(a, b)))
        return math.degrees(2 * math.acos(min(1, dot)))

    steps = sorted(distance(a, b) for before, after in zip(frames, frames[1:])
                   for a, b in zip(before, after))
    origin = clip["trans"][0]
    return {
        "p99_degrees_per_frame": round(steps[int((len(steps) - 1) * .99)], 3),
        "max_degrees_per_frame": round(max(steps), 3),
        "mean_degrees_per_frame": round(sum(steps) / len(steps), 3),
        "max_raw_seam_degrees": round(max(distance(a, b) for a, b in zip(frames[0], frames[-1])), 3),
        "root_horizontal_range_m": round(max(math.hypot(row[0] - origin[0], row[2] - origin[2])
                                             for row in clip["trans"]), 4),
    }
