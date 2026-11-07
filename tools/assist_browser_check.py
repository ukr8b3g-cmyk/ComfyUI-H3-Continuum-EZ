"""Production HTML/JS + real CPU assist preparation; Core inference is mocked.
This does not certify live ComfyUI, Windows, H3 or P-H3 GPU inference.
"""
from __future__ import annotations
import base64,copy,hashlib,importlib.util,json,mimetypes,os,re,shutil,sys,tempfile,traceback
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('h3ezstudio',ROOT/'__init__.py',submodule_search_locations=[str(ROOT)])
m=importlib.util.module_from_spec(spec);sys.modules['h3ezstudio']=m;spec.loader.exec_module(m)
from h3ezstudio.assist_api import prepare_request,adopt_request,preflight_request,DEFAULT_MODEL
from h3ezstudio.plan import default_plan
OUT=Path(os.environ.get('H3EZ_TEST_OUTPUT',str(ROOT/'validation/browser')));OUT.mkdir(parents=True,exist_ok=True)

def production_bundle():
    """Bundle static production modules into isolated scopes for an offline DOM fixture.

    Only import/export syntax is adapted; production function bodies remain unchanged.
    No browser network access or live ComfyUI is used in this test.
    """
    ordered=['i18n.js','media_labels.js','ui_help.js','prompting.js','assist_context.js','enhancer.js','story_tools.js','state.js',
             'assist.js','assist_panel.js','story_panel.js','studio.js']
    chunks=['window.__ezModules=Object.create(null);']
    hashes={}
    for name in ordered:
        raw=(ROOT/'web'/name).read_text(encoding='utf-8')
        hashes['web/'+name]=hashlib.sha256((ROOT/'web'/name).read_bytes()).hexdigest()
        exported=re.findall(r'^export (?:async )?(?:function|class|const|let)\s+(\w+)',raw,re.M)
        # A const declaration can export several comma-separated constants.
        if name=='state.js': exported.append('MAX_TIMELINE_SECONDS')
        source=re.sub(r"^import\s*\{([^}]+)\}\s*from\s*['\"]\./([^'\"]+)['\"];?\s*$",
            lambda m:'const {'+m.group(1)+'}=window.__ezModules['+json.dumps(m.group(2))+'];',raw,flags=re.M)
        source=re.sub(r'^export\s+','',source,flags=re.M)
        source=source.replace('import.meta.url',json.dumps('http://fixture.invalid/web/'+name))
        chunks.append('window.__ezModules['+json.dumps(name)+']=(()=>{\n'+source+'\nreturn {'+','.join(dict.fromkeys(exported))+'};})();')
    (OUT/'source_bundle.json').write_text(json.dumps({'sha256':hashes,'adaptations':['static imports/exports bound in isolated module scopes','import.meta.url assigned fixture URL','CSS and asset pixels embedded; no external navigation']},indent=2)+'\n')
    return '\n'.join(chunks)

