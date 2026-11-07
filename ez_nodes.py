"""Two public nodes; all long-form editing lives in the HTML Studio."""
from __future__ import annotations
from collections import defaultdict
from pathlib import Path
import sys
from .plan import (DEFAULT_JSON, PlanError, normalize_plan, fingerprint, preview_prompts, shot_geometry,
                   DEFAULT_WIDTH, DEFAULT_HEIGHT, MAX_DIMENSION, validate_dimension, common_prompt)

class H3ContinuumEZTimeline:
    CATEGORY = 'H3 Continuum EZ'
    FUNCTION = 'compile'
    RETURN_TYPES = ('H3_EZ_STUDIO_PLAN',)
    RETURN_NAMES = ('timeline',)
    DESCRIPTION = 'Open Studio for images, long prompts and original-audio editing. No Run/Take history.'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'timeline_json': ('STRING', {'default': DEFAULT_JSON, 'multiline': True, 'dynamicPrompts': False})},
                'hidden': {'unique_id': 'UNIQUE_ID'},
                'optional': {'external_prompt': ('STRING', {'forceInput': True, 'tooltip': 'Optional common prompt. Edit in Studio to use local text; choose External text in Studio to use this input again.'})}}

    @classmethod
    def IS_CHANGED(cls, timeline_json, external_prompt=None, unique_id=None):
        import folder_paths
        p = normalize_plan(timeline_json)
        return (fingerprint(p, Path(folder_paths.get_input_directory())), external_prompt)

    def compile(self, timeline_json, external_prompt=None, unique_id=None):
        plan = normalize_plan(timeline_json)
        from .enhancer import verified_plan
        warnings = []
        if plan.get('prompt_enhancer', {}).get('enabled') is True and any(x.get('images') for x in plan.get('prompt_enhancer', {}).get('texts', [])):
            import folder_paths
            plan, warnings = verified_plan(plan, Path(folder_paths.get_input_directory()))
        resolved = preview_prompts(plan, external_prompt)
        # The UI receives the executed prompt, not a guess from upstream widgets.
        ui = {'h3ez_common': [common_prompt(plan, external_prompt)], 'h3ez_external': [external_prompt],
              'h3ez_prompts': [resolved], 'h3ez_geometry': [shot_geometry(plan)], 'h3ez_assist_warnings': [warnings]}
        return {'ui': ui, 'result': ({'plan': plan, 'external_prompt': external_prompt, 'node_id': unique_id, 'source_plan': __import__('json').loads(timeline_json)},)}

def _is_output_link(value, node_id, slot):
    return isinstance(value, list) and len(value) == 2 and str(value[0]) == str(node_id) and value[1] == slot


def _is_inactive_switch_input(node, name, engine_id):
    if node.get('class_type') != 'ComfySwitchNode':
        return False
    switch = node['inputs'].get('switch')
    if _is_output_link(switch, engine_id, 5):
        switch = False  # This Engine's output_images is false in Long video mode.
    return type(switch) is bool and name == ('on_false' if switch else 'on_true')


def _has_active_image_consumer(prompt, engine_id):
    consumers = defaultdict(list)
    for target, node in prompt.items():
        for name, value in node.get('inputs', {}).items():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[1], (int, float)):
                if not _is_inactive_switch_input(node, name, engine_id):
                    consumers[str(value[0])].append((value[1], target))

    # ComfyUI queues output nodes and their dependencies. A disconnected chain
    # of intermediate nodes will never request the Engine's frames.
    node_classes = getattr(sys.modules.get('nodes'), 'NODE_CLASS_MAPPINGS', {})
    pending = [target for slot, target in consumers[str(engine_id)] if slot == 0]
    seen = set()
    while pending:
        target = pending.pop()
        if target in seen:
            continue
        seen.add(target)
        node_class = node_classes.get(prompt[target].get('class_type'))
        if node_class is None or getattr(node_class, 'OUTPUT_NODE', False) is True:
            return True
        pending.extend(child for _, child in consumers[str(target)])
    return False


