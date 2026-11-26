"""Identify review inputs without serializing model objects or loading model weights."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path

from .review_store import ReviewError, sha_file, token


_FILES = {
    'UNETLoader': ('diffusion_models', 'unet_name'),
    'CLIPLoader': ('text_encoders', 'clip_name'),
    'VAELoader': ('vae', 'vae_name'),
    'LoraLoaderModelOnly': ('loras', 'lora_name'),
}
_BUILTINS = {
    'KSamplerSelect', 'BasicScheduler', 'ManualSigmas', 'ModelAttentionBackend',
    'BlockSparseAttention', 'MiniMaxH3SigmaShift',
}
_INPUTS = ('model', 'clip', 'video_vae', 'audio_vae', 'sampler', 'sigmas')


def parse_control(value):
    control = json.loads(value)
    expected = {'run', 'binding', 'command_id', 'action', 'revision', 'candidate'}
    if not isinstance(control, dict) or set(control) != expected:
        raise ReviewError('Invalid review command')
    for key in ('run', 'binding', 'command_id'):
        token(control[key])
    if control['candidate'] is not None:
        token(control['candidate'])
    if control['action'] not in ('next', 'retry', 'resume', 'preview'):
        raise ReviewError('Unknown review command')
    if type(control['revision']) is not int or control['revision'] < 0:
        raise ReviewError('Invalid review revision')
    return control


@lru_cache(maxsize=24)
def _file_identity(path, version):
    return sha_file(path)


def _file_version(path):
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


def graph_identity(prompt, engine_id):
    import folder_paths

    if not isinstance(prompt, dict) or str(engine_id) not in prompt:
        raise ReviewError('Review requires a compiled ComfyUI workflow')
    graph = {}

    def describe(link):
        if not isinstance(link, list) or len(link) != 2 or str(link[0]) not in prompt:
            raise ReviewError('Review model input is not linked to a supported loader')
        node_id = str(link[0])
        if node_id in graph:
            return
        node = prompt[node_id]
        kind = node['class_type']
        values = node['inputs']
        if kind not in _FILES and kind not in _BUILTINS:
            raise ReviewError(f'Review cannot verify inputs from {kind}. Use ordinary generation.')
        data = {'class': kind, 'inputs': values}
        graph[node_id] = data
        if kind in _FILES:
            category, key = _FILES[kind]
            if not isinstance(values.get(key), str):
                raise ReviewError(f'Review requires a fixed file in {kind}')
            path = Path(folder_paths.get_full_path_or_raise(category, values[key])).resolve()
            version = _file_version(path)
            data['weight'] = _file_identity(path, version)
            if _file_version(path) != version:
                raise ReviewError('A model file changed while verifying review inputs')
        for value in values.values():
            if isinstance(value, list) and len(value) == 2 and str(value[0]) in prompt:
                describe(value)

    inputs = prompt[str(engine_id)]['inputs']
    links = {key: inputs.get(key) for key in _INPUTS}
    if inputs.get('video_decode_vae') is not None:
        links['video_decode_vae'] = inputs['video_decode_vae']
    for link in links.values():
        describe(link)
    return {'links': links, 'nodes': graph}


def run_identity(timeline, input_root, width, height, sigmas, mode, graph):
    from .plan import fingerprint
    from .version import __version__

    return {
        'plan': fingerprint(timeline['plan'], input_root),
        'external_prompt': hashlib.sha256((timeline.get('external_prompt') or '').encode()).hexdigest(),
        'size': [width, height], 'sigmas': sigmas.detach().cpu().tolist(),
        'output_mode': mode, 'graph': graph, 'engine_version': __version__,
    }
