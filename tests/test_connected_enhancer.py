from h3ezstudio.ez_nodes import H3ContinuumEZEngine
from h3ezstudio.assist_api import prepare_request, AssistError
from h3ezstudio.plan import default_plan
import pytest

def request():
    p=default_plan();p['schema']=2;p['shots'][0]['prompt']='A person walks.'
    p['prompt_enhancer']={'enabled':True,'texts':[]}
    return {'plan':p,'target':{'field':'prompt','shot_id':'shot-1'},'model':'selected.safetensors'}

def test_connected_prompt_encoder_is_not_eagerly_loaded_for_video():
    # Core's graph scheduler excludes lazy inputs unless a node requests them.
    assert H3ContinuumEZEngine.INPUT_TYPES()['optional']['prompt_clip'][1]['lazy'] is True
    assert not hasattr(H3ContinuumEZEngine,'check_lazy_status')

def test_explicit_text_job_preserves_wired_loader_device(tmp_path):
    r=request();r['loader']={'type':'minimax','device':'cpu'}
    out=prepare_request(r,tmp_path,['selected.safetensors'])
    loader=next(n for n in out['graph'].values() if n['class_type']=='CLIPLoader')
    assert loader['inputs']=={'clip_name':'selected.safetensors','type':'minimax','device':'cpu'}
    generator=next(n for n in out['graph'].values() if n['class_type']=='TextGenerateV2')
    assert out['graph'][generator['inputs']['clip'][0]] is loader

@pytest.mark.parametrize('loader',[{'type':'sdxl','device':'default'},{'type':'minimax','device':'cuda:77'},{'device':'cpu'},None])
def test_wrong_loader_configuration_rejected(tmp_path,loader):
    r=request();r['loader']=loader
    with pytest.raises(AssistError):prepare_request(r,tmp_path,['selected.safetensors'])
