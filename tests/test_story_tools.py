import copy
import json
import pytest
from h3ezstudio.plan import default_plan,normalize_plan,execution_plan,compile_part_prompt,shot_geometry
from h3ezstudio.enhancer import dependency_payload,canonical,digest
from h3ezstudio.story_tools import action_positions

def plan():
    p=default_plan();p['schema']=2;p['shots'][0]['seconds']=20
    p['global_prompt']='同じ人物。';p['shots'][0]['prompt']='順序を守る。'
    return p

def test_actions_do_not_add_samples_or_change_duration():
    p=plan();before=execution_plan(p)
    p['shots'][0]['actions']=[dict(id=f'a{i}',kind='event',text=f'動作{i}',at=None,weight=1)for i in range(9)]
    p=normalize_plan(p)
    assert execution_plan(p)==before
    texts=[compile_part_prompt(p,x)[0]for x in before]
    for i in range(9):assert sum(x.count(f'動作{i}')for x in texts)==1

def test_state_carries_forward_without_restarting():
    p=plan();p['shots'][0]['actions']=[dict(id='walk',kind='state',text='WALK',at=0,weight=1)]
    p=normalize_plan(p);parts=execution_plan(p)
    assert 'seconds into the new action: WALK' in compile_part_prompt(p,parts[0])[0]
    assert 'Continue this ongoing action: WALK' in compile_part_prompt(p,parts[1])[0]
    assert 'seconds into the new action: WALK' not in compile_part_prompt(p,parts[1])[0]

def test_camera_and_roles_work_when_enhancer_off():
    p=plan();p['prompt_enhancer']={'enabled':False,'texts':[]};p['shots'][0]['camera']='static'
    p['assets']=[dict(id='a',kind='image',label='A',file=dict(name='a.png',type='input',subfolder=''))]
    p['reference_slots'][0]='a';p['global_refs']=[1]
    p['shots'][0]['reference_roles']=[dict(asset_id='a',role='outfit',description='Red coat only.')]
    p=normalize_plan(p);text=compile_part_prompt(p,execution_plan(p)[0])[0]
    assert 'Keep the camera stationary.' in text
    assert 'Use <Picture 1> as the outfit reference.' in text
    assert 'Red coat only.' in text

@pytest.mark.parametrize('edit',[
    {'camera':'unknown'}, {'actions':[dict(id='x',kind='bad',text='x')]},
    {'actions':[dict(id='x',kind='event',text='x',at=100)]},
    {'reference_roles':[dict(asset_id='missing',role='character')]},
    {'actions':[dict(id='x',kind='event',text='x',weight=0)]},
])
def test_story_invalid_data_rejected(edit):
    p=plan();p['shots'][0].update(edit)
    with pytest.raises(ValueError):normalize_plan(p)

def test_original_and_enhanced_fields_survive_unrelated_roundtrip():
    p=plan();p=normalize_plan(p);target=dict(field='prompt',shot_id=p['shots'][0]['id'])
    dep=dependency_payload(p,target)
    p['prompt_enhancer']={'enabled':True,'texts':[dict(target=target,text='強化した文章。',
        dependencies=dep,base_text_hash=digest(dep['text']),dependency_hash=digest(canonical(dep)),images=[])]}
    before=copy.deepcopy(p);restored=normalize_plan(json.dumps(p,ensure_ascii=False))
    assert restored==before
    off=copy.deepcopy(restored);off['prompt_enhancer']['enabled']=False
    a=compile_part_prompt(off,execution_plan(off)[0])[0]
    b=compile_part_prompt(restored,execution_plan(restored)[0])[0]
    assert '順序を守る。' in a and '強化した文章。' not in a
    assert '強化した文章。' in b and '順序を守る。' not in b
