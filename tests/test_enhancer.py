import copy
import hashlib
import json
from pathlib import Path
import pytest
from h3ezstudio.plan import default_plan,normalize_plan,compile_part_prompt,execution_plan,used_asset_ids
from h3ezstudio.enhancer import dependency_payload,canonical,digest,resolve_prompt_text,normalize_enhancer,validate_candidate,verified_plan

def plan():
    p=default_plan();p['schema']=2;p['global_prompt']='同じ女性。衣装を変えない。';p['shots'][0]['prompt']='静かに歩く。'
    p['prompt_enhancer']={'enabled':False,'texts':[]}
    return normalize_plan(p)

def add(p,target,text='静かにゆっくりと歩く。',external=None):
    dep=dependency_payload(p,target,external)
    e={'target':target,'text':text,'base_text_hash':digest(dep['text']),'dependency_hash':digest(canonical(dep)),'dependencies':dep,'images':[]}
    p['prompt_enhancer']['texts'].append(e)
    return e

TARGET={'field':'prompt','shot_id':'shot-1'}

def test_off_on_off_no_destruction():
    p=plan();add(p,TARGET);original=copy.deepcopy(p)
    assert resolve_prompt_text(p,TARGET)==('静かに歩く。','off')
    p['prompt_enhancer']['enabled']=True
    assert resolve_prompt_text(p,TARGET)==('静かにゆっくりと歩く。','enhanced')
    p['prompt_enhancer']['enabled']=False
    assert p==original

def test_source_edit_marks_stale():
    p=plan();add(p,TARGET);p['prompt_enhancer']['enabled']=True;p['shots'][0]['prompt']='座る。'
    assert resolve_prompt_text(p,TARGET)==('座る。','stale')

def test_common_edit_marks_shot_stale():
    p=plan();add(p,TARGET);p['prompt_enhancer']['enabled']=True
    p['shots'][0]['prompt_mode']='replace'
    assert resolve_prompt_text(p,TARGET)[1]=='enhanced'
    p['global_prompt']='別の場所。'
    assert resolve_prompt_text(p,TARGET)[1]=='stale'

def test_label_change_does_not_invalidate():
    p=plan();add(p,TARGET);p['prompt_enhancer']['enabled']=True;p['shots'][0]['label']='新しい名前'
    assert resolve_prompt_text(p,TARGET)[1]=='enhanced'

def test_external_actual_value():
    p=plan();p['prompt_source']='external';t={'field':'global_prompt'}
    add(p,t,'外部の強化文','actual value A');p['prompt_enhancer']['enabled']=True
    assert resolve_prompt_text(p,t,'actual value A')==('外部の強化文','enhanced')
    assert resolve_prompt_text(p,t,'actual value B')==('actual value B','stale')

def test_schema_roundtrip():
    p=plan();add(p,TARGET);p['prompt_enhancer']['enabled']=True
    assert normalize_plan(json.dumps(p,ensure_ascii=False))==p

def test_per_field_restore_survives_roundtrip_and_compilation(tmp_path):
    p=plan();shot=add(p,TARGET,'SHOT_AI');common=add(p,{'field':'global_prompt'},'COMMON_AI')
    p['prompt_enhancer']['enabled']=True;shot['inactive']=True
    # A restored entry does not access the former AI-only image.
    shot['images']=[{'id':'missing','sha256':'0'*64}]
    p=normalize_plan(json.dumps(p,ensure_ascii=False))
    assert verified_plan(p,tmp_path)==(p,[])
    assert resolve_prompt_text(p,TARGET)==('静かに歩く。','off')
    text,_=compile_part_prompt(p,execution_plan(p)[0])
    assert 'COMMON_AI' in text and 'SHOT_AI' not in text and '静かに歩く。' in text
    p['prompt_enhancer']['texts'][0]['inactive']=False
    assert resolve_prompt_text(p,TARGET)==('SHOT_AI','enhanced')

@pytest.mark.parametrize('value',[0,1,'false',None,[]])
def test_invalid_per_field_state(value):
    p=plan();add(p,TARGET)['inactive']=value
    with pytest.raises(ValueError):normalize_plan(p)

def test_duplicate_target_rejected():
    p=plan();add(p,TARGET);add(p,TARGET)
    with pytest.raises(ValueError):normalize_plan(p)

@pytest.mark.parametrize('value',[0,1,'false',None,[],{}])
def test_invalid_switch(value):
    p=plan();p['prompt_enhancer']['enabled']=value
    with pytest.raises(ValueError):normalize_plan(p)

@pytest.mark.parametrize('text',['','   ','<think>reason','Edit <Picture 1>','```json\n{}','{"shot":1}','subject_definitions: a person'])
def test_reject_contract_violations(text):
    with pytest.raises(ValueError):validate_candidate(text)

def test_original_only_when_unadopted():
    p=plan();p['prompt_enhancer']['enabled']=True
    assert resolve_prompt_text(p,TARGET)==('静かに歩く。','unadopted')

def test_compile_uses_one_version_only():
    p=plan();add(p,TARGET,text='NEW_TEXT');p['prompt_enhancer']['enabled']=True
    text,_=compile_part_prompt(p,execution_plan(p)[0])
    assert 'NEW_TEXT' in text and '静かに歩く。' not in text

def test_no_ai_fields_for_old_plan():
    p=default_plan();p['prompt_enhancer']={'enabled':True,'texts':[]}
    with pytest.raises(ValueError):normalize_plan(p)

def test_off_no_file_reads(tmp_path):
    p=plan();e=add(p,TARGET);e['images']=[{'id':'missing','sha256':'0'*64}]
    assert verified_plan(p,tmp_path)==(p,[])

def test_changed_ai_image_preserves_saved_record(tmp_path):
    p=plan();p['assets']=[{'id':'a','kind':'image','label':'a','file':{'name':'a.png','subfolder':'','type':'input'}}]
    p['reference_slots'][0]='a';p['global_refs']=[1]
    e=add(p,TARGET);e['images']=[{'id':'a','sha256':digest('old')}];p['prompt_enhancer']['enabled']=True
    (tmp_path/'a.png').write_bytes(b'new')
    verified,notes=verified_plan(p,tmp_path)
    assert notes and len(p['prompt_enhancer']['texts'])==1 and verified['prompt_enhancer']['texts']==[]
    assert normalize_plan(verified)==verified

def test_actions_do_not_change_sampling_shape():
    p=plan();p['shots'][0]['seconds']=60;before=execution_plan(p)
    p['shots'][0]['actions']=[{'id':'a1','kind':'state','text':'WALK','at':0,'weight':1},{'id':'a2','kind':'event','text':'TURN','at':10,'weight':1}]
    p=normalize_plan(p)
    assert execution_plan(p)==before
    texts=[compile_part_prompt(p,x)[0] for x in before]
    assert sum('TURN' in t for t in texts)==1
    assert all('WALK' in t for t in texts)

def test_unused_asset_not_required_for_hash(tmp_path):
    from h3ezstudio.plan import fingerprint
    p=plan();p['assets']=[{'id':'unused','kind':'image','label':'unused','file':{'name':'missing.png','subfolder':'','type':'input'}}]
    assert used_asset_ids(p)==set() and len(fingerprint(p,tmp_path))==64

@pytest.mark.parametrize('text',[
    'Edit the image to change the outfit.',
    'Modify this picture to show a different background.',
    'Alter the photo by removing the person.',
])
def test_still_image_commands_are_not_silently_converted(text):
    from h3ezstudio.enhancer import validate_candidate
    with pytest.raises(ValueError,match='still-image'):
        validate_candidate(text)
