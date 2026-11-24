"""One short real Bailian TTS/ASR round trip; never print stored credentials.

This explicitly uses the saved independent keys. It is a manual, billable check,
not a background health check and is not invoked by the desktop application.
"""
import asyncio
import io
import json
import sys
import time
import wave
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'agent-backend'))
from app.config import ConfigStore, ModelSettings
from app.speech import generate_speech
from app.recognition import transcribe
from app import speech


async def main():
    store = ConfigStore(r'C:\Users\asus\AppData\Local\com.deskaura.app\config.json')
    started = time.monotonic()
    report = {'tts_requests': 0, 'asr_requests': 0, 'tts_ok': False, 'asr_ok': False}
    original_merge = speech.merge_bailian_wav
    def capture_test_wav(parts):
        if parts:
            (ROOT / 'build/bailian-chain-raw.wav').write_bytes(parts[0])
        return original_merge(parts)
    speech.merge_bailian_wav = capture_test_wav
    try:
        if '--reuse-audio' in sys.argv:
            audio, _ = original_merge([(ROOT / 'build/bailian-chain-raw.wav').read_bytes()])
            report['reused_test_audio'] = True
        else:
            report['tts_requests'] += 1
            response = await generate_speech(SimpleNamespace(text='你好，语音连接测试。'), store)
            audio = response.body
        with wave.open(io.BytesIO(audio), 'rb') as wav:
            report['audio_seconds'] = round(wav.getnframes() / wav.getframerate(), 2)
            report['audio_sample_rate'] = wav.getframerate()
        report['tts_ok'] = True
        (ROOT / 'build/bailian-chain-test.wav').write_bytes(audio)
        cfg = store.asr_config()
        if cfg['asr_provider'] == 'compatible' and cfg['asr_base_url'] == 'https://api.siliconflow.cn/v1' and cfg['asr_model'] == 'FunAudioLLM/SenseVoiceSmall':
            cfg.update(asr_provider='dashscope', asr_base_url='https://dashscope.aliyuncs.com/compatible-mode/v1', asr_model='qwen3-asr-flash', asr_language='')
            report['legacy_asr_override'] = True
        report['asr_requests'] += 1
        result = await transcribe(audio, SimpleNamespace(asr_config=lambda: cfg))
        report['asr_ok'] = bool(result['text'])
        report['recognized_characters'] = len(result['text'])
        report['recognized_test_phrase'] = '语音' in result['text'] and '测试' in result['text']
        if report.get('legacy_asr_override') and report['asr_ok']:
            current = store.get()
            store.save(ModelSettings(base_url=current['base_url'], model=current['model'],
                asr_provider=cfg['asr_provider'], asr_base_url=cfg['asr_base_url'],
                asr_model=cfg['asr_model'], asr_language=cfg['asr_language']))
            report['asr_nonsecret_configuration_corrected'] = True
    except HTTPException as error:
        report['error_status'] = error.status_code
        report['error'] = str(error.detail)
    except Exception as error:
        # Never stringify unexpected HTTP errors: those may contain signed URLs.
        report['unexpected_error_type'] = type(error).__name__
    report['seconds'] = round(time.monotonic() - started, 2)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
