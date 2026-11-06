import copy
import json
import math
from contextlib import nullcontext
from types import SimpleNamespace
from pathlib import Path
import pytest
import torch
from PIL import Image, ImageOps
from h3ezstudio.plan import *
from h3ezstudio.media import load_image, render_original_audio, resolve_resolution
from h3ezstudio.vendor.continuum.temporal import make_extension_shape


def image(aid='a'):
    return {'id':aid,'kind':'image','label':'image','file':{'name':aid+'.png','subfolder':'','type':'input'}}

def audio(aid='music',seconds=8):
    return {'id':aid,'kind':'audio','label':'song','file':{'name':aid+'.wav','subfolder':'','type':'input'},'duration':seconds}

@pytest.mark.parametrize('seconds',[2,2.01,3.5,4,5,6,8.25,10,12.1,15])
@pytest.mark.parametrize('context',[5,22,39])
def test_geometry_matches_original_core(seconds,context):
    p=default_plan();p['shots'].append({**p['shots'][0],'id':'s2','seconds':seconds,'transition':'continue'})
    assert shot_geometry(p)[1]['frames']==make_extension_shape(context,seconds).net_new_frames

@pytest.mark.parametrize('bad',[None,False,0,'',[],{'schema':2}])
def test_bad_plan(bad):
    with pytest.raises((ValueError,TypeError)):normalize_plan(bad)

@pytest.mark.parametrize('seconds',[0,1.9,600.1,float('nan'),float('inf'),True,'5'])
def test_bad_seconds(seconds):
    p=default_plan();p['shots'][0]['seconds']=seconds
    with pytest.raises(PlanError):normalize_plan(p)

def test_long_prompt_preserved_and_external_does_not_overwrite():
    p=default_plan();text='日本語とEnglish\n'*4000;p['global_prompt']=text;p['shots'][0]['prompt']='Dialogue.'
    before=copy.deepcopy(p);p=normalize_plan(p)
    compiled,_=compile_prompt(p,p['shots'][0],has_first=False)
    assert text+'\n\nDialogue.' in compiled and compiled.count(text)==1
    external,_=compile_prompt(p,p['shots'][0],has_first=False,external_prompt='LLM runtime')
    assert 'LLM runtime\n\nDialogue.' in external and text not in external and p==before

def test_reference_mapping_keeps_slots_stable():
    p=default_plan();p['assets']=[image('a'),image('b'),image('c')];p['reference_slots'][0]='b';p['reference_slots'][4]='c';p['first_image']='a';p['global_refs']=[1,5]
    p['global_prompt']='@R1 wears a coat. @R5 is the backdrop.'
    p['shots'].append({**p['shots'][0],'id':'s2','transition':'continue'})
    p=normalize_plan(p);compiled=preview_prompts(p)
    assert compiled[0]['picture_map']=={'@R1':'<Picture 2>','@R5':'<Picture 3>'}
    assert compiled[1]['picture_map']==compiled[0]['picture_map']
    p['shots'][1]['transition']='cut'
    assert preview_prompts(p)[1]['picture_map']['@R1']=='<Picture 1>'

def test_explicit_no_refs_and_inactive_token():
    p=default_plan();p['assets']=[image()];p['reference_slots'][0]='a';p['global_refs']=[1];p['shots'][0]['refs']=[];p['global_prompt']='@R1'
    p=normalize_plan(p)
    with pytest.raises(PlanError,match='not active'):preview_prompts(p)

def test_reject_first_image_on_continue():
    p=default_plan();p['assets']=[image()];p['shots'].append({**p['shots'][0],'id':'b','transition':'continue','first_image':'a'})
    with pytest.raises(PlanError,match='scene cut'):normalize_plan(p)

@pytest.mark.parametrize('file',[{'name':'../bad.png'}, {'name':'C:\\x.png'},{'name':'x','subfolder':'../foo'},{'name':'x','subfolder':'/tmp'},{'name':'x','type':'output'}])
def test_path_traversal_rejected(file):
    with pytest.raises(PlanError):validate_file_ref(file)

