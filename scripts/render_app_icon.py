"""Render the existing local Momo model into a project-owned raster app icon."""
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import shutil

from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build/ui-and-standby-v15"
TARGET = ROOT / "companion-frontend/src/assets/app-icon.png"


async def main():
    config = Path(os.environ["LOCALAPPDATA"]) / "com.deskaura.app"
    role_id = json.loads((config / "active-role.json").read_text())["role_id"]
    role = next(json.loads(path.read_text()) for path in (config / "roles").glob("*/role.json")
                if json.loads(path.read_text()).get("id") == role_id)
    avatar = Path(role["model_path"]).resolve(strict=True)
    OUT.mkdir(parents=True, exist_ok=True)
    backup = OUT / "icon-backup"
    if not backup.exists():
        shutil.copytree(ROOT / "companion-frontend/src-tauri/icons", backup)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1024, "height": 1024})
        await page.route("**/qa-icon", lambda route: route.fulfill(
            content_type="text/html", body="<html><body style='margin:0'></body></html>"))
        await page.route("**/qa-avatar.vrm", lambda route: route.fulfill(path=str(avatar)))
        await page.goto("http://127.0.0.1:1420/qa-icon")
        encoded = await page.evaluate("""async () => {
          const T=await import('/node_modules/.vite/deps/three.js');
          const {GLTFLoader}=await import('/node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader__js.js');
          const {VRMLoaderPlugin,VRMUtils}=await import('/node_modules/.vite/deps/@pixiv_three-vrm.js');
          const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
          const gltf=await loader.loadAsync('/qa-avatar.vrm'),vrm=gltf.userData.vrm;
          VRMUtils.rotateVRM0(vrm);
          const sign=vrm.meta.metaVersion==='0'?-1:1;
          vrm.humanoid.getNormalizedBoneNode('leftUpperArm').rotation.z=-1.25*sign;
          vrm.humanoid.getNormalizedBoneNode('rightUpperArm').rotation.z=1.25*sign;
          vrm.expressionManager?.setValue('happy',.35);
          vrm.expressionManager?.setValue('relaxed',.12);vrm.update(0);vrm.scene.updateMatrixWorld(true);
          const scene=new T.Scene();scene.add(vrm.scene);
          scene.add(new T.HemisphereLight(0xffffff,0x665276,2.4));
          const light=new T.DirectionalLight(0xffffff,2);light.position.set(-1,2,3);scene.add(light);
          const head=vrm.humanoid.getNormalizedBoneNode('head').getWorldPosition(new T.Vector3());
          const camera=new T.OrthographicCamera(-.20,.20,.20,-.20,.01,20);
          camera.position.set(head.x,head.y+.09,head.z+2);camera.lookAt(head.x,head.y+.09,head.z);
          const renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
          renderer.setSize(1024,1024);renderer.outputColorSpace=T.SRGBColorSpace;
          renderer.render(scene,camera);
          const result=renderer.domElement.toDataURL('image/png');renderer.dispose();
          return result.split(',')[1];
        }""")
        await browser.close()
    portrait = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA")
    background = Image.new("RGBA", portrait.size, "#352945")
    background.alpha_composite(portrait)
    mask = Image.new("L", portrait.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1023, 1023), radius=210, fill=255)
    background.putalpha(mask)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    background.save(TARGET)
    preview = Image.new("RGB", (1024, 320), "#171a24")
    for size, x in ((256, 24), (128, 330), (64, 530), (32, 660), (16, 770)):
        icon = background.resize((size, size), Image.Resampling.LANCZOS)
        preview.paste(icon, (x, (320 - size) // 2), icon)
    preview.save(OUT / "icon-size-preview.png")
    (OUT / "icon-provenance.json").write_text(json.dumps({
        "mode": "existing-local-model-render", "source_model": str(avatar),
        "asset": str(TARGET), "ai_image_generation": False,
        "brief": "Existing Momo anime face, centered close-up, gentle smile, flat plum backdrop, no text, rounded alpha corners.",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"icon": str(TARGET), "preview": str(OUT / "icon-size-preview.png")}))


if __name__ == "__main__":
    asyncio.run(main())
