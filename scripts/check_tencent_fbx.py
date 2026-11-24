"""Independent actual-avatar visual QA using the production Tencent FBX parser."""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("avatar", type=Path)
    parser.add_argument("--fbx", type=Path, default=ROOT / "build/tencent-fbx-qa.fbx")
    parser.add_argument("--output", default="tencent-fbx-avatar-qa.png")
    parser.add_argument("--base-url", default="http://127.0.0.1:1420")
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1560, "height": 980})
        await page.route("**/qa-tencent", lambda route: route.fulfill(
            content_type="text/html",
            body='<html><body style="margin:0;background:#171924;color:#d9c8ec;font:13px Segoe UI"></body></html>'))
        await page.route("**/qa-avatar.vrm", lambda route: route.fulfill(path=str(args.avatar.resolve(strict=True))))
        await page.route("**/qa-motion.fbx", lambda route: route.fulfill(path=str(args.fbx.resolve(strict=True))))
        await page.goto(args.base_url + "/qa-tencent")
        report = await page.evaluate("""async () => {
          const THREE=await import('/node_modules/.vite/deps/three.js');
          const {GLTFLoader}=await import('/node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader__js.js');
          const {VRMLoaderPlugin,VRMUtils}=await import('/node_modules/.vite/deps/@pixiv_three-vrm.js');
          const {parseTencentFbxMotion}=await import('/src/fbxMotion.ts');
          const {prepareMotionTracks,sampleTrack,smoothBone}=await import('/src/motionPlayback.ts');
          const {AvatarMotionSafety,limitJointRotation}=await import('/src/motionSafety.ts');
          const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
          const gltf=await loader.loadAsync('/qa-avatar.vrm'),vrm=gltf.userData.vrm,rig=vrm.humanoid;
          VRMUtils.rotateVRM0(vrm);vrm.scene.updateMatrixWorld(true);
          const scene=new THREE.Scene();scene.background=new THREE.Color('#171924');scene.add(vrm.scene);
          scene.add(new THREE.HemisphereLight(0xffffff,0x777088,2));
          const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-2,4,3);scene.add(light);
          const rest=new Map(Object.entries(rig.normalizedHumanBones).map(([n,b])=>[n,b.node.quaternion.clone()]));
          const data=parseTencentFbxMotion(await(await fetch('/qa-motion.fbx')).arrayBuffer());
          const flip=vrm.meta.metaVersion==='0',safety=new AvatarMotionSafety(rig,vrm.scene);
          const tracks=prepareMotionTracks(data.poses,rest,flip,{id:'tencent-real-qa'});
          const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(300,365);renderer.outputColorSpace=THREE.SRGBColorSpace;
          const q=new THREE.Quaternion(),reports=[];
          for(const angle of [0,.8,-.8]){
            rig.resetNormalizedPose();safety.reset();
            const filtered=new Map([...rest].map(([n,v])=>[n,v.clone()]));
            const section=document.createElement('section');section.style.cssText='display:flex;gap:4px;padding:5px';document.body.append(section);
            const camera=new THREE.OrthographicCamera(-.54,.54,.66,-.66,.01,20);camera.position.set(Math.sin(angle)*3,1.19,Math.cos(angle)*3);camera.lookAt(0,1.19,0);camera.updateMatrixWorld(true);
            const times=[.4,1.1,1.8,2.5,3.3];let capture=0,maxStep=0;const previous=new Map();
            for(let frame=0;frame<=200;frame++){
              const t=frame/60,blend=THREE.MathUtils.smoothstep(t,0,.8);
              for(const[bone,track]of tracks){
                sampleTrack(track,t,data.fps,q);limitJointRotation(bone,q,rest.get(bone),flip,'generated',q);
                q.slerp(rest.get(bone),1-blend);smoothBone(filtered.get(bone),q,bone,1/60);rig.getNormalizedBoneNode(bone).quaternion.copy(filtered.get(bone));
              }
              safety.apply(1/60,'generated',blend,'fluent');vrm.update(1/60);vrm.scene.updateMatrixWorld(true);
              for(const name of ['leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm']){
                const rotation=rig.getNormalizedBoneNode(name).quaternion;
                if(previous.has(name))maxStep=Math.max(maxStep,previous.get(name).angleTo(rotation)*180/Math.PI);previous.set(name,rotation.clone());
              }
              if(capture<times.length&&t+1/120>=times[capture]){
                renderer.render(scene,camera);const holder=document.createElement('div');holder.style.cssText='width:300px';
                const title=document.createElement('div');title.textContent='Tencent FBX · '+angle+' rad · '+t.toFixed(2)+'s';holder.append(title);
                const image=new Image();image.src=renderer.domElement.toDataURL();holder.append(image);section.append(holder);capture++;
              }
            }
            reports.push({angle,maxStep});
          }
          renderer.dispose();return {frames:data.poses.length,duration:data.duration,tracks:tracks.size,reports};
        }""")
        output = ROOT / "build" / args.output
        await page.screenshot(path=str(output), full_page=True)
        print(json.dumps({"screenshot": str(output), "report": report}))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
