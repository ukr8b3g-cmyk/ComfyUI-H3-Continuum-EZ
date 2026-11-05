"""Real EZ and original Continuum logic; ComfyUI sampling/VAE boundary is a CPU fixture.
This is NOT a live ComfyUI or GPU quality test.
"""
import copy
import sys
import types
from pathlib import Path
import pytest
import torch
from h3ezstudio.plan import default_plan, normalize_plan, shot_geometry
from h3ezstudio.vendor.continuum.temporal import pixel_frames_for_latent_t

class Nested:
    def __init__(self,parts):self.parts=tuple(parts)
    def unbind(self):return self.parts
    def to(self,device):return Nested([p.to(device) for p in self.parts])

@pytest.fixture
def runtime(monkeypatch):
    records=[];events=[]
    comfy=types.ModuleType('comfy');comfy.__path__=[]
    monkeypatch.setitem(sys.modules,'comfy',comfy)
    def module(name,**kw):
        m=types.ModuleType(name);m.__dict__.update(kw);monkeypatch.setitem(sys.modules,name,m)
        if name.startswith('comfy.') and '.' not in name[6:]:setattr(comfy,name.split('.')[-1],m)
        return m
    module('comfy.nested_tensor',NestedTensor=Nested)
    module('comfy.model_management',intermediate_device=lambda:torch.device('cpu'),throw_exception_if_processing_interrupted=lambda:None)
    module('comfy.sample',fix_empty_latent_channels=lambda m,x,*a:x,prepare_noise=lambda x,seed,inds:Nested([torch.zeros_like(p) for p in x.unbind()]))
    module('comfy.utils',PROGRESS_BAR_ENABLED=False,common_upscale=lambda x,w,h,*a:torch.nn.functional.interpolate(x,size=(h,w),mode='bilinear'))
    module('comfy.patcher_extension',WrappersMP=types.SimpleNamespace(APPLY_MODEL='apply_model'))
    module('latent_preview',prepare_callback=lambda *a:None)
    class Base:pass
    module('comfy.model_base',MiniMaxH3=Base)
    class Model:
        def __init__(self):self.model=Base();self.model_options={};self.wrappers={}
        def clone(self):m=Model();m.model=self.model;m.model_options=copy.deepcopy(self.model_options);m.wrappers=copy.copy(self.wrappers);return m
        def remove_wrappers_with_key(self,t,k):self.wrappers.pop((t,k),None)
        def add_wrapper_with_key(self,t,k,f):self.wrappers[(t,k)]=f
    class Guider:
        def __init__(self,model):self.model=model
        def inner_set_conds(self,conds):self.conds=conds
        def sample(self,noise,latent,sampler,sigmas,**kw):
            events.append('sample');records.append({'cond':self.conds,'model':self.model,'seed':kw['seed'],'latent':latent})
            return Nested([torch.rand(p.shape,generator=torch.Generator().manual_seed(kw['seed'])) for p in latent.unbind()])
    module('comfy.samplers',CFGGuider=Guider)
    class Clip:
        def tokenize(self,prompt,**kwargs):events.append('text_encode');return {'prompt':prompt,'kwargs':kwargs}
        def encode_from_tokens_scheduled(self,tokens):return [[torch.ones(1,2,4),{'fixture_prompt':tokens['prompt'],'fixture_items':tokens['kwargs']}]]
    class VAE:
        audio_sample_rate=32000
        def __init__(self,audio=False):self.is_audio=audio
        def encode(self,x):
            events.append('audio_encode' if self.is_audio else 'image_encode')
            if self.is_audio:return torch.ones(1,32,2,round(x.shape[1]/32000*40))
            return torch.ones(1,24,1,x.shape[1]//16,x.shape[2]//16)
        def decode(self,z):
            events.append('audio_decode' if self.is_audio else 'video_decode')
            if self.is_audio:return torch.ones(1,round(z.shape[-1]/40*32000),2)*.1
            return torch.ones(pixel_frames_for_latent_t(z.shape[2]),z.shape[3]*16,z.shape[4]*16,3)*.5
    from h3ezstudio import engine
    monkeypatch.setattr(engine,'resolve_resolution',lambda *a:(64,32))
    return engine,Model,Clip,VAE,events,records

def call(runtime,tmp_path,p,*,width=64,height=32):
    eng,M,C,V,events,records=runtime
    result=eng.run_engine(model=M(),clip=C(),video_vae=V(),audio_vae=V(True),sampler=object(),sigmas=torch.tensor([1.,.5,0.]),timeline={'plan':p,'external_prompt':None},seed=123,width=width,height=height,input_root=tmp_path)
    return result


@pytest.mark.parametrize('source', ['studio','external'])
def test_common_editor_source_reaches_sampler_for_each_shot(runtime,tmp_path,source):
    import json
    from h3ezstudio.ez_nodes import H3ContinuumEZTimeline
    p=default_plan();p['global_prompt']='Studio scene';p['prompt_source']=source
    p['shots'][0]['prompt']='First action'
    p['shots'].append({**p['shots'][0],'id':'second','prompt':'Second action','transition':'continue'})
    timeline=H3ContinuumEZTimeline().compile(json.dumps(p),'External scene')['result'][0]
    eng,M,C,V,events,records=runtime
    eng.run_engine(model=M(),clip=C(),video_vae=V(),audio_vae=V(True),sampler=object(),sigmas=torch.tensor([1.,.5,0.]),timeline=timeline,seed=123,width=64,height=32,input_root=tmp_path)
    common='Studio scene' if source=='studio' else 'External scene'
    other='External scene' if source=='studio' else 'Studio scene'
    for i,rec in enumerate(records):
        text=rec['cond']['positive'][0][1]['fixture_prompt']
        assert common in text and other not in text
        assert p['shots'][i]['prompt'] in text and p['shots'][1-i]['prompt'] not in text

def test_three_shots_original_context_and_cut(runtime,tmp_path):
    p=default_plan();p['global_prompt']='The same scene';p['shots'] += [{**p['shots'][0],'id':'s2','transition':'continue'}, {**p['shots'][0],'id':'s3','transition':'cut'}]
    result=call(runtime,tmp_path,p);eng,M,C,V,events,records=runtime
    assert len(records)==3
    cond1=records[0]['cond']['positive'][0][1];cond2=records[1]['cond']['positive'][0][1];cond3=records[2]['cond']['positive'][0][1]
    assert not cond1.get('minimax_refs') and cond2['minimax_refs'][-1]['_h3cj_video_context'] and not cond3.get('minimax_refs')
    assert [e for e in events if e in ('sample','video_decode')]==['sample','video_decode']*3
    assert [e for e in events if e in ('text_encode','sample')]==['text_encode','sample']*3
    assert result[0].shape[0]==sum(g['frames'] for g in shot_geometry(p))
    assert result[1]['waveform'].shape[-1]==round(result[0].shape[0]*32000/24)
    assert 'reference_context_v1' in result[3] and len(records[1]['model'].wrappers)==1

def test_original_audio_is_never_decoded_then_discarded(runtime,tmp_path,monkeypatch):
    p=default_plan();p['shots'].append({**p['shots'][0],'id':'s2','transition':'continue'})
    eng,M,C,V,events,records=runtime;frames=sum(x['frames'] for x in shot_geometry(p));master={'waveform':torch.randn(1,2,round(frames*32000/24))*.01,'sample_rate':32000}
    monkeypatch.setattr(eng,'render_original_audio',lambda *a,**kw:master)
    result=call(runtime,tmp_path,p)
    assert 'audio_encode' in events and 'audio_decode' not in events
    assert result[1] is master
    assert any('audio_latent' in k for k in records[0]['cond']['positive'][0][1]['minimax_keyframes'])

def test_nan_stops_before_decode(runtime,tmp_path,monkeypatch):
    eng,*_=runtime
    def bad(**kwargs):return {'samples':Nested((torch.full((1,24,37,2,4),float('nan')),torch.zeros(1,32,2,207)))}
    monkeypatch.setattr(eng,'sample_chunk',bad)
    with pytest.raises(RuntimeError,match='NaN'):call(runtime,tmp_path,default_plan())
    assert not any('decode' in e for e in runtime[-2])

def test_cancel_preserved(runtime,tmp_path,monkeypatch):
    import comfy.model_management
    def cancel():raise InterruptedError('cancel fixture')
    monkeypatch.setattr(comfy.model_management,'throw_exception_if_processing_interrupted',cancel)
    with pytest.raises(InterruptedError):call(runtime,tmp_path,default_plan())

def test_model_input_not_patched_globally(runtime,tmp_path):
    eng,M,C,V,events,records=runtime;m=M()
    eng.run_engine(model=m,clip=C(),video_vae=V(),audio_vae=V(True),sampler=object(),sigmas=torch.tensor([1.,0.]),timeline={'plan':default_plan()},seed=0,megapixels=.1,aspect='16:9',input_root=tmp_path)
    assert m.model_options=={} and m.wrappers=={}

def test_reference_and_first_image_numbers_match_core_path(runtime,tmp_path):
    from PIL import Image
    eng,M,C,V,events,records=runtime
    for n in ('first','ref'):Image.new('RGB',(96,64)).save(tmp_path/f'{n}.png')
    p=default_plan();p['assets']=[{'id':n,'kind':'image','label':n,'file':{'name':n+'.png','subfolder':'','type':'input'}} for n in ('first','ref')]
    p['first_image']='first';p['reference_slots'][0]='ref';p['global_refs']=[1];p['global_prompt']='The person in @R1 remains seated.'
    p['shots'].append({**p['shots'][0],'id':'s2','transition':'continue'})
    result=call(runtime,tmp_path,p,width=64,height=96)
    assert result[0].shape[1:3]==(96,64)
    first=records[0]['cond']['positive'][0][1];second=records[1]['cond']['positive'][0][1]
    assert 'The person in <Picture 2> remains seated.' in first['fixture_prompt']
    assert first['minimax_keyframes'][0]['resolved_frame_index']==0
    assert not second.get('minimax_keyframes')
    assert len(second['minimax_refs'])==2  # Image Reference + original Continuum AV context.
    assert 'The person in <Picture 2> remains seated.' in second['fixture_prompt']
    assert 'opening frame' not in second['fixture_prompt']
    assert events.index('image_encode')<events.index('sample')<events.index('video_decode')


def test_easy_text_reaches_encoder_with_matching_images_and_continuum_context(runtime,tmp_path):
    from PIL import Image
    from h3ezstudio.plan import preview_prompts
    colors = {'start': (255, 0, 0), 'orange': (255, 128, 0), 'white': (255, 255, 255)}
    for name, color in colors.items():
        Image.new('RGB', (96,64), color).save(tmp_path/f'{name}.png')
    p=default_plan()
    p['assets']=[dict(id=name,kind='image',label=name,file=dict(name=name+'.png',subfolder='',type='input')) for name in colors]
    p['reference_slots'][1]='orange';p['reference_slots'][4]='white';p['global_refs']=[5,2]
    p['first_image']='start';p['global_prompt']='An orange-clad man and a woman in white stand in a garden.'
    p['shots'][0]['prompt']='The woman says "こんにちは！" and the man nods.'
    p['shots'] += [{**p['shots'][0], 'id':'next', 'transition':'continue'},
                  {**p['shots'][0], 'id':'cut', 'transition':'cut', 'refs':[]}]
    expected=preview_prompts(normalize_plan(p))
    call(runtime,tmp_path,p)
    records=runtime[-1]
    for record, row in zip(records,expected,strict=True):
        assert record['cond']['positive'][0][1]['fixture_prompt']==row['prompt']
    first=records[0]['cond']['positive'][0][1]
    items=first['fixture_items']['minimax_ref_items']
    assert len(items)==3
    for item, color in zip(items, colors.values(), strict=True):
        assert torch.allclose(item['data'][0,0,0],torch.tensor(color)/255,atol=.005)
    assert 'The reference sources are <Picture 2>, <Picture 3>.' in first['fixture_prompt']
    next_=records[1]['cond']['positive'][0][1]
    assert next_['minimax_refs'][-1]['_h3cj_video_context']
    assert not next_.get('minimax_keyframes')
    assert 'opening frame' not in next_['fixture_prompt']
    cut=records[2]['cond']['positive'][0][1]
    assert not cut.get('minimax_refs') and not cut.get('minimax_keyframes')
    assert '<Picture' not in cut['fixture_prompt']
