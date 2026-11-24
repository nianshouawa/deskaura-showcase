import math

import pytest

from scripts.motion_quality import metrics


def test_quality_measurements_preserve_motion_tooling_semantics():
    poses = [[0.] * 156 for _ in range(3)]
    poses[1][0] = math.radians(10)
    poses[2][0] = math.radians(20)
    result = metrics({"poses": poses, "trans": [[0., 0., 0.], [.3, 1., .4], [0., 0., 0.]]})
    assert result["p99_degrees_per_frame"] == 10
    assert result["max_degrees_per_frame"] == 10
    assert result["mean_degrees_per_frame"] == pytest.approx(.455)
    assert result["max_raw_seam_degrees"] == 20
    assert result["root_horizontal_range_m"] == .5
