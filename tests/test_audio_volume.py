import copy
import wave
from contextlib import ExitStack
import numpy as np
import pytest
import torch
from h3ezstudio.plan import default_plan, normalize_plan, PlanError
from h3ezstudio.media import render_original_audio
from h3ezstudio import storage


def project():
    p = default_plan()
    p['assets'] = [{'id':'music', 'kind':'audio', 'label':'music', 'duration':2,
                    'file':{'name':'music.wav', 'type':'input'}}]
    p['audio'] = [{'id':'clip', 'asset_id':'music', 'start':0, 'source_in':0, 'duration':.5}]
    return p


@pytest.mark.parametrize('value', [-.01, 1.01, None, '0.5', True, float('nan'), float('inf')])
def test_invalid_volume_is_rejected(value):
    p = project(); p['audio'][0]['volume'] = value
    with pytest.raises(PlanError, match='Audio volume'):
        normalize_plan(p)


def test_clip_gain_matches_ram_and_disk_without_affecting_other_clips(tmp_path, monkeypatch):
    with wave.open(str(tmp_path/'music.wav'), 'wb') as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(8000)
        f.writeframes(np.full((16000, 2), 10000, dtype='<i2').tobytes())
    p = project(); source = copy.deepcopy(p['audio'][0])
    p['audio'] = [{**source, 'start':.25},
                  {**source, 'id':'quiet', 'start':1, 'source_in':.5, 'volume':.25},
                  {**source, 'id':'silent', 'start':2, 'volume':0}]
    p = normalize_plan(p)
    assert 'volume' not in p['audio'][0]  # old saved plans retain their original shape
    monkeypatch.setattr(storage, 'backing_root', lambda:tmp_path/'backing')
    ram = render_original_audio(p, tmp_path, 72)
    with ExitStack() as stack:
        disk = render_original_audio(p, tmp_path, 72, stack=stack)
        assert torch.equal(ram['waveform'], disk['waveform'])
        w = disk['waveform']; level = 10000/32768
        assert torch.all(w[...,2000:6000] == level)
        assert torch.all(w[...,8000:12000] == level*.25)
        assert not w[...,:2000].any() and not w[...,12000:].any()


def test_long_audio_is_bounded_by_video_in_ram_and_disk(tmp_path, monkeypatch):
    rate = 8000
    samples = np.arange(30 * rate, dtype=np.int32) % 30000
    with wave.open(str(tmp_path/'music.wav'), 'wb') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(np.repeat(samples, 2).astype('<i2').tobytes())
    p = project()
    p['shots'][0]['seconds'] = 10
    p['assets'][0]['duration'] = 30
    p['audio'][0].update(start=.25, source_in=.5, duration=29, volume=.5)
    p = normalize_plan(p)
    before = copy.deepcopy(p)
    frames = 243
    expected_samples = 81000
    start = 2000
    source = 4000
    expected = torch.from_numpy(samples[source:source+expected_samples-start]).float() / 65536
    ram = render_original_audio(p, tmp_path, frames)
    monkeypatch.setattr(storage, 'backing_root', lambda:tmp_path/'backing')
    with ExitStack() as stack:
        disk = render_original_audio(p, tmp_path, frames, stack=stack)
        for track in (ram, disk):
            w = track['waveform']
            assert w.shape == (1, 2, expected_samples)
            assert not w[..., :start].any()
            torch.testing.assert_close(w[0, 0, start:], expected)
    assert p == before

    p['audio'][0]['start'] = 10.125
    (tmp_path/'music.wav').unlink()
    assert render_original_audio(p, tmp_path, frames) is None
