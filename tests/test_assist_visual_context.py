import copy
import json
import pytest
from PIL import Image
from h3ezstudio.plan import default_plan, normalize_plan, compile_part_prompt, execution_plan
from h3ezstudio.enhancer import VISUAL_CONTRACT, resolve_prompt_text, verified_plan
from h3ezstudio.assist_api import prepare_request, adopt_request, DEFAULT_MODEL, AI_TOTAL_PIXELS

TARGET = {'field':'prompt','shot_id':'shot-1'}

def fixture(tmp_path):
    p=default_plan();p.update(schema=2, global_prompt='COMMON_ONLY', resolution={'source':'studio','aspect':'2:3','megapixels':.5},
                             prompt_enhancer={'enabled':True,'texts':[]})
    p['shots'][0]['prompt']='SHOT_ONLY';p['shots'][0]['seconds']=5
    for i in range(11):
        name=f'image-{i}.png';Image.new('RGB',(600,900),(i*20,50,120)).save(tmp_path/name)
        p['assets'].append({'id':f'a{i}','kind':'image','label':name,'subject_name':f'Person {i}',
                            'file':{'name':name,'subfolder':'','type':'input'}})
    p['reference_slots']=[f'a{i}' for i in range(9)];p['global_refs']=[1,2]
    return p

def prepare(p,tmp_path,target=TARGET,**kwargs):
    return prepare_request({'plan':p,'target':target,'contract':VISUAL_CONTRACT,**kwargs},tmp_path,[DEFAULT_MODEL])

def context(result):
    gen=next(n['inputs'] for n in result['graph'].values() if n['class_type']=='TextGenerateV2')
    return gen,json.loads(gen['prompt'])

def adopt(p,r,tmp_path):
    e=adopt_request({'plan':p,'target':r['receipt']['target'],'receipt':r['receipt'],'candidate':'AI_TEXT'},tmp_path)['entry']
    p['prompt_enhancer']['texts']=[e]
    return normalize_plan(p)

def test_automatic_multi_image_order_roles_duration_and_portrait(tmp_path):
    p=fixture(tmp_path);p['shots'][0].update(first_image='a0',last_image='a9',refs=[2,1])
    before=copy.deepcopy(p);r=prepare(p,tmp_path);gen,c=context(r)
    assert p==before
    assert [x['id'] for x in r['receipt']['images']]==['a0','a9','a1']
    assert c['visual_inputs']==[{'image':i+1,'asset_id':aid} for i,aid in enumerate(['a0','a9','a1'])]
    assert c['assigned_image_roles'][0]['first']=='a0' and c['assigned_image_roles'][0]['last']=='a9'
    assert c['shot_duration']=={'requested_seconds':5,'rendered_seconds':124/24}
    assert c['output_frame']=={'source':'studio','aspect':'2:3','width':576,'height':864}
    assert 'COMMON_ONLY' not in gen['prompt'] and c['selected_text']=='SHOT_ONLY'
    assert {k for k in gen if k.startswith('images.')}=={'images.image1','images.image2','images.image3'}
    assert len({gen[f'images.image{i}'][0] for i in range(1,4)})==3
    p=adopt(p,r,tmp_path)
    assert resolve_prompt_text(p,TARGET)==('AI_TEXT','enhanced')
    assert 'COMMON_ONLY\n\nAI_TEXT' in compile_part_prompt(p,execution_plan(p)[0])[0]

def test_common_does_not_receive_shots_or_individual_images(tmp_path):
    p=fixture(tmp_path);p['shots'][0].update(refs=[3],first_image='a9',last_image='a10',camera='follow')
    r=prepare(p,tmp_path,{'field':'global_prompt'});gen,c=context(r)
    assert 'SHOT_ONLY' not in gen['prompt'] and 'follow' not in gen['prompt']
    assert c['assigned_image_roles']==[] and 'shot_duration' not in c
    assert [x['id'] for x in r['receipt']['images']]==['a0','a1']
    assert c['selected_text']=='COMMON_ONLY'
    p=adopt(p,r,tmp_path);p['shots'][0]['seconds']=20;p['shots'][0]['prompt']='CHANGED_SHOT'
    assert resolve_prompt_text(p,{'field':'global_prompt'})==('AI_TEXT','enhanced')

