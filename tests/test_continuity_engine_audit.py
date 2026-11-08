"""Engine-level proof: fixture sampling must NOT be misreported as real wrapper use."""
import copy
import json
import pytest
import torch

from h3ezstudio.plan import default_plan
from .test_engine_boundary import runtime


def _two_part_plan():
    plan = default_plan()
    second = copy.deepcopy(plan['shots'][0])
    second.update(id='shot-2', transition='continue')
    plan['shots'].append(second)
    return plan


def _generate(runtime, tmp_path):
    eng, Model, Clip, VAE, events, records = runtime
    return eng.run_engine(
        model=Model(), clip=Clip(), video_vae=VAE(), audio_vae=VAE(True),
        sampler=object(), sigmas=torch.tensor([1., 0.]),
        timeline={'plan': _two_part_plan()}, seed=17, width=64, height=32,
        input_root=tmp_path,
    )


def test_default_audit_off_keeps_report_unchanged(runtime, tmp_path, monkeypatch):
    monkeypatch.delenv('H3EZ_CONTINUITY_AUDIT', raising=False)
    result = _generate(runtime, tmp_path)
    assert 'H3EZ_CONTINUITY_AUDIT ' not in result[3]


def test_report_mode_does_not_claim_a_fixture_sampler_used_the_wrapper(runtime, tmp_path, monkeypatch):
    monkeypatch.setenv('H3EZ_CONTINUITY_AUDIT', 'report')
    result = _generate(runtime, tmp_path)
    tagged = [line.removeprefix('H3EZ_CONTINUITY_AUDIT ') for line in result[3].splitlines()
              if line.startswith('H3EZ_CONTINUITY_AUDIT ')]
    assert len(tagged) == 2
    first, next_part = map(json.loads, tagged)
    assert first['transition'] == 'cut' and first['context_frames'] == 0
    assert first['ok'] is True
    assert next_part['transition'] == 'continue' and next_part['metadata_ok'] is True
    assert next_part['wrapper_validation_calls'] == 0
    assert next_part['ok'] is False  # Stub Guider does not execute MODEL wrappers.


def test_assert_mode_rejects_missing_real_wrapper_execution(runtime, tmp_path, monkeypatch):
    monkeypatch.setenv('H3EZ_CONTINUITY_AUDIT', 'assert')
    with pytest.raises(RuntimeError, match='continuity audit failed'):
        _generate(runtime, tmp_path)


def test_report_does_not_change_fixture_video_or_audio(runtime, tmp_path, monkeypatch):
    monkeypatch.delenv('H3EZ_CONTINUITY_AUDIT', raising=False)
    baseline = _generate(runtime, tmp_path)
    monkeypatch.setenv('H3EZ_CONTINUITY_AUDIT', 'report')
    observed = _generate(runtime, tmp_path)
    assert torch.equal(baseline[0], observed[0])
    assert baseline[1]['sample_rate'] == observed[1]['sample_rate']
    assert torch.equal(baseline[1]['waveform'], observed[1]['waveform'])
    assert baseline[2] == observed[2]


def test_off_never_inspects_or_creates_profiler(runtime, tmp_path, monkeypatch):
    monkeypatch.delenv('H3EZ_CONTINUITY_AUDIT', raising=False)
    def forbidden(*args, **kwargs):
        raise AssertionError('Audit created while off')
    eng = runtime[0]
    monkeypatch.setattr(eng, 'inspect_context', forbidden)
    monkeypatch.setattr(eng, 'LayoutValidationProfiler', forbidden)
    monkeypatch.setattr(eng, 'build_audit_record', forbidden)
    _generate(runtime, tmp_path)


def test_report_inspection_failure_is_fail_soft_and_does_not_leak_text(runtime, tmp_path, monkeypatch, caplog):
    monkeypatch.setenv('H3EZ_CONTINUITY_AUDIT', 'report')
    def broken(*args, **kwargs):
        raise ValueError('private prompt or filename')
    monkeypatch.setattr(runtime[0], 'inspect_context', broken)
    result = _generate(runtime, tmp_path)
    assert 'context inspection failed: ValueError' in result[3]
    assert 'private prompt or filename' not in result[3] + caplog.text


@pytest.mark.parametrize('forecast', [False, True])
def test_real_cpu_wrapper_evidence_rejects_forecast_only(runtime, forecast):
    from .upstream_test_layout_adapter import _fake_layout, _context_ref
    from h3ezstudio.vendor.continuum.model_patch import _wrapper_factory, LayoutValidationProfiler
    from h3ezstudio.continuity_audit import build_audit_record, inspect_context
    video = torch.zeros(1, 24, 7, 2, 4)
    audio = torch.zeros(1, 32, 2, 37)
    ref = _context_ref(video, audio)
    ref['latent_w'] = 4  # Two packed rows per video slot at a 2x4 latent grid.
    cond = [[torch.zeros(1), {'minimax_refs': [ref]}]]
    layout, *_ = _fake_layout()
    layout.signature = (3, 7, 2, 4, 10)
    payload = {'layout': layout, 'refs': [ref], 'keyframes': [], 'frame_count': 22}
    profiler = LayoutValidationProfiler(route_markers='cpu-fixture')
    wrapper = _wrapper_factory(strict=False, debug=False, validation_profiler=profiler)
    called = []
    class Executor:
        class_obj = runtime[1]().model
        def __call__(self, *args, **kwargs):
            called.append(True)
            return 'cpu-executed'
    for _ in range(2):
        assert wrapper(Executor(), video, minimax_payload=payload,
                       transformer_options={'spectrum_h3_actual': not forecast}) == 'cpu-executed'
    context = inspect_context(cond, video_context=video, audio_context=audio,
                              context_frames=22, audio_grid_offset=1/3)
    proof = build_audit_record(part=2, shot=2, transition='continue', context_frames=22,
                              motion_score=0., selection_reason='fixture', context=context, profiler=profiler)
    assert len(called) == 2 and proof['metadata_ok']
    assert proof['wrapper_full_validations'] == 2
    assert proof['wrapper_failed_validations'] == 0
    assert proof['ok'] is (not forecast)
    assert proof['wrapper_actual_validations'] == (0 if forecast else 2)
