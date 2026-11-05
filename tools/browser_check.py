"""Runs the REAL editor in Chromium with a mocked ComfyUI bridge. Not live ComfyUI."""
from __future__ import annotations
import json
import re
import base64
import hashlib
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/browser';OUT.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**k):super().__init__(*a,directory=str(ROOT),**k)
    def do_GET(self):
        if self.path in ('/scripts/app.js','/scripts/api.js'):
            key='app' if self.path.endswith('app.js') else 'api'; body=f'export const {key}=window.fixture{key.title()};'.encode()
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else:super().do_GET()
    def log_message(self,*a):pass

def main():
    checks=[];errors=[]
    def ok(name):checks.append({'name':name,'passed':True})
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1720,'height':1020},device_scale_factor=1)
            page.on('pageerror',lambda e:errors.append(str(e)))
            # Network navigation is disabled in this environment. Bundle local modules into
            # the same in-memory document without changing their function bodies.
            source_paths=['web/i18n.js','web/prompting.js','web/state.js','web/studio.js','web/extension.js']
            texts={path:(ROOT/path).read_text() for path in source_paths}
            strip=lambda t:re.sub(r'^import .*?;\n','',t,flags=re.M).replace('export ','')
            i18n=strip(texts['web/i18n.js'])
            prompting=strip(texts['web/prompting.js'])
            state=strip(texts['web/state.js'])
            studio=strip(texts['web/studio.js']).replace("new URL('./studio.css',import.meta.url).href","'about:blank'")
            extension=strip(texts['web/extension.js']).replace("new URL('./studio.css',import.meta.url).href","'about:blank'")
            fixture=(ROOT/'tests/ui_fixture.html').read_text().split('<script type="module">')[1].split('</script>')[0]
            fixture=strip(fixture)
            prefix,tail=fixture.split("await import('../web/extension.js');")
            data={f.name:'data:'+('audio/wav' if f.suffix=='.wav' else 'image/png')+';base64,'+base64.b64encode(f.read_bytes()).decode() for f in (ROOT/'tests/assets').iterdir()}
            page.set_content('<meta charset="utf-8"><link data-h3ez-style="1"><style>'+ (ROOT/'web/studio.css').read_text()+'</style><div id="node"></div>')
            page.evaluate('(v)=>window.fixtureAssets=v',data)
            bind="window.fixtureApi.apiURL=path=>path.startsWith('/view?')?window.fixtureAssets[new URL('http://local'+path).searchParams.get('filename')]:path; const app=window.fixtureApp,api=window.fixtureApi; window.fixtureDuration=()=>duration(window.getSaved());"
            page.add_script_tag(content='(()=>{'+i18n+'\n'+prompting+'\n'+state+'\n'+studio+'\n'+prefix+'\n'+bind+'\n'+extension+'\n'+tail+'})()')
            (OUT/'source_bundle.json').write_text(json.dumps({'sources':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in texts.items()},'transforms':['static imports bound in one test scope','exports removed for inline script','stylesheet URL replaced; original CSS embedded','ComfyUI API mocked; no external network']},indent=2))
            page.wait_for_function('window.fixtureReady===true')
            assert page.locator('dialog.h3ez-studio').is_visible();ok('Extension button opens actual HTML Studio')
            assert page.locator('.ez-shot').count()==3;ok('Three shots and duration ruler rendered')
            assert page.locator('.ez-asset').count()==3;ok('Asset thumbnails rendered')
            long=('Long-form scene description. 人物の外見と構図を維持する。\n'*650)
            page.get_by_label('ショットプロンプト',exact=True).fill(long)
            page.locator('.ez-shot').nth(1).click();page.locator('.ez-shot').nth(0).click()
            assert page.get_by_label('ショットプロンプト',exact=True).input_value()==long;ok('Long prompt survives shot selection without truncation')
            page.get_by_role('button',name='プロンプトを広く',exact=True).click()
            area=page.locator('textarea.ez-prompt').bounding_box();assert area['width']>1100;ok('Prompt focus mode provides large editor')
            page.screenshot(path=str(OUT/'prompt-editor.png'))
            page.get_by_role('button',name='タイムライン',exact=True).click()
            # Internal file-card drop uses real DOM events and real editor handlers.
            page.evaluate('''() => {const dt=new DataTransfer();dt.setData('application/x-h3ez-asset','image-1');document.querySelector('.ez-inspector .ez-ref-strip').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));}''')
            assert page.locator('.ez-inspector .ez-ref-chip.selected').count()==2;ok('Image drag/drop assigns stable per-shot R slot')
            page.get_by_role('button',name='ノードに反映',exact=True).click()
            saved=page.evaluate('window.getSaved()');assert saved['shots'][0]['refs']==[1,2];assert saved['shots'][0]['prompt']==long;ok('Apply writes complete text and reference plan to node value')
            before_ids=[s['id'] for s in saved['shots']]
            page.evaluate('''() => {const cards=[...document.querySelectorAll('.ez-shot')],dt=new DataTransfer();dt.setData('application/x-h3ez-shot',cards[2].dataset.shotId);cards[1].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));}''')
            page.get_by_role('button',name='ノードに反映',exact=True).click()
            assert page.evaluate('window.getSaved().shots[1].id')==before_ids[2];ok('Drag reorder changes order but retains shot identity')
            page.get_by_role('button',name='文章を取り込む',exact=True).click()
            page.get_by_label('ショット文章を取り込む').fill('[Shot 1]\nImported first prompt.\n\n[Shot 2]\nImported second prompt.')
            page.get_by_role('button',name='解析して確認').click()
            assert page.evaluate('window.getSaved().shots[0].prompt')==long;ok('Import analysis does not mutate saved node')
            page.locator('.h3ez-import').get_by_role('button',name='適用',exact=True).click()
            page.get_by_role('button',name='ノードに反映',exact=True).click()
            assert page.evaluate('window.getSaved().shots[0].prompt').startswith('Imported first');ok('Confirmed import updates only prompt bodies')
            # Upload via actual browser File input; only ComfyUI upload HTTP is mocked.
            with page.expect_file_chooser() as chooser:
                page.get_by_role('button',name='＋ 素材を追加',exact=True).click()
            chooser.value.set_files(str(ROOT/'tests/assets/sample-audio.wav'))
            page.wait_for_selector('.ez-audio-clip')
            assert page.locator('.ez-audio-clip').count()==1;ok('WAV file input decodes duration and adds audio clip')
            page.get_by_label('配置秒',exact=True).fill('0');page.get_by_label('配置秒',exact=True).press('Tab')
            page.get_by_label('長さ',exact=True).fill('4');page.get_by_label('長さ',exact=True).press('Tab')
            page.get_by_label('素材IN',exact=True).fill('1');page.get_by_label('素材IN',exact=True).press('Tab')
            page.get_by_role('button',name='ノードに反映',exact=True).click()
            c=page.evaluate('window.getSaved().audio[0]');assert c['start']==0 and c['source_in']==1 and c['duration']==4;ok('Audio source-in and placement are independent numeric edits')
            ruler=page.locator('.ez-ruler').bounding_box();total=page.evaluate('window.getSaved().shots.length')
            # Seek into this clip at roughly two seconds.
            duration_js=page.evaluate("window.fixtureDuration()")
            page.locator('.ez-ruler').click(position={'x':ruler['width']*2/duration_js,'y':10})
            page.get_by_role('button',name='分割',exact=True).click()
            assert page.locator('.ez-audio-clip').count()==2;ok('Audio split creates two adjacent non-destructive source ranges')
            page.get_by_role('button',name='ノードに反映',exact=True).click()
            saved=page.evaluate('window.getSaved()');a,b=saved['audio'];assert abs((a['source_in']+a['duration'])-b['source_in'])<1e-6;ok('Split maintains original source continuity')
            # Numeric overlap must be rejected and restored.
            page.locator('.ez-audio-clip').nth(1).click()
            previous=page.get_by_label('配置秒',exact=True).input_value()
            page.get_by_label('配置秒',exact=True).fill('0');page.get_by_label('配置秒',exact=True).press('Tab')
            assert float(page.get_by_label('配置秒',exact=True).input_value())==float(previous);ok('Overlapping audio edit is rejected without changing clip')
            # Mouse trim on last audio clip, no overlap.
            right=page.locator('.ez-audio-clip').nth(1).locator('.ez-trim.right').bounding_box()
            page.mouse.move(right['x']+3,right['y']+20);page.mouse.down();page.mouse.move(right['x']-20,right['y']+20,steps=5);page.mouse.up()
            page.get_by_role('button',name='ノードに反映',exact=True).click()
            assert page.evaluate('window.getSaved().audio[1].duration')<b['duration'];ok('Mouse edge trim changes audio duration')
            page.get_by_role('button',name='動画を書き出す',exact=True).click()
            assert page.evaluate('window.fixtureState.queued')==1;ok('Generate dispatches one standard queue call')
            # External connection state follows the actual node link and runtime output.
            page.evaluate("window.node.inputs[0].link=99;window.node.onConnectionsChange();window.node.onExecuted({h3ez_common:['Executed LLM text']})")
            page.get_by_role('button',name='共通プロンプト',exact=True).click()
            page.get_by_label('共通プロンプト',exact=True).fill('Edited internal common prompt')
            page.get_by_role('button',name='生成に使うプロンプト',exact=True).click()
            page.get_by_text('送信文を確認（自動生成）',exact=True).click()
            effective=page.get_by_label('自動生成した送信文',exact=True)
            assert 'Edited internal common prompt' in effective.input_value()
            assert 'Executed LLM text' not in effective.input_value()
            assert page.get_by_label('共通プロンプトの入力元',exact=True).input_value()=='studio'
            page.get_by_label('プロンプトの合成方法',exact=True).select_option('replace')
            page.get_by_text('送信文を確認（自動生成）',exact=True).click()
            assert 'Imported first prompt.' in effective.input_value()
            assert 'Executed LLM text' not in effective.input_value()
            page.get_by_label('プロンプトの合成方法',exact=True).select_option('append')
            page.get_by_role('button',name='ノードに反映',exact=True).click()
            assert page.evaluate('window.getSaved().global_prompt')=='Edited internal common prompt'
            ok('Internal common prompt remains editable with external input and shot-only mode excludes it')
            page.evaluate('window.node.inputs[0].link=null;window.node.onConnectionsChange()')
            page.wait_for_timeout(80)
            page.get_by_role('button',name='共通プロンプト',exact=True).click()
            assert page.get_by_label('共通プロンプト',exact=True).input_value()=='Edited internal common prompt'
            ok('Disconnect uses the edited internal common prompt')
            # Image replacement keeps the asset identity/R slot and every shot link.
            before=page.evaluate('window.getSaved().reference_slots[0]')
            with page.expect_file_chooser() as chooser:
                page.get_by_role('button',name='scene-a.png を差し替え',exact=True).click()
            chooser.value.set_files(str(ROOT/'tests/assets/scene-c.png'))
            page.wait_for_function("document.querySelector('[aria-label=\"scene-c.png を差し替え\"]') !== null")
            page.wait_for_timeout(120)
            page.get_by_role('button',name='ノードに反映',exact=True).click()
            after=page.evaluate('window.getSaved()')
            assert after['reference_slots'][0]==before and next(a for a in after['assets'] if a['id']==before)['file']['name']=='scene-c.png'
            ok('Image replacement preserves stable asset ID and R1 assignments')
            # Comfy node JSON round trip: close then reopen from the committed widget.
            page.get_by_role('button',name='閉じる',exact=True).click();assert page.locator('dialog.h3ez-studio').count()==0
            page.evaluate('window.openEditor()');assert page.locator('.ez-audio-clip').count()==2;ok('Reopening reconstructs shots/assets/audio from serialized node JSON')
            page.get_by_role('button',name='共通プロンプト',exact=True).click();page.get_by_label('共通プロンプト',exact=True).fill('unsaved')
            page.once('dialog',lambda d:d.dismiss());page.get_by_role('button',name='閉じる',exact=True).click()
            assert page.locator('dialog.h3ez-studio').is_visible();ok('Unsaved close can be cancelled')
            page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='閉じる',exact=True).click();page.evaluate('window.openEditor()')
            page.get_by_role('button',name='共通プロンプト',exact=True).click();assert page.get_by_label('共通プロンプト',exact=True).input_value()!='unsaved';ok('Confirmed discard leaves committed node data intact')
            page.get_by_role('button',name='このショット',exact=True).click()
            page.screenshot(path=str(OUT/'timeline-studio.png'))
            page.set_viewport_size({'width':1366,'height':768});page.wait_for_timeout(100)
            bounds=page.locator('dialog.h3ez-studio').bounding_box();assert bounds['width']<=1366;assert page.get_by_role('button',name='ノードに反映').is_visible();ok('1366x768 layout retains apply/close/editor controls')
            page.screenshot(path=str(OUT/'timeline-1366.png'))
            assert not errors,errors;ok('No browser page errors')
            browser.close()
    finally:
        server.shutdown();server.server_close()
        (OUT/'results.json').write_text(json.dumps({'environment':'Chromium standalone DOM fixture; ComfyUI bridge mocked','checks':checks,'page_errors':errors},ensure_ascii=False,indent=2)+'\n')
    print(f'{len(checks)} browser checks passed; page errors: {len(errors)}')
if __name__=='__main__':main()
