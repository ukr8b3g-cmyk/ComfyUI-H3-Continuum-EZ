"""Build deterministic Python/JavaScript contract fixtures, no models or GPU."""
import copy,importlib.util,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('h3ezstudio',ROOT/'__init__.py',submodule_search_locations=[str(ROOT)])
m=importlib.util.module_from_spec(spec);sys.modules['h3ezstudio']=m;spec.loader.exec_module(m)
from h3ezstudio.plan import default_plan,normalize_plan,execution_plan,compile_part_prompt,shot_geometry
from h3ezstudio.enhancer import dependency_payload,canonical,digest,resolve_prompt_text,VISUAL_CONTRACT
out=[]
for scenario in ['legacy','off','on','stale','external','story','emoji','visual-shot','visual-common','visual-engine']:
 p=default_plan();p['global_prompt']='共通の人物。日本語を保持。';p['shots'][0]['prompt']='女性が静かに歩く。'
 if scenario=='emoji':p['shots'][0]['prompt']='雪と😀、 "quoted" \\ text\n行2'
 if scenario!='legacy':p['schema']=2;p['prompt_enhancer']={'enabled':False,'texts':[]}
 if scenario=='story':
  p['shots'][0]['seconds']=24;p['shots'][0]['camera']='follow'
  p['shots'][0]['actions']=[dict(id='a1',kind='state',text='歩き続ける。',at=0,weight=2),dict(id='a2',kind='event',text='振り返る。',at=None,weight=1)]
 external='外部の実効文章'if scenario=='external'else None
 if external:p['prompt_source']='external'
 contract=VISUAL_CONTRACT if scenario.startswith('visual-') else 'h3ez-assist-v1'
 size={'width':512,'height':768} if scenario=='visual-engine' else None
 if scenario.startswith('visual-'):
  p['resolution']={'source':'engine' if size else 'studio','aspect':'2:3','megapixels':.5}
  p['shots'][0]['seconds']=5.17
  p['assets']=[dict(id=f'image-{i}',kind='image',label=f'Image {i}',file=dict(name=f'{i}.png',subfolder='',type='input'))for i in (1,2)]
  p['reference_slots'][:2]=['image-1','image-2'];p['global_refs']=[1,2]
 p=normalize_plan(p);target={'field':'global_prompt'} if scenario=='visual-common' else {'field':'prompt','shot_id':p['shots'][0]['id']}
 if scenario in ('on','stale','external','emoji') or scenario.startswith('visual-'):
  dep=dependency_payload(p,target,external,contract,output_size=size)
  p['prompt_enhancer']['texts']=[dict(target=target,text='より具体的な動作。',dependencies=dep,base_text_hash=digest(dep['text']),dependency_hash=digest(canonical(dep)),images=[])]
  p['prompt_enhancer']['enabled']=True
 if scenario=='stale':p['shots'][0]['prompt']='今は座る。'
 parts=execution_plan(p)
 out.append(dict(scenario=scenario,plan=p,target=target,external=external,contract=contract,output_size=size,dependency=dependency_payload(p,target,external,contract,output_size=size),resolved=resolve_prompt_text(p,target,external),parts=parts,prompts=[compile_part_prompt(p,x,external)[0]for x in parts]))
path=ROOT/'tests/contracts/assist_parity.json';path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(path)
