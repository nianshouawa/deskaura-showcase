import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.tencent_motion import TencentMotionError, TencentMotionProvider


def test_missing_key_is_not_configured():
    provider = TencentMotionProvider(api_key="")
    assert not provider.configured
    with pytest.raises(TencentMotionError, match="未配置"):
        asyncio.run(provider.generate("wave"))


def test_submit_poll_returns_fbx_without_leaking_key(monkeypatch):
    calls = []

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            if url.endswith("/submit"):
                return httpx.Response(200, json={"id": "task-1"}, request=httpx.Request("POST", url))
            return httpx.Response(200, json={
                "status": "completed",
                "data": [{"type": "fbx", "url": "https://cdn.example/motion.fbx"}],
            }, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.tencent_motion.httpx.AsyncClient", Client)
    provider = TencentMotionProvider(api_key="sk-secret", poll_interval=.2)
    result = asyncio.run(provider.generate("a gentle bow"))
    assert result["format"] == "fbx" and result["duration_source"] == "tencent_native"
    assert "sk-secret" not in repr(result)
    assert calls[0][1]["json"]["enable_duration_est"] is True
    assert calls[0][1]["headers"]["Authorization"] == "Bearer sk-secret"


def test_manual_duration_is_clamped_and_sent(monkeypatch):
    bodies = []

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            bodies.append(kwargs["json"])
            if url.endswith("/submit"):
                return httpx.Response(200, json={"id": "task-2"}, request=httpx.Request("POST", url))
            return httpx.Response(200, json={"status": "completed", "data": [{"type": "fbx", "url": "https://cdn.example/a.fbx"}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.tencent_motion.httpx.AsyncClient", Client)
    result = asyncio.run(TencentMotionProvider(api_key="test").generate("wave", 30))
    assert result["duration_source"] == "manual"
    assert result["duration"] == 12
    assert bodies[0]["duration"] == 12 and bodies[0]["enable_duration_est"] is False


def test_refresh_reloads_and_clears_keyring_credentials(monkeypatch):
    current = {"key": "first-secret"}
    monkeypatch.delenv("TENCENT_MOTION_API_KEY", raising=False)
    monkeypatch.setattr("app.tencent_motion._saved_motion_key", lambda: current["key"])
    provider = TencentMotionProvider()
    assert provider.configured
    current["key"] = ""
    provider.refresh()
    assert not provider.configured


def test_explicit_test_key_is_not_overwritten_by_refresh(monkeypatch):
    monkeypatch.setattr("app.tencent_motion._saved_motion_key", lambda: "keyring-secret")
    provider = TencentMotionProvider(api_key="explicit-secret")
    monkeypatch.setattr("app.tencent_motion._saved_motion_key", lambda: "")
    provider.refresh()
    assert provider.api_key == "explicit-secret"


def test_submit_endpoint_pasted_as_base_is_normalized(monkeypatch):
    calls = []

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            calls.append(url)
            if url.endswith("/submit"):
                return httpx.Response(200, json={"id": "task-3"}, request=httpx.Request("POST", url))
            return httpx.Response(200, json={
                "status": "completed", "data": [{"type": "fbx", "url": "https://cdn.example/a.fbx"}],
            }, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.tencent_motion.httpx.AsyncClient", Client)
    provider = TencentMotionProvider(
        api_key="test", base_url="https://tokenhub.tencentmaas.com/v1/api/3d/submit",
    )
    asyncio.run(provider.generate("wave"))
    assert calls == [
        "https://tokenhub.tencentmaas.com/v1/api/3d/submit",
        "https://tokenhub.tencentmaas.com/v1/api/3d/query",
    ]


def test_quota_402_has_actionable_non_secret_message(monkeypatch):
    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            return httpx.Response(402, json={"message": "quota exhausted"}, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.tencent_motion.httpx.AsyncClient", Client)
    with pytest.raises(TencentMotionError, match="免费额度已用完"):
        asyncio.run(TencentMotionProvider(api_key="private-key", base_url="https://example.test/api").generate("wave"))


def test_download_fbx_is_bounded_validated_and_cached_without_provider_url(monkeypatch):
    import app.main as motion
    data = b"Kaydara FBX Binary" + bytes(100)

    class Download:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return None
        def raise_for_status(self):
            return None
        async def aiter_bytes(self):
            yield data

    class Client:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return None
        def stream(self, *args):
            return Download()

    monkeypatch.setattr(motion.httpx, "AsyncClient", Client)
    motion.fbx_results.clear()
    ident, duration = asyncio.run(motion._cache_tencent_fbx({
        "url": "https://cdn.example/a.fbx?signed-private-token",
        "duration": 4, "duration_source": "manual",
    }))
    assert duration == 4
    assert motion.fbx_results[ident]["bytes"] == data
    assert "signed-private-token" not in repr(motion.fbx_results)
    assert "url" not in motion.fbx_results[ident]


def test_download_rejects_html_error_page(monkeypatch):
    import app.main as motion

    class Download:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return None
        def raise_for_status(self):
            return None
        async def aiter_bytes(self):
            yield b"<html>private signed URL expired</html>" + bytes(100)

    class Client:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return None
        def stream(self, *args):
            return Download()

    monkeypatch.setattr(motion.httpx, "AsyncClient", Client)
    with pytest.raises(TencentMotionError, match="有效 FBX"):
        asyncio.run(motion._cache_tencent_fbx({"url": "https://cdn.example/a.fbx"}))
