"""Keep Studio's model binding out of ordinary video execution dependencies."""
from __future__ import annotations

import sys


def _review_targets(prompt, engine_id):
    """Select the Engine and output nodes downstream of that Engine only."""
    from collections import defaultdict

    consumers = defaultdict(list)
    for node_id, node in prompt.items():
        for value in node.get('inputs', {}).values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[1], int):
                consumers[str(value[0])].append(node_id)
    classes = getattr(sys.modules.get('nodes'), 'NODE_CLASS_MAPPINGS', {})
    pending = list(consumers[engine_id])
    visited = {engine_id}
    targets = [engine_id]
    while pending:
        node_id = pending.pop()
        if node_id in visited:
            continue
        visited.add(node_id)
        if getattr(classes.get(prompt[node_id].get('class_type')), 'OUTPUT_NODE', False):
            targets.append(node_id)
        pending.extend(consumers[node_id])
    return targets


def prepare_video_prompt(request):
    """Copy only EZ inputs that need filtering; leave the saved workflow intact.

    Core validates upstream nodes even for lazy inputs. The prompt_clip wire is
    a Studio binding for an explicit, separate AI text job, never a video input.
    Removing it from the execution prompt before validation lets a saved original
    or AI text render without requiring the optional text model to be installed.
    Do not remove its source node: other real consumers must still be validated.
    """
    if not isinstance(request, dict) or not isinstance(request.get('prompt'), dict):
        return request
    prompt = request['prompt']
    updates = {}
    for node_id, node in prompt.items():
        if not isinstance(node, dict) or node.get('class_type') != 'H3ContinuumEZEngine':
            continue
        inputs = node.get('inputs')
        if isinstance(inputs, dict) and any(key in inputs for key in ('prompt_clip','ai_instruction')):
            updates[node_id] = {**node, 'inputs': {key: value for key, value in inputs.items()
                                                 if key not in ('prompt_clip','ai_instruction')}}
    if updates:
        request = {**request, 'prompt': {**prompt, **updates}}
    export_engine = request.get('h3ez_review_export')
    if isinstance(export_engine, str):
        node = prompt.get(export_engine, {})
        if node.get('class_type') == 'H3ContinuumEZEngine' and node.get('inputs', {}).get('execution_control'):
            request = {**request, 'partial_execution_targets': _review_targets(prompt, export_engine)}
    return request


def register_prompt_handler(server=None):
    """Use ComfyUI's pre-validation extension hook; no loader or Core patches."""
    if server is None:
        module = sys.modules.get('server')
        server = getattr(getattr(module, 'PromptServer', None), 'instance', None)
    if server is None or getattr(server, '_h3ez_video_prompt_registered', False):
        return
    server.add_on_prompt_handler(prepare_video_prompt)
    server._h3ez_video_prompt_registered = True
