import pathlib, tempfile, subprocess
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=pathlib.Path('/tmp/codex-remote-attachments/01a0c443-7d74-74c0-8047-e0bd84184dca/61eb891f-6cac-4f1d-9e11-9e2f3a37537d/1-Photo-1.jpg')
out=pathlib.Path(tempfile.mkdtemp(prefix='plc-camera-stress-'))
subprocess.run(['/Users/lucas_garcia/.local/bin/ffmpeg','-loglevel','error','-loop','1','-i',str(SOURCE),'-t','1','-vf','scale=640:1280,format=yuv420p','-r','5',str(out/'camera.y4m')],check=True)
HTML='''<label for="photo">Take photo</label><input type="file" capture="environment" id="photo" hidden>
<script type="module">import {installCameraCapture} from '/camera.js'; installCameraCapture();
window.captures=0;window.sizes=[];window.streams=[];
const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async(...args)=>{const s=await original(...args);streams.push(s);return s;};
document.querySelector('#photo').onchange=e=>{sizes.push(e.target.files[0].size);captures++;e.target.value='';};</script>'''
with sync_playwright() as p:
    browser=p.chromium.launch(args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-video-capture={out/"camera.y4m"}'])
    page=browser.new_page()
    page.route('https://camera.qa.test/**',lambda r:r.fulfill(path=str(ROOT/'src/camera.js'),content_type='text/javascript') if r.request.url.endswith('camera.js') else r.fulfill(body=HTML,content_type='text/html'))
    page.goto('https://camera.qa.test');page.wait_for_function('window.captures===0')
    for i in range(100):
        page.click('label');page.locator('[data-shutter]:enabled').wait_for();page.click('[data-shutter]')
        page.wait_for_function('(n)=>window.captures===n',arg=i+1)
        assert page.evaluate('streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))')
        assert page.locator('dialog').count()==0
    print('PASS: 100 sequential camera captures; all tracks ended and dialogs removed. No network uploads in this stress test.',flush=True)
    page.click('label');page.locator('[data-shutter]:enabled').wait_for();page.click('[data-cancel]')
    assert page.evaluate('streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))')
    print('PASS: Cancel releases camera.',flush=True)
    page.evaluate('() => { navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException("Denied","NotAllowedError")); }')
    page.click('label');page.wait_for_function('document.querySelector("[role=status]").textContent.includes("denied")')
    assert page.locator('[data-shutter]').is_disabled()
    assert page.locator('[data-library]').count()==0
    assert page.locator('.photo-feedback--error').count()==1
    print('PASS: Permission denied shows error feedback; no storage-upload fallback.',flush=True)
    print('Largest captured JPEG bytes:',page.evaluate('Math.max(...sizes.slice(0,100))'),flush=True)
    browser.close()
