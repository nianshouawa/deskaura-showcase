"""Provider-specific speech requests and validated, browser-playable audio."""
import asyncio
import base64
import binascii
import hashlib
import io
import json
import re
import time
import wave
from urllib.parse import quote, urlsplit, urlunsplit
from xml.sax.saxutils import escape, quoteattr

import httpx
from fastapi import HTTPException
from fastapi.responses import Response
from .config import private_model_endpoint

MAX_AUDIO = 32 * 1024 * 1024
MAX_BAILIAN_JSON = 128 * 1024
BAILIAN_TTS_SUFFIX = '/services/aigc/multimodal-generation/generation'
_verification: dict[str, dict] = {}


def record_verification(cfg, verified, detail):
    # Keep only a small recent history; no keys or request texts are recorded.
    if len(_verification) >= 32: _verification.pop(next(iter(_verification)))
    _verification[fingerprint(cfg)] = {'verified': verified, 'detail': detail, 'at': int(time.time())}


def provider_name(cfg):
    """Infer the wire protocol; legacy UI selections must not override edits."""
    model = str(cfg.get('audio_model') or '').strip().casefold()
    try:
        parsed = urlsplit(str(cfg.get('audio_base_url') or '').strip())
        host, path = (parsed.hostname or '').casefold().rstrip('.'), parsed.path.rstrip('/').casefold()
    except ValueError:
        host, path = '', ''
    if host == 'easyvoice.ae' or host.endswith('.easyvoice.ae'):
        return 'easyvoice'
    if host == 'elevenlabs.io' or host.endswith('.elevenlabs.io'):
        return 'elevenlabs'
    if (host.endswith('.tts.speech.microsoft.com') or host.endswith('.tts.speech.azure.cn')
            or path.endswith('/cognitiveservices/v1')):
        return 'azure'
    if (host in {'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'}
            or host.endswith('.maas.aliyuncs.com') or path.endswith(BAILIAN_TTS_SUFFIX)):
        return 'dashscope'
    # Explicit compatible endpoints take precedence over an old native model.
    if path.endswith('/audio/speech'):
        return 'compatible'
    if re.search(r'/text-to-speech(?:/[^/]+)?$', path) or model.startswith('eleven_'):
        return 'elevenlabs'
    if model in {'azure', 'azure-speech', 'azure-tts'}:
        return 'azure'
    if model.startswith(('qwen3-tts-', 'qwen-tts')):
        return 'dashscope'
    return 'compatible'


def output_format(cfg, provider):
    """Use a supported format when switching services in the common form."""
    requested = cfg.get('audio_format', 'mp3')
    supported = {
        'dashscope': ('wav',),
        'azure': ('mp3', 'wav', 'pcm'),
        'elevenlabs': ('mp3', 'pcm'),
        'easyvoice': ('mp3', 'wav', 'pcm'),
    }.get(provider)
    return requested if supported is None or requested in supported else supported[0]


def fingerprint(cfg):
    return hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()


def speech_status(store):
    cfg = store.audio_config()
    local = cfg.get("voice_connection_mode") == "local" and private_model_endpoint(cfg.get("audio_base_url", ""))
    configured = bool((cfg['api_key'] or local) and cfg['audio_base_url'] and cfg['audio_voice'] and (cfg['audio_model'] or provider_name(cfg) == 'azure'))
    problem = ''
    if configured:
        try:
            build_speech_request('test', cfg)
        except (HTTPException, ValueError, TypeError):
            configured = False
            problem = '地址、模型或输出格式需要检查'
    previous = _verification.get(fingerprint(cfg), {})
    return {'status': 'ok', 'enabled': cfg['audio_enabled'], 'configured': configured,
            'provider_verified': bool(cfg['audio_enabled'] and configured and previous.get('verified', False)), 'provider': provider_name(cfg),
            'kind': 'synthesis',
            'detail': '已关闭' if not cfg['audio_enabled'] else previous.get('detail') or ('待检测' if configured else problem or '缺少密钥或配置'),
            'verified_at': previous.get('at')}


def speech_endpoint(base, suffix):
    parsed = urlsplit(base.strip())
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(400, '请填写 HTTP(S) API 地址，不要包含密钥、查询参数或网页片段')
    path = parsed.path.rstrip('/')
    if path.endswith(suffix): return urlunsplit(parsed._replace(path=path))
    return urlunsplit(parsed._replace(path=path + suffix))


