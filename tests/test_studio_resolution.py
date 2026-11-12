import json
import pytest
from h3ezstudio.plan import ASPECT_RATIOS, DEFAULT_JSON, default_plan, normalize_plan, studio_resolution, PlanError
from h3ezstudio.enhancer import dependency_payload, VISUAL_CONTRACT
from .test_engine_boundary import runtime, call

@pytest.mark.parametrize('aspect', ASPECT_RATIOS)
def test_resolution_roundtrip(aspect):
    p=json.loads(DEFAULT_JSON);p['resolution']['aspect']=aspect
    assert normalize_plan(p)['resolution']==p['resolution']
    w,h=studio_resolution(p['resolution'])
    assert w%32==h%32==0
    assert abs(w*h-300000)<25000

@pytest.mark.parametrize('mp',[0,-1,17,float('nan'),True,'0.3'])
def test_resolution_rejects_invalid(mp):
    p=json.loads(DEFAULT_JSON);p['resolution']['megapixels']=mp
    with pytest.raises(PlanError):normalize_plan(p)

def test_default_and_legacy():
    assert studio_resolution(json.loads(DEFAULT_JSON)['resolution'])==(736,416)
    assert 'resolution' not in normalize_plan(default_plan())

@pytest.mark.parametrize('source,width,height,expected',[
    ('studio',64,32,(96,96)),
    ('studio',None,None,(96,96)),
    ('engine',64,32,(32,64)),
])
def test_engine_size_source(runtime,tmp_path,source,width,height,expected):
    p=default_plan();p['shots'][0]['seconds']=2
    p['resolution']={'source':source,'aspect':'1:1','megapixels':.01}
    result=call(runtime,tmp_path,p,width=width,height=height)
    assert tuple(result[0].shape[1:3])==expected


def test_matched_image_aspect_reaches_ai_context_and_engine(runtime, tmp_path):
    plan = default_plan()
    plan['shots'][0]['seconds'] = 2
    plan['resolution'] = {'source': 'studio', 'aspect': 'image', 'megapixels': .01,
                          'image_aspect': '55:74'}
    saved = normalize_plan(json.dumps(plan))
    assert saved['resolution'] == plan['resolution']
    assert studio_resolution(saved['resolution']) == (96, 128)
    output = dependency_payload(saved, {'field': 'global_prompt'}, contract=VISUAL_CONTRACT)['output']
    assert output == {'source': 'studio', 'aspect': '55:74', 'width': 96, 'height': 128}
    assert tuple(call(runtime, tmp_path, saved, width=32, height=32)[0].shape[1:3]) == (128, 96)
    saved['resolution']['megapixels'] = .5
    assert studio_resolution(saved['resolution']) == (608, 832)
    saved['resolution']['image_aspect'] = '1:0'
    with pytest.raises(PlanError, match='Invalid image aspect ratio'):
        normalize_plan(saved)
    saved['resolution'] = {'source': 'studio', 'aspect': 'image', 'megapixels': .3,
                           'image_size': {'width': 896, 'height': 1184}}
    assert normalize_plan(saved)['resolution'] == {'source': 'studio', 'aspect': 'image',
                                                  'megapixels': .3, 'image_aspect': '28:37'}


def test_music3_fails_before_sampling(runtime, tmp_path, monkeypatch):
    from comfy import model_base

    class Music3:
        pass

    monkeypatch.setattr(model_base, 'MiniMaxMusic3', Music3, raising=False)
    engine, Model, Clip, VAE, events, _ = runtime
    model = Model()
    model.model = Music3()
    with pytest.raises(PlanError, match='MODEL is MiniMax Music3'):
        engine.run_engine(model=model, clip=Clip(), video_vae=VAE(), audio_vae=VAE(True),
                          sampler=None, sigmas=None, timeline={'plan': default_plan()},
                          seed=0, input_root=tmp_path)
    assert not events
