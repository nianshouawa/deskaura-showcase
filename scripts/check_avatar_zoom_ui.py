"""Isolated real-WebGL zoom and static-preview cursor checks."""
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 980, "height": 760})
        await page.goto("http://127.0.0.1:15420/?tutorial=1")
        result = await page.evaluate("""async()=>{
          const {createApp}=await import('/node_modules/.vite/deps/vue.js');
          const Stage=(await import('/src/components/AvatarStage.vue')).default;
          const THREE=await import('/node_modules/.vite/deps/three.js');
          const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
          const mesh=new THREE.Mesh(new THREE.BoxGeometry(.6,1.7,.3),
            new THREE.MeshStandardMaterial({color:0x66bb99}));
          mesh.position.y=.85;
          const file=await new GLTFExporter().parseAsync(mesh,{binary:true});
          document.body.innerHTML='<div id="zoom-test" style="position:fixed;inset:0"></div>';
          const style=document.createElement('style');
          style.textContent='#zoom-test{background:#151822}#zoom-test .stage,#zoom-test canvas{width:100%;height:100%}';
          document.head.appendChild(style);
          const app=createApp(Stage);const stage=app.mount('#zoom-test');
          await stage.loadFile(new File([file],'qa.glb'));
          const runtime=stage.$.setupState;
          const initialDistance=runtime.orbit.distance;
          function turn(pitch,yaw){
            runtime.orbit.pitch=pitch;runtime.orbit.yaw=yaw;runtime.updateCamera();runtime.camera.updateMatrixWorld(true);
          }
          function maximum(){
            for(let i=0;i<100;i++)stage.zoomCamera(1.1);
            runtime.camera.updateMatrixWorld(true);
            return runtime.orbit.distance;
          }
          const orderChecks=[];
          for(const pitch of [-.65,0,.65])for(const yaw of [0,1,3]){
            turn(0,0);runtime.orbit.distance=initialDistance;runtime.updateCamera();
            maximum();turn(pitch,yaw);
            const zoomFirst=runtime.orbit.distance;
            const firstMatrix=runtime.camera.matrixWorld.elements.slice();
            turn(0,0);runtime.orbit.distance=initialDistance;runtime.updateCamera();
            turn(pitch,yaw);const turnFirst=maximum();
            if(Math.abs(zoomFirst-turnFirst)>1e-9)throw Error('order-dependent zoom');
            if(!runtime.camera.matrixWorld.elements.every((v,i)=>Math.abs(v-firstMatrix[i])<1e-9))throw Error('different final camera');
            orderChecks.push({pitch,yaw,distance:turnFirst});
          }
          turn(0,0);runtime.orbit.distance=initialDistance;runtime.updateCamera();
          const distances=[];
          for(let i=0;i<25;i++)stage.zoomCamera(1.1);
          const canvas=document.querySelector('canvas');
          canvas.dispatchEvent(new PointerEvent('pointerdown',{button:1,pointerId:1,clientX:400,clientY:300,bubbles:true}));
          canvas.dispatchEvent(new PointerEvent('pointermove',{button:1,buttons:4,pointerId:1,clientX:400,clientY:410,bubbles:true}));
          canvas.dispatchEvent(new PointerEvent('pointerup',{button:1,pointerId:1,clientX:400,clientY:410,bubbles:true}));
          for(let i=0;i<10;i++){
            distances.push(runtime.orbit.distance);
            stage.zoomCamera(1.1);
          }
          if(!distances.every((v,i)=>!i||v<=distances[i-1]+1e-9))throw Error('reversed zoom');
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const gl=canvas.getContext('webgl2');
          const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
          runtime.renderer.render(runtime.scene,runtime.camera);
          gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          const opaque=pixels.filter((v,i)=>i%4===3&&v>0).length;
          if(opaque<100)throw Error('blank canvas');
          app.unmount();
          const previewApp=createApp(Stage,{preview:true});
          const preview=previewApp.mount('#zoom-test');
          await preview.loadFile(new File([file],'preview.glb'));
          if(getComputedStyle(document.querySelector('canvas')).cursor!=='default')throw Error('misleading preview cursor');
          window.qaStage=previewApp;
          return {distances,order_checks:orderChecks,opaque,preview_cursor:'default'};
        }""")
        await page.wait_for_timeout(150)
        await page.screenshot(path=str(ROOT / "build/final-audit/zoom-angle.png"))
        await page.evaluate("window.qaStage.unmount()")
        print(json.dumps(result))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
