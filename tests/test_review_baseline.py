"""Characterize the existing single-pass engine before adding a review path."""

from PIL import Image
import torch

from h3ezstudio.plan import default_plan
from h3ezstudio.vendor.continuum.v2.seeds import derive_chunk_seed
from .test_engine_boundary import runtime


def test_fixed_plan_samples_and_decodes_each_part_before_the_next(runtime, tmp_path, monkeypatch):
    engine, Model, Clip, VAE, events, samples = runtime
    plan = default_plan()
    for name in ('first', 'last', 'reference'):
        Image.new('RGB', (64, 32)).save(tmp_path / f'{name}.png')
        plan['assets'].append({
            'id': name, 'kind': 'image', 'label': name,
            'file': {'name': f'{name}.png', 'subfolder': '', 'type': 'input'},
        })
    plan['first_image'] = 'first'
    plan['reference_slots'][0] = 'reference'
    plan['global_refs'] = [1]
    first = plan['shots'][0]
    first.update(seconds=10, last_image='last', prompt='Follow @R1.', dialogue=[
        {'speaker': 'reference', 'text': 'Start walking.', 'at': 7},
    ])
    plan['shots'].append({
        **first, 'id': 'cut', 'seconds': 2, 'transition': 'cut',
        'last_image': None, 'prompt': 'A new scene.', 'dialogue': [],
    })
    base_seed = 2**63 + 5
    marks = []
    seams = []
    original = engine.correct_boundary

    def check_boundary(tail, part):
        seams.append((tail.shape[0], part.shape[0]))
        return original(tail, part)

    monkeypatch.setattr(engine, 'correct_boundary', check_boundary)
    video, audio, fps, report = engine.run_engine(
        model=Model(), clip=Clip(), video_vae=VAE(), audio_vae=VAE(audio=True),
        sampler=object(), sigmas=torch.tensor([1., .5, 0.]),
        timeline={'plan': plan, 'external_prompt': 'A fixed external prompt.'},
        seed=base_seed, input_root=tmp_path, width=64, height=32,
        progress=lambda event, **payload: marks.append((event, payload)),
    )

    parts = marks[0][1]['parts']
    assert [(p['start_frame'], p['frames'], p['transition'], p['last_image']) for p in parts] == [
        (0, 124, 'cut', None), (124, 119, 'continue', 'last'), (243, 56, 'cut', None),
    ]
    assert [event for event, _ in marks] == ['start'] + ['preparing', 'sampling', 'decoding', 'part_complete'] * 3
    assert [event for event in events if event in ('sample', 'video_decode', 'audio_decode')] == [
        'sample', 'video_decode', 'audio_decode',
    ] * 3
    assert seams == [(engine.TAIL_FRAMES, 119)]
    seed = derive_chunk_seed(base_seed, 0, 0)
    assert [record['seed'] for record in samples] == [
        seed, derive_chunk_seed(seed, 1, 0), derive_chunk_seed(base_seed, 1, 0),
    ]
    first_cond, next_cond, cut_cond = [sample['cond']['positive'][0][1] for sample in samples]
    assert 'Follow <Picture 2>.' in first_cond['fixture_prompt']
    assert 'Follow <Picture 3>.' in next_cond['fixture_prompt']
    assert 'Start walking.' in next_cond['fixture_prompt']
    assert 'Start walking.' not in first_cond['fixture_prompt'] + cut_cond['fixture_prompt']
    assert all('A fixed external prompt.' in cond['fixture_prompt'] for cond in (first_cond, next_cond, cut_cond))
    assert next_cond['minimax_refs'][-1]['_h3cj_video_context']
    assert not cut_cond['minimax_refs'][-1].get('_h3cj_video_context')
    assert fps == 24 and video.shape == (299, 32, 64, 3)
    assert audio['waveform'].shape == (1, 2, round(299 * audio['sample_rate'] / fps))
    assert '299 frames at 24 fps' in report
