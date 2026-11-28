"""Real checkpoint/proxy I/O, with synthetic sampling and small CPU tensors."""
import json
import sys
import types
from uuid import uuid4

import av
import pytest
import torch

from h3ezstudio.plan import default_plan
from h3ezstudio.review_store import ReviewError, ReviewStore, sha_file
from h3ezstudio.review_contract import graph_identity, parse_control
from h3ezstudio.prompt_queue import prepare_video_prompt
from .test_engine_boundary import runtime


def run_review(runtime, tmp_path, mode='Images', seconds=10):
    engine, Model, Clip, VAE, _, samples = runtime
    plan = default_plan()
    plan['shots'][0]['seconds'] = seconds
    plan['shots'].append({**plan['shots'][0], 'id': 'cut', 'seconds': 2, 'transition': 'cut'})
    run_id, binding = uuid4().hex, uuid4().hex
    kwargs = dict(model=Model(), clip=Clip(), video_vae=VAE(), audio_vae=VAE(True), sampler=object(),
                  sigmas=torch.tensor([1., 0.]), timeline={'plan': plan}, seed=2**64-3,
                  width=64, height=32, input_root=tmp_path, output_root=tmp_path,
                  output_mode=mode, video_result={})
    graph = {'fixture': 'same'}

    def operation(action, *, command=None):
        store = ReviewStore(tmp_path, run_id, binding)
        with store.writer(create=action == 'next'):
            state = store.state or {}
            command = command or {
                'action': action, 'command_id': uuid4().hex, 'revision': state.get('revision', 0),
                'candidate': state['candidate']['id'] if state.get('candidate') else None,
            }
            result = engine.run_engine(**kwargs, review=(store, command, graph))
            if result is not None:
                store.finish()
            return result, store.read(), command

    return operation, engine, kwargs, samples, run_id, binding


@pytest.mark.parametrize('legacy_version', ['0.13.6', '0.13.7'])
def test_review_retry_resume_and_export(runtime, tmp_path, monkeypatch, legacy_version):
    operation, engine, kwargs, samples, run, binding = run_review(runtime, tmp_path)
    _, first, first_command = operation('next')
    first['identity'].pop('checkpoint_version')
    first['identity']['engine_version'] = legacy_version
    store = ReviewStore(tmp_path, run, binding)
    store.manifest.write_text(json.dumps(first), encoding='utf-8')
    assert operation('next', command=first_command)[0] is None
    assert len(samples) == 1
    _, second, _ = operation('next')
    assert len(samples) == 2 and second['accepted'][0]['id'] == first['candidate']['id']
    assert second['candidate']['record']['context_frames'] > 0
    assert second['candidate']['join']['boundary'] == 2
    raw_path = tmp_path / 'h3_continuum_ez' / 'runs' / run / (first['candidate']['id'] + '.safetensors')
    first_sha = sha_file(raw_path)
    proxy = engine._review_proxy

    def fail_proxy(*args, **kwargs):
        raise OSError('mock preview failure')

    monkeypatch.setattr(engine, '_review_proxy', fail_proxy)
    with pytest.raises(OSError, match='preview failure'):
        operation('retry')
    assert len(samples) == 3
    monkeypatch.setattr(engine, '_review_proxy', proxy)
    _, retried, _ = operation('resume')
    assert len(samples) == 3
    assert retried['candidate']['id'] != second['candidate']['id']
    assert retried['candidate']['record']['seed'] != second['candidate']['record']['seed']
    assert retried['accepted'][0]['sha256'] == sha_file(raw_path) == first_sha
    kwargs['sigmas'] = torch.tensor([1., .25, 0.])
    with pytest.raises(ReviewError, match='conditions changed'):
        operation('next')
    kwargs['sigmas'] = torch.tensor([1., 0.])
    _, third, _ = operation('next')
    assert third['candidate']['record']['context_frames'] == 0
    assert len(samples) == 4
    result, complete, _ = operation('next')
    assert complete['complete'] and len(complete['accepted']) == 3
    assert len(samples) == 4
    assert result[0].shape == (299, 32, 64, 3)
    public = ReviewStore(tmp_path, run, complete['binding']).status()
    assert len(public['accepted_previews']) == 3
    assert public['accepted_previews'][1]['join'] == retried['candidate']['join']
    assert set(public['accepted_previews'][1]) == {'join', 'record'}
    assert result[1]['waveform'].shape[-1] == round(299 * 32000 / 24)


