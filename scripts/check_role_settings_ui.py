"""Isolated UI QA for the independent role settings window; never calls paid APIs."""
import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("DESKAURA_UI_QA_URL", "http://127.0.0.1:1420").rstrip("/")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1024, "height": 800})
        errors, writes, tests = [], [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        config = {"base_url": "https://example.invalid/v1", "model": "qa", "brain_tag": "QA 大脑",
                  "motion_provider": "tencent_tokenhub", "motion_mode": "online",
                  "motion_duration_mode": "manual", "motion_duration": 7.5,
                  "gaze_mode": "face", "gaze_enabled": True, "audio_enabled": True,
                  "audio_provider": "dashscope", "audio_model": "qwen3-tts-flash", "audio_voice": "Cherry",
                  "persona_template": "温柔陪伴", "persona_text": "角色名称：QA",
                  "memory_provider": "memu", "memory_retrieve_method": "rag",
                  "api_key_masked": "sk-******test", "local_operation_mode": "request_approval"}
        fixture = (ROOT / "build/model-conversion-check/fixture.glb").read_bytes()

        async def api(route):
            path = route.request.url
            if "/qa.glb" in path:
                await route.fulfill(status=200, body=fixture, content_type="model/gltf-binary")
                return
            if "/api/roles/" in path:
                result = {"ok": True}
            elif "/api/settings/model" in path:
                if route.request.method == "PUT":
                    patch = route.request.post_data_json
                    writes.append(patch)
                    config.update(patch)
                result = config
            elif "/api/local/sandbox" in path:
                result = {"available": False, "detail": "QA 未配置系统沙箱"}
            elif "/api/local/directory" in path:
                value = route.request.post_data_json
                result = {"path": value["path"]}
            elif "/api/persona/import" in path:
                assert "filename=persona.txt" in path
                assert route.request.post_data_buffer == b"QA"
                result = {"text": "角色名称：导入角色\n性格：耐心"}
            elif "/api/connectivity/chat/test" in path:
                tests.append("brain")
                result = {"verification_id": "qa-proof", "text": "正常"}
            elif "/api/connectivity/receipt" in path:
                result = {"accepted": True}
            elif "/api/modules/" in path:
                result = {"enabled": True, "verified": False, "detail": "QA 尚未验证"}
            else:
                result = {}
            await route.fulfill(status=200, json=result)

        await page.route("**/api/**", api)
        await page.route("**/qa.glb", api)
        await page.add_init_script("""
          window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'settings'},currentWebview:{label:'settings'}},
            convertFileSrc:()=>location.origin+'/qa.glb',
            transformCallback:()=>1,invoke:async(c,a)=>c.includes('listen')?1:c.includes('scale_factor')?1:null};
          window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
        """)
        await page.goto(f"{BASE}/?settings=1")
        await page.evaluate("""async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('deskaura-model-library',2);
          r.onupgradeneeded=()=>r.result.createObjectStore('models',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          await new Promise((resolve,reject)=>{const tx=db.transaction('models','readwrite');tx.objectStore('models').put({id:'qa-role',name:'QA 角色',path:'D:/qa.vrm',added:1});
          tx.oncomplete=resolve;tx.onerror=reject});db.close()}""")
        await page.goto(f"{BASE}/?settings=1&role=qa-role")
        await page.wait_for_selector(".settings-page-heading h2")
        assert await page.locator(".settings-nav b").all_text_contents() == ["角色", "人设", "记忆", "大脑", "手脚", "视觉", "听觉", "语音", "动作"]
        assert await page.locator(".settings-page-heading h2").inner_text() == "角色"
        assert await page.locator(".role-module-item").count() == 8
        assert await page.locator(".status-dot.verified").count() == 0
        assert await page.locator(".module-panel-head").get_by_role("button", name="一键检测").count() == 1
        assert await page.locator(".module-panel-head").get_by_role("button", name="导出").count() == 1
        assert await page.locator(".module-status-link em").all_text_contents() == ["异常", "异常", "异常", "异常", "异常", "已停用", "异常", "异常"]
        assert await page.get_by_text("开启人脸检测", exact=False).count() == 0
        assert await page.get_by_label("授权目录", exact=True).count() == 1
        directory = page.get_by_label("授权目录", exact=True)
        await directory.fill("D:/authorised")
        await directory.press("Enter")
        await page.wait_for_function("document.querySelector('.local-operation-notice')?.textContent==='已保存'")
        assert writes[-1]["file_access_root"] == "D:/authorised"
        await page.locator(".settings-content").evaluate("element=>element.scrollTop=0")
        await page.screenshot(path=str(ROOT / "build/settings-role-new.png"))
        await page.locator(".settings-nav button").filter(has_text="大脑").click()
        assert await page.locator(".settings-page-heading h2").inner_text() == "大脑"
        assert await page.locator(".role-module-item").count() == 0
        await page.get_by_role("tab", name="本地私有化部署", exact=True).click()
        assert await page.get_by_role("tab", name="本地私有化部署").get_attribute("aria-selected") == "true"
        await page.get_by_label("标签", exact=True).fill("本地 QA")
        await page.get_by_role("button", name="保存配置", exact=True).click()
        await page.wait_for_function("document.querySelector('.config-result')?.textContent==='QA 尚未验证'")
        assert writes[-1]["brain_connection_mode"] == "local"
        assert writes[-1]["brain_tag"] == "本地 QA"
        assert tests == ["brain"]
        await page.screenshot(path=str(ROOT / "build/settings-brain-new.png"))
        await page.locator(".settings-nav button").filter(has_text="人设").click()
        await page.get_by_role("combobox", name="角色模板", exact=True).click()
        await page.get_by_role("option", name="元气伙伴", exact=True).click()
        assert "积极" in await page.locator(".persona-editor").input_value()
        await page.locator("input[type=file]").set_input_files({"name": "persona.txt", "mimeType": "text/plain", "buffer": b"QA"})
        await page.wait_for_function("document.querySelector('.persona-editor')?.value.includes('导入角色')")
        await page.screenshot(path=str(ROOT / "build/settings-persona-new.png"))
        await page.locator(".settings-nav button").filter(has_text="动作").click()
        await page.get_by_role("spinbutton", name="固定秒数", exact=True).fill("8")
        assert await page.get_by_role("spinbutton", name="固定秒数", exact=True).count() == 1
        await page.get_by_role("combobox", name="本地动作库", exact=True).click()
        assert await page.get_by_role("tab", name="回答动作", exact=True).count() == 1
        assert await page.get_by_role("tab", name="常用动作", exact=True).count() == 1
        assert await page.get_by_role("option").count() == 14
        await page.get_by_role("tab", name="常用动作", exact=True).click()
        assert await page.get_by_role("option").count() == 9
        await page.keyboard.press("Escape")
        assert await page.get_by_text("Worker 的 HTTP 访问地址", exact=False).count() == 0
        await page.screenshot(path=str(ROOT / "build/settings-motion-new.png"))
        await page.goto(f"{BASE}/?home=1")
        await page.wait_for_selector(".role-module-panel")
        assert await page.locator(".studio-settings").count() == 1
        assert await page.locator(".status-dot.verified").count() == 0
        assert await page.locator(".role-module-item").count() == 8
        await page.get_by_role("button", name="预览角色 QA 角色", exact=True).click()
        await page.wait_for_function("document.querySelector('.preview-heading p')?.textContent==='QA 角色：很高兴与你相伴。'")
        await page.wait_for_selector("canvas.camera-ready")
        assert await page.get_by_role("button", name="应用", exact=True).count() == 1
        assert await page.locator(".preview-meta small").count() == 1
        await page.screenshot(path=str(ROOT / "build/home-modules-new.png"))
        layouts = []
        for width, height in [(1180, 780), (980, 620)]:
            await page.set_viewport_size({"width": width, "height": height})
            # Responsive controls change padding at the compact breakpoint.
            await page.evaluate("()=>new Promise(requestAnimationFrame)")
            dimensions = await page.locator(".studio-settings").evaluate("""element=>{
              const parent=element.getBoundingClientRect();
              const last=element.querySelector('.local-operation-panel').getBoundingClientRect();
              return {height:element.clientHeight,scroll:element.scrollHeight,lastBottom:last.bottom,bottom:parent.bottom};
            }""")
            await page.screenshot(path=str(ROOT / f"build/home-eight-modules-{width}x{height}.png"))
            if dimensions["scroll"] > dimensions["height"] + 1:
                details = await page.locator(".studio-settings").evaluate("""element=>[...element.querySelectorAll(
                  ':scope>h2,.home-desktop-controls,.module-panel-head,.role-module-grid,.module-panel-actions,.local-operation-panel,.local-operation-panel>*'
                )].map(node=>({class:node.className,height:node.getBoundingClientRect().height,top:node.getBoundingClientRect().top,
                  bottom:node.getBoundingClientRect().bottom,padding:getComputedStyle(node).padding,gap:getComputedStyle(node).gap}))""")
                print(json.dumps({"overflow_width": width, "overflow_height": height, "dimensions": dimensions, "children": details}))
            assert dimensions["scroll"] <= dimensions["height"] + 1, dimensions
            assert dimensions["lastBottom"] <= dimensions["bottom"], dimensions
            layouts.append({"width": width, "height": height, **dimensions})
        await page.screenshot(path=str(ROOT / "build/home-eight-modules-small.png"))
        # Save and active-check feedback must fit too, not just the idle panel.
        await page.get_by_label("授权目录", exact=True).fill("D:/authorised-updated")
        await page.get_by_label("授权目录", exact=True).press("Enter")
        await page.wait_for_function("document.querySelector('.module-panel-notice')?.textContent==='已保存'")
        assert writes[-1]["file_access_root"] == "D:/authorised-updated"
        feedback_layouts = []
        for state in ["local_saved", "detected"]:
            if state == "detected":
                # Keep all detection inside the page mock and avoid real devices.
                await page.evaluate("""()=>{
                  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
                    getUserMedia:async()=>{throw new Error('QA 摄像头未授权')},
                    enumerateDevices:async()=>[]
                  }});
                }""")
                await page.get_by_role("button", name="检测", exact=True).click()
                await page.wait_for_function("!document.querySelector('.module-panel-head')?.textContent.includes('检测中')")
                assert await page.locator(".module-panel-notice").count() == 1
            dimensions = await page.locator(".studio-settings").evaluate("""element=>{
              const parent=element.getBoundingClientRect(),last=element.querySelector('.module-panel-notice').getBoundingClientRect();
              return {height:element.clientHeight,scroll:element.scrollHeight,lastBottom:last.bottom,bottom:parent.bottom};
            }""")
            await page.screenshot(path=str(ROOT / f"build/home-eight-modules-{state}.png"))
            assert dimensions["scroll"] <= dimensions["height"] + 1, {"state": state, **dimensions}
            assert dimensions["lastBottom"] <= dimensions["bottom"], {"state": state, **dimensions}
            feedback_layouts.append({"state": state, "width": 980, "viewport_height": 620, **dimensions})
        guide_layouts = []
        await page.goto(f"{BASE}/?tutorial=1")
        for width, height in [(960, 760), (720, 520)]:
            await page.set_viewport_size({"width": width, "height": height})
            await page.evaluate("()=>new Promise(requestAnimationFrame)")
            dimensions = await page.locator(".guide-sidebar").evaluate("""element=>{
              const nav=element.querySelector('nav'),parent=element.getBoundingClientRect();
              return {height:element.clientHeight,scroll:element.scrollHeight,navHeight:nav.clientHeight,navScroll:nav.scrollHeight,
                count:nav.children.length,allVisible:[...nav.children].every(node=>node.getBoundingClientRect().bottom<=parent.bottom)};
            }""")
            assert dimensions["height"] >= dimensions["scroll"] and dimensions["navHeight"] >= dimensions["navScroll"], dimensions
            assert dimensions["count"] == 15 and dimensions["allVisible"], dimensions
            assert await page.locator(".guide-version,.guide-content>footer").count() == 0
            guide_layouts.append({"width": width, "height": height, **dimensions})
        assert not errors, errors
        print(json.dumps({"directory": 9, "modules": 8, "no_fake_green": True, "home_layouts": layouts,
                          "home_feedback_layouts": feedback_layouts, "guide_layouts": guide_layouts,
                          "real_tabs_and_role_save": True, "document_import": True,
                          "duration_spinner": True, "motion_categories": [14, 9], "page_errors": errors}))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
