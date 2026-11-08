"""Unit checks for the non-mutating diagnostic module; GPU proof is separate."""

import copy
import pytest
import torch

from h3ezstudio.continuity_audit import get_audit_mode, inspect_context
from h3ezstudio.vendor.continuum.constants import (
    MARK_AUDIO_CONTEXT,
    MARK_AUDIO_END_FRAME,
    MARK_AUDIO_OVERHANG,
    MARK_CONTEXT_FRAMES,
    MARK_VIDEO_CONTEXT,
)
from h3ezstudio.vendor.continuum.temporal import audio_latent_t, context_slots


def context_fixture(frames):
    video = torch.zeros(1, 24, context_slots(frames), 2, 4)
    audio = torch.zeros(1, 32, 2, audio_latent_t(frames))
    entry = {
        "kind": "video_audio",
        "latent_t": context_slots(frames),
        "latent_h": video.shape[-2],
        "latent_w": video.shape[-1],
        "ref_audio_t": audio_latent_t(frames),
        "latent": video,
        "audio_latent": audio,
        MARK_VIDEO_CONTEXT: True,
        MARK_AUDIO_CONTEXT: True,
        MARK_AUDIO_END_FRAME: float(frames),
        MARK_CONTEXT_FRAMES: frames,
        MARK_AUDIO_OVERHANG: 0.0,
    }
    return video, audio, [[torch.zeros(1), {"minimax_refs": [entry]}]]


@pytest.mark.parametrize("frames", [5, 22, 39])
def test_context_rows_validate_without_copy_or_mutation(frames):
    video, audio, conditioning = context_fixture(frames)
    initial = [(tuple(video.shape), tuple(audio.shape)), id(conditioning[0][1]["minimax_refs"][0]["latent"])]
    result = inspect_context(conditioning, video_context=video, audio_context=audio,
                             context_frames=frames, audio_grid_offset=0.0)
    assert result["metadata_ok"] is True
    assert result["continuum_ref_rows"] == 1
    assert result["video_context_slots"] == context_slots(frames)
    assert [(tuple(video.shape), tuple(audio.shape)), id(conditioning[0][1]["minimax_refs"][0]["latent"])] == initial


def test_missing_audio_marker_is_reported():
    video, audio, conditioning = context_fixture(22)
    del conditioning[0][1]["minimax_refs"][0][MARK_AUDIO_CONTEXT]
    result = inspect_context(conditioning, video_context=video, audio_context=audio,
                             context_frames=22, audio_grid_offset=0.0)
    assert result["metadata_ok"] is False
    assert any("audio context marker" in x for x in result["metadata_errors"])


def test_wrong_context_index_is_reported():
    video, audio, conditioning = context_fixture(39)
    conditioning[0][1]["minimax_refs"][0][MARK_CONTEXT_FRAMES] = 22
    result = inspect_context(conditioning, video_context=video, audio_context=audio,
                             context_frames=39, audio_grid_offset=0.0)
    assert result["metadata_ok"] is False


def test_duplicate_context_ref_is_reported():
    video, audio, conditioning = context_fixture(5)
    conditioning[0][1]["minimax_refs"].append(copy.copy(conditioning[0][1]["minimax_refs"][0]))
    result = inspect_context(conditioning, video_context=video, audio_context=audio,
                             context_frames=5, audio_grid_offset=0.0)
    assert result["metadata_ok"] is False


def test_environment_off_by_default_and_invalid_mode_fails(monkeypatch):
    monkeypatch.delenv("H3EZ_CONTINUITY_AUDIT", raising=False)
    assert get_audit_mode() == "off"
    monkeypatch.setenv("H3EZ_CONTINUITY_AUDIT", " RePoRt ")
    assert get_audit_mode() == "report"
    monkeypatch.setenv("H3EZ_CONTINUITY_AUDIT", "invalid")
    with pytest.raises(ValueError, match="H3EZ_CONTINUITY_AUDIT"):
        get_audit_mode()


@pytest.mark.parametrize('frames', [5, 22, 39])
@pytest.mark.parametrize('phase', [-1/3, 0., 1/3])
def test_all_rows_and_signed_grid_phase(frames, phase):
    video, audio, cond = context_fixture(frames)
    cond[0][1]['minimax_refs'][0][MARK_AUDIO_OVERHANG] = phase
    cond.append([cond[0][0], copy.deepcopy(cond[0][1])])
    # prepare_conditioning shallow-copies rows while sharing the context tensors.
    cond[1][1]['minimax_refs'][0].update(latent=video, audio_latent=audio)
    result = inspect_context(cond, video_context=video, audio_context=audio,
                             context_frames=frames, audio_grid_offset=phase)
    assert result['metadata_ok'] and result['continuum_ref_rows'] == 2


@pytest.mark.parametrize('field', ['latent', 'audio_latent'])
def test_same_shape_replacement_cannot_pass_as_selected_context(field):
    video, audio, cond = context_fixture(22)
    cond[0][1]['minimax_refs'][0][field] = cond[0][1]['minimax_refs'][0][field].clone()
    result = inspect_context(cond, video_context=video, audio_context=audio,
                             context_frames=22, audio_grid_offset=0.)
    assert not result['metadata_ok']
    assert any('identity mismatch' in e for e in result['metadata_errors'])


def test_orphan_audio_context_is_not_ignored():
    video, audio, cond = context_fixture(22)
    cond[0][1]['minimax_refs'].append({MARK_AUDIO_CONTEXT: True})
    assert not inspect_context(cond, video_context=video, audio_context=audio,
                               context_frames=22, audio_grid_offset=0.)['metadata_ok']


@pytest.mark.parametrize('phase', [float('nan'), float('inf'), -.6])
def test_invalid_phase_is_reportable_strict_json(phase):
    import json
    video, audio, cond = context_fixture(22)
    result = inspect_context(cond, video_context=video, audio_context=audio,
                             context_frames=22, audio_grid_offset=phase)
    assert not result['metadata_ok']
    json.dumps(result, allow_nan=False)


def test_inspection_never_reads_or_transfers_tensor_values(monkeypatch):
    video, audio, cond = context_fixture(22)
    # Invalid Tensor-valued scalar metadata must not trigger .item()/float().
    cond[0][1]['minimax_refs'][0]['latent_t'] = torch.tensor(7)
    cond[0][1]['minimax_refs'][0][MARK_AUDIO_OVERHANG] = torch.tensor(0.)
    def forbidden(*args, **kwargs):
        raise AssertionError('Diagnostic attempted a tensor read/transfer')
    for name in ('cpu', 'numpy', 'item', '__float__', '__bool__', 'to', 'clone'):
        monkeypatch.setattr(torch.Tensor, name, forbidden)
    result = inspect_context(cond, video_context=video, audio_context=audio,
                             context_frames=22, audio_grid_offset=0.)
    assert not result['metadata_ok']
