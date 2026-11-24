"""Check real release window layout without changing saved settings or running models."""
import asyncio
import base64
import ctypes
import json
from pathlib import Path

import httpx
import websockets

from check_desktop_stability import evaluate, pages

ROOT = Path(__file__).resolve().parents[1]


async def capture(page, filename):
    async with websockets.connect(page["webSocketDebuggerUrl"], proxy=None) as socket:
        await socket.send(json.dumps({"id": 1, "method": "Page.captureScreenshot",
                                      "params": {"format": "png"}}))
        while True:
            result = json.loads(await socket.recv())
            if result.get("id") == 1:
                (ROOT / "build" / filename).write_bytes(base64.b64decode(result["result"]["data"]))
                return


async def wait_page(query):
    for _ in range(80):
        page = next((page for page in pages() if query in page["url"]), None)
        if page and await evaluate(page, "document.readyState==='complete'"):
            return page
        await asyncio.sleep(.1)
    raise AssertionError(f"Window unavailable: {query}")


def settings_caption():
    user32 = ctypes.windll.user32
    found = []
    callback_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def inspect(handle, _):
        text = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(ctypes.c_void_p(handle), text, 256)
        if text.value == "DeskAura · 设置":
            style = user32.GetWindowLongW(ctypes.c_void_p(handle), -16)
            found.append({"caption": style & 0x00C00000 == 0x00C00000,
                          "system_menu": bool(style & 0x00080000),
                          "minimize": bool(style & 0x00020000),
                          "maximize": bool(style & 0x00010000)})
        return True

    user32.EnumWindows(callback_type(inspect), 0)
    assert found and all(all(item.values()) for item in found), found
    return found[0]


async def main():
    home = await wait_page("home=1")
    layouts = []
    try:
        for width, height in [(1180, 780), (980, 620)]:
            await evaluate(home, f"""window.__TAURI_INTERNALS__.invoke('plugin:window|set_size',
                {{label:'home',value:{{Logical:{{width:{width},height:{height}}}}}}})""")
            await asyncio.sleep(.3)
            dimensions = await evaluate(home, """(()=>{
              const panel=document.querySelector('.studio-settings'), bounds=panel.getBoundingClientRect();
              return {height:panel.clientHeight,scroll:panel.scrollHeight,
                bottom:bounds.bottom,lastBottom:panel.querySelector('.local-operation-panel').getBoundingClientRect().bottom,
                modules:[...panel.querySelectorAll('.module-name-line>strong')].map(n=>n.textContent),
                heading:panel.querySelector('h2').textContent};
            })()""")
            assert dimensions["scroll"] <= dimensions["height"] + 1, dimensions
            assert dimensions["lastBottom"] <= dimensions["bottom"], dimensions
            assert dimensions["modules"] == ["人设", "记忆", "大脑", "手脚", "视觉", "听觉", "语音", "动作"]
            assert dimensions["heading"] == "交互与控制"
            layouts.append({"width": width, "height": height, **dimensions})
            await capture(home, f"control-release-{width}x{height}.png")
    finally:
        await evaluate(home, """window.__TAURI_INTERNALS__.invoke('plugin:window|set_size',
            {label:'home',value:{Logical:{width:1180,height:780}}})""")
    await evaluate(home, """[...document.querySelectorAll('.studio-nav button')].find(n=>n.textContent.trim()==='设置').click()""")
    settings = await wait_page("settings=1")
    await asyncio.sleep(.4)
    sidebar = await evaluate(settings, """(()=>{
      const n=document.querySelector('.settings-nav');
      return {height:n.clientHeight,scroll:n.scrollHeight,titles:[...n.querySelectorAll('button b')].map(n=>n.textContent)};
    })()""")
    assert sidebar["height"] >= sidebar["scroll"], sidebar
    assert sidebar["titles"] == ["角色", "人设", "记忆", "大脑", "手脚", "视觉", "听觉", "语音", "动作"], sidebar
    caption = settings_caption()
    await capture(settings, "settings-release-eight-modules.png")
    await evaluate(settings, "window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'settings'})")
    await evaluate(home, """[...document.querySelectorAll('.studio-nav button')].find(n=>n.textContent.trim()==='使用指南').click()""")
    guide = await wait_page("tutorial=1")
    await asyncio.sleep(.3)
    guide_layout = await evaluate(guide, """(()=>{
      const n=document.querySelector('.guide-sidebar'),nav=n.querySelector('nav');
      return {height:n.clientHeight,scroll:n.scrollHeight,navHeight:nav.clientHeight,navScroll:nav.scrollHeight,count:nav.children.length};
    })()""")
    assert guide_layout["height"] >= guide_layout["scroll"] and guide_layout["navHeight"] >= guide_layout["navScroll"], guide_layout
    assert guide_layout["count"] == 15
    await capture(guide, "guide-release-eight-modules.png")
    try:
        await evaluate(guide, "window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'tutorial'})")
    except websockets.ConnectionClosed:
        pass  # Closing the real Guide destroys its CDP connection.
    await evaluate(home, "window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus',{label:'home'})")
    with httpx.Client(trust_env=False, timeout=10) as client:
        assert all(client.get(f"http://127.0.0.1:{port}/health").is_success for port in (8000, 8001, 8002))
    print(json.dumps({"home": layouts, "settings": sidebar, "native_caption": caption,
                      "guide": guide_layout, "health": "all ready"}))


if __name__ == "__main__":
    asyncio.run(main())
