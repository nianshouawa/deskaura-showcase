import asyncio
import httpx
import pytest
from app import connection


def test_address_validation():
    assert connection.worker_address('http://127.0.0.1:6006/health/') == 'http://127.0.0.1:6006'
    assert connection.worker_address('https://host.test/prefix/generate') == 'https://host.test/prefix'
    for bad in ('ssh root@host', 'socks5://127.0.0.1:1080', 'http://127.0.0.1:1080', 'http://a:b@host', 'https://host/?token=secret'):
        with pytest.raises(ValueError): connection.worker_address(bad)


def test_read_only_connection_and_wrong_service(monkeypatch):
    class Provider:
        configured = True
        worker_url = 'http://127.0.0.1:6006'
        def refresh(self): pass
    real_client = httpx.AsyncClient
    for response, expected in ((httpx.Response(200, json={'status':'ok', 'model_path':'Lite'}), True),
                               (httpx.Response(200, json={'status':'ok'}), False),
                               (httpx.Response(200, text='<html>Jupyter</html>'), False),
                               (httpx.Response(404), False),
                               (httpx.Response(200, json={'status':'loading','model_path':'Lite'}), False)):
        calls = []
        def handler(request):
            calls.append(request)
            return response
        def make_client(**kw):
            assert kw['trust_env'] is False
            return real_client(transport=httpx.MockTransport(handler), **kw)
        monkeypatch.setattr(connection.httpx, 'AsyncClient', make_client)
        result = asyncio.run(connection.inspect_worker(Provider()))
        assert result['ready'] is expected
        assert len(calls) == 1 and calls[0].method == 'GET' and calls[0].url.path == '/health'


def test_connection_failure_is_actionable_and_sanitized(monkeypatch):
    class Provider:
        configured = True
        worker_url = 'http://127.0.0.1:6006'
        def refresh(self): pass
    real_client = httpx.AsyncClient
    def handler(request): raise httpx.ConnectError('internal-private-detail')
    monkeypatch.setattr(connection.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    result = asyncio.run(connection.inspect_worker(Provider()))
    assert not result['ready'] and not result['reachable']
    assert 'internal-private-detail' not in result['detail']
