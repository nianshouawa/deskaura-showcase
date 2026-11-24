"""Independent, bounded model transcription; never system dictation."""
import base64
import asyncio
import hashlib
import json
import re
import time
from urllib.parse import urlsplit
import httpx
from fastapi import HTTPException
from .config import private_model_endpoint

_recognition_verification: dict[str, dict] = {}


def recognition_provider(cfg: dict) -> str:
    """Choose the wire format from the saved endpoint/model, not a UI preset."""
    base = str(cfg.get("asr_base_url", "")).strip()
    model = str(cfg.get("asr_model", "")).strip().casefold()
    try:
        address = urlsplit(base)
        host, path = (address.hostname or "").casefold(), address.path.rstrip("/")
    except ValueError:
        host, path = "", ""
    if (model.startswith("qwen3-asr-flash") or path.endswith("/chat/completions") or
            host in {"dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"} or
            host.endswith(".maas.aliyuncs.com")):
        return "dashscope"
    return "compatible"

# Never paraphrase an ASR transcript with another paid model. Keep negation,
# self-correction clauses, names, quantities and quoted/code/path content intact.
_LITERAL = re.compile(
    r"```[\s\S]*?```|`[^`\n]*`|“[^”\n]*”|「[^」\n]*」|"
    r'"[^"\n]*"|\'[^\'\n]*\'|https?://[^\s，。！？；、]+|'
    r"(?:[A-Za-z]:[\\/]|\\\\)[^\s，。！？；、]+"
)


def clean_transcript(text: str) -> str:
    """Remove only unmistakable disfluencies, without rewriting user intent.

    Qwen3-ASR's context message is not an instruction-following rewrite prompt.
    Complex spoken corrections stay verbatim rather than guessing what the user
    meant; the conversation model still receives their full correction context.
    """
    original = text.strip()
    if not original:
        return original

    def clean_plain(value: str) -> str:
        # 嗯 can be an intentional yes; 啊/那个/就是 can carry real meaning.
        # Only remove pause-delimited hesitation when other language remains.
        value = re.sub(r"(^|[\s，,。；;：:])(?:[呃额嗯]+[\s，,。；;：:]+)+", r"\1", value)
        # Collapse obvious initial pronoun stutters, not 看看/好好/不不/etc.
        value = re.sub(r"(^|[，,。！？!?；;\s])([我你他她它])\2+", r"\1\2", value)
        value = re.sub(r"([，,；;：:])(?:[\s，,；;：:])+", r"\1", value)
        return value

    chunks, offset = [], 0
    for match in _LITERAL.finditer(original):
        chunks.extend((clean_plain(original[offset:match.start()]), match.group()))
        offset = match.end()
    chunks.append(clean_plain(original[offset:]))
    cleaned = "".join(chunks).strip(" \t\r\n，,；;：:")
    # An isolated affirmation/hesitation may itself be the entire user intent.
    return cleaned if re.search(r"[\w\u3400-\u9fff]", cleaned) else original


def recognition_fingerprint(cfg):
    relevant = {key: cfg.get(key) for key in ('asr_provider', 'asr_base_url', 'asr_model', 'asr_language', 'api_key', 'hearing_connection_mode', 'hearing_local_provider')}
    return hashlib.sha256(json.dumps(relevant, sort_keys=True).encode()).hexdigest()


def record_recognition_verification(cfg, verified, detail):
    if len(_recognition_verification) >= 32:
        _recognition_verification.pop(next(iter(_recognition_verification)))
    _recognition_verification[recognition_fingerprint(cfg)] = {'verified': verified, 'detail': detail, 'at': int(time.time())}


def recognition_status(store):
    """Local inspection is free; only real successful transcription verifies upstream."""
    cfg = store.asr_config()
    builtin = cfg.get("hearing_connection_mode") == "local" and cfg.get("hearing_local_provider") == "built_in"
    provider = recognition_provider(cfg)
    local = cfg.get("hearing_connection_mode") == "local" and private_model_endpoint(cfg.get("asr_base_url", ""))
    configured = bool((cfg.get('api_key') or local) and cfg.get('asr_base_url') and cfg.get('asr_model', '').strip())
    problem = ''
    if builtin:
        try:
            from deskaura_local.runtime import model_available
            configured = model_available("hearing")
        except (ImportError, OSError):
            configured = False
        provider = "built_in"
        problem = "" if configured else "内置识别模型文件或运行库缺失"
    elif configured:
        try:
            recognition_endpoint(cfg['asr_base_url'], provider)
            validate_recognition_model(cfg['asr_model'].strip(), provider)
        except (HTTPException, ValueError, TypeError):
            configured = False
            problem = '地址或识别模型需要检查'
    previous = _recognition_verification.get(recognition_fingerprint(cfg), {})
    return {'status': 'ok', 'kind': 'recognition', 'provider': provider,
            'enabled': cfg['asr_enabled'], 'configured': configured,
            'provider_verified': bool(cfg['asr_enabled'] and configured and previous.get('verified', False)),
            'verified_at': previous.get('at'),
            'detail': '已关闭' if not cfg['asr_enabled'] else previous.get('detail') or ('尚未检测' if builtin and configured else '配置齐全 · 请录音验证' if configured else problem or '缺少密钥或配置')}