def main():
    checks=[];errors=[];calls=[];jobs={};counter=0;fixture_delay=False
    with tempfile.TemporaryDirectory() as folder:
        input_root=Path(folder)
        shutil.copyfile(ROOT/'tests/assets/scene-a.png',input_root/'scene-a.png')
        shutil.copyfile(ROOT/'tests/assets/scene-a.png',input_root/'scene-b.png')
        p=default_plan();p['global_prompt']='同じ女性、赤いコート。';p['shots'][0]['prompt']='静かに歩く。'
        p['assets']=[dict(id='image-a',kind='image',label='scene-a.png',file=dict(name='scene-a.png',subfolder='',type='input'))]
        p['reference_slots'][0]='image-a';p['global_refs']=[1]
        p['assets'].append(dict(id='image-b',kind='image',label='scene-b.png',file=dict(name='scene-b.png',subfolder='',type='input')))
        p['reference_slots'][1]='image-b';p['global_refs']=[1,2]
        p['resolution']={'source':'studio','aspect':'2:3','megapixels':.5}
        initial=copy.deepcopy(p)
        queue={'queue_running':[], 'queue_pending':[[0,'unrelated-video',{'unrelated':{'class_type':'H3ContinuumEZEngine'}}]]}
        def request(path,options):
            nonlocal counter
            body=json.loads(options.get('body','{}'));calls.append({'path':path,'body':body})
            try:
                if path.endswith('/capabilities'):data={'models':[DEFAULT_MODEL],'missing_nodes':[]}
                elif path.endswith('/prepare'):data=prepare_request(body,input_root,[DEFAULT_MODEL],'fixture-model-no-GPU')
                elif path.endswith('/adopt'):data=adopt_request(body,input_root)
                elif path.endswith('/preflight'):data=preflight_request(body,input_root)
                elif path=='/prompt':
                    graph=body['prompt'];assert not any(n['class_type']=='H3ContinuumEZEngine'for n in graph.values())
                    output=next(k for k,v in graph.items()if v['class_type']=='PreviewAny')
                    counter+=1;pid=f'fixture-ai-{counter}';jobs[pid]={'output':output,'graph':graph}
                    queue['queue_pending'].append([counter,pid,graph]);data={'prompt_id':pid}
                elif path=='/queue'and options.get('method')=='POST':
                    assert 'unrelated-video'not in body['delete'];queue['queue_pending']=[q for q in queue['queue_pending']if q[1]not in body['delete']];data={}
                elif path=='/queue':data=queue
                elif path.startswith('/history/'):
                    pid=unquote(path.split('/history/')[1]);job=jobs.get(pid)
                    if fixture_delay or not job:data={}
                    else:
                        queue['queue_pending']=[q for q in queue['queue_pending']if q[1]!=pid]
                        data={pid:{'outputs':{job['output']:{'text':['女性は赤いコートを着たまま、ゆっくり静かに歩き続ける。']}},'status':{'completed':True}}}
                elif path.startswith('/history?'):data={}
                else:raise ValueError('Unexpected route '+path)
                return {'status':200,'data':data}
            except Exception as error:return {'status':400,'data':{'error':str(error)}}
        html='''<!doctype html><meta charset="utf-8"><title>EZ AI integration fixture</title><body><script type="module">
import {openStudio} from '/web/studio.js';
window.saved=PLAN;
window.queueCount=0;
window.fakeAPI={clientId:'fixture-client',fetchApi:async(path,options={})=>{const result=await window.hostRequest(path,options);return new Response(JSON.stringify(result.data),{status:result.status,headers:{'Content-Type':'application/json'}});}};
window.openFixture=(locale='ja')=>{window.editor=openStudio({value:JSON.stringify(window.saved),locale,
 mediaUrl:a=>'/tests/assets/'+a.file.name,upload:async()=>{throw new Error('fixture upload failure');},
 onApply:async value=>{window.saved=structuredClone(value);},onQueue:async()=>{window.queueCount++;},
 assistApi:window.fakeAPI,getCanvasModel:()=> 'p-h3-image_prompt_upsampler_w4a8.safetensors',assistIdentity:()=>({workflow:'fixture',node:'7'})});};
window.openFixture();window.ready=true;
</script>'''.replace('PLAN',json.dumps(p,ensure_ascii=False))
        def route_handler(route):
            path=unquote(urlsplit(route.request.url).path)
            if path=='/':route.fulfill(status=200,body=html,content_type='text/html');return
            file=(ROOT/path.lstrip('/')).resolve()
            if file.is_relative_to(ROOT)and file.is_file():route.fulfill(status=200,body=file.read_bytes(),content_type=mimetypes.guess_type(str(file))[0]or'application/octet-stream')
            else:route.fulfill(status=404,body='not found')
        try:
            with sync_playwright()as pw:
                browser=pw.chromium.launch(**({'executable_path':os.environ['H3EZ_TEST_BROWSER']} if os.environ.get('H3EZ_TEST_BROWSER') else {}),headless=True)
                page=browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1)
                page.expose_function('hostRequest',request)
                page.set_default_timeout(6000)
                page.on('pageerror',lambda error:(errors.append(str(error)),print('PAGE ERROR:',error,flush=True)))
                page.set_content('<meta charset="utf-8"><link data-h3ez-style="1"><style>'+(ROOT/'web/studio.css').read_text()+'</style>')
                data_uri='data:image/png;base64,'+base64.b64encode((input_root/'scene-a.png').read_bytes()).decode()
                page.evaluate('(uri)=>window.fixtureImage=uri',data_uri)
                init=html.split('<script type="module">')[1].split('</script>')[0]
                init=init.replace("import {openStudio} from '/web/studio.js';", "const {openStudio}=window.__ezModules['studio.js'];")
                init=init.replace("mediaUrl:a=>'/tests/assets/'+a.file.name", "mediaUrl:a=>window.fixtureImage")
                page.add_script_tag(content=production_bundle()+'\n;(()=>{'+init+'})();')
                page.wait_for_function('window.ready===true')
                checks.append('Production Studio opens with current timeline and image reference')
                assert page.locator('.ez-enhancer-toggle,.ez-assist-panel').count()==0
                assert not calls
                checks.append('No enable switch or accordion; opening starts no AI work')
                assert page.locator('.ez-ai-settings,.ez-story-panel').count()==0
                assert page.locator('.ez-ai-toolbar select').count()==0
                assert page.locator('.ez-ai-context').inner_text()=='参照 2枚'
                page.get_by_role('button',name='AI生成',exact=True).click()
                candidate=page.get_by_label('AI文：ショットプロンプト',exact=True)
                candidate.wait_for(state='visible')
                graph=jobs['fixture-ai-1']['graph'];gen=next(n['inputs']for n in graph.values()if n['class_type']=='TextGenerateV2')
                context=json.loads(gen['prompt'])
                assert 'images.image1'in gen and 'images.image2'in gen
                assert context['output_frame']['aspect']=='2:3' and context['shot_duration']['requested_seconds']==5
                assert initial['global_prompt']not in gen['prompt']
                checks.append('AI click automatically sends two images, duration and aspect without common prose')
                assert page.evaluate('window.editor.getDraft().shots[0].prompt')==initial['shots'][0]['prompt']
                checks.append('Generate uses the AI draft while retaining the original')
                candidate.fill('女性はゆっくり歩き、立ち止まる。')
                page.get_by_role('button',name='ノード反映',exact=True).click()
                page.wait_for_function("window.saved.prompt_enhancer.texts[0].text==='女性はゆっくり歩き、立ち止まる。'")
                page.get_by_role('button',name='原文',exact=True).click()
                page.wait_for_function('window.editor.getDraft().prompt_enhancer.texts[0].inactive')
                page.get_by_role('button',name='AI文',exact=True).click()
                page.wait_for_function('window.editor.getDraft().prompt_enhancer.texts[0].inactive===false')
                assert counter==1
                checks.append('Original / AI Text select the source without rerunning inference')
                page.get_by_role('button',name='ノード反映',exact=True).click()
                page.wait_for_function('window.saved.schema===2')
                saved=page.evaluate('window.saved')
                page.evaluate('window.editor.close();window.openFixture();')
                assert page.get_by_label('AI文：ショットプロンプト',exact=True).input_value()==saved['prompt_enhancer']['texts'][0]['text']
                checks.append('Apply and reopen retain edited AI text and original')
                page.get_by_role('button',name='原文',exact=True).click()
                page.get_by_label('ショットプロンプト',exact=True).fill('女性は座る。')
                page.wait_for_function("document.querySelector('.ez-ai-state').textContent.includes('再生成')")
                assert page.evaluate('window.editor.getDraft().prompt_enhancer.texts[0].text')==saved['prompt_enhancer']['texts'][0]['text']
                checks.append('Source edits mark saved AI text stale without deleting it')
                page.get_by_role('button',name='入力確認',exact=True).click()
                page.wait_for_function("document.querySelector('.ez-status').textContent.includes('入力確認完了')")
                page.get_by_role('button',name='動画書き出し',exact=True).click()
                page.wait_for_function('window.queueCount===1');assert counter==1
                checks.append('Video queue does not rerun AI')
                page.screenshot(path=str(OUT/'studio-ja.png'),full_page=True)
                page.evaluate('window.editor.close();window.openFixture("en");')
                assert page.get_by_role('button',name='Generate AI',exact=True).is_visible()
                fixture_delay=True
                page.get_by_role('button',name='Generate AI',exact=True).click()
                page.wait_for_function("['待機中','生成中','Queued','Generating'].includes(document.querySelector('.ez-ai-state').textContent)")
                page.get_by_role('button',name='Stop',exact=True).click()
                page.wait_for_timeout(1100)
                assert any(q[1]=='unrelated-video'for q in queue['queue_pending'])
                assert not any(q[1].startswith('fixture-ai-')for q in queue['queue_pending'])
                assert not any('interrupt'in x['path']for x in calls)
                checks.append('Cancel removes only the owned pending AI job')
                page.screenshot(path=str(OUT/'studio-en.png'),full_page=True)
                assert not errors,errors
                checks.append('Japanese and English production UI: no uncaught browser errors')
                browser.close()
        except Exception:
            (OUT/'failure.txt').write_text(traceback.format_exc(),encoding='utf-8')
            raise
        finally:
            (OUT/'results.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'errors':errors,'model_inference':'mocked; not GPU tested','cpu_api':'actual prepare/adopt/preflight','api_call_count':len(calls)},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'passed':len(checks),'errors':errors},ensure_ascii=False))
if __name__=='__main__':main()
