"""Isolated browser QA. No credentials, real camera, microphone or model calls."""
import asyncio
import json
import base64
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        context = await browser.new_context(viewport={'width': 460, 'height': 680}, permissions=['camera', 'microphone'])
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        paid = []
        async def route_api(route):
            url = route.request.url
            if '/settings/model' in url:
                value = {'base_url':'https://example.invalid/v1','model':'test','audio_enabled':False,'asr_enabled':True,'asr_has_api_key':True,'gaze_mode':'face'}
            elif '/chat/capabilities' in url:
                value = {'image_input':True,'source':'provider','detail':'QA only','provider_verified':True,'max_attachments':3,'max_image_bytes':4194304,'max_image_pixels':20000000,'max_text_bytes':49152,'max_text_characters':12000,'image_mime_types':['image/jpeg','image/png','image/webp'],'text_extensions':['.txt','.py'],'audio_input':False,'video_input':False,'document_input':False}
            elif url.endswith('/chat/sessions'):
                value = {'sessions':[{'id':'qa','title':'隔离测试','updated_at':'2026-11-05'}]}
            elif '/chat/sessions/' in url:
                value = {'messages':[]}
            else:
                if route.request.method != 'GET': paid.append(url)
                value = {'detail':'QA blocks external generation'}
            await route.fulfill(status=200, json=value)
        await page.route('http://127.0.0.1:8000/**', route_api)
        await page.add_init_script("""
        window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'dialog'},currentWebview:{label:'dialog'}},
          transformCallback:()=>1,invoke:async(command,args)=>{
            if(command.includes('is_maximized'))return false;
            if(command.includes('listen'))return 1;
            return null;
          }};
        """)
        await page.goto('http://127.0.0.1:1420/?dialog=1')
        await page.wait_for_selector('.chat-welcome')
        for width in (360,460,570):
            await page.set_viewport_size({'width':width,'height':680})
            await page.get_by_role('button', name='通话', exact=True).click()
            await page.wait_for_selector('.call-camera-preview video')
            await page.wait_for_function("document.querySelector('.voice-waveform')")
            await page.screenshot(path=str(ROOT / f'build/call-ui-{width}.png'))
            report = await page.evaluate("""()=>({overflow:document.documentElement.scrollWidth>innerWidth,
              count:document.querySelectorAll('.composer-actions button').length,
              buttons:[...document.querySelectorAll('.composer-actions button')].map(b=>{let r=b.getBoundingClientRect();return {name:b.ariaLabel,left:r.left,right:r.right}})})""")
            assert not report['overflow'], report
            assert all(7 <= b['left'] < b['right'] <= width-7 for b in report['buttons']), report
            await page.get_by_role('button',name='静音麦克风',exact=True).click()
            await page.wait_for_selector('.voice-waveform',state='hidden')
            await page.get_by_role('button',name='挂断通话',exact=True).click()
            await page.wait_for_selector('.call-camera-preview',state='hidden')
            print(json.dumps({'width':width,'state':'passed','buttons':report['count']},ensure_ascii=False))
        assert not paid, paid
        assert not errors, errors
        await page.evaluate("""async()=>{
          const {FaceTracker}=await import('/src/faceTracking.ts');
          window.qaFace=new FaceTracker(); window.qaFaceStates=[];
          await window.qaFace.start(t=>window.qaFaceTarget=t,s=>window.qaFaceStates.push(s));
        }""")
        await page.wait_for_function("window.qaFaceStates.some(s=>s==='未检测到人脸')",timeout=15000)
        face = await page.evaluate("({states:window.qaFaceStates,target:window.qaFaceTarget})")
        await page.evaluate('window.qaFace.stop()')
        print(json.dumps({'bundled_face_detector':face},ensure_ascii=False))
        portrait = ROOT / 'build/face-detector-fixture.jpg'
        if portrait.exists():
            data = 'data:image/jpeg;base64,' + base64.b64encode(portrait.read_bytes()).decode()
            await page.evaluate("""async(data)=>{
              const picture=new Image();picture.src=data;await picture.decode();
              const canvas=document.createElement('canvas');canvas.width=picture.width;canvas.height=picture.height;
              canvas.getContext('2d').drawImage(picture,0,0);
              const realAcquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
              window.qaFaceCanvas=canvas;window.qaFaceDraw=setInterval(()=>canvas.getContext('2d').drawImage(picture,0,0),80);
              navigator.mediaDevices.getUserMedia=async()=>canvas.captureStream(10);
              window.qaFaceStates=[];await window.qaFace.start(t=>window.qaFaceTarget=t,s=>window.qaFaceStates.push(s));
              navigator.mediaDevices.getUserMedia=realAcquire;
            }""", data)
            await page.wait_for_function('window.qaFaceTarget?.visible===true',timeout=15000)
            print(json.dumps({'portrait_face':await page.evaluate('window.qaFaceTarget')},ensure_ascii=False))
            await page.evaluate('window.qaFace.stop();clearInterval(window.qaFaceDraw)')
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
