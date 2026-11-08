import copy
import pytest
import torch
from h3ezstudio.seam import correct_boundary, HEAD_FRAMES
from h3ezstudio.plan import default_plan, execution_plan, shot_geometry
from h3ezstudio.vendor.continuum.v2.seeds import derive_chunk_seed
from .test_engine_boundary import runtime
from .test_storage_output import scratch


@pytest.mark.parametrize('pulse', [.35, .26])
def test_isolated_exposure_is_corrected_without_mutating_or_retiming(pulse):
    previous=torch.full((2,32,64,3),.3)
    current=torch.full((31,32,64,3),.3);current[0]=pulse
    original=current.clone()
    prefix,report=correct_boundary(previous,current)
    assert prefix is not None and prefix.shape[0]==HEAD_FRAMES
    assert report['method']=='isolated-exposure'
    assert report['peak_after']<report['peak_before']*.1
    assert torch.allclose(prefix[0],previous[-1],atol=1e-6)
    assert torch.equal(prefix[1:],current[1:HEAD_FRAMES])
    assert torch.equal(current,original)


def test_native_static_and_persistent_lighting_change_are_not_pulse_repaired():
    previous=torch.full((2,32,64,3),.3)
    for value in (.3,.5,.1):
        prefix,report=correct_boundary(previous,torch.full((17,32,64,3),value))
        assert prefix is None and report['method']=='native'


def test_local_motion_is_not_treated_as_global_exposure():
    previous=torch.full((2,32,64,3),.3)
    current=torch.full((17,32,64,3),.3);current[0,:8,:8]=.8
    prefix,report=correct_boundary(previous,current)
    assert report['method']!='isolated-exposure'


def test_long_part_only_passes_a_bounded_prefix_to_continuum(monkeypatch):
    import h3ezstudio.seam as seam
    observed=[];original=seam.apply_color_guard
    def checked(previous,current):
        observed.append((previous.shape[0],current.shape[0]));return original(previous,current)
    monkeypatch.setattr(seam,'apply_color_guard',checked)
    seam.correct_boundary(torch.full((2,8,8,3),.3),torch.full((15000,8,8,3),.3))
    assert observed==[(2,5)]


@pytest.mark.parametrize('streaming',[False,True])
def test_engine_corrects_continue_before_preview_or_output_and_keeps_audio(runtime,scratch,tmp_path,monkeypatch,streaming):
    import av
    eng,M,C,V,events,records=runtime
    plan=default_plan();plan['shots'][0]['seconds']=379/24
    parts=execution_plan(plan);assert len(parts)==2
    original_decode=eng.decode_video
    def decode(vae,latent):
        result=original_decode(vae,latent)
        if len(records)==2:result[39]=.6
        return result
    monkeypatch.setattr(eng,'decode_video',decode)
    monkeypatch.setattr(eng,'choose_context_frames',lambda *a:(39,1.,'fixture'))
    frames=sum(g['frames'] for g in shot_geometry(plan))
    audio={'waveform':torch.full((1,2,round(frames*32000/24)),.02),'sample_rate':32000}
    monkeypatch.setattr(eng,'render_original_audio',lambda *a,**kw:audio)
    observed=[]
    class Preview:
        def append(self,part,*args):observed.append(part[0].clone());return {}
    video={}
    result=eng.run_engine(model=M(),clip=C(),video_vae=V(),audio_vae=V(True),sampler=object(),
        sigmas=torch.tensor([1.,0.]),timeline={'plan':plan},seed=123,width=64,height=32,
        input_root=tmp_path,buffer_backend='Disk-backed',output_mode='Long video' if streaming else 'Images',
        output_root=tmp_path/'output',video_result=video,preview_session=Preview())
    assert result[1] is audio
    first_seed=derive_chunk_seed(123,0,0)
    assert len(records)==2 and [r['seed'] for r in records]==[first_seed,derive_chunk_seed(first_seed,1,0)]
    assert 'boundary isolated-exposure' in result[3]
    assert all(torch.allclose(x,torch.full_like(x,.5),atol=1e-5) for x in observed)
    if streaming:
        assert result[0] is None
        with av.open(str(tmp_path/'output'/video['subfolder']/video['filename'])) as c:
            decoded=list(c.decode(video=0))
            assert len(decoded)==frames
            rgb=decoded[parts[1]['start_frame']].to_ndarray(format='rgb24')
            assert abs(float(rgb.mean())/255-.5)<.04
    else:
        assert result[0].shape[0]==frames
        assert torch.allclose(result[0][parts[1]['start_frame']],torch.full_like(result[0][0],.5))


def test_cut_does_not_apply_boundary_correction(runtime,tmp_path,monkeypatch):
    eng,M,C,V,events,records=runtime
    plan=default_plan();plan['shots'].append({**copy.deepcopy(plan['shots'][0]),'id':'cut','transition':'cut'})
    def forbidden(*a,**kw):raise AssertionError('Scene cuts must be left untouched')
    monkeypatch.setattr(eng,'correct_boundary',forbidden)
    eng.run_engine(model=M(),clip=C(),video_vae=V(),audio_vae=V(True),sampler=object(),
        sigmas=torch.tensor([1.,0.]),timeline={'plan':plan},seed=123,width=64,height=32,input_root=tmp_path)
