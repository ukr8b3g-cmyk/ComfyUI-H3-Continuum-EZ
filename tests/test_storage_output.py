import gc
import logging
import hashlib
import json
import shutil
from pathlib import Path
import pytest
import torch
import av
from .test_engine_boundary import runtime
from h3ezstudio import storage
from h3ezstudio.plan import default_plan, shot_geometry
from h3ezstudio.vendor.continuum import storage_settings


@pytest.fixture
def scratch(tmp_path, monkeypatch):
    # The mocked model logs a caught exception; pytest's report handler otherwise
    # retains its traceback and every engine local, unlike the real supported model.
    monkeypatch.setattr(logging.getLogger('h3ezstudio.vendor.continuum.model_patch'), 'disabled', True)
    root = tmp_path / 'scratch'
    monkeypatch.setattr(storage, 'backing_root', lambda: root)
    return root


def run(runtime, tmp_path, **options):
    eng, M, C, V, *_ = runtime
    p = default_plan()
    p['shots'] += [{**p['shots'][0], 'id':'s2', 'transition':'continue'},
                   {**p['shots'][0], 'id':'s3', 'transition':'cut'}]
    return eng.run_engine(model=M(), clip=C(), video_vae=V(), audio_vae=V(True),
        sampler=object(), sigmas=torch.tensor([1., 0.]), timeline={'plan':p}, seed=3,
        width=64, height=32, input_root=tmp_path, **options), p


def test_disk_matches_ram_and_keeps_live_alias(runtime, scratch, tmp_path, caplog):
    ram, _ = run(runtime, tmp_path, buffer_backend='RAM')
    disk, _ = run(runtime, tmp_path, buffer_backend='Disk-backed')
    assert torch.equal(ram[0], disk[0])
    assert torch.equal(ram[1]['waveform'], disk[1]['waveform'])
    assert len(list(scratch.glob('*.bin'))) == 2  # only returned IMAGE/AUDIO; latents released
    alias = disk[0][0]
    del disk
    caplog.clear(); gc.collect(); storage.collect()
    assert len(list(scratch.glob('*.bin'))) == 1
    assert alias.mean() == .5
    del alias
    caplog.clear(); gc.collect(); storage.collect()
    assert not list(scratch.glob('*.bin'))


def test_stream_has_exact_frames_audio_and_no_full_image(runtime, scratch, tmp_path, monkeypatch):
    original_empty = torch.empty
    def checked(shape, *args, **kwargs):
        if isinstance(shape, (list, tuple)) and len(shape) == 4 and shape[1:] == (32,64,3):
            raise AssertionError('stream must not allocate full IMAGE')
        return original_empty(shape, *args, **kwargs)
    monkeypatch.setattr(torch, 'empty', checked)
    exported = {}
    result, p = run(runtime, tmp_path, output_mode='Long video', output_root=tmp_path, video_result=exported)
    assert result[0] is None
    path = tmp_path / exported['subfolder'] / exported['filename']
    frames = sum(g['frames'] for g in shot_geometry(p))
    with av.open(str(path)) as container:
        assert len(container.streams.audio) == 1
        decoded = list(container.decode(video=0))
        assert len(decoded) == frames
        assert all(b.time > a.time for a,b in zip(decoded,decoded[1:]))
    with av.open(str(path)) as container:
        samples = sum(frame.samples for frame in container.decode(audio=0))
        assert abs(samples-round(frames*32000/24)) <= 2048
    assert 'not allocated' in result[3]
    assert not list((tmp_path/'h3_continuum_ez').glob('*.partial.mp4'))


def test_cancel_cleans_partial_and_latents(runtime, scratch, tmp_path, monkeypatch, caplog):
    from h3ezstudio import stream_video
    original = stream_video.StreamVideo.append
    def cancel(self, images):
        original(self, images[:2])
        raise InterruptedError('cancel during encoding')
    monkeypatch.setattr(stream_video.StreamVideo, 'append', cancel)
    with pytest.raises(InterruptedError):
        run(runtime, tmp_path, output_mode='Long video', output_root=tmp_path, video_result={})
    caplog.clear(); gc.collect(); storage.collect()
    assert not list((tmp_path/'h3_continuum_ez').glob('*.mp4'))
    assert not list(scratch.glob('*.bin'))


def test_full_disk_never_falls_back_to_ram(scratch, monkeypatch):
    monkeypatch.setattr(storage.buffers, '_disk_free_bytes', lambda root: 1)
    with pytest.raises(RuntimeError, match='reserve'):
        storage.select_backend('Disk-backed', 1024)


def test_storage_maintenance_blocks_active_operation(tmp_path):
    m = storage_settings.StorageSettings(tmp_path/'settings.json',
        default_finalize=lambda:tmp_path/'finalize', default_decode=lambda:tmp_path/'decode')
    with m.operation():
        with pytest.raises(storage_settings.StorageBusy):
            m.save(str(tmp_path/'target'), 0)
        with pytest.raises(storage_settings.StorageBusy):
            m.cleanup()
    m.save(str(tmp_path/'target'), 0)
    status = m.status()
    assert status['revision'] == 1
    assert status['path'] == str((tmp_path/'target').resolve())
    assert m.resolve('finalize', tmp_path).is_dir()


def test_storage_vendor_bytes():
    root = Path(__file__).resolve().parents[1]/'vendor/continuum'
    for path, digest in json.loads((root/'STORAGE_PROVENANCE.json').read_text())['sha256'].items():
        assert hashlib.sha256((root/path).read_bytes()).hexdigest() == digest



def test_ez_storage_isolates_custom_folder(tmp_path):
    from h3ezstudio.storage_api import EZStorageSettings
    m = EZStorageSettings(tmp_path/'config.json', default_finalize=lambda:tmp_path/'default', default_decode=lambda:tmp_path/'unused')
    m.save(str(tmp_path/'chosen'), 0)
    assert m.status()['path'] == str(tmp_path/'chosen'/'h3-continuum-ez')
    assert not (tmp_path/'chosen'/'h3-continuum-scratch').exists()
    m.save(m.status()['path'], 1)
    assert m.status()['path'] == str(tmp_path/'chosen'/'h3-continuum-ez')


def test_long_video_rejects_image_consumer_before_sampling(monkeypatch, tmp_path):
    import sys, types
    from h3ezstudio.ez_nodes import H3ContinuumEZEngine
    monkeypatch.setitem(sys.modules, 'folder_paths', types.SimpleNamespace())
    with pytest.raises(ValueError, match='does not output IMAGE'):
        H3ContinuumEZEngine().generate(output_mode='Long video', unique_id='7', prompt={'8':{'inputs':{'images':['7',0]}}})


def test_stream_uses_imported_audio_without_generated_audio_decode(runtime, scratch, tmp_path, monkeypatch):
    eng = runtime[0]
    master = {'waveform':torch.full((1,2,489333), .02), 'sample_rate':32000}
    monkeypatch.setattr(eng, 'render_original_audio', lambda *args, **kw: master)
    result, _ = run(runtime, tmp_path, output_mode='Long video', output_root=tmp_path, video_result={})
    assert result[1] is master
    assert 'audio_decode' not in runtime[-2]
