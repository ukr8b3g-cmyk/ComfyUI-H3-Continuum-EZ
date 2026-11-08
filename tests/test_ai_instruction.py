import copy
import json
from pathlib import Path
import pytest
from h3ezstudio.assist_api import prepare_request, DEFAULT_MODEL
from h3ezstudio.enhancer import SYSTEM_PROMPT, VISUAL_CONTRACT, resolve_prompt_text
from h3ezstudio.plan import default_plan, normalize_plan
from h3ezstudio.prompt_queue import prepare_video_prompt

def fixture():
    p=default_plan();p.update(schema=2,prompt_source='studio',global_prompt='COMMON_BACKGROUND',
        resolution={'source':'studio','aspect':'16:9','megapixels':.3},
        prompt_enhancer={'enabled':True,'texts':[],'instruction':'Describe continuous motion. Preserve dialogue.'})
    p['shots'][0]['prompt']='SHOT_ACTION'
    return p

def prepare(p,tmp_path,**extra):
    target={'field':'prompt','shot_id':p['shots'][0]['id']}
    r=prepare_request({'plan':p,'target':target,'contract':VISUAL_CONTRACT,'video_context':True,**extra},tmp_path,[DEFAULT_MODEL])
    gen=next(n['inputs'] for n in r['graph'].values() if n['class_type']=='TextGenerateV2')
    return r,gen

def test_studio_external_default_priority_and_cache(tmp_path):
    p=fixture();before=copy.deepcopy(p)
    local,g=prepare(p,tmp_path);assert g['system_prompt']==p['prompt_enhancer']['instruction']
    external,g=prepare(p,tmp_path,ai_instruction='EXTERNAL_DIRECTIVE');assert g['system_prompt']=='EXTERNAL_DIRECTIVE'
    fallback,g=prepare(p,tmp_path,ai_instruction='  ');assert g['system_prompt']==SYSTEM_PROMPT
    assert len({r['cache_key'] for r in (local,external,fallback)})==3
    assert p==before and normalize_plan(json.dumps(p))==p
    p['prompt_enhancer']['enabled']=False
    assert resolve_prompt_text(p,{'field':'prompt','shot_id':p['shots'][0]['id']})==('SHOT_ACTION','off')

def test_common_context_is_read_only_and_not_mixed_into_selected_text(tmp_path):
    p=fixture();_,g=prepare(p,tmp_path);context=json.loads(g['prompt'])
    assert context['selected_text']=='SHOT_ACTION'
    assert context['common_context_do_not_repeat']=='COMMON_BACKGROUND'
    p['shots'][0]['prompt_mode']='replace'
    _,g=prepare(p,tmp_path);assert json.loads(g['prompt'])['common_context_do_not_repeat']==''
    _,g=prepare(p,tmp_path,target={'field':'global_prompt'})
    context=json.loads(g['prompt']);assert context['selected_text']=='COMMON_BACKGROUND'
    assert 'SHOT_ACTION' not in g['prompt'] and not context['common_context_do_not_repeat']

@pytest.mark.parametrize('bad',[None,False,123,'x'*8001,'null\0char'])
def test_instruction_validation(tmp_path,bad):
    p=fixture()
    with pytest.raises(ValueError):prepare(p,tmp_path,ai_instruction=bad)
    p['prompt_enhancer']['instruction']=bad
    with pytest.raises(ValueError):normalize_plan(p)

def test_studio_default_matches_backend():
    s=(Path(__file__).resolve().parents[1]/'web/default_instruction.js').read_text(encoding='utf-8')
    assert json.loads(s.split('export const DEFAULT_INSTRUCTION=',1)[1].strip().removesuffix(';'))==SYSTEM_PROMPT

def test_ai_instruction_never_becomes_a_video_dependency():
    request={'prompt':{'engine':{'class_type':'H3ContinuumEZEngine','inputs':{
        'clip':['main',0],'seed':123,'ai_instruction':['missing-text',0],'prompt_clip':['missing-ai',0]}}},
        'extra_data':{'extra_pnginfo':{'workflow':{'preserved':True}}}}
    before=copy.deepcopy(request);out=prepare_video_prompt(request)
    assert out['prompt']['engine']['inputs']=={'clip':['main',0],'seed':123}
    assert request==before and out['extra_data'] is request['extra_data']
