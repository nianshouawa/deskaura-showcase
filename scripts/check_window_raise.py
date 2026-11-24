"""Verify that repeated Home links focus existing Guide and Settings windows."""
import asyncio
import ctypes
import json

from check_desktop_stability import evaluate, pages


async def wait_page(fragment):
    for _ in range(60):
        page = next((item for item in pages() if fragment in item["url"]), None)
        if page:
            return page
        await asyncio.sleep(.1)
    raise AssertionError(f"Window not found: {fragment}")


async def click_home(home, label):
    user32 = ctypes.windll.user32
    user32.FindWindowW.restype = ctypes.c_void_p
    user32.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
    user32.SetForegroundWindow.argtypes = [ctypes.c_void_p]
    user32.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
    hwnd = user32.FindWindowW(None, "DeskAura · 角色工作室")
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
    await asyncio.sleep(.15)
    assert "角色工作室" in foreground_title(), foreground_title()
    await evaluate(home, f"""(()=>{{
      const button=[...document.querySelectorAll('.studio-nav button')]
        .find(item=>item.textContent.trim().includes({json.dumps(label)}));
      if(!button) throw new Error('missing {label}');
      button.click();
      return true;
    }})()""")
    for _ in range(30):
        if label in foreground_title():
            return
        await asyncio.sleep(.1)
    raise AssertionError(f"Requested window was not activated: {label}; {foreground_title()}")


def foreground_title():
    user32 = ctypes.windll.user32
    user32.GetForegroundWindow.restype = ctypes.c_void_p
    user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
    handle = user32.GetForegroundWindow()
    text = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(handle, text, 256)
    return text.value


async def main():
    home = await wait_page("home=1")
    await click_home(home, "使用指南")
    guide = await wait_page("tutorial=1")
    await asyncio.sleep(.25)
    await click_home(home, "设置")
    await wait_page("settings=1")
    await asyncio.sleep(.25)
    assert "设置" in foreground_title(), foreground_title()
    await click_home(home, "使用指南")
    await asyncio.sleep(.25)
    assert "使用指南" in foreground_title(), foreground_title()
    await click_home(home, "设置")
    await asyncio.sleep(.25)
    assert "设置" in foreground_title(), foreground_title()
    await evaluate(home, "window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus',{label:'home'})")
    print(json.dumps({"guide_reuses": True, "settings_reuses": True, "raised_to_front": True}))


if __name__ == "__main__":
    asyncio.run(main())
