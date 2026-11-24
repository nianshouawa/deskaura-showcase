"""Render staged archives with the actual AvatarStage, avatar and loop sampler."""
import asyncio
import argparse
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / "build/standby-library"
IDS = ["cloud_standby_" + key for key in ("sleep", "sing", "sway", "daydream", "stretch", "look_around")]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", type=Path, default=STAGE)
    parser.add_argument("--ids", nargs="+", default=IDS)
    parser.add_argument("--side", action="store_true")
    parser.add_argument("--entry", action="store_true")
    args = parser.parse_args()
    stage = args.stage.resolve()
    stage.mkdir(parents=True, exist_ok=True)
    ids = args.ids
    config = Path(os.environ["LOCALAPPDATA"]) / "com.deskaura.app"
    role = json.loads((config / "active-role.json").read_text())["role_id"]
    roles = [json.loads(path.read_text()) for path in (config / "roles").glob("*/role.json")]
    avatar = Path(next(item["model_path"] for item in roles if item.get("id") == role or item.get("role_id") == role))
    if not avatar.is_file():
        raise RuntimeError("Active avatar not found")
    reports, images = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 500, "height": 650}, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.route("**/qa-standby", lambda route: route.fulfill(
            content_type="text/html", body='<html><body style="margin:0;background:#e3e8ec"></body></html>'))
        await page.route("**/qa-avatar.vrm", lambda route: route.fulfill(path=str(avatar)))

        async def motion_route(route):
            ident = route.request.url.rsplit("/", 1)[-1]
            candidate = stage / f"{ident}.json"
            path = candidate if candidate.is_file() else ROOT / f"motion-service/data/cloud_motions/{ident}.json"
            await route.fulfill(path=str(path), content_type="application/json", headers={"Access-Control-Allow-Origin": "*"})
        await page.route("**/api/motion/library/*", motion_route)
        await page.goto("http://127.0.0.1:1420/qa-standby")
        await page.evaluate("""async () => {
          const componentSource=await(await fetch('/src/components/AvatarStage.vue')).text();
          const vueUrl=componentSource.match(/["']([^"']*\\/vue\\.js\\?v=[^"']+)["']/)[1];
          const {createApp,h,ref}=await import(vueUrl);
          const {default:AvatarStage}=await import('/src/components/AvatarStage.vue');
          const motion=ref(undefined),stage=ref();
          const emotion=()=>motion.value?.id.includes('emotion_')?motion.value.id.split('emotion_')[1]:
            motion.value?.id.endsWith('sleep')?'tired':motion.value?.id.endsWith('sing')?'happy':'neutral';
          createApp({setup(){return ()=>h(AvatarStage,{ref:stage,motion:motion.value,emotion:emotion(),gazeMode:'none'})}}).mount(document.body);
          window.qa={motion,stage};
        }""")
        await page.wait_for_function("window.qa.stage.value")
        await page.evaluate("async () => { await window.qa.stage.value.loadUrl('/qa-avatar.vrm'); }")
        await page.add_style_tag(content="html,body,#app,.stage{width:100%;height:100%;margin:0} canvas{width:100%;height:100%;display:block}")
        await page.wait_for_timeout(1400)
        if args.side:
            await page.locator("canvas").dispatch_event("pointerdown", {"button": 1, "buttons": 4, "pointerId": 7, "clientX": 250, "clientY": 300})
            await page.locator("canvas").dispatch_event("pointermove", {"button": 1, "buttons": 4, "pointerId": 7, "clientX": 110, "clientY": 300})
            await page.locator("canvas").dispatch_event("pointerup", {"button": 1, "buttons": 0, "pointerId": 7, "clientX": 110, "clientY": 300})
        for ident in ids:
            await page.evaluate("""ident => { window.qa.motion.value={
              id:ident,kind:'hymotion',url:'/api/motion/library/'+ident,duration:8,loop:true}; }""", ident)
            captures = []
            for index, delay in enumerate((150, 150, 150, 150, 200, 400) if args.entry else (1800, 2400, 4300)):
                await page.wait_for_timeout(delay)
                image = stage / f"{ident}-view{index}.png"
                await page.screenshot(path=str(image))
                captures.append(image)
            values = []
            for path in captures:
                image = Image.open(path).convert("RGB")
                background = Image.new("RGB", image.size, image.getpixel((0, 0)))
                from PIL import ImageChops
                bounds = ImageChops.difference(image, background).getbbox()
                if not bounds or bounds[2] - bounds[0] < 40 or bounds[3] - bounds[1] < 150:
                    raise RuntimeError(f"Blank avatar: {ident}")
                values.append(bounds)
            from PIL import ImageChops
            changed = ImageChops.difference(Image.open(captures[0]), Image.open(captures[1])).getbbox() is not None
            if not changed:
                raise RuntimeError(f"Static avatar: {ident}")
            reports.append({"id": ident, "bounds": values, "moving": changed})
            images.append(captures)
        await page.set_viewport_size({"width": 390, "height": 700})
        for ident in ids:
            await page.evaluate("""ident => { window.qa.motion.value={
              id:ident,kind:'hymotion',url:'/api/motion/library/'+ident,duration:8,loop:true}; }""", ident)
            await page.wait_for_timeout(1800)
            path = stage / f"{ident}-mobile.png"
            await page.screenshot(path=str(path))
            from PIL import ImageChops
            image = Image.open(path).convert("RGB")
            bounds = ImageChops.difference(image, Image.new("RGB", image.size, image.getpixel((0, 0)))).getbbox()
            if not bounds or bounds[3] - bounds[1] < 150:
                raise RuntimeError(f"Blank mobile avatar: {ident}")
            reports.append({"id": ident, "viewport": "390x700", "bounds": bounds})
        await browser.close()
    if errors:
        raise RuntimeError(json.dumps(errors))
    columns = 6 if args.entry else 3
    sheet = Image.new("RGB", (columns * 500, len(ids) * 680), "#e3e8ec")
    draw = ImageDraw.Draw(sheet)
    for row, captures in enumerate(images):
        for col, path in enumerate(captures):
            sheet.paste(Image.open(path).convert("RGB"), (col * 500, row * 680 + 28))
            draw.text((col * 500 + 12, row * 680 + 8), f"{ids[row]} / {col + 1}", fill="#20252a")
    sheet.save(stage / "standby-review.jpg")
    (stage / "visual-report.json").write_text(json.dumps({"avatar": str(avatar), "reports": reports, "errors": errors}, indent=2))
    print(json.dumps({"review": str(stage / "standby-review.jpg"), "checks": len(reports), "errors": errors}))


if __name__ == "__main__":
    asyncio.run(main())
