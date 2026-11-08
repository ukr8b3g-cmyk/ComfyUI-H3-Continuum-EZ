"""Synthetic motion, temporal safety and bounded streaming integration (CPU)."""
import pytest
import torch
from h3ezstudio import seam
from h3ezstudio.plan import default_plan, execution_plan, shot_geometry
from h3ezstudio.vendor.continuum.v2.seam_guard import _boundary_metrics, _seam_window_peak
from h3ezstudio.vendor.continuum.v2.seeds import derive_chunk_seed
from .test_engine_boundary import runtime
from .test_storage_output import scratch


def motion_fixture():
    texture = torch.nn.functional.avg_pool2d(
        torch.rand((1, 3, 96, 96), generator=torch.Generator().manual_seed(7)),
        5, 1, 2).squeeze(0).permute(1, 2, 0)
    previous = torch.stack([texture, texture])
    head = torch.stack([torch.roll(texture, x, 1) for x in [4, 6, 7, 8, 9]])
    return previous, head


def test_safe_hitch_bridge_changes_only_two_frames_and_no_inputs():
    previous, head = motion_fixture()
    backup = head.clone(); old_previous = previous.clone()
    prefix, report = seam._motion_bridge(previous, head)
    assert report['blend_frames'] == 2
    assert torch.equal(head, backup) and torch.equal(previous, old_previous)
    assert torch.equal(prefix[2:], head[2:])
    before = _boundary_metrics(previous, head); after = _boundary_metrics(previous, prefix)
    for field in ['pixel_mae_norm', 'luma_norm', 'chroma_norm', 'edge_norm', 'temporal_norm', 'motion']:
        assert getattr(after, field) <= getattr(before, field)*1.01+.0001
    assert _seam_window_peak(previous, prefix) < _seam_window_peak(previous, head)*.95


def test_steady_motion_and_fast_motion_are_left_alone():
    previous, head = motion_fixture(); texture = previous[-1]
    steady = torch.stack([torch.roll(texture, x, 1) for x in [1, 2, 3, 4, 5]])
    assert seam._motion_bridge(torch.stack([torch.roll(texture, -1, 1), texture]), steady) is None
    fast_previous = torch.stack([1-texture, texture])
    assert seam._motion_bridge(fast_previous, head) is None


def test_scene_change_and_isolated_local_flash_are_not_motion_blended():
    previous, head = motion_fixture(); texture = previous[-1]
    changed = torch.stack([1-texture]*5)
    assert seam._motion_bridge(previous, changed) is None
    flash = torch.stack([texture]*5); flash[0, :20, :20] = 1.
    assert seam._motion_bridge(previous, flash) is None


def test_bridge_receives_only_bounded_frames_for_a_long_part(monkeypatch):
    previous, head = motion_fixture()
    part = torch.cat([head, head[-1:].expand(200, -1, -1, -1)])
    observed = []; original = seam._motion_bridge
    def checked(prev, current):
        observed.append((prev.shape[0], current.shape[0]))
        return original(prev, current)
    monkeypatch.setattr(seam, '_motion_bridge', checked)
    prefix, report = seam.correct_boundary(previous, part)
    assert observed == [(2, 5)]
    assert prefix.shape[0] <= 5 and report['blend_frames'] <= 2


@pytest.mark.parametrize('streaming', [False, True])
def test_motion_patch_precedes_output_without_retiming_or_audio_changes(runtime, scratch, tmp_path, monkeypatch, streaming):
    import av
    eng,M,C,V,events,records = runtime
    plan=default_plan();plan['shots'][0]['seconds']=379/24
    parts=execution_plan(plan);assert len(parts)==2
    previous, head=motion_fixture();original_decode=eng.decode_video
    def decode(vae,latent):
        raw=original_decode(vae,latent)
        raw.copy_(previous[-1])
        if len(records)==2:raw[39:44].copy_(head)
        return raw
    monkeypatch.setattr(eng,'decode_video',decode)
    monkeypatch.setattr(eng,'choose_context_frames',lambda *a:(39,1.,'fixture'))
    frames=sum(g['frames'] for g in shot_geometry(plan))
    audio={'waveform':torch.full((1,2,round(frames*32000/24)),.02),'sample_rate':32000}
    monkeypatch.setattr(eng,'render_original_audio',lambda *a,**kw:audio)
    seen=[]
    class Preview:
        def append(self,part,*args):seen.append(part[:5].clone());return {}
    video={}
    result=eng.run_engine(model=M(),clip=C(),video_vae=V(),audio_vae=V(True),sampler=object(),
        sigmas=torch.tensor([1.,0.]),timeline={'plan':plan},seed=123,width=96,height=96,
        input_root=tmp_path,buffer_backend='Disk-backed',output_mode='Long video' if streaming else 'Images',
        output_root=tmp_path/'output',video_result=video,preview_session=Preview())
    expected,_=seam.correct_boundary(previous,head)
    assert 'continuum-motion-blend' in result[3]
    assert torch.equal(seen[1],expected) and result[1] is audio
    assert 'audio_decode' not in events
    seed=derive_chunk_seed(123,0,0)
    assert [r['seed'] for r in records]==[seed,derive_chunk_seed(seed,1,0)]
    if streaming:
        with av.open(str(tmp_path/'output'/video['subfolder']/video['filename'])) as c:
            assert sum(1 for _ in c.decode(video=0))==frames
    else:
        assert result[0].shape[0]==frames
        assert torch.equal(result[0][parts[1]['start_frame']:parts[1]['start_frame']+5],expected)
