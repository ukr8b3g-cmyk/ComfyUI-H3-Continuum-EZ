"""Run with ComfyUI's Python: this_file.py /path/to/ComfyUI (CPU, no inference)."""
import asyncio
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys

comfy_root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(comfy_root))
sys.argv = [sys.argv[0], '--cpu']
import nodes
import execution

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('h3ez_check', root / '__init__.py',
                                            submodule_search_locations=[str(root)])
package = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = package
spec.loader.exec_module(package)
from h3ez_check.plan import default_plan
from h3ez_check.prompt_queue import prepare_video_prompt


class TypedSources:
    RETURN_TYPES = ('MODEL', 'CLIP', 'VAE', 'VAE', 'SAMPLER', 'SIGMAS')

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {}}


# Sources only stand in for tensors. Core and EZ validation are unmodified.
nodes.NODE_CLASS_MAPPINGS.update(package.NODE_CLASS_MAPPINGS)
nodes.NODE_CLASS_MAPPINGS['H3EZValidationSources'] = TypedSources
plan = default_plan()
plan['prompt_enhancer'] = {'enabled': False, 'texts': []}
prompt = {
    'sources': {'class_type': 'H3EZValidationSources', 'inputs': {}},
    'timeline': {'class_type': 'H3ContinuumEZTimeline', 'inputs': {'timeline_json': json.dumps(plan)}},
    'engine': {'class_type': 'H3ContinuumEZEngine', 'inputs': {
        **{name: ['sources', slot] for slot, name in enumerate(
            ['model', 'clip', 'video_vae', 'audio_vae', 'sampler', 'sigmas'])},
        'timeline': ['timeline', 0], 'seed': 0, 'prompt_clip': ['ai', 0]}},
    'ai': {'class_type': 'CLIPLoader', 'inputs': {
        'clip_name': '__h3ez_missing_ai_model__.safetensors', 'type': 'minimax', 'device': 'default'}},
}


async def main():
    async def validate(graph):
        return await execution.validate_prompt('h3ez-cpu-validation', deepcopy(graph), ['engine'])

    baseline = await validate(prompt)
    assert not baseline[0] and 'ai' in baseline[3], baseline
    fixed = prepare_video_prompt({'prompt': prompt})['prompt']
    assert (await validate(fixed))[0]
    for enabled in (False, True):
        for mode in ('Images', 'Long video'):
            case = deepcopy(prompt)
            p = deepcopy(plan)
            p['prompt_enhancer']['enabled'] = enabled
            case['timeline']['inputs']['timeline_json'] = json.dumps(p)
            case['engine']['inputs']['output_mode'] = mode
            assert (await validate(prepare_video_prompt({'prompt': case})['prompt']))[0]
    shared = deepcopy(prompt)
    shared['engine']['inputs']['clip'] = ['ai', 0]
    invalid = await validate(prepare_video_prompt({'prompt': shared})['prompt'])
    assert not invalid[0] and 'ai' in invalid[3], invalid
    # Explicit AI loading is still checked by Core; filtering never changes it.
    ai_request = {'prompt': {'ai': deepcopy(prompt['ai'])}}
    assert prepare_video_prompt(ai_request) is ai_request
    ai_validation = await execution.validate_inputs('h3ez-ai-validation', ai_request['prompt'], 'ai', {})
    assert not ai_validation[0]
    assert 'prompt_clip' in prompt['engine']['inputs']
    print(json.dumps({'core_validation': 'PASS', 'baseline_reproduced': True,
                      'both_output_modes': True, 'both_enabled_states': True,
                      'shared_model_validation_preserved': True,
                      'explicit_AI_validation_preserved': True, 'model_loading': False}))


asyncio.run(main())