def test_explicit_empty_refs_do_not_inherit_common_images(tmp_path):
    p=fixture(tmp_path);p['shots'][0]['refs']=[]
    r=prepare(p,tmp_path);gen,c=context(r)
    assert not r['receipt']['images'] and not any(k.startswith('images.') for k in gen)

def test_maximum_references_are_all_sent_with_total_pixel_budget(tmp_path):
    p=fixture(tmp_path);p['global_refs']=list(range(1,10));p['shots'][0].update(first_image='a9',last_image='a10')
    r=prepare(p,tmp_path);assert len(r['receipt']['images'])==11
    pixels=0
    for node in r['graph'].values():
        if node['class_type']=='LoadImage':
            with Image.open(tmp_path/node['inputs']['image']) as image:pixels+=image.width*image.height
    assert pixels<=AI_TOTAL_PIXELS
    assert len(normalize_plan(adopt(p,r,tmp_path))['prompt_enhancer']['texts'][0]['images'])==11

@pytest.mark.parametrize('change',['seconds','aspect','reference','last','pixels'])
def test_changed_visual_condition_rejects_late_ai_and_preserves_original(tmp_path,change):
    p=fixture(tmp_path);r=prepare(p,tmp_path)
    if change=='seconds':p['shots'][0]['seconds']=8
    if change=='aspect':p['resolution']['aspect']='16:9'
    if change=='reference':p['shots'][0]['refs']=[3]
    if change=='last':p['shots'][0]['last_image']='a9'
    if change=='pixels':Image.new('RGB',(20,20),'blue').save(tmp_path/'image-1.png')
    with pytest.raises(ValueError):adopt(p,r,tmp_path)
    assert p['shots'][0]['prompt']=='SHOT_ONLY' and p['global_prompt']=='COMMON_ONLY'

def test_engine_size_receipt_is_checked_again_at_video_execution(tmp_path):
    p=fixture(tmp_path);p['resolution']['source']='engine'
    r=prepare(p,tmp_path,output_size={'width':736,'height':416});_,c=context(r)
    assert c['output_frame']=={'source':'engine','aspect':'23:13','width':736,'height':416}
    p=adopt(p,r,tmp_path)
    same,notes=verified_plan(p,tmp_path,{'width':736,'height':416});assert not notes
    assert resolve_prompt_text(same,TARGET)==('AI_TEXT','enhanced')
    changed,notes=verified_plan(p,tmp_path,{'width':512,'height':768});assert notes
    assert resolve_prompt_text(changed,TARGET)[0]=='SHOT_ONLY'
    assert p['prompt_enhancer']['texts'][0]['text']=='AI_TEXT'

def test_missing_one_of_multiple_images_fails_before_queue_graph(tmp_path):
    p=fixture(tmp_path);(tmp_path/'image-1.png').unlink()
    with pytest.raises(ValueError):prepare(p,tmp_path)
    assert p['shots'][0]['prompt']=='SHOT_ONLY'


@pytest.mark.parametrize('target',[TARGET, {'field':'global_prompt'}])
def test_studio_size_change_retains_ai_selection_edit_restore_and_render(tmp_path,target):
    p=fixture(tmp_path);p=adopt(p,prepare(p,tmp_path,target),tmp_path)
    saved=copy.deepcopy(p['prompt_enhancer']['texts'][0])
    for aspect, mp in (('2:3',.3),('16:9',.4),('9:16',.6),('1:1',1)):
        p['resolution'].update(aspect=aspect, megapixels=mp)
        p=normalize_plan(json.dumps(p))
        assert resolve_prompt_text(p,target)==('AI_TEXT','enhanced')
        runtime,notes=verified_plan(p,tmp_path)
        assert not notes and 'AI_TEXT' in compile_part_prompt(runtime,execution_plan(runtime)[0])[0]
        assert p['prompt_enhancer']['texts'][0]==saved
    edited=adopt_request({'plan':p,'target':target,'receipt':saved,'candidate':'EDITED_AI'},tmp_path)['entry']
    p['prompt_enhancer']['texts']=[edited]
    assert resolve_prompt_text(p,target)==('EDITED_AI','enhanced')
    edited['inactive']=True
    assert resolve_prompt_text(p,target)[1]=='off'
    edited['inactive']=False
    assert resolve_prompt_text(p,target)==('EDITED_AI','enhanced')
    p['resolution']['source']='engine'
    assert resolve_prompt_text(p,target)[1]=='stale'