def bailian_speech_endpoint(base):
    """Qwen TTS uses DashScope's native HTTP API, not compatible audio/speech."""
    try:
        parsed = urlsplit(base.strip().rstrip('/'))
        valid = (parsed.scheme == 'https' and parsed.hostname and not parsed.username
                 and not parsed.password and not parsed.query and not parsed.fragment
                 and parsed.port in {None, 443})
    except ValueError:
        valid = False
    if not valid or any(character in base for character in '{}<>'):
        raise HTTPException(400, '百炼语音合成需要有效 HTTPS API 地址，不要包含密钥或未替换的业务空间占位符。')
    path = parsed.path.rstrip('/')
    if path == '':
        path = '/api/v1'
    if path == '/api/v1':
        path += BAILIAN_TTS_SUFFIX
    elif path != '/api/v1' + BAILIAN_TTS_SUFFIX:
        raise HTTPException(400, '百炼语音合成请填写原生 /api/v1 根地址或完整 multimodal-generation/generation 地址，不是兼容模式或 ASR 地址。')
    return urlunsplit(parsed._replace(path=path))


def build_speech_request(text, cfg):
    provider = provider_name(cfg)
    headers = {'Authorization': 'Bearer ' + cfg['api_key']} if cfg["api_key"] else {}
    fmt, speed = output_format(cfg, provider), cfg.get('audio_speed', 1)
    if provider == 'dashscope':
        model = cfg['audio_model'].strip()
        if not (model == 'qwen3-tts-flash' or model.startswith('qwen3-tts-flash-')) or any(part in model.lower() for part in ('realtime', 'vc', 'vd')):
            raise HTTPException(400, '百炼当前适配 qwen3-tts-flash 同步语音合成及其版本，不支持 realtime、声音复刻或声音设计模型。')
        if len(text) > 600:
            raise HTTPException(400, '百炼单次请求最多 600 字，请使用程序的自动分段生成。')
        return bailian_speech_endpoint(cfg['audio_base_url']), headers, {'json': {
            'model': model, 'input': {'text': text, 'voice': cfg['audio_voice'].strip(), 'language_type': 'Auto'},
        }}, 'wav', 24000
    if provider == 'azure':
        headers = {'Ocp-Apim-Subscription-Key': cfg['api_key'], 'Content-Type': 'application/ssml+xml',
                   'X-Microsoft-OutputFormat': {'mp3': 'audio-24khz-48kbitrate-mono-mp3', 'wav': 'riff-24khz-16bit-mono-pcm', 'pcm': 'raw-24khz-16bit-mono-pcm'}[fmt]}
        voice = cfg['audio_voice'].strip()
        language = '-'.join(voice.split('-')[:2])
        ssml = f'<speak version="1.0" xml:lang={quoteattr(language)}><voice name={quoteattr(voice)}><prosody rate="{(speed - 1) * 100:+.0f}%">{escape(text)}</prosody></voice></speak>'
        return speech_endpoint(cfg['audio_base_url'], '/cognitiveservices/v1'), headers, {'content': ssml.encode()}, fmt, 24000
    if provider == 'elevenlabs':
        headers = {'xi-api-key': cfg['api_key']}
        endpoint = speech_endpoint(cfg['audio_base_url'], '/text-to-speech/' + quote(cfg['audio_voice'].strip(), safe=''))
        data = {'text': text, 'model_id': cfg['audio_model'].strip(), 'voice_settings': {'speed': min(1.2, max(.7, speed))}}
        return endpoint, headers, {'params': {'output_format': 'mp3_44100_128' if fmt == 'mp3' else 'pcm_24000'}, 'json': data}, fmt, 24000
    if provider == 'easyvoice' and not cfg['audio_voice'].startswith(('jf_', 'jm_')) and re.search(r'[\u3400-\u9fff]', text):
        raise HTTPException(422, 'EasyVoice 当前未提供中文音色。英文可用 af_aoede 测试；中文朗读请选择支持中文的服务和音色。')
    data = {'model': cfg['audio_model'].strip(), 'voice': cfg['audio_voice'].strip(), 'input': text,
            'response_format': fmt, 'speed': speed}
    return speech_endpoint(cfg['audio_base_url'], '/audio/speech'), headers, {'json': data}, fmt, cfg.get('audio_sample_rate', 24000)