def test_join_diagnosis_tracks_saved_candidate_and_accepted_preview(runtime, tmp_path):
    from h3ezstudio.review_join import diagnose_join

    operation, _, _, samples, run, binding = run_review(runtime, tmp_path)
    store = ReviewStore(tmp_path, run, binding)
    operation('next')
    _, state, _ = operation('next')
    join = state['candidate']['join']['filename']
    unchanged = sha_file(store.manifest)
    result = diagnose_join(store, join)
    assert result['available'] and result['timeline_seconds'] == state['candidate']['record']['start']
    assert (result['previous_frames'], result['next_frames'], result['planned_cut']) == (8, 6, False)
    assert len(samples) == 2 and sha_file(store.manifest) == unchanged
    with pytest.raises(ReviewError):
        diagnose_join(store, state['candidate']['preview']['filename'])
    with pytest.raises(ReviewError):
        diagnose_join(ReviewStore(tmp_path, run, uuid4().hex), join)
    _, following, _ = operation('next')
    assert diagnose_join(store, join) == result
    assert diagnose_join(store, following['candidate']['join']['filename'])['planned_cut']
    assert len(samples) == 3


def test_long_review_uses_original_audio_and_exact_legacy_output(runtime, tmp_path, monkeypatch):
    from h3ezstudio.plan import execution_plan

    operation, engine, kwargs, samples, _, _ = run_review(runtime, tmp_path, 'Long video', seconds=40)
    plan = execution_plan(kwargs['timeline']['plan'])
    assert len(plan) >= 6
    duration_samples = round(sum(part['frames'] for part in plan) * 32000 / 24)
    audio = {'sample_rate': 32000, 'waveform': torch.linspace(-.1, .15, duration_samples).repeat(1, 2, 1)}
    monkeypatch.setattr(engine, 'render_original_audio', lambda *a, **k: audio)
    legacy = engine.run_engine(**kwargs)
    original = dict(kwargs['video_result'])
    for _ in plan:
        operation('next')
    export, state, _ = operation('next')
    assert len(samples) == 2 * len(plan) and legacy[1] is audio and export[1] is audio
    assert legacy[0] is None and export[0] is None

    def signatures(record):
        path = tmp_path / record['subfolder'] / record['filename']
        with av.open(str(path)) as video:
            frames = [(frame.pts, frame.to_ndarray(format='rgb24').tobytes()) for frame in video.decode(video=0)]
        with av.open(str(path)) as media:
            wave = [(frame.pts, frame.to_ndarray().tobytes()) for frame in media.decode(audio=0)]
        return frames, wave

    assert state['complete'] and signatures(original) == signatures(kwargs['video_result'])


def test_separate_video_decoder_is_used_for_review_and_export(runtime, tmp_path):
    operation, _, kwargs, samples, _, _ = run_review(runtime, tmp_path, 'Long video', seconds=16)
    from h3ezstudio.plan import execution_plan

    class Decoder(runtime[3]):
        def decode(self, latent):
            self.calls += 1
            return super().decode(latent)

    def unexpected_video_decode(_):
        pytest.fail('Review or export used the encoding VAE to decode video')

    decoder = Decoder()
    decoder.calls = 0
    kwargs['video_vae'].decode = unexpected_video_decode
    kwargs['video_decode_vae'] = decoder
    parts = execution_plan(kwargs['timeline']['plan'])
    for _ in parts:
        _, _, _ = operation('next')
    assert decoder.calls > len(parts)  # The join preview decodes its previous section too.
    before_export = decoder.calls
    result, state, _ = operation('next')
    assert decoder.calls == before_export + len(parts)
    assert state['complete'] and len(samples) == len(parts)
    frames = sum(part['frames'] for part in parts)
    assert frames > 15 * 24
    assert result[1]['waveform'].shape[-1] == round(frames * 32000 / 24)
    video = kwargs['video_result']
    with av.open(str(tmp_path / video['subfolder'] / video['filename'])) as media:
        assert sum(1 for _ in media.decode(video=0)) == frames


def test_export_resume_uses_checkpoints_without_sampling(runtime, tmp_path, monkeypatch):
    from h3ezstudio.stream_video import StreamVideo

    operation, _, _, samples, _, _ = run_review(runtime, tmp_path, 'Long video')
    for _ in range(3):
        operation('next')
    with monkeypatch.context() as patch:
        def fail(*args):
            raise OSError('output unavailable')
        patch.setattr(StreamVideo, 'finish', fail)
        with pytest.raises(OSError, match='output unavailable'):
            operation('next')
    _, state, _ = operation('resume')
    assert state['complete'] and len(state['accepted']) == len(samples) == 3


