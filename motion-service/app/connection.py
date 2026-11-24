"""Worker-only URL validation and non-generating tunnel diagnostics."""
from urllib.parse import urlsplit, urlunsplit

import httpx


def worker_address(raw: str) -> str:
    value = raw.strip().rstrip('/')
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError:
        raise ValueError('Worker 地址端口无效') from None
    if url.scheme not in {'http', 'https'} or not url.hostname:
        raise ValueError('请填写 HTTP(S) 本地访问地址，不是 SSH 命令或 SOCKS 代理地址')
    if url.username or url.password or url.query or url.fragment:
        raise ValueError('Worker 地址不能包含账号、密码、查询参数或片段')
    if port in {22, 1080, 10808, 7890, 7897}:
        raise ValueError('这个端口通常用于 SSH / 网络代理。请复制映射到 Worker 6006 的本地 HTTP 访问地址')
    path = url.path.rstrip('/')
    for suffix in ('/health', '/generate'):
        if path.endswith(suffix):
            path = path[:-len(suffix)]
    return urlunsplit((url.scheme, url.netloc, path, '', '')).rstrip('/')


async def inspect_worker(provider):
    provider.refresh()
    if not provider.configured:
        return {'reachable': False, 'ready': False, 'detail': '动作服务未启用云端或未配置 Worker 地址'}
    try:
        base = worker_address(provider.worker_url)
    except ValueError as error:
        return {'reachable': False, 'ready': False, 'detail': str(error)}
    try:
        # AutoDL forwards a target HTTP port, it is NOT an HTTP/SOCKS proxy.
        async with httpx.AsyncClient(timeout=8, trust_env=False, follow_redirects=False) as client:
            response = await client.get(base + '/health')
            if response.status_code != 200:
                return {'reachable': True, 'ready': False, 'worker_url': base,
                        'detail': f'地址可达但 /health 返回 HTTP {response.status_code}；请确认该转发指向动作 Worker，而不是 Jupyter / SSH'}
            try:
                info = response.json()
            except ValueError:
                info = {}
            # A Jupyter page or another healthy HTTP app is not our worker.
            if not isinstance(info, dict) or not any(key in info for key in ('model_path', 'model', 'model_name')):
                return {'reachable': True, 'ready': False, 'worker_url': base, 'detail': '返回内容不是动作 Worker 的模型状态，请检查端口映射'}
            ready = info.get('status') == 'ok'
            return {'reachable': True, 'ready': ready, 'worker_url': base,
                    'model': info.get('model_path') or info.get('model') or info.get('model_name'),
                    'automatic_duration': info.get('automatic_duration'),
                    'detail': '隧道可达，Worker 模型已就绪；尚未验证生成' if ready else '隧道可达，但云端模型仍在加载或报错'}
    except httpx.ConnectError:
        detail = '无法建立连接：请启动 AutoDL 隧道代理，检查实例和本地访问端口'
    except httpx.TimeoutException:
        detail = '连接超时：本地监听不等于转发成功，请检查实例、隧道及云端 Worker'
    except httpx.HTTPError:
        detail = 'HTTP 协议连接失败：请确认复制的是映射到 Worker 的本地访问地址'
    return {'reachable': False, 'ready': False, 'worker_url': base, 'detail': detail}
