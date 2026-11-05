import sys
import types
from h3ezstudio import ez_nodes
from h3ezstudio.plan import DEFAULT_JSON


def test_timeline_carries_origin_and_original_plan():
    result = ez_nodes.H3ContinuumEZTimeline().compile(DEFAULT_JSON, unique_id='42')
    timeline = result['result'][0]
    assert timeline['node_id'] == '42'
    assert timeline['source_plan']['shots'][0]['seconds'] == 5


def test_engine_publishes_preview_without_changing_outputs(monkeypatch, tmp_path):
    from h3ezstudio import engine, preview
    monkeypatch.setitem(sys.modules, 'folder_paths', types.SimpleNamespace(
        get_input_directory=lambda: str(tmp_path), get_output_directory=lambda: str(tmp_path)))
    result = (object(), object(), 24., 'report')
    monkeypatch.setattr(engine, 'run_engine', lambda **kwargs: result)
    monkeypatch.setattr(preview, 'save_preview', lambda *args: {'filename': 'test.mp4', 'subfolder':'h3_continuum_ez'})
    monkeypatch.setitem(sys.modules, 'comfy_api.latest', types.SimpleNamespace(InputImpl=types.SimpleNamespace(VideoFromFile=lambda path: path)))
    output = ez_nodes.H3ContinuumEZEngine().generate(timeline={'plan': {}, 'source_plan': {'schema': 1}, 'node_id': '42'})
    assert output['result'][:4] == result
    assert output['result'][4].endswith('test.mp4')
    assert output['ui']['h3ez_video'][0]['node_id'] == '42'
    assert output['ui']['h3ez_video'][0]['plan'] == {'schema': 1}


def test_failed_export_preserves_generated_outputs(monkeypatch, tmp_path):
    from h3ezstudio import engine, preview
    monkeypatch.setitem(sys.modules, 'folder_paths', types.SimpleNamespace(
        get_input_directory=lambda: str(tmp_path), get_output_directory=lambda: str(tmp_path)))
    result = (object(), object(), 24., 'report')
    monkeypatch.setattr(engine, 'run_engine', lambda **kwargs: result)
    def fail(*args):
        raise OSError('disk full')
    monkeypatch.setattr(preview, 'save_preview', fail)
    output = ez_nodes.H3ContinuumEZEngine().generate(timeline={'plan': {}})
    assert output['result'][:3] == result[:3]
    assert 'disk full' in output['result'][3]
    assert 'h3ez_video' not in output['ui']


def test_studio_output_mode_overrides_engine_and_checks_image_links(monkeypatch, tmp_path):
    import pytest
    from h3ezstudio import engine
    from h3ezstudio.plan import PlanError, normalize_plan

    monkeypatch.setitem(sys.modules, 'folder_paths', types.SimpleNamespace(
        get_input_directory=lambda: str(tmp_path), get_output_directory=lambda: str(tmp_path)))
    monkeypatch.setitem(sys.modules, 'comfy_api.latest', types.SimpleNamespace(
        InputImpl=types.SimpleNamespace(VideoFromFile=lambda path: path)))

    def run(**kwargs):
        assert kwargs['output_mode'] == 'Long video'
        kwargs['video_result'].update(filename='stream.mp4', subfolder='h3_continuum_ez')
        return None, object(), 24., 'report'

    monkeypatch.setattr(engine, 'run_engine', run)
    timeline = {'plan': normalize_plan(DEFAULT_JSON)}
    output = ez_nodes.H3ContinuumEZEngine().generate(timeline=timeline, output_mode='Images')
    assert output['result'][0] is None
    assert output['result'][4].endswith('stream.mp4')
    with pytest.raises(PlanError, match='Disconnect images'):
        ez_nodes.H3ContinuumEZEngine().generate(
            timeline=timeline, output_mode='Images', unique_id='7',
            prompt={'8': {'inputs': {'images': ['7', 0]}}})


def test_subgraph_switch_uses_actual_engine_output_mode(monkeypatch, tmp_path):
    import pytest
    from h3ezstudio import engine, preview
    from h3ezstudio.plan import PlanError

    monkeypatch.setitem(sys.modules, 'folder_paths', types.SimpleNamespace(
        get_input_directory=lambda: str(tmp_path), get_output_directory=lambda: str(tmp_path)))
    monkeypatch.setitem(sys.modules, 'comfy_api.latest', types.SimpleNamespace(
        InputImpl=types.SimpleNamespace(VideoFromFile=lambda path: path)))
    file = {'filename': 'stream.mp4', 'subfolder': 'h3_continuum_ez'}
    frames = object()
    modes = []

    def run(**kwargs):
        mode = kwargs['output_mode']
        modes.append(mode)
        if mode == 'Long video':
            kwargs['video_result'].update(file)
        return None if mode == 'Long video' else frames, object(), 24., 'report'

    monkeypatch.setattr(engine, 'run_engine', run)
    monkeypatch.setattr(preview, 'save_preview', lambda *args: dict(file))

    prompt = {
        '18:9': {'class_type': 'CreateVideo', 'inputs': {'images': ['18:8', 0]}},
        '18:20': {'class_type': 'ComfySwitchNode', 'inputs': {
            'switch': ['18:8', 5], 'on_false': ['18:8', 4], 'on_true': ['18:9', 0],
        }},
        '19': {'class_type': 'SaveVideo', 'inputs': {'video': ['18:20', 0]}},
    }
    node = ez_nodes.H3ContinuumEZEngine()
    video = node.generate(timeline={'plan': {'output_mode': 'Long video'}},
                          output_mode='Images', unique_id='18:8', prompt=prompt)['result']
    assert video[0] is None and video[4].endswith('stream.mp4') and video[5] is False
    images = node.generate(timeline={'plan': {'output_mode': 'Images'}},
                           output_mode='Long video', unique_id='18:8', prompt=prompt)['result']
    assert images[0] is frames and images[5] is True
    assert modes == ['Long video', 'Images']

    prompt['25'] = {'class_type': 'SaveVideo', 'inputs': {'video': ['18:9', 0]}}
    with pytest.raises(PlanError, match='Disconnect images'):
        node.generate(timeline={'plan': {'output_mode': 'Long video'}},
                      unique_id='18:8', prompt=prompt)
    assert modes == ['Long video', 'Images']
