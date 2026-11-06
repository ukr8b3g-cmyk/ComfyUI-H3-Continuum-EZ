import copy
import hashlib
import json
from pathlib import Path
import pytest
from PIL import Image
from h3ezstudio.plan import default_plan, normalize_plan, used_asset_ids
from h3ezstudio.enhancer import SHOT_ONLY_CONTRACT, resolve_prompt_text
from h3ezstudio.assist_api import (prepare_request, adopt_request, preflight_request,
                                  DEFAULT_MODEL, AssistError, DERIVED_FOLDER)


def plan():
    p=default_plan();p['schema']=2;p['shots'][0]['prompt']='女性が静かに振り返る。';p['prompt_enhancer']={'enabled':True,'texts':[]};return p


def request(p=None, **extra):
    return {'plan':p or plan(),'target':{'field':'prompt','shot_id':'shot-1'},'model':DEFAULT_MODEL,**extra}


def with_image(tmp_path):
    p=plan();file=tmp_path/'ref.png';Image.new('RGB',(1600,900),(220,70,30)).save(file)
    p['assets']=[{'id':'img-1','kind':'image','label':'reference','file':{'name':file.name,'subfolder':'','type':'input'}}]
    p['reference_slots'][0]='img-1';p['global_refs']=[1];return p,file


def test_fixed_graph_is_text_only(tmp_path):
    p=plan();before=copy.deepcopy(p);result=prepare_request(request(p),tmp_path,[DEFAULT_MODEL])
    assert p==before and result['experimental'] is True
    assert len(result['graph'])==3
    assert {n['class_type'] for n in result['graph'].values()}=={'CLIPLoader','TextGenerateV2','PreviewAny'}
    gen=next(n for n in result['graph'].values() if n['class_type']=='TextGenerateV2')['inputs']
    assert gen['sampling_mode']=='off' and gen['mtp']=='off'
    assert gen['max_length']==1536 and gen['thinking'] is True
    assert gen['use_default_template'] is True and gen['system_prompt']
    assert result['output_id'] in result['graph']
    assert not (tmp_path/DERIVED_FOLDER).exists()


def test_shot_only_ai_excludes_common_text_without_excluding_it_from_video(tmp_path):
    from h3ezstudio.plan import compile_part_prompt, execution_plan
    p=plan();p['global_prompt']='KEEP_SHARED_ORIGINAL'
    r=prepare_request(request(p,contract=SHOT_ONLY_CONTRACT),tmp_path,[DEFAULT_MODEL])
    generator=next(n for n in r['graph'].values() if n['class_type']=='TextGenerateV2')
    assert p['global_prompt'] not in generator['inputs']['prompt']
    assert r['receipt']['dependencies']['common']==''
    p['global_prompt']='UPDATED_SHARED_ORIGINAL'
    entry=adopt_request({'plan':p,'target':r['receipt']['target'],'receipt':r['receipt'],'candidate':'SHOT_AI'},tmp_path)['entry']
    p['prompt_enhancer']['texts']=[entry]
    for mode in ('append','replace'):
        p['shots'][0]['prompt_mode']=mode
        normalized=normalize_plan(p)
        text,_=compile_part_prompt(normalized,execution_plan(normalized)[0])
        assert 'SHOT_AI' in text
        assert ('UPDATED_SHARED_ORIGINAL' in text)==(mode=='append')
        assert resolve_prompt_text(normalized,{'field':'global_prompt'})[0]=='UPDATED_SHARED_ORIGINAL'


def test_off_does_no_ai_preparation(tmp_path):
    p=plan();p['prompt_enhancer']['enabled']=False
    class NoModels:
        def __contains__(self,v):raise AssertionError('discovery happened while OFF')
    with pytest.raises(AssistError,match='OFF'):prepare_request(request(p,image_id='missing'),tmp_path,NoModels())
    assert not list(tmp_path.iterdir())


def test_source_and_image_immutable_and_bounded(tmp_path):
    p,file=with_image(tmp_path);before=file.read_bytes();r=prepare_request(request(p,image_id='img-1'),tmp_path,[DEFAULT_MODEL])
    assert file.read_bytes()==before
    binding=r['receipt']['images'][0];assert binding['sha256']==hashlib.sha256(before).hexdigest()
    image=next(n for n in r['graph'].values() if n['class_type']=='LoadImage')
    path=tmp_path/image['inputs']['image']
    with Image.open(path) as im:assert im.width*im.height<=500000 and im.mode=='RGB'
    assert image['inputs']['image'].startswith(DERIVED_FOLDER+'/')
    assert len(r['graph'])==4


def test_image_must_be_assigned(tmp_path):
    p,file=with_image(tmp_path);p['global_refs']=[]
    with pytest.raises(AssistError,match='assigned'):prepare_request(request(p,image_id='img-1'),tmp_path,[DEFAULT_MODEL])


