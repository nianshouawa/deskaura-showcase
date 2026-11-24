"""Evaluate a bounded QA expression in an already-debuggable DeskAura WebView."""
import argparse
import asyncio
import base64
import json
import httpx
import websockets

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('window', choices=['home', 'pet', 'chat', 'tutorial', 'settings'])
    parser.add_argument('expression_base64')
    args = parser.parse_args()
    pages = httpx.get('http://127.0.0.1:9235/json', trust_env=False).json()
    query = {'home': 'home=1', 'chat': 'dialog=1', 'tutorial': 'tutorial=1', 'settings': 'settings=1'}.get(args.window)
    page = next(p for p in pages if query in p['url']) if query else next(p for p in pages if p['url'].endswith('/'))
    expression = base64.b64decode(args.expression_base64).decode('utf-8')
    async with websockets.connect(page['webSocketDebuggerUrl'], proxy=None) as ws:
        await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expression, 'returnByValue': True, 'awaitPromise': True}}))
        try:
            while True:
                result = json.loads(await ws.recv())
                if result.get('id') == 1:
                    print(json.dumps(result, ensure_ascii=True)); return
        except websockets.ConnectionClosed:
            print('WebView closed')

if __name__ == '__main__':
    asyncio.run(main())
