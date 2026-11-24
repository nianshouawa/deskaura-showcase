"""Exercise ASR settings in a debug WebView without saving or calling a provider."""
import asyncio
import base64
import json
from pathlib import Path
import httpx
import websockets

ROOT = Path(__file__).resolve().parents[1]


async def main():
    client = httpx.Client(trust_env=False, timeout=10)
    before = client.get('http://127.0.0.1:8000/api/settings/model').json()
    pages = client.get('http://127.0.0.1:9235/json').json()
    page = next(p for p in pages if 'home=1' in p['url'])
    async with websockets.connect(page['webSocketDebuggerUrl'], proxy=None) as ws:
        counter = 0
        async def command(method, params):
            nonlocal counter
            counter += 1
            await ws.send(json.dumps({'id': counter, 'method': method, 'params': params}))
            while True:
                result = json.loads(await ws.recv())
                if result.get('id') == counter:
                    if result.get('error'):
                        raise RuntimeError(result['error'])
                    return result['result']
        async def evaluate(expression):
            result = await command('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
            if 'exceptionDetails' in result:
                raise RuntimeError(result['exceptionDetails'])
            return result.get('result', {}).get('value')
        async def choose(index, value):
            await evaluate(f"(()=>{{const s=document.querySelectorAll('.recognition-settings select')[{index}];s.value={json.dumps(value)};s.dispatchEvent(new Event('change',{{bubbles:true}}))}})()")
            await asyncio.sleep(.1)
        await choose(0, 'dashscope')
        state = await evaluate("(()=>{const el=document.querySelector('.recognition-settings');return {text:el.textContent,inputs:[...el.querySelectorAll('input')].filter(e=>e.type!=='password').map(e=>e.value),providers:[...el.querySelectorAll('select')].map(e=>e.value)}})()")
        assert state['providers'] == ['dashscope', 'beijing']
        assert 'qwen3-asr-flash' in state['inputs']
        await choose(1, 'singapore')
        assert await evaluate("document.querySelector('.recognition-settings input:not([type])').value") == 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
        await choose(1, 'custom')
        assert await evaluate("document.querySelectorAll('.recognition-settings select')[1].value") == 'custom'
        await choose(1, 'beijing')
        await evaluate("document.querySelector('.recognition-settings').scrollIntoView({block:'start'})")
        await asyncio.sleep(.2)
        geometry = await evaluate("(()=>{let r=document.querySelector('.recognition-settings').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,screen:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,selectOverflow:[...document.querySelectorAll('.recognition-settings select')].some(e=>e.getBoundingClientRect().right>r.right+2)}})()")
        assert not geometry['overflow'] and not geometry['selectOverflow']
        screenshot = await command('Page.captureScreenshot', {'format': 'png'})
        (ROOT / 'build/bailian-asr-settings-qa.png').write_bytes(base64.b64decode(screenshot['data']))
        await choose(0, 'compatible')
        assert await evaluate("document.querySelectorAll('.recognition-settings select').length") == 1
        order = await evaluate("[...document.querySelectorAll('[id^=settings-].settings-card')].map(e=>e.id)")
        assert order.index('settings-chat') < order.index('settings-recognition') < order.index('settings-speech') < order.index('settings-motion')
        await evaluate("(()=>{const s=document.querySelector('#settings-speech select');s.value='dashscope';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
        await asyncio.sleep(.1)
        tts = await evaluate("(()=>{let e=document.querySelector('#settings-speech');return {values:[...e.querySelectorAll('input:not([type=password])')].map(i=>i.value),selects:[...e.querySelectorAll('select')].map(i=>i.value),speed:!!e.querySelector('input[type=number]'),datalist:e.querySelector('input[list]')?.list?.id}})()")
        assert tts['selects'] == ['dashscope', 'beijing', 'wav'], tts
        assert 'qwen3-tts-flash' in tts['values'] and 'Cherry' in tts['values']
        assert not tts['speed'] and tts['datalist'] == 'bailian-voices'
        await evaluate("(()=>{const s=document.querySelectorAll('#settings-speech select')[1];s.value='singapore';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
        await asyncio.sleep(.1)
        assert await evaluate("document.querySelector('#settings-speech input:not([type])').value") == 'https://dashscope-intl.aliyuncs.com/api/v1'
        await evaluate("(()=>{const s=document.querySelectorAll('#settings-speech select')[1];s.value='custom';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
        await asyncio.sleep(.1)
        assert await evaluate("document.querySelectorAll('#settings-speech select')[1].value") == 'custom'
        await evaluate("document.querySelector('#settings-speech').scrollIntoView({block:'start'})")
        await asyncio.sleep(.15)
        screenshot = await command('Page.captureScreenshot', {'format': 'png'})
        (ROOT / 'build/bailian-tts-settings-qa.png').write_bytes(base64.b64decode(screenshot['data']))
        directory = await evaluate("[...document.querySelectorAll('#settings-services .service-link')].map(e=>e.textContent)")
        assert directory
        assert any('语音识别' in text for text in directory) and any('语音生成' in text for text in directory)
        after = client.get('http://127.0.0.1:8000/api/settings/model').json()
        assert before == after, 'QA must not persist provider selections or credentials'
        await command('Page.reload', {})
        print(json.dumps({'provider_switch': True, 'region_and_custom_switch': True, 'tts_native_wav': True, 'sections_order': order, 'no_horizontal_overflow': True, 'configuration_preserved': True, 'paid_model_calls': 0, 'geometry': geometry}))


if __name__ == '__main__':
    asyncio.run(main())