def validate_recognition_model(model, provider):
    if not model:
        raise HTTPException(422, '请填写识别模型 ID。')
    if provider == 'dashscope' and (not model.startswith('qwen3-asr-flash') or any(part in model.lower() for part in ('filetrans', 'realtime'))):
        raise HTTPException(422, '百炼当前适配 Qwen3-ASR-Flash 同步识别，请使用 qwen3-asr-flash 或其同步版本；不支持 filetrans、realtime、聊天或 TTS 模型。')


def recognition_endpoint(base: str, provider: str) -> str:
    """Normalize only known roots; never send a key to an accidental TTS/native path."""
    base = base.strip().rstrip('/')
    try:
        url = urlsplit(base)
        valid = (url.scheme in {'http', 'https'} and url.hostname and not url.username
                 and not url.password and not url.query and not url.fragment and url.port != 0)
    except ValueError:
        valid = False
    if not valid or any(char in base for char in '{}<>'):
        raise HTTPException(422, 'ASR 地址无效，请填写完整 HTTP(S) 地址；业务空间域名中的占位符必须替换为真实 ID。')
    path = url.path.rstrip('/')
    if provider == 'dashscope':
        if url.scheme != 'https' and url.hostname not in {'127.0.0.1', 'localhost', '::1'}:
            raise HTTPException(422, '百炼识别请使用 HTTPS 地址；仅本机转发允许 HTTP。')
        if path.startswith('/api/') or path == '/api':
            raise HTTPException(422, '百炼识别需要兼容模式 /compatible-mode/v1，不支持原生 /api/v1 地址。')
        if path == '':
            return base + '/compatible-mode/v1/chat/completions'
        if path == '/compatible-mode':
            return base + '/v1/chat/completions'
        if path.endswith('/v1'):
            return base + '/chat/completions'
        if path.endswith('/chat/completions'):
            return base
        raise HTTPException(422, '百炼 Qwen ASR 使用兼容模式 /compatible-mode/v1 或完整 /chat/completions 地址，不是原生 /api/v1、TTS 或 /audio/transcriptions。')
    if provider != 'compatible':
        raise HTTPException(422, '不支持的语音识别平台，请重新选择并保存。')
    if path.endswith('/audio/transcriptions'):
        return base
    if path.endswith('/audio/speech') or path.endswith('/chat/completions'):
        raise HTTPException(422, '通用 ASR 需要 API 根地址或 /audio/transcriptions，不能使用聊天、TTS 或百炼原生接口。')
    return base + '/audio/transcriptions'


def _transcript(value: object, provider: str) -> str:
    if not isinstance(value, dict) or value.get('error'):
        raise ValueError('Invalid ASR response')
    if provider == 'dashscope':
        choices = value.get('choices')
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise ValueError('Missing choices')
        message = choices[0].get('message')
        if not isinstance(message, dict) or 'content' not in message:
            raise ValueError('Missing content')
        text = message['content']
    else:
        if 'text' not in value:
            raise ValueError('Missing text')
        text = value['text']
    if text is not None and not isinstance(text, str):
        raise ValueError('Invalid transcript')
    if not text or not text.strip():
        raise HTTPException(422, '没有识别到文字，请靠近麦克风重试。')
    if len(text) > 4000:
        raise HTTPException(422, '识别结果超过 4000 字，请分段说话。')
    return clean_transcript(text)


