"""Read-only model/clip check in the actual desktop WebView (debug port required)."""
import argparse
import asyncio
import json
from pathlib import Path
import base64

import httpx
import websockets


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--clip', default='cloud_thinking_loop')
    parser.add_argument('--apply-model', action='store_true')
    parser.add_argument('--screenshot', action='store_true')
    parser.add_argument('--output', help='Optional PNG output path instead of printing image data')
    parser.add_argument('--delay', type=float, default=2.5)
    args = parser.parse_args()
    pages = httpx.get('http://127.0.0.1:9235/json', trust_env=False).json()
    async def evaluate(page, expression):
        async with websockets.connect(page['webSocketDebuggerUrl'], proxy=None) as ws:
            await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expression, 'returnByValue': True, 'awaitPromise': True}}))
            while True:
                value = json.loads(await ws.recv())
                if value.get('id') == 1:
                    return value
    if args.apply_model:
        home = next(page for page in pages if 'home=1' in page['url'])
        await evaluate(home, "document.querySelector('.model-name')?.click()")
        await asyncio.sleep(2)
    pet = next(page for page in pages if page['url'].endswith('/'))
    clip = httpx.get('http://127.0.0.1:8002/api/motion/library/' + args.clip, trust_env=False).json()
    payload = {'motion': {'id': args.clip, 'kind': 'hymotion', 'url': '/api/motion/library/' + args.clip,
                          'duration': clip['duration'], 'loop': bool(clip.get('loop'))}, 'emotion': 'neutral'}
    request = {'target': {'kind': 'AnyLabel', 'label': 'main'}, 'event': 'deskaura:reply', 'payload': payload}
    await evaluate(pet, 'window.__TAURI_INTERNALS__.invoke("plugin:event|emit_to",' + json.dumps(request) + ')')
    await asyncio.sleep(max(0, args.delay))
    if not args.screenshot:
        print(json.dumps({'clip': args.clip, 'source': clip['source'], 'sent': True}))
        return
    async with websockets.connect(pet['webSocketDebuggerUrl'], proxy=None) as ws:
        await ws.send(json.dumps({'id': 1, 'method': 'Page.captureScreenshot', 'params': {'format': 'png', 'clip': {'x': 0, 'y': 0, 'width': 1700, 'height': 1060, 'scale': .55}}}))
        while True:
            value = json.loads(await ws.recv())
            if value.get('id') == 1:
                if args.output:
                    path = Path(args.output).resolve()
                    path.write_bytes(base64.b64decode(value['result']['data']))
                    print(json.dumps({'clip': args.clip, 'screenshot': str(path)}))
                else:
                    print(value['result']['data'])
                return


if __name__ == '__main__':
    asyncio.run(main())
