"""Check pet maintenance cannot take keyboard focus from another process."""
import asyncio
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import subprocess
import sys
import time

from check_desktop_stability import evaluate, pages

TITLE = "DeskAura isolated keyboard focus check"
user = ctypes.WinDLL("user32", use_last_error=True)
user.CreateWindowExW.restype = wintypes.HWND
user.CreateWindowExW.argtypes = [
    wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID,
]
user.FindWindowW.restype = wintypes.HWND
user.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
user.GetForegroundWindow.restype = wintypes.HWND
user.GetWindowLongPtrW.restype = ctypes.c_ssize_t
user.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
user.SetForegroundWindow.argtypes = [wintypes.HWND]
user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user.GetKeyboardLayout.restype = wintypes.HANDLE
user.GetKeyboardLayout.argtypes = [wintypes.DWORD]
user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]


def target():
    hwnd = user.CreateWindowExW(0, "EDIT", TITLE, 0x10CF0000 | 0x1000,
                               100, 100, 420, 240, None, None, None, None)
    if not hwnd:
        raise ctypes.WinError(ctypes.get_last_error())
    user.SetForegroundWindow(hwnd)
    message = wintypes.MSG()
    while user.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
        user.TranslateMessage(ctypes.byref(message))
        user.DispatchMessageW(ctypes.byref(message))


async def main():
    child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--target"],
                             creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        hwnd = None
        for _ in range(60):
            hwnd = user.FindWindowW("EDIT", TITLE)
            if hwnd:
                break
            await asyncio.sleep(.1)
        assert hwnd, "test editor not ready"
        user.SetForegroundWindow(hwnd)
        await asyncio.sleep(.2)
        assert user.GetForegroundWindow() == hwnd, "test editor could not be foregrounded"
        thread = user.GetWindowThreadProcessId(hwnd, None)
        layout = user.GetKeyboardLayout(thread)
        pet = next(p for p in pages() if p["url"].endswith("/"))
        main_hwnd = user.FindWindowW(None, "DeskAura")
        assert main_hwnd
        assert user.GetWindowLongPtrW(main_hwnd, -20) & 0x08000000, "pet can activate"
        for _ in range(10):
            await evaluate(pet, """(async()=>{
                const invoke=window.__TAURI_INTERNALS__.invoke;
                await invoke('polish_window');
                await invoke('set_ignore_cursor_events',{value:false});
                await invoke('set_ignore_cursor_events',{value:true});
                return true;
            })()""")
            assert user.GetForegroundWindow() == hwnd, "pet maintenance stole foreground"
            assert user.GetKeyboardLayout(thread) == layout, "external keyboard layout changed"
        print(json.dumps({"external_focus_preserved": True, "external_layout_preserved": True,
                          "pet_noactivate": True, "cycles": 10}))
    finally:
        child.terminate()
        child.wait(timeout=10)


if __name__ == "__main__":
    if "--target" in sys.argv:
        target()
    else:
        asyncio.run(main())