async def transcribe(audio: bytes, store) -> dict:
    cfg = store.asr_config()
    if not cfg['asr_enabled']:
        raise HTTPException(409, '请在主页 → 语音识别中启用并保存 ASR 配置。')
    builtin = cfg.get("hearing_connection_mode") == "local" and cfg.get("hearing_local_provider") == "built_in"
    local = cfg.get("hearing_connection_mode") == "local" and private_model_endpoint(cfg.get("asr_base_url", ""))
    if not cfg['api_key'] and not local and not builtin:
        raise HTTPException(409, '语音识别需要独立 ASR 密钥，不会自动借用朗读或对话密钥。')
    if len(audio) < 44 or len(audio) > 8 * 1024 * 1024 or audio[:4] != b'RIFF' or audio[8:12] != b'WAVE':
        raise HTTPException(422, '录音必须为 WAV，大小不超过 8 MB。')
    if builtin:
        try:
            from deskaura_local.runtime import transcribe_wav
            text = await asyncio.to_thread(transcribe_wav, audio, cfg.get("asr_language", ""))
            result = {"text": _transcript({"text": text}, "compatible")}
            record_recognition_verification(cfg, True, "本次配置已完成真实本地语音识别")
            return result
        except HTTPException as error:
            record_recognition_verification(cfg, False, str(error.detail))
            raise
        except ValueError:
            detail = "内置识别需要有效的 PCM16 WAV（8–48 kHz，最长 120 秒）及支持的语言"
            record_recognition_verification(cfg, False, detail)
            raise HTTPException(422, detail) from None
        except Exception:
            detail = "内置识别模型运行失败，请检查完整安装包与本地模型文件"
            record_recognition_verification(cfg, False, detail)
            raise HTTPException(503, detail) from None
    provider = recognition_provider(cfg)
    endpoint = recognition_endpoint(cfg['asr_base_url'], provider)
    model = cfg['asr_model'].strip()
    validate_recognition_model(model, provider)
    if provider == 'dashscope':
        # Base64 adds a third to the upload size. Keep the full data URI below 10 MB.
        if 4 * ((len(audio) + 2) // 3) + 22 > 10_000_000:
            raise HTTPException(422, '百炼内嵌音频编码后不能超过 10 MB，请缩短录音。')
        options = {'enable_itn': False}
        if cfg['asr_language']:
            options['language'] = cfg['asr_language']
        request = {'json': {
            'model': model, 'stream': False, 'asr_options': options,
            'messages': [{'role': 'user', 'content': [{'type': 'input_audio', 'input_audio': {
                'data': 'data:audio/wav;base64,' + base64.b64encode(audio).decode('ascii'),
            }}]}],
        }}
    else:
        data = {'model': model}
        if cfg['asr_language']:
            data['language'] = cfg['asr_language']
        request = {'data': data, 'files': {'file': ('recording.wav', audio, 'audio/wav')}}
    try:
        async with httpx.AsyncClient(timeout=90, trust_env=False, follow_redirects=False) as client:
            async with client.stream('POST', endpoint, headers={'Authorization': f"Bearer {cfg['api_key']}"} if cfg["api_key"] else {},
                                     **request) as response:
                if response.status_code != 200:
                    hints = ({400: '请求参数或音频不符合要求，请使用同步 Qwen3-ASR-Flash 模型',
                              401: '密钥无效或与北京 / 新加坡地域不匹配',
                              403: '模型未开通、业务空间权限不足或账户不可用',
                              404: '兼容模式地址或该地域的识别模型不可用',
                              429: '额度不足或超过调用频率限制'} if provider == 'dashscope' else
                             {401: '密钥无效', 403: '账户权限不足', 404: '地址或模型不支持语音转写', 429: '额度或速率限制'})
                    raise HTTPException(502, f"ASR HTTP {response.status_code}：{hints.get(response.status_code, '服务商拒绝请求')}。请核对识别接口，不要填写 TTS 地址。")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 128 * 1024:
                        raise HTTPException(502, 'ASR 返回数据过大。')
        result = {'text': _transcript(json.loads(body), provider)}
        record_recognition_verification(cfg, True, '本次配置已完成真实语音识别')
        return result
    except HTTPException as error:
        record_recognition_verification(cfg, False, str(error.detail))
        raise
    except httpx.HTTPError:
        detail = '语音识别连接失败或超时，请检查 ASR 地址、网络和服务商状态。'
        record_recognition_verification(cfg, False, detail)
        raise HTTPException(502, detail) from None
    except (ValueError, AttributeError):
        expected = 'choices[0].message.content' if provider == 'dashscope' else 'text'
        detail = f'识别接口未返回有效的 {expected} JSON，请检查所选平台与接口协议。'
        record_recognition_verification(cfg, False, detail)
        raise HTTPException(502, detail) from None
