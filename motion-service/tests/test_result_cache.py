import pytest

import app.main as motion


@pytest.fixture
def cache(monkeypatch):
    for name in ("tasks", "motion_results", "result_roles", "result_times", "fbx_results", "pending_cloud_checks"):
        monkeypatch.setattr(motion, name, {})


def test_all_motion_result_metadata_is_bounded(cache, monkeypatch):
    monkeypatch.setattr(motion, "MAX_RESULT_ITEMS", 3)
    for index in range(10):
        ident = str(index)
        motion.tasks[ident] = {}
        motion.motion_results[ident] = {"poses": [[0] * 156]}
        motion.result_roles[ident] = "default"
        motion.pending_cloud_checks[ident] = {}
        motion._remember_result(ident)
    assert set(motion.result_times) == {"7", "8", "9"}
    assert set(motion.motion_results) == set(motion.tasks) == set(motion.result_roles) == set(motion.pending_cloud_checks) == {"7", "8", "9"}


def test_expiry_removes_only_expired_results(cache, monkeypatch):
    monkeypatch.setattr(motion.time, "monotonic", lambda: 1000)
    motion.result_times.update(old=0, recent=999)
    motion.motion_results.update(old={}, recent={})
    motion._remember_result("new")
    assert "old" not in motion.motion_results
    assert "recent" in motion.motion_results