def test_downstream_save_failure_can_retry_completed_export_without_sampling(runtime, tmp_path):
    operation, _, _, samples, run, binding = run_review(runtime, tmp_path, 'Long video')
    for _ in range(3):
        operation('next')
    original_samples = len(samples)

    def execute_save(action, *, fail):
        result, state, _ = operation(action)
        assert result is not None
        assert state['complete'] and state['pending'] is None
        if fail:
            raise OSError('downstream SaveVideo failed')
        return state

    with pytest.raises(OSError, match='downstream SaveVideo'):
        execute_save('next', fail=True)
    store = ReviewStore(tmp_path, run, binding)
    accepted = store.read()['accepted']
    assert store.status()['can_save']
    with pytest.raises(OSError, match='downstream SaveVideo'):
        execute_save('save', fail=True)
    assert execute_save('save', fail=False)['accepted'] == accepted
    assert len(samples) == len(accepted) == original_samples


def test_review_lock_and_checkpoint_integrity(runtime, tmp_path):
    operation, _, _, samples, run, binding = run_review(runtime, tmp_path)
    _, view, _ = operation('next')
    store = ReviewStore(tmp_path, run, binding)
    with store.writer():
        with pytest.raises(ReviewError, match='already running'):
            with ReviewStore(tmp_path, run, binding).writer():
                pytest.fail('Another writer took the same run')
    location = store.folder / (view['candidate']['id'] + '.safetensors')
    location.write_bytes(b'damaged')
    with pytest.raises(ReviewError, match='missing or damaged'):
        operation('next')
    assert len(samples) == 1
    assert store.read()['accepted'] == []


def test_review_contract_hashes_weights_and_rejects_unknown_loaders(tmp_path, monkeypatch):
    model = tmp_path / 'weight.safetensors'
    model.write_bytes(b'first')
    monkeypatch.setitem(sys.modules, 'folder_paths',
                        types.SimpleNamespace(get_full_path_or_raise=lambda *_: str(model)))
    graph = {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': model.name}},
        '2': {'class_type': 'H3ContinuumEZEngine', 'inputs': {
            key: ['1', 0] for key in ('model', 'clip', 'video_vae', 'audio_vae', 'sampler', 'sigmas')}},
    }
    before = graph_identity(graph, '2')
    model.write_bytes(b'other')
    assert graph_identity(graph, '2') != before
    before = graph_identity(graph, '2')
    graph['3'] = {'class_type': 'VAELoader', 'inputs': {'vae_name': 'decoder.safetensors'}}
    graph['2']['inputs']['video_decode_vae'] = ['3', 0]
    assert graph_identity(graph, '2')['links']['video_decode_vae'] == ['3', 0]
    assert graph_identity(graph, '2') != before
    del graph['2']['inputs']['video_decode_vae']
    assert graph_identity(graph, '2') == before
    graph['1']['class_type'] = 'UnknownLoader'
    with pytest.raises(ReviewError, match='UnknownLoader'):
        graph_identity(graph, '2')


def test_export_scope_excludes_unrelated_outputs(monkeypatch):
    classes = {'Save': types.SimpleNamespace(OUTPUT_NODE=True)}
    monkeypatch.setitem(sys.modules, 'nodes', types.SimpleNamespace(NODE_CLASS_MAPPINGS=classes))
    graph = {
        '20:8': {'class_type': 'H3ContinuumEZEngine', 'inputs': {'execution_control': 'test'}},
        '21': {'class_type': 'Switch', 'inputs': {'on_true': ['20:8', 0]}},
        '22': {'class_type': 'Save', 'inputs': {'source': ['21', 0]}},
        '23': {'class_type': 'Save', 'inputs': {}},
    }
    request = {'prompt': graph, 'partial_execution_targets': ['20:8'], 'h3ez_review_export': '20:8'}
    assert prepare_video_prompt(request)['partial_execution_targets'] == ['20:8', '22']
    assert request['partial_execution_targets'] == ['20:8']


@pytest.mark.parametrize('field,value', [('run', '../path'), ('revision', True), ('action', 'unknown')])
def test_invalid_command_rejected(field, value):
    data = dict(run=uuid4().hex, binding=uuid4().hex, command_id=uuid4().hex,
                action='next', revision=0, candidate=None)
    data[field] = value
    with pytest.raises(ReviewError):
        parse_control(json.dumps(data))
