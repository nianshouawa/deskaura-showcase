"""Read-only UI verification for the current settings, guide, and home layout."""
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:1420"


async def main():
    config = {
        "base_url": "https://api.example.invalid/v1", "model": "qa", "brain_tag": "云端",
        "audio_enabled": True, "asr_enabled": True, "motion_enabled": True,
        "vision_enabled": True, "vision_camera_id": "", "gaze_mode": "face",
        "gaze_enabled": True, "click_feedback_enabled": True, "bubble_enabled": True,
        "memory_path": r"C:\Users\example\DeskAura\memory",
        "motion_mode": "online", "motion_duration_mode": "manual", "motion_duration": 5,
        "persona_tag": "陪伴", "memory_tag": "MemU", "hearing_tag": "内置",
        "voice_tag": "百炼", "motion_tag": "混元", "vision_tag": "本机", "tools_tag": "本地",
    }

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1180, "height": 780})
        errors = []
        page.on("pageerror", lambda error: None if "unregisterListener" in str(error) else errors.append(str(error)))

        async def route_api(route):
            url = route.request.url
            if "/api/settings/model" in url:
                value = config
            elif "/api/modules/" in url:
                value = {"enabled": True, "verified": False, "detail": "尚未检测"}
            elif "/api/memory/status" in url:
                value = {"memory_count": 0, "relationship_level": 1, "status": "ok"}
            else:
                value = {}
            await route.fulfill(json=value)

        await page.route("http://127.0.0.1:800*/**", route_api)
        await page.add_init_script("""
          window.__TAURI_INTERNALS__={
            metadata:{currentWindow:{label:'settings'},currentWebview:{label:'settings'}},
            transformCallback:()=>1,invoke:async()=>null
          };
          Object.defineProperty(navigator,'mediaDevices',{value:{enumerateDevices:async()=>[]}})
        """)
        await page.goto(BASE + "/?home=1")
        await page.evaluate("""async()=>{
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('deskaura-model-library',2);
            r.onupgradeneeded=()=>r.result.createObjectStore('models',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          await new Promise((resolve,reject)=>{const tx=db.transaction('models','readwrite');
            tx.objectStore('models').put({id:'qa-role',name:'QA 角色',description:'',path:'D:/qa.vrm',added:1});
            tx.oncomplete=resolve;tx.onerror=reject});db.close();
        }""")
        await page.goto(BASE + "/?settings=1&role=qa-role")
        await page.wait_for_selector(".settings-page-heading")
        await page.locator(".settings-nav button").filter(has_text="记忆").click()
        assert await page.get_by_text("记忆路径", exact=True).count() == 1
        assert (await page.get_by_label("记忆路径", exact=True).input_value()).endswith("memory")
        assert await page.get_by_text("标签", exact=True).count() == 1
        await page.screenshot(path=str(ROOT / "build/current-settings-memory.png"))

        await page.locator(".settings-nav button").filter(has_text="视觉").click()
        assert await page.locator(".settings-nav button.active b").all_text_contents() == ["视觉"]
        assert await page.get_by_text("图像理解", exact=False).count() == 0
        assert await page.get_by_label("选择摄像头", exact=True).count() == 1
        assert await page.get_by_label("API 地址", exact=True).count() == 0
        await page.screenshot(path=str(ROOT / "build/current-settings-vision.png"))

        await page.locator(".settings-nav button").filter(has_text="人设").click()
        placeholder = await page.locator(".persona-editor").get_attribute("placeholder")
        assert placeholder and "\n" in placeholder and "……" in placeholder
        await page.locator(".settings-nav button").filter(has_text="动作").click()
        assert await page.get_by_text("动作库与动作生成", exact=False).count() >= 1

        closed_nav = await page.locator(".settings-nav").evaluate(
            "n => ({height:n.clientHeight,scroll:n.scrollHeight})"
        )
        assert closed_nav["height"] >= closed_nav["scroll"]
        assert not errors, errors

        await page.goto(BASE + "/?home=1")
        await page.wait_for_selector(".role-module-panel")
        assert await page.get_by_text("自动朗读", exact=True).count() == 0
        assert await page.get_by_text("角色置顶", exact=True).count() == 1
        assert await page.get_by_text("视线追踪", exact=True).count() == 1
        assert await page.get_by_text("点击反馈", exact=True).count() == 1
        await page.set_viewport_size({"width": 980, "height": 620})
        await page.evaluate("() => new Promise(requestAnimationFrame)")
        fit = await page.locator(".studio-settings").evaluate(
            "e => ({height:e.clientHeight,scroll:e.scrollHeight})"
        )
        assert fit["height"] >= fit["scroll"], fit
        await page.screenshot(path=str(ROOT / "build/current-home-controls.png"))

        await page.goto(BASE + "/?tutorial=1")
        await page.set_viewport_size({"width": 720, "height": 520})
        await page.wait_for_selector(".guide-layout")
        assert await page.get_by_text("从一个角色，到每天的陪伴。", exact=True).count() == 1
        assert await page.get_by_text("连续单击三次", exact=False).count() == 1
        nav = await page.locator(".guide-sidebar").evaluate(
            "e => ({height:e.clientHeight,scroll:e.scrollHeight,navHeight:e.querySelector('nav').clientHeight,navScroll:e.querySelector('nav').scrollHeight})"
        )
        assert nav["height"] >= nav["scroll"] and nav["navHeight"] >= nav["navScroll"], nav
        await page.screenshot(path=str(ROOT / "build/current-guide.png"))
        await browser.close()
        print(json.dumps({
            "settings_memory": True, "settings_vision_face_only": True,
            "persona_prompt": True, "home": fit, "guide": nav, "errors": errors,
        }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
