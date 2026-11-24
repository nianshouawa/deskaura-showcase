from app.hymotion import HYMotionProvider


def test_hymotion_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("HY_MOTION_ENABLED", raising=False)
    monkeypatch.delenv("HY_MOTION_WORKER_URL", raising=False)
    provider = HYMotionProvider()
    assert provider.configured is False
    assert provider.capabilities()["format"].startswith("SMPL-H")
