from copy import deepcopy
from types import SimpleNamespace

import pytest

from h3ezstudio.prompt_queue import prepare_video_prompt, register_prompt_handler


def request():
    return {
        'prompt': {
            '18:8': {'class_type': 'H3ContinuumEZEngine', 'inputs': {
                'clip': ['18:2', 0], 'prompt_clip': ['18:25', 0], 'seed': 123,
                'timeline': ['7', 0]}, '_meta': {'title': 'Engine'}},
            '18:25': {'class_type': 'CLIPLoader', 'inputs': {
                'clip_name': 'not-installed.safetensors', 'type': 'minimax', 'device': 'default'}},
        },
        'extra_data': {'extra_pnginfo': {'workflow': {'links': [[48, 25, 0, 8, 7, 'CLIP']]}}},
        'client_id': 'test-client', 'partial_execution_targets': ['18:8'],
    }


def test_video_excludes_only_ai_binding_without_rewiring_saved_workflow():
    source = request()
    before = deepcopy(source)
    result = prepare_video_prompt(source)
    expected = deepcopy(source)
    del expected['prompt']['18:8']['inputs']['prompt_clip']
    assert result == expected
    assert source == before
    assert result['extra_data'] is source['extra_data']
    assert result['prompt']['18:25'] is source['prompt']['18:25']
    assert prepare_video_prompt(result) is result


def test_shared_model_consumers_and_explicit_ai_jobs_remain_intact():
    source = request()
    source['prompt']['text'] = {'class_type': 'TextGenerateV2', 'inputs': {'clip': ['18:25', 0]}}
    result = prepare_video_prompt(source)
    assert result['prompt']['text'] == source['prompt']['text']
    assert result['prompt']['18:25'] == source['prompt']['18:25']
    del source['prompt']['18:8']
    assert prepare_video_prompt(source) is source


def test_multiple_engines_filter_independently_without_changing_video_clip():
    source = request()
    source['prompt']['second'] = deepcopy(source['prompt']['18:8'])
    source['prompt']['second']['inputs']['clip'] = ['18:25', 0]
    result = prepare_video_prompt(source)
    for node_id in ['18:8', 'second']:
        assert 'prompt_clip' not in result['prompt'][node_id]['inputs']
    assert result['prompt']['second']['inputs']['clip'] == ['18:25', 0]


@pytest.mark.parametrize('value', [None, [], {}, {'prompt': None}, {'prompt': {}},
                                  {'prompt': {'8': None}},
                                  {'prompt': {'8': {'class_type': 'H3ContinuumEZEngine', 'inputs': None}}}])
def test_unrelated_or_malformed_requests_are_left_for_core_validation(value):
    assert prepare_video_prompt(value) is value


def test_registration_uses_public_hook_once():
    handlers = []
    server = SimpleNamespace(add_on_prompt_handler=handlers.append)
    register_prompt_handler(server)
    register_prompt_handler(server)
    assert handlers == [prepare_video_prompt]
