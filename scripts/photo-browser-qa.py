"""Real browser + live API/GHL test on an isolated, archived QA building.
Serve the candidate dist via Playwright routing before deploying it.
The local image is also fed through Chromium's simulated camera device.
"""
import json, os, pathlib, subprocess, tempfile, datetime
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path('/tmp/codex-remote-attachments/01a0c443-7d74-74c0-8047-e0bd84184dca/61eb891f-6cac-4f1d-9e11-9e2f3a37537d/1-Photo-1.jpg')
OUT = pathlib.Path(tempfile.mkdtemp(prefix='plc-photo-qa-'))
def fixture(*args):
    return subprocess.check_output(['node','--env-file=.env','scripts/photo-qa-fixture.mjs',*map(str,args)],cwd=ROOT,text=True)

subprocess.run(['/Users/lucas_garcia/.local/bin/ffmpeg','-loglevel','error','-loop','1','-i',str(SOURCE),'-t','1','-vf','scale=640:1280,format=yuv420p','-r','5',str(OUT/'camera.y4m')],check=True)
f = json.loads(fixture('create'))
print('QA_BUILDING', f['buildingId'], f['name'], flush=True)
print('EVIDENCE_DIR', str(OUT), flush=True)
report = {'buildingId':f['buildingId'],'source':str(SOURCE),'checks':[]}
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-video-capture={OUT / "camera.y4m"}'])
        context=browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,permissions=['camera','geolocation'],geolocation={'latitude':43.65,'longitude':-79.38})
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        def candidate(route):
            path=route.request.url.split('.pages.dev',1)[1].split('?',1)[0]
            target=ROOT/'dist'/path.lstrip('/') if path.startswith('/assets/') else ROOT/'dist/index.html'
            route.fulfill(path=str(target))
        if not os.environ.get('QA_LIVE'):
            page.route('https://power-log-command.pages.dev/**',candidate)
        page.goto('https://power-log-command.pages.dev/')
        page.fill('input[name="username"]',f['username']);page.fill('#login-password',f['password'])
        page.click('button[type=submit]')
        page.locator('#start-command-mode').wait_for(timeout=30000)
        assert f['name'].upper() in page.locator('body').inner_text().upper()
        report['checks'].append('Login and isolated QA dashboard loaded')
        # Command Mode failure is deliberately injected; successful uploads below are real.
        page.click('#start-command-mode')
        page.fill('#command-mode-manual-input','42')
        page.click('#command-mode-manual-form button[type=submit]')
        page.locator('label[for="command-mode-group-photo"]').wait_for()
        assert page.locator('#command-mode-upload').count()==0
        failure='**/api/inspections/group-photo'
        page.route(failure,lambda route:route.fulfill(status=503,content_type='application/json',body='{"error":"QA simulated storage failure"}'))
        page.click('label[for="command-mode-group-photo"]')
        assert page.locator('[data-library]').count()==0
        page.locator('[data-shutter]:enabled').wait_for();page.click('[data-shutter]')
        page.locator('.photo-feedback--error').wait_for()
        assert page.locator('.photo-feedback--success').count()==0
        page.screenshot(path=str(OUT/'error.png'))
        page.unroute(failure)
        page.click('.photo-feedback button')
        report['checks'].append('Injected upload failure shows animated red error, no false success; live-only camera has no library option')
        page.click('label[for="command-mode-group-photo"]')
        page.locator('[data-shutter]:enabled').wait_for()
        before=datetime.datetime.now(datetime.timezone.utc)
        with page.expect_response(lambda r:'/api/inspections/group-photo' in r.url,timeout=90000) as pending:
            page.click('[data-shutter]')
        r=pending.value; assert r.status==200,(r.status,r.text())
        data=r.json(); assert data['photoKey'].startswith('https://'),data
        assert data['latitude']==43.65 and data['longitude']==-79.38,data
        captured=datetime.datetime.fromisoformat(data['capturedAt'].replace('Z','+00:00'))
        assert abs((captured-before).total_seconds())<10,data
        page.locator('.photo-feedback--success').wait_for()
        report['checks'].append('Command Mode live capture saved to GHL; shutter timestamp and simulated GPS verified in response')
        page.locator('.machine-photo--done').wait_for()
        assert 'location tagged' in page.locator('.machine-photo--done').inner_text()
        page.screenshot(path=str(OUT/'success.png'),full_page=True)
        report['checks'].append('Regular checklist turns green immediately after Command Mode, without reload')
        # Real in-page camera capture, real API/GHL. No OS picker is used.
        page.locator('label[for^="machine-photo-"]').click()
        page.locator('[data-shutter]:enabled').wait_for(timeout=15000)
        page.screenshot(path=str(OUT/'camera.png'))
        with page.expect_response(lambda r:'/api/inspections/group-photo' in r.url,timeout=90000) as pending:
            page.locator('[data-shutter]').click()
        r=pending.value; assert r.status==200,(r.status,r.text())
        assert r.json()['photoKey'].startswith('https://')
        report['checks'].append('In-page camera capture using local image: HTTP 200, GHL URL returned')
        page.locator('.machine-photo--done').wait_for()
        # Exercise the exact section-photo path shown in the screenshot.
        page.locator('label[for^="photo-"]').first.click()
        page.locator('[data-shutter]:enabled').wait_for()
        with page.expect_response(lambda r:'/api/inspections/photo' in r.url,timeout=120000) as pending:
            page.locator('[data-shutter]').click()
        r=pending.value; assert r.status==200,(r.status,r.text())
        assert isinstance(r.json()['results'],list)
        report['checks'].append('AI section-photo in-page camera: HTTP 200 and structured readings response')
        page.click('#open-photo-library')
        page.locator('.photo-library__thumb img').first.wait_for(timeout=30000)
        page.locator('.photo-library__thumb img').first.scroll_into_view_if_needed()
        for img in page.locator('.photo-library__thumb img').all():
            img.scroll_into_view_if_needed()
        page.wait_for_function('Array.from(document.querySelectorAll(".photo-library__thumb img")).every(i=>i.complete&&i.naturalWidth>0)')
        page.screenshot(path=str(OUT/'library.png'),full_page=True)
        report['checks'].append('All photo library thumbnails decode successfully from GHL')
        rows=json.loads(fixture('inspect',f['buildingId']))
        assert len(rows)>=3 and all(r['backend']=='ghl' for r in rows),rows
        report['checks'].append(f'{len(rows)} photo index records confirmed as GHL-backed')
        metadata=json.loads(fixture('metadata',f['buildingId']))
        assert len(metadata)==1 and metadata[0]['latitude']==43.65 and metadata[0]['longitude']==-79.38,metadata
        assert metadata[0]['captured_at'],metadata
        report['checks'].append('Timestamp and coordinates verified in persisted group_photos database row')
        page.reload();page.locator('.machine-photo--done').wait_for(timeout=30000)
        report['checks'].append('Proof photo remains recorded after page reload')
        if os.environ.get('QA_CLEAR'):
            page.click('#start-command-mode');page.click('#command-mode-clear-all')
            page.click('#cancel-clear-all')
            page.click('#command-mode-exit');page.locator('.machine-photo--done').wait_for()
            page.click('#start-command-mode');page.click('#command-mode-clear-all')
            page.click('#confirm-clear-all')
            page.wait_for_function('!document.querySelector("#clear-all-modal")')
            assert page.input_value('#command-mode-manual-input')==''
            page.click('#command-mode-exit')
            page.locator('.machine-photo--required').wait_for()
            page.reload();page.locator('.machine-photo--required').wait_for()
            assert page.locator('.machine-photo--done').count()==0
            assert json.loads(fixture('metadata',f['buildingId']))==[]
            assert json.loads(fixture('inspect',f['buildingId']))==[]
            page.click('#open-photo-library')
            assert page.locator('.photo-library__thumb img').count()==0
            report['checks'].append('Clear-all Cancel preserves proof; Confirm clears readings, proof metadata and photo library, including after reload')
        assert not errors,errors
        browser.close()
        report['passed']=True
finally:
    print(json.dumps(report,indent=2),flush=True)
    print(fixture('disable',f['buildingId']),flush=True)