def test_plain_adoption_preserves_original(tmp_path):
    p=plan();r=prepare_request(request(p),tmp_path,[DEFAULT_MODEL])
    result=adopt_request({'plan':p,'target':r['receipt']['target'],'receipt':r['receipt'],'candidate':'女性が肩越しにゆっくり振り返る。'},tmp_path)
    assert result['entry']['text']=='女性が肩越しにゆっくり振り返る。'
    assert p['shots'][0]['prompt']=='女性が静かに振り返る。'
    assert p['prompt_enhancer']['texts']==[]


def test_adopt_after_off_rejected(tmp_path):
    p=plan();r=prepare_request(request(p),tmp_path,[DEFAULT_MODEL]);p['prompt_enhancer']['enabled']=False
    with pytest.raises(AssistError,match='OFF'):adopt_request({'plan':p,'target':r['receipt']['target'],'receipt':r['receipt'],'candidate':'candidate'},tmp_path)


def test_adopt_after_edit_rejected(tmp_path):
    p=plan();r=prepare_request(request(p),tmp_path,[DEFAULT_MODEL]);p['shots'][0]['prompt']='different'
    with pytest.raises(AssistError,match='source changed'):adopt_request({'plan':p,'target':r['receipt']['target'],'receipt':r['receipt'],'candidate':'candidate'},tmp_path)


def test_adopt_after_image_bytes_change_rejected(tmp_path):
    p,file=with_image(tmp_path);r=prepare_request(request(p,image_id='img-1'),tmp_path,[DEFAULT_MODEL])
    Image.new('RGB',(10,10),'blue').save(file)
    with pytest.raises(AssistError,match='image changed'):adopt_request({'plan':p,'target':r['receipt']['target'],'receipt':r['receipt'],'candidate':'candidate'},tmp_path)


def test_unique_graph_but_stable_cache_identity(tmp_path):
    a=prepare_request(request(),tmp_path,[DEFAULT_MODEL]);b=prepare_request(request(),tmp_path,[DEFAULT_MODEL])
    assert a['request_id']!=b['request_id'] and set(a['graph']).isdisjoint(b['graph'])
    assert a['cache_key']==b['cache_key']


def test_model_changes_cache_identity(tmp_path):
    a=prepare_request(request(),tmp_path,[DEFAULT_MODEL],'model:1');b=prepare_request(request(),tmp_path,[DEFAULT_MODEL],'model:2')
    assert a['cache_key']!=b['cache_key']


@pytest.mark.parametrize('text',['', ' ', 'Edit <Picture 1> to...', '<think>reasoning</think>', '{"action":"foo"}', 'x'*24001])
def test_invalid_input_no_queue_graph(tmp_path,text):
    p=plan();p['shots'][0]['prompt']=text
    with pytest.raises(ValueError):prepare_request(request(p),tmp_path,[DEFAULT_MODEL])


@pytest.mark.parametrize('model',['not-installed.safetensors','../../other.bin','https://example.com/model',42])
def test_unrecognized_model_rejected(tmp_path,model):
    with pytest.raises(ValueError):prepare_request(request(model=model),tmp_path,[DEFAULT_MODEL])


def test_preflight_unused_missing_warns_used_missing_blocks(tmp_path):
    p,file=with_image(tmp_path);file.unlink();p['global_refs']=[]
    result=preflight_request({'plan':p},tmp_path);assert result['ok'] and len(result['warnings'])==1
    p['global_refs']=[1];result=preflight_request({'plan':p},tmp_path);assert not result['ok'] and len(result['errors'])==1


def test_unknown_keys_rejected(tmp_path):
    with pytest.raises(AssistError):prepare_request(request(exec='run'),tmp_path,[DEFAULT_MODEL])


def test_ai_derived_symlink_rejected(tmp_path):
    p,_=with_image(tmp_path);other=tmp_path/'other';other.mkdir();(tmp_path/DERIVED_FOLDER).symlink_to(other,target_is_directory=True)
    with pytest.raises(AssistError,match='symbolic link'):prepare_request(request(p,image_id='img-1'),tmp_path,[DEFAULT_MODEL])


def test_unowned_directory_protected(tmp_path):
    p,_=with_image(tmp_path);dest=tmp_path/DERIVED_FOLDER;dest.mkdir();f=dest/'user-file';f.write_text('keep')
    with pytest.raises(AssistError,match='unowned'):prepare_request(request(p,image_id='img-1'),tmp_path,[DEFAULT_MODEL])
    assert f.read_text()=='keep'


def test_external_prompt_rebinds(tmp_path):
    p=plan();r=prepare_request(request(p,external_prompt='old'),tmp_path,[DEFAULT_MODEL])
    with pytest.raises(AssistError,match='source changed'):adopt_request({'plan':p,'target':r['receipt']['target'],'external_prompt':'new','receipt':r['receipt'],'candidate':'candidate'},tmp_path)
