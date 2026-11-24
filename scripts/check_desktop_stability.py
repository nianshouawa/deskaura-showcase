"""Bounded release-window stress test; no chat, media or configuration writes."""
import asyncio
import json
import time

import httpx
import websockets

BASE = "http://127.0.0.1:9235"


def pages():
    return httpx.get(BASE + "/json", trust_env=False).json()


async def evaluate(page, expression):
    async with websockets.connect(page["webSocketDebuggerUrl"], proxy=None) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True, "returnByValue": True}}))
        while True:
            result = json.loads(await ws.recv())
            if result.get("id") == 1:
                assert "error" not in result, result
                assert "exceptionDetails" not in result.get("result", {}), result
                return result["result"]["result"].get("value")


async def main():
    started = time.monotonic()
    home = next(p for p in pages() if "home=1" in p["url"])
    # Concurrent commands repeatedly clone/drop runtime handles in production.
    await evaluate(home, """(async()=>{
        for(let round=0;round<10;round++)
          await Promise.all(Array.from({length:32},()=>window.__TAURI_INTERNALS__.invoke('get_cursor_pos')));
        return true;
    })()""")
    for cycle in range(12):
        await evaluate(home, """window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview_window',{
            options:{label:'dialog',url:'/?dialog=1&tab=chat',title:'DeskAura 对话',
            width:460,height:680,minWidth:360,minHeight:420,
            decorations:false,transparent:true,alwaysOnTop:false,resizable:true,dragDropEnabled:false}
        })""")
        chat = None
        for _ in range(40):
            chat = next((p for p in pages() if "dialog=1" in p["url"]), None)
            if chat:
                try:
                    if await evaluate(chat, "!!window.__TAURI_INTERNALS__ && document.readyState==='complete'"):
                        break
                except (AssertionError, websockets.ConnectionClosed):
                    pass
            await asyncio.sleep(.1)
        else:
            raise AssertionError("chat did not initialize")
        # The official window setters exercise native resize/subclass messages.
        await evaluate(chat, """(async()=>{
            const invoke=window.__TAURI_INTERNALS__.invoke;
            for(let i=0;i<6;i++) {
                await invoke('plugin:window|set_size',{label:'dialog',value:{Logical:{width:440+i*12,height:630+i*10}}});
                await invoke('set_always_on_top',{value:i%2===0});
            }
            await invoke('set_always_on_top',{value:false});
            return true;
        })()""")
        if cycle != 11:
            await evaluate(chat, "window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'dialog'})")
            for _ in range(30):
                if not any("dialog=1" in p["url"] for p in pages()):
                    break
                await asyncio.sleep(.1)
            else:
                raise AssertionError("chat did not close")
    print(json.dumps({"concurrent_commands": 320, "chat_opens": 12, "chat_closes": 11,
                      "resize_and_topmost_cycles": 72, "seconds": round(time.monotonic()-started, 1)}))


if __name__ == "__main__":
    asyncio.run(main())