class H3ContinuumEZEngine:
    OUTPUT_NODE = True
    CATEGORY = 'H3 Continuum EZ'
    FUNCTION = 'generate'
    RETURN_TYPES = ('IMAGE', 'AUDIO', 'FLOAT', 'STRING', 'VIDEO', 'BOOLEAN')
    RETURN_NAMES = ('images', 'audio', 'fps', 'report', 'video', 'output_images')
    DESCRIPTION = 'Continuum core with managed disk-backed buffers. Long video writes MP4 without IMAGE output. No Resume or Second Pass.'

    @classmethod
    def INPUT_TYPES(cls):
        dimensions = {'min': 32, 'max': MAX_DIMENSION, 'step': 32}
        return {'required': {
            'model': ('MODEL',), 'clip': ('CLIP',), 'video_vae': ('VAE',), 'audio_vae': ('VAE',),
            'sampler': ('SAMPLER',), 'sigmas': ('SIGMAS',), 'timeline': ('H3_EZ_STUDIO_PLAN',),
            'seed': ('INT', {'default': 0, 'min': 0, 'max': 0xffffffffffffffff, 'control_after_generate': True})},
            'optional': {
            # Studio follows this explicit connection for its auxiliary text job.
            # Video sampling uses the saved selected prose, so do not load a second
            #  text encoder merely to render an already edited timeline.
            'prompt_clip': ('CLIP', {'lazy': True, 'tooltip': 'Prompt enhancer model. Connect a minimax Load CLIP. Studio AI Generate uses this connection; video generation uses the selected saved text without running the enhancer again.'}),
            # Keep the old widget positions so LiteGraph can restore older workflows.
            'megapixels': ('FLOAT', {'default': .3, 'min': .1, 'max': 2., 'step': .05, 'hidden': True}),
            'aspect': (['16:9', '9:16', '1:1', '4:3', '3:4'], {'hidden': True}),
            'width': ('INT', {**dimensions, 'default': DEFAULT_WIDTH, 'tooltip': 'Output width in pixels. Use a multiple of 32.'}),
            'height': ('INT', {**dimensions, 'default': DEFAULT_HEIGHT, 'tooltip': 'Output height in pixels. Use a multiple of 32.'}),
            'buffer_backend': (['Disk-backed', 'Auto', 'RAM'], {'default': 'Disk-backed', 'tooltip': 'Images mode: Disk-backed uses disk buffers to reduce RAM use. Auto selects RAM or disk based on available memory. RAM keeps buffers in memory. Long video always uses disk buffers.'}),
            'output_mode': (['Images', 'Long video'], {'default': 'Images', 'tooltip': 'Studio can choose the output format. Both modes provide an audio/video preview and video output. Long video writes in parts to reduce RAM use. If this workflow also needs image data, image output is enabled automatically without changing any connections.'})},
            'hidden': {'prompt': 'PROMPT', 'unique_id': 'UNIQUE_ID'}}

    @classmethod
    def VALIDATE_INPUTS(cls, width=None, height=None):
        try:
            if width is not None:
                validate_dimension(width, 'Width')
            if height is not None:
                validate_dimension(height, 'Height')
        except PlanError as error:
            return str(error)
        return True

    def generate(self, **kwargs):
        import folder_paths
        from .engine import run_engine
        prompt, unique_id = kwargs.pop('prompt', None), kwargs.pop('unique_id', None)
        kwargs.pop('prompt_clip', None)
        timeline = kwargs.get('timeline')
        studio_mode = timeline['plan'].get('output_mode') if timeline is not None else None
        if studio_mode is not None:
            kwargs['output_mode'] = studio_mode
        streaming = kwargs.get('output_mode') == 'Long video'
        if streaming and prompt and unique_id is not None and _has_active_image_consumer(prompt, unique_id):
            # An existing image-processing branch must work without manual rewiring.
            kwargs['output_mode'] = 'Images'
            streaming = False
        kwargs.setdefault('buffer_backend', 'Disk-backed')
        exported = {}
        from .progress import GenerationProgress
        from .preview_session import PreviewSession
        progress = GenerationProgress(timeline or {}, unique_id)
        with PreviewSession(getattr(folder_paths,'get_temp_directory',lambda:None)(),
                            folder_paths.get_output_directory(),progress.run_id) as session:
            try:
                result = run_engine(**kwargs, input_root=Path(folder_paths.get_input_directory()),
                                    output_root=folder_paths.get_output_directory(), video_result=exported,
                                    progress=progress, preview_session=session)
            except BaseException as error:
                interrupted=isinstance(error,(KeyboardInterrupt,InterruptedError)) or type(error).__name__=='InterruptProcessingException'
                progress('interrupted' if interrupted else 'failed')
                raise
        from .preview import save_preview
        try:
            preview = exported if streaming else save_preview(*result[:3], folder_paths.get_output_directory())
        except Exception as error:
            import logging
            logging.getLogger(__name__).exception('EZ preview export failed')
            progress('finished', preview_warning=str(error))
            return {'ui': {'h3ez_preview_error': [str(error)]},
                    'result': (*result[:3], result[3] + '\nPreview MP4 export failed: ' + str(error), None, not streaming)}
        timeline = kwargs['timeline']
        preview.update(node_id=timeline.get('node_id'), plan=timeline.get('source_plan', timeline['plan']),thumbnails=session.filmstrip)
        progress('finished')
        from comfy_api.latest import InputImpl
        video = InputImpl.VideoFromFile(str(Path(folder_paths.get_output_directory()) / preview['subfolder'] / preview['filename']))
        return {'ui': {'h3ez_video': [preview]}, 'result': (*result, video, not streaming)}

NODE_CLASS_MAPPINGS = {'H3ContinuumEZTimeline': H3ContinuumEZTimeline, 'H3ContinuumEZEngine': H3ContinuumEZEngine}
NODE_DISPLAY_NAME_MAPPINGS = {'H3ContinuumEZTimeline': 'H3 Continuum EZ Timeline', 'H3ContinuumEZEngine': 'H3 Continuum EZ Engine'}
