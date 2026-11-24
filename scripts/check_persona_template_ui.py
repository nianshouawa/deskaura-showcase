"""Isolated persona and guide UI checks; no user data or paid requests."""
import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("DESKAURA_UI_QA_URL", "http://127.0.0.1:1420").rstrip("/")
OUTPUT = ROOT / "build" / "final-audit"


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 980, "height": 760})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        config = {"base_url": "", "model": "", "persona_text": "保留我的角色设定",
                  "persona_local_provider": "built_in", "memory_path": "D:/qa"}

        async def api(route):
            if "/api/settings/model" in route.request.url:
                result = config
            elif "/api/tools/mcp" in route.request.url:
                result = {"services": [], "total": 0, "connected": 0}
            else:
                result = {}
            await route.fulfill(json=result)

        await page.route("**/api/**", api)
        await page.add_init_script("""
          window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'settings'},currentWebview:{label:'settings'}},
            transformCallback:()=>1,invoke:async(c)=>c.includes('listen')?1:null};
          window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
        """)
        await page.goto(BASE + "/?settings=1")
        await page.evaluate("""async()=>{
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('deskaura-model-library',2);
            r.onupgradeneeded=()=>r.result.createObjectStore('models',{keyPath:'id'});
            r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          await new Promise((resolve,reject)=>{const tx=db.transaction('models','readwrite');
            tx.objectStore('models').put({id:'template-qa',name:'模板检查角色',added:1});
            tx.oncomplete=resolve;tx.onerror=reject});db.close();
        }""")
        await page.goto(BASE + "/?settings=1&role=template-qa&section=persona")
        picker = page.get_by_role("combobox", name="角色模板", exact=True)
        await picker.wait_for()
        assert await picker.inner_text() == "无"
        await picker.click()
        options = page.get_by_role("option")
        assert await options.first.locator(".picker-option-copy").inner_text() == "无"
        await page.screenshot(path=str(OUTPUT / "persona-template.png"))
        await page.get_by_role("option", name="温柔陪伴", exact=True).click()
        assert "温柔、耐心" in await page.locator(".persona-editor").input_value()
        await page.locator(".persona-editor").fill("保留我的手写内容")
        await picker.click()
        await page.get_by_role("option", name="无", exact=True).click()
        assert await page.locator(".persona-editor").input_value() == "保留我的手写内容"
        await page.goto(BASE + "/?tutorial=1")
        assert "默认是「无」" in await page.locator("#persona").inner_text()
        await page.screenshot(path=str(OUTPUT / "guide.png"))
        nav = await page.get_by_role("navigation", name="使用指南目录").evaluate("(e)=>({client:e.clientHeight,scroll:e.scrollHeight})")
        assert nav["scroll"] <= nav["client"] + 1
        for width, height in [(760, 560), (1180, 780)]:
            await page.set_viewport_size({"width": width, "height": height})
            assert await page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        assert not errors, errors
        await browser.close()
        print(json.dumps({"persona_default": "无", "none_preserves_text": True,
                          "guide_default_no_nav_scroll": True, "page_errors": errors}, ensure_ascii=True))


if __name__ == "__main__":
    asyncio.run(main())