def provider_error(status, content, cfg):
    if provider_name(cfg) == 'dashscope':
        hints = {400: '检查 Qwen TTS 同步模型、音色 ID 和输入参数',
                 401: '检查独立语音合成密钥与北京 / 新加坡地域是否匹配',
                 403: '检查模型、业务空间权限及账户状态',
                 404: '检查原生 API 地址及该地域的模型是否可用',
                 429: '额度不足或超过调用频率限制'}
        return f"百炼语音合成 HTTP {status}：{hints.get(status, '服务商暂时不可用，请稍后重试')}。"
    code = ''
    try:
        data = json.loads(content)
        error = data.get('error', data)
        if isinstance(error, dict):
            code = str(error.get('code', ''))
            message = str(error.get('message', error.get('detail', '')))
        else: message = str(error)
    except (ValueError, TypeError, AttributeError): message = ''
    if code == 'plan_required':
        return '当前音色需要付费套餐；EasyVoice 免费账户请选 af_aoede / af_heart / af_nova 等免费音色（alloy 需要升级）。'
    if status == 401: return '密钥认证失败（401）：检查独立语音密钥与所选平台是否匹配。'
    if status == 403: return '访问被拒绝（403）：检查音色、模型的套餐权限，以及地区或账户限制。'
    if status == 404: return '接口不存在（404）：检查 API 根地址、平台类型和模型 / 音色 ID，勿填网页地址。'
    if status == 429: return '请求受限（429）：额度不足或调用过快，请查看账户额度并稍后重试。'
    if status >= 500: return f'服务商暂时出错（{status}），请稍后重试。'
    message = message.replace(cfg['api_key'], '[已隐藏]') if cfg['api_key'] else message
    message = re.sub(r'(?i)(bearer\s+\S+|(?:sk|ev)_[\w-]+|https?://\S+)', '[已隐藏]', message)
    return f'服务商拒绝请求（{status}）' + (f'：{message[:220]}' if message else '：请检查模型、音色和格式。')


def playable_audio(content, mime, requested, sample_rate):
    """Trust bytes over mislabeled formats; raw PCM needs a WAV container."""
    mime = mime.lower().split(';')[0].strip()
    if mime == 'application/json' or content.lstrip().startswith(b'{'):
        try:
            data = json.loads(content)
            encoded = data.get('audio')
            if not isinstance(encoded, str): raise ValueError()
            content = base64.b64decode(encoded.split(',', 1)[-1], validate=True)
            requested = data.get('format', requested)
            mime = ''
        except (ValueError, TypeError, binascii.Error):
            raise HTTPException(502, '服务商返回 JSON 而非可播放音频；请关闭时间戳 / 异步任务输出并检查平台协议。') from None
    if not content: raise HTTPException(502, '服务商返回了空音频')
    if content[:4] == b'RIFF' and content[8:12] == b'WAVE': return content, 'audio/wav'
    # Raw PCM often starts ff ff 00 00 (samples -1, 0). A sync word alone
    # incorrectly classifies it as MP3; validate version/layer/bitrate/rate too.
    mpeg_frame = (len(content) >= 4 and content[0] == 255 and content[1] & 0xe0 == 0xe0
                  and (content[1] >> 3) & 3 != 1 and content[1] & 6 != 0
                  and 0 < content[2] >> 4 < 15 and (content[2] >> 2) & 3 != 3)
    if content.startswith(b'ID3') or mpeg_frame: return content, 'audio/mpeg'
    if content.startswith(b'OggS'): return content, 'audio/ogg'
    if content.startswith(b'fLaC'): return content, 'audio/flac'
    if len(content) > 1 and content[0] == 255 and content[1] & 0xf6 == 0xf0: return content, 'audio/aac'
    if requested == 'pcm' and mime in {'', 'application/octet-stream', 'audio/pcm', 'audio/l16', 'audio/raw'}:
        if len(content) % 2: raise HTTPException(502, 'PCM 字节数无效；需要 16 位单声道音频')
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(sample_rate); wav.writeframes(content)
        return output.getvalue(), 'audio/wav'
    raise HTTPException(502, '返回内容不是支持的音频文件；请尝试 WAV 或 MP3，并检查地址是否指向语音接口。')