def test_symlink_escape_and_content_hash(tmp_path):
    a=image();(tmp_path/'a.png').write_bytes(b'one');p=default_plan();p['assets']=[a];p['first_image']='a'
    first=fingerprint(p,tmp_path);(tmp_path/'a.png').write_bytes(b'two');assert fingerprint(p,tmp_path)!=first
    out=tmp_path.parent/'outside_h3ez.txt';out.write_text('outside')
    (tmp_path/'a.png').unlink();(tmp_path/'a.png').symlink_to(out)
    with pytest.raises(PlanError):asset_path(a,tmp_path)
    out.unlink()

def test_audio_exact_original_source(tmp_path):
    p=default_plan();p['assets']=[audio()];(tmp_path/'music.wav').write_bytes(b'fixture')
    p['audio']=[{'id':'c1','asset_id':'music','start':0.,'source_in':1.,'duration':1.}, {'id':'c2','asset_id':'music','start':2.,'source_in':3.,'duration':1.}]
    p=normalize_plan(p);source=torch.arange(8000,dtype=torch.float32).reshape(1,1,-1).repeat(1,2,1)/8000;before=source.clone()
    out=render_original_audio(p,tmp_path,124,loader=lambda _: {'waveform':source,'sample_rate':1000})
    assert torch.equal(out['waveform'][...,:1000],source[...,1000:2000])
    assert torch.equal(out['waveform'][...,2000:3000],source[...,3000:4000])
    assert not out['waveform'][...,1000:2000].any() and torch.equal(source,before)
    assert out['waveform'].shape[-1]==round(124*1000/24)

def test_audio_overlap_is_not_silently_mixed():
    p=default_plan();p['assets']=[audio()];p['audio']=[{'id':'a1','asset_id':'music','start':0,'source_in':0,'duration':3},{'id':'a2','asset_id':'music','start':2,'source_in':0,'duration':2}]
    with pytest.raises(PlanError,match='overlap'):normalize_plan(p)

def test_audio_source_out_of_bounds():
    p=default_plan();p['assets']=[audio(seconds=2)];p['audio']=[{'id':'a1','asset_id':'music','start':0,'source_in':1,'duration':2}]
    with pytest.raises(PlanError,match='source file'):normalize_plan(p)

@pytest.mark.parametrize('aspect',['16:9','9:16','1:1','4:3','3:4'])
def test_resolutions(aspect):
    w,h=resolve_resolution(.3,aspect);assert w%32==h%32==0 and w*h<400000

def test_schema_only_two_nodes():
    from h3ezstudio import NODE_CLASS_MAPPINGS
    assert set(NODE_CLASS_MAPPINGS)=={'H3ContinuumEZTimeline','H3ContinuumEZEngine'}
    assert 'run_name' not in str([n.INPUT_TYPES() for n in NODE_CLASS_MAPPINGS.values()])

def test_vendor_byte_integrity():
    import hashlib
    root=Path(__file__).resolve().parents[1]
    meta=json.loads((root/'docs/CORE_PROVENANCE.json').read_text())
    for x in meta['files']:
        if x['mode']=='byte-identical':assert hashlib.sha256((root/'vendor/continuum'/x['path']).read_bytes()).hexdigest()==x['sha256']

# v0.9.1 input guard: expansion must follow the existing 64 Mi-pixel cap.
def test_oversized_image_is_rejected_before_exif_transpose(monkeypatch):
    header=SimpleNamespace(width=10000,height=7000)
    monkeypatch.setattr(Image,'open',lambda _:nullcontext(header))
    monkeypatch.setattr(ImageOps,'exif_transpose',lambda _:pytest.fail('Decoded before checking size'))
    with pytest.raises(PlanError,match='64 megapixels'):load_image(Path('oversized.png'))

def test_load_image_preserves_exif_orientation(tmp_path):
    path=tmp_path/'portrait.jpg'
    with Image.new('RGB',(2,3)) as source:
        exif=source.getexif();exif[274]=6;source.save(path,exif=exif)
    assert load_image(path).shape==(1,2,3,3)

def test_unused_file_content_is_not_a_generation_dependency(tmp_path):
    a=image();(tmp_path/'a.png').write_bytes(b'one');p=default_plan();p['assets']=[a]
    before=fingerprint(p,tmp_path);(tmp_path/'a.png').write_bytes(b'two')
    assert fingerprint(p,tmp_path)==before
    (tmp_path/'a.png').unlink();assert fingerprint(p,tmp_path)==before
