"""Isolated settings overflow and applied-role persistence regression checks."""
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:15420"
OUTPUT = ROOT / "build/final-audit"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 980, "height": 760})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        config = {"base_url": "https://example.invalid/v1", "model": "qa",
                  "persona_text": "角色设定\n" * 80, "persona_local_provider": "built_in",
                  "memory_path": "D:/qa"}
        services = []
        mcp = {"mcpServers": {f"服务{i}": {"command": "node", "args": ["example.js", "长路径/" * 100]} for i in range(8)}}

        async def api(route):
            url = route.request.url
            if "/api/settings/model" in url:
                if route.request.method == "PUT":
                    config.update(route.request.post_data_json)
                result = config
            elif "/api/tools/mcp/export" in url:
                result = mcp
            elif "/api/tools/mcp" in url:
                result = {"services": services, "total": len(services)}
            elif "/api/modules/" in url:
                result = {"verified": False, "detail": "QA 检测失败"}
            else:
                result = {}
            await route.fulfill(json=result)

        await page.route("**/api/**", api)
        await page.add_init_script("""
          window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'settings'},currentWebview:{label:'settings'}},
            transformCallback:()=>1,invoke:async(c)=>c.includes('listen')?1:null};
          window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
          localStorage.setItem('deskaura-active-model','expand-qa');
        """)
        await page.goto(BASE + "/?settings=1")
        await page.evaluate("""async()=>{
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('deskaura-model-library',2);
            r.onupgradeneeded=()=>r.result.createObjectStore('models',{keyPath:'id'});
            r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          await new Promise((resolve,reject)=>{const tx=db.transaction('models','readwrite');
            tx.objectStore('models').put({id:'expand-qa',name:'展开检查',description:'很长的角色描述'.repeat(60),added:1});
            tx.oncomplete=resolve;tx.onerror=reject});db.close();
        }""")
        await page.goto(BASE + "/?settings=1&role=expand-qa")
        await page.get_by_role("button", name="展开角色描述", exact=True).click()
        assert await page.locator(".role-description-input").evaluate("(e)=>e.clientHeight>=e.scrollHeight-2")
        expanded_height = await page.locator(".role-description-input").evaluate("(e)=>e.offsetHeight")
        await page.wait_for_timeout(500)
        assert await page.locator(".role-description-input").evaluate("(e)=>e.offsetHeight") == expanded_height
        assert expanded_height < 600
        await page.get_by_role("button", name="收起角色描述", exact=True).click()
        assert await page.locator(".role-description-input").evaluate("(e)=>e.offsetHeight") == 68
        for _ in range(3):
            await page.get_by_role("button", name="展开角色描述", exact=True).click()
            assert await page.locator(".role-description-input").evaluate("(e)=>e.offsetHeight") == expanded_height
            await page.get_by_role("button", name="收起角色描述", exact=True).click()
        await page.get_by_role("button", name="人设", exact=False).first.click()
        persona = page.locator(".persona-editor")
        default_persona_height = await persona.evaluate("(e)=>e.offsetHeight")
        await persona.fill("很长但只有一行的角色设定" * 180)
        await page.get_by_role("button", name="展开角色设定", exact=True).click()
        assert await persona.evaluate("(e)=>e.offsetHeight") >= default_persona_height
        await page.get_by_role("button", name="收起角色设定", exact=True).click()
        assert await persona.evaluate("(e)=>e.offsetHeight") == default_persona_height
        await page.get_by_role("button", name="展开角色设定", exact=True).click()
        assert await page.locator(".persona-editor").evaluate("(e)=>e.clientHeight>=e.scrollHeight-2")
        await page.get_by_role("button", name="收起角色设定", exact=True).click()
        await page.locator(".settings-content").evaluate("(e)=>e.scrollTop=300")
        scroll_before = await page.locator(".settings-content").evaluate("(e)=>e.scrollTop")
        await page.evaluate("""()=>{
          const editor=document.querySelector('.persona-editor');
          window.qaEditorMutations=[];
          window.qaEditorObserver=new MutationObserver(records=>window.qaEditorMutations.push(...records));
          window.qaEditorObserver.observe(editor,{attributes:true,attributeFilter:['style']});
          for(let i=0;i<20;i++) editor.dispatchEvent(new Event('input',{bubbles:true}));
        }""")
        await page.wait_for_timeout(300)
        assert await page.locator(".settings-content").evaluate("(e)=>e.scrollTop") == scroll_before
        assert await page.evaluate("window.qaEditorMutations.length") == 0
        await page.evaluate("window.qaEditorObserver.disconnect()")
        for _ in range(5):
            await page.mouse.move(850, 650)
            await page.mouse.wheel(0, 180)
            await page.wait_for_timeout(50)
            now = await page.locator(".settings-content").evaluate("(e)=>e.scrollTop")
            assert now >= scroll_before
            scroll_before = now
        await page.get_by_role("button", name="手脚", exact=False).first.click()
        box = page.locator(".mcp-service-list")
        editor = page.locator(".mcp-json-editor")
        await editor.wait_for()
        empty_height = await box.evaluate("(e)=>e.offsetHeight")
        assert 90 <= empty_height <= 140, empty_height
        await page.get_by_role("button", name="展开JSON配置", exact=True).click()
        assert await editor.evaluate("(e)=>e.clientHeight>=e.scrollHeight-2")
        assert await editor.evaluate("(e)=>e.clientWidth>=e.scrollWidth-2")
        json_height = await editor.evaluate("(e)=>e.offsetHeight")
        await page.wait_for_timeout(500)
        assert await editor.evaluate("(e)=>e.offsetHeight") == json_height
        await page.get_by_role("button", name="收起JSON配置", exact=True).click()
        assert await editor.evaluate("(e)=>e.offsetHeight") == 308
        assert await editor.evaluate("(e)=>parseFloat(getComputedStyle(e).paddingRight)") == 12
        for i in range(8):
            services.append({"name": f"服务{i}", "connected": True, "description": "测试服务说明",
                             "server_info": {"name": "QA", "version": "1"}, "tools": []})
        await page.goto(BASE + "/?settings=1&role=expand-qa&section=tools")
        await page.locator(".mcp-service-card").first.wait_for()
        assert await box.evaluate("(e)=>e.offsetHeight") == await editor.evaluate("(e)=>e.offsetHeight")
        await page.screenshot(path=str(OUTPUT / "mcp-overflow.png"))
        await page.get_by_role("button", name="展开MCP服务", exact=True).click()
        assert await box.evaluate("(e)=>e.clientHeight>=e.scrollHeight-2")
        await page.get_by_role("button", name="收起MCP服务", exact=True).click()
        await page.set_viewport_size({"width": 760, "height": 560})
        assert await page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        await page.set_viewport_size({"width": 980, "height": 760})
        services[:] = services[:1]
        await page.reload()
        await page.locator(".mcp-service-card").first.wait_for()
        assert await box.evaluate("(e)=>e.offsetHeight") < await editor.evaluate("(e)=>e.offsetHeight")
        assert await box.evaluate("(e)=>e.offsetHeight") == empty_height
        assert await page.get_by_role("button", name="展开MCP服务", exact=True).count() == 0
        await page.screenshot(path=str(OUTPUT / "mcp-single.png"))
        await page.get_by_role("button", name="人设", exact=False).first.click()
        await page.locator(".persona-editor").fill("应用角色时修改后的设定")
        await page.get_by_role("button", name="保存配置", exact=True).click()
        await page.wait_for_function("document.querySelector('.config-result')?.textContent.includes('配置已保存')")
        assert config["persona_text"] == "应用角色时修改后的设定"
        assert "检测" in await page.locator(".config-result").inner_text()
        await page.goto(BASE + "/?home=1")
        heading = page.locator(".home-role-description")
        await heading.wait_for()
        before = await page.locator(".preview-box").bounding_box()
        await heading.locator("span").evaluate("(e)=>e.textContent='超长角色描述'.repeat(300)")
        after = await page.locator(".preview-box").bounding_box()
        assert before["height"] == after["height"]
        assert await heading.locator("span").evaluate("(e)=>e.clientHeight<=parseFloat(getComputedStyle(e).lineHeight)*2+1")
        await heading.evaluate("(e)=>{e.style.height='auto';e.querySelector('span').style.cssText='position:static;display:inline';e.querySelector('span').textContent='原来的一行描述'}")
        original = await page.locator(".preview-box").bounding_box()
        assert abs(original["height"] - before["height"]) <= 1, (original, before)
        await heading.evaluate("(e)=>{e.removeAttribute('style');e.querySelector('span').removeAttribute('style');e.querySelector('span').textContent='超长角色描述'.repeat(300)}")
        await page.screenshot(path=str(OUTPUT / "home-description.png"))
        assert not errors, errors
        await browser.close()
        print(json.dumps({"overflow_expansion": True, "mcp_auto_height": True,
                          "applied_role_save": True, "page_errors": errors}))


if __name__ == "__main__":
    asyncio.run(main())