def bailian_audio_url(value):
    """Only fetch provider-owned signed OSS files; do not forward Bearer credentials."""
    if not isinstance(value, str) or len(value) > 8192:
        raise HTTPException(502, '百炼未返回有效音频下载地址。')
    try:
        url = urlsplit(value)
        valid = (url.scheme in {'https', 'http'} and not url.username and not url.password
                 and not url.fragment and url.port in {None, 443}
                 and re.fullmatch(r'dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com', url.hostname or ''))
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(502, '百炼返回的音频下载域名不在支持范围内，已阻止访问；请检查平台协议。')
    # Official examples may return http OSS links; the same signed file supports HTTPS.
    return urlunsplit(url._replace(scheme='https'))


def split_bailian_text(text):
    """Respect Qwen's 600-character request cap without dropping reply text."""
    remaining = text.strip()
    parts = []
    while len(remaining) > 600:
        cut = 600
        for match in re.finditer(r'[。！？!?；;\n]', remaining[:600]):
            if match.end() >= 180:
                cut = match.end()
        parts.append(remaining[:cut])
        remaining = remaining[cut:]
    if remaining:
        parts.append(remaining)
    return parts


async def _bounded_body(response, limit, message):
    content = bytearray()
    async for chunk in response.aiter_bytes():
        content.extend(chunk)
        if len(content) > limit:
            raise HTTPException(502, message)
    return bytes(content)


def merge_bailian_wav(parts):
    """Join matching PCM WAV segments, never concatenate complete containers."""
    if not parts:
        raise HTTPException(502, '百炼返回了空音频。')
    output = io.BytesIO()
    parameters = None
    total_frames = 0
    try:
        with wave.open(output, 'wb') as target:
            for content in parts:
                content = normalize_bailian_wav(content)
                if len(content) < 12 or int.from_bytes(content[4:8], 'little') != len(content) - 8:
                    raise ValueError('Truncated RIFF container')
                with wave.open(io.BytesIO(content), 'rb') as source:
                    current = (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype())
                    if current[0] not in {1, 2} or current[1] != 2 or not 8000 <= current[2] <= 48000 or current[3] != 'NONE':
                        raise ValueError('Unsupported WAV')
                    if parameters is None:
                        parameters = current
                        target.setnchannels(current[0]); target.setsampwidth(current[1]); target.setframerate(current[2])
                    elif parameters != current:
                        raise ValueError('Inconsistent WAV segments')
                    frames = source.readframes(source.getnframes())
                    if not frames or len(frames) != source.getnframes() * current[0] * current[1]:
                        raise ValueError('Truncated WAV')
                    total_frames += source.getnframes()
                    if total_frames > current[2] * 240 or output.tell() + len(frames) > MAX_AUDIO:
                        raise HTTPException(502, '生成音频超过 4 分钟或大小限制，请缩短回复。')
                    target.writeframes(frames)
    except (ValueError, EOFError, wave.Error):
        raise HTTPException(502, '百炼音频不是完整的兼容 PCM WAV，或分段格式不一致。') from None
    return output.getvalue(), 'audio/wav'


def normalize_bailian_wav(content):
    """Finalize the unseekable PCM WAV header returned by native Qwen TTS.

    Actual provider downloads can retain FFmpeg-style ~2 GiB length sentinels
    although the complete HTTP body is only a few seconds long. Repair only a
    canonical PCM header with that recognizable sentinel pair, never arbitrary
    truncated WAV data or chunk layouts. The caller still validates PCM format,
    frame alignment, duration and size before returning a playable container.
    """
    if (len(content) < 44 or content[:4] != b'RIFF' or content[8:16] != b'WAVEfmt '
            or int.from_bytes(content[16:20], 'little') != 16
            or int.from_bytes(content[20:22], 'little') != 1
            or content[36:40] != b'data'):
        return content
    riff_size = int.from_bytes(content[4:8], 'little')
    data_size = int.from_bytes(content[40:44], 'little')
    sentinel = (riff_size == data_size + 36 and 0x7fff0000 <= data_size <= 0x7fffffff
                or riff_size == data_size == 0xffffffff)
    if not sentinel:
        return content
    channels = int.from_bytes(content[22:24], 'little')
    alignment = int.from_bytes(content[32:34], 'little')
    bits = int.from_bytes(content[34:36], 'little')
    actual_size = len(content) - 44
    if (channels not in {1, 2} or bits != 16 or alignment != channels * 2
            or not actual_size or actual_size % alignment or len(content) > MAX_AUDIO):
        raise HTTPException(502, '百炼流式 WAV 音频帧不完整或格式不受支持。')
    return (content[:4] + (len(content) - 8).to_bytes(4, 'little') + content[8:40]
            + actual_size.to_bytes(4, 'little') + content[44:])


async def generate_bailian_audio(text, cfg):
    parts = []
    total = 0
    # No silent retry: each segment is one explicit TTS request for the given reply.
    async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=12), follow_redirects=False) as client:
        for segment in split_bailian_text(text):
            endpoint, headers, body, _, _ = build_speech_request(segment, cfg)
            async with client.stream('POST', endpoint, headers=headers, **body) as response:
                content = await _bounded_body(response, MAX_BAILIAN_JSON, '百炼语音合成返回数据过大。')
                if response.status_code != 200:
                    raise HTTPException(502, provider_error(response.status_code, content, cfg))
                try:
                    result = json.loads(content)
                    if result.get('code') or result.get('status_code', 200) != 200:
                        raise ValueError('Provider error')
                    audio = result['output']['audio']
                    url = bailian_audio_url(audio['url'])
                except (ValueError, TypeError, KeyError, AttributeError):
                    raise HTTPException(502, '百炼未返回有效的 output.audio.url，请确认使用同步 Qwen TTS 协议。') from None
            # Signed OSS URL already authorizes the file. Never send the API Key here.
            async with client.stream('GET', url) as response:
                if response.status_code != 200:
                    raise HTTPException(502, '百炼已生成音频，但下载失败；请稍后重试并检查网络。')
                content = await _bounded_body(response, MAX_AUDIO - total, '生成音频过大，请缩短回复。')
                total += len(content)
                parts.append(content)
    return merge_bailian_wav(parts)


async def generate_speech(payload, store, *, override=None, preview=False):
    cfg = store.audio_config()
    if override is not None:
        cfg.update({key: value for key, value in override.model_dump().items() if key.startswith('audio_') and key != 'audio_api_key'})
        if override.audio_api_key and override.audio_api_key.strip(): cfg['api_key'] = override.audio_api_key.strip()
    if not preview and not cfg['audio_enabled']: raise HTTPException(409, '请先启用并保存语音合成')
    local = cfg.get("voice_connection_mode") == "local" and private_model_endpoint(cfg.get("audio_base_url", ""))
    if not cfg['api_key'] and not local: raise HTTPException(409, '缺少独立语音密钥；本地部署请填写本机或局域网接口')
    started = time.monotonic()
    try:
        if provider_name(cfg) == 'dashscope':
            async with asyncio.timeout(90):
                audio, mime = await generate_bailian_audio(payload.text, cfg)
        else:
            endpoint, headers, body, fmt, sample_rate = build_speech_request(payload.text, cfg)
            async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=12), follow_redirects=False) as client:
                async with client.stream('POST', endpoint, headers=headers, **body) as upstream:
                    if not upstream.is_success:
                        error = bytearray()
                        async for chunk in upstream.aiter_bytes():
                            error.extend(chunk[:8192 - len(error)])
                            if len(error) >= 8192: break
                        detail = provider_error(upstream.status_code, error, cfg)
                        raise HTTPException(502, detail)
                    content = await _bounded_body(upstream, MAX_AUDIO, '单次音频过大，请缩短回复或改用 MP3')
                    audio, mime = playable_audio(content, upstream.headers.get('content-type', ''), fmt, sample_rate)
    except HTTPException as error:
        record_verification(cfg, False, str(error.detail))
        raise
    except (httpx.HTTPError, ValueError, TimeoutError) as error:
        timed_out = isinstance(error, (httpx.TimeoutException, TimeoutError))
        detail = '语音请求超时：检查网络、代理和服务商状态，可缩短文本后重试。' if timed_out else '连接语音服务失败：检查 API 地址、网络与系统代理。'
        record_verification(cfg, False, detail)
        raise HTTPException(504 if timed_out else 502, detail) from None
    record_verification(cfg, True, '服务商已返回有效音频 · 待客户端播放确认')
    return Response(audio, media_type=mime, headers={'Cache-Control': 'no-store', 'X-Audio-Provider': provider_name(cfg),
                    'X-Audio-Generation-Ms': str(round((time.monotonic() - started) * 1000))})
