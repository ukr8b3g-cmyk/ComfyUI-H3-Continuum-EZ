"""CPU-only preparation for explicitly requested, standard ComfyUI text jobs.

No model inference occurs in an HTTP handler. The client submits the returned
fixed graph to Core's queue; model management belongs to Core. No external URLs,
model downloads, workflow mutation, or global interrupts are performed here.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import urlsplit
from uuid import uuid4

from .enhancer import (CONTRACT, VISUAL_CONTRACT, MAX_AI_IMAGES, MAX_INSTRUCTION, PROFILE, SYSTEM_PROMPT, canonical, compatible_dependencies, dependency_payload, digest,
                       original_text, resolve_prompt_text, target_key, validate_candidate, normalize_enhancer)
from .plan import normalize_plan, asset_path, used_asset_ids, shot_geometry, execution_plan

PREFIX = '/h3-continuum-ez/assist'
DEFAULT_MODEL = 'p-h3-image_prompt_upsampler_w4a8.safetensors'
MAX_BODY = 8 * 1024 * 1024
MAX_INPUT_CHARS = 24_000
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_IMAGE_PIXELS = 64 * 1024 * 1024
AI_PIXELS = 500_000
AI_TOTAL_PIXELS = 2_000_000
DERIVED_FOLDER = 'h3ez-assist-inputs'
DERIVED_QUOTA = 512 * 1024 * 1024


class AssistError(ValueError):
    status = 400


def require_enabled(plan):
    if plan.get('schema') != 2 or plan.get('prompt_enhancer', {}).get('enabled') is not True:
        raise AssistError('Prompt enhancer is OFF / プロンプトエンハンサーはOFFです')


def _prepare_image(asset, input_root, pixel_budget=AI_PIXELS):
    """Read once, hash the exact decoded bytes, and keep the source untouched."""
    from PIL import Image, ImageOps
    source = asset_path(asset, input_root)
    if source.stat().st_size > MAX_IMAGE_BYTES:
        raise AssistError('AI input image exceeds 64 MiB / AI入力画像が64 MiBを超えています')
    with source.open('rb') as handle:
        data = handle.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise AssistError('AI input image exceeds 64 MiB')
    source_hash = hashlib.sha256(data).hexdigest()
    root = Path(input_root).resolve()
    folder = root / DERIVED_FOLDER
    if folder.is_symlink():
        raise AssistError('AI input folder must not be a symbolic link')
    folder.mkdir(exist_ok=True)
    if folder.resolve() != folder:
        raise AssistError('AI input folder resolves outside the managed location')
    # The manifest declares ownership; arbitrary user files are never cleaned.
    marker = folder / '.h3ez-assist-owner.json'
    if marker.exists():
        if marker.is_symlink() or marker.stat().st_size > 4096:
            raise AssistError('Invalid AI input ownership marker')
        if json.loads(marker.read_text(encoding='utf-8')).get('schema') != 'h3ez-assist-inputs-v1':
            raise AssistError('Unrecognized AI input ownership marker')
    else:
        if any(folder.iterdir()):
            raise AssistError('AI input directory contains unowned files; choose an empty managed directory')
        try:
            with marker.open('x', encoding='utf-8') as handle:
                json.dump({'schema':'h3ez-assist-inputs-v1'}, handle)
        except FileExistsError:
            # A simultaneous request created it. Revalidate before writing below.
            if marker.is_symlink() or json.loads(marker.read_text()).get('schema') != 'h3ez-assist-inputs-v1':
                raise AssistError('AI input ownership changed')
    identity = digest(source_hash + f':rgb-exif-lanczos-{pixel_budget}-v1')
    name = f'AI_{identity}.png'
    target = folder / name
    if target.is_symlink():
        raise AssistError('AI image destination must not be a link')
    if not target.exists() and sum(x.stat().st_size for x in folder.iterdir() if x.is_file()) > DERIVED_QUOTA - 8 * 1024**2:
        raise AssistError('AI derived-image storage is full. With all AI jobs stopped, remove only this extension’s derived images in h3ez-assist-inputs; originals are not affected.')
    # Always validate even if a derived copy exists; cached files are not trusted
    # as a substitute for the source size/type check.
    with Image.open(io.BytesIO(data)) as image:
        if image.width < 1 or image.height < 1 or image.width * image.height > MAX_IMAGE_PIXELS:
            raise AssistError('AI image exceeds 64 megapixels / 画像の面積が上限を超えています')
        image = ImageOps.exif_transpose(image)
        ratio = min(1.0, math.sqrt(pixel_budget / (image.width * image.height)),
                    1536 / max(image.width, image.height))
        size = (max(1, int(image.width * ratio)), max(1, int(image.height * ratio)))
        image.thumbnail(size, Image.Resampling.LANCZOS)
        image = image.convert('RGB')
        descriptor, pending = tempfile.mkstemp(prefix='.AI_', suffix='.partial', dir=folder)
        try:
            with os.fdopen(descriptor, 'wb') as handle:
                image.save(handle, format='PNG')
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(pending, target)
        finally:
            Path(pending).unlink(missing_ok=True)
    return f'{DERIVED_FOLDER}/{name}', {'id':asset['id'], 'sha256':source_hash}


def prepare_request(body, input_root, available_models, model_identity=None):
    if not isinstance(body, dict) or set(body) - {'plan','target','external_prompt','image_id','model','loader','contract','output_size','ai_instruction','video_context'}:
        raise AssistError('Invalid AI request fields')
    plan = normalize_plan(body.get('plan'),allow_audio_overhang=True)
    require_enabled(plan)  # Before model/file work, even for hand-written API calls.
    instruction = body.get('ai_instruction', plan.get('prompt_enhancer', {}).get('instruction', ''))
    if not isinstance(instruction,str) or len(instruction)>MAX_INSTRUCTION or '\0' in instruction:
        raise AssistError('AI instruction must be text of at most 8000 characters / AI指示は8000文字以内です')
    instruction = instruction.strip() or SYSTEM_PROMPT
    if 'video_context' in body and type(body['video_context']) is not bool:
        raise AssistError('Invalid video context flag')
    target = body.get('target')
    target_key(target)
    external = body.get('external_prompt')
    if external is not None and not isinstance(external, str):
        raise AssistError('External prompt must be a string or null')
    dep = dependency_payload(plan, target, external, body.get('contract', CONTRACT), output_size=body.get('output_size'))
    if dep['contract'] == VISUAL_CONTRACT and dep['output']['width'] is None:
        raise AssistError('Output size is unresolved. Select Studio size or use literal Engine dimensions / 出力サイズが未確定です。Studioのサイズ設定またはEngineの幅・高さを指定してください')
    if not dep['text'].strip():
        raise AssistError('Enter the original text first / 先に原文を入力してください')
    if len(dep['text']) + len(dep['common']) > MAX_INPUT_CHARS:
        raise AssistError('AI input exceeds 24,000 characters. Shorten the selected field/context; nothing was truncated. / AI入力が長すぎます。原文は切り捨てていません')
    # A structured H3 prompt should not be double-wrapped by this helper.
    validate_candidate(dep['text'])
    model = body.get('model') or plan.get('prompt_enhancer', {}).get('model') or DEFAULT_MODEL
    if not isinstance(model, str) or model not in available_models:
        raise AssistError('Select an installed prompt-upscaler model / インストール済みのアップサンプラーモデルを選択してください')
    loader_settings = body.get('loader', {'type':'minimax', 'device':'default'})
    if (not isinstance(loader_settings, dict) or set(loader_settings) != {'type','device'}
            or loader_settings['type'] != 'minimax' or loader_settings['device'] not in ('default','cpu')):
        raise AssistError('Connect a minimax Load CLIP / minimaxのLoad CLIPを接続してください')
    request_id = uuid4().hex
    loader, generator, output = (f'h3ez_ai_{request_id}_{suffix}' for suffix in ('model','text','result'))
    images, image_paths = [], []
    aid = body.get('image_id')
    visual = dep['contract'] == VISUAL_CONTRACT
    selected_ids = [x['id'] for x in dep['images']] if visual else ([] if aid is None else [aid])
    if visual and aid is not None:
        raise AssistError('Automatic references cannot be overridden by a single image')
    if len(selected_ids) > MAX_AI_IMAGES:
        raise AssistError('Too many AI references')
    budget = min(AI_PIXELS, AI_TOTAL_PIXELS // max(1, len(selected_ids)))
    for aid in selected_ids:
        if not isinstance(aid, str) or aid not in {x['id'] for x in dep['images']}:
            raise AssistError('Select one of this field\'s assigned images / 対象の文章に割り当てられた画像を選択してください')
        asset = next(a for a in plan['assets'] if a['id'] == aid)
        if asset['kind'] != 'image':
            raise AssistError('AI input must be an image')
        image_path, binding = _prepare_image(asset, input_root, budget)
        image_paths.append(image_path)
        images.append(binding)
    context = {'selected_text': dep['text'], 'common_context_do_not_repeat':dep['common'],
               'assigned_image_roles':dep['scope'],
               'reference_catalog':[{'id':x['id'],'name':x['subject_name']} for x in dep['images']],
               'selected_visual_reference': aid,
               'instruction':'Refine selected_text only. Keep its original language. Return plain prose.'}
    # Context is read-only background, never a replacement for either text field.
    # Retain old contracts for already saved AI text and older clients.
    if body.get('video_context') and target['field']=='prompt':
        shot=next(s for s in plan['shots'] if s['id']==target['shot_id'])
        if shot.get('prompt_mode')!='replace':
            context['common_context_do_not_repeat']=resolve_prompt_text(plan,{'field':'global_prompt'},external)[0]
    if visual:
        context.pop('selected_visual_reference')
        context['visual_inputs'] = [{'image':i+1, 'asset_id':aid} for i,aid in enumerate(selected_ids)]
        context['output_frame'] = dep['output']
        if target['field'] == 'prompt':
            timing = dep['scope'][0]['timing']
            context['shot_duration'] = {'requested_seconds':timing['requested_ms']/1000,
                                        'rendered_seconds':timing['frames']/timing['fps']}
        else:
            context['instruction'] += ' This is shared text. Do not add shot-specific actions or timing.'
    prompt_text = canonical(context)
    if len(prompt_text) > MAX_INPUT_CHARS:
        raise AssistError('AI context exceeds the explicit input budget; simplify selected context. Nothing was truncated.')
    inputs = {'clip':[loader,0], 'prompt':prompt_text, 'max_length':1536,
              'sampling_mode':'off', 'thinking':True, 'use_default_template':True,
              'system_prompt':instruction, 'mtp':'off'}
    graph = {
        loader:{'class_type':'CLIPLoader', 'inputs':{'clip_name':model, **loader_settings}},
        generator:{'class_type':'TextGenerateV2', 'inputs':inputs},
        output:{'class_type':'PreviewAny', 'inputs':{'source':[generator,0]}}
    }
    for i,image_path in enumerate(image_paths,1):
        node = f'h3ez_ai_{request_id}_image_{i}'
        graph[node] = {'class_type':'LoadImage', 'inputs':{'image':image_path}}
        inputs[f'images.image{i}'] = [node,0]
    identity = model_identity or model
    receipt = {'target':dict(target), 'dependencies':dep, 'base_text_hash':digest(dep['text']),
               'dependency_hash':digest(canonical(dep)), 'images':images,
               'model_identity':identity, 'profile_version':PROFILE}
    # Do not include random node IDs in the result-cache identity.
    cache_key = digest(canonical({'receipt':receipt, 'loader':loader_settings, 'profile':PROFILE, 'system_prompt':instruction, 'context':prompt_text, 'max_length':1536,
                                 'thinking':True, 'sampling':'off', 'mtp':'off'}))
    return {'request_id':request_id, 'graph':graph, 'output_id':output,
            'receipt':receipt, 'cache_key':cache_key, 'model':model,
            'experimental':True}


def adopt_request(body, input_root):
    if not isinstance(body, dict) or set(body)-{'plan','target','external_prompt','receipt','candidate','output_size'}:
        raise AssistError('Invalid candidate adoption fields')
    plan=normalize_plan(body.get('plan'),allow_audio_overhang=True); require_enabled(plan)
    target=body.get('target'); target_key(target)
    receipt=body.get('receipt')
    if not isinstance(receipt,dict) or receipt.get('target') != target:
        raise AssistError('Candidate target mismatch')
    external=body.get('external_prompt')
    if external is not None and not isinstance(external,str):raise AssistError('External prompt must be text or null')
    previous_dependencies = receipt.get('dependencies')
    if not isinstance(previous_dependencies, dict):
        raise AssistError('Invalid candidate dependencies')
    saved_output = previous_dependencies.get('output', {})
    output_size = body.get('output_size', saved_output if saved_output.get('source')=='engine' and saved_output.get('width') else None)
    dep=dependency_payload(plan,target,external,previous_dependencies.get('contract', CONTRACT),bool(previous_dependencies.get('common')),output_size)
    if (receipt.get('dependency_hash')!=digest(canonical(previous_dependencies))
            or receipt.get('base_text_hash')!=digest(dep['text'])
            or not compatible_dependencies(previous_dependencies, dep)):
        raise AssistError('The source changed. Generate a new candidate / 入力条件が変更されました。候補を作り直してください')
    entry={**receipt, 'text':validate_candidate(body.get('candidate'))}
    checked=normalize_enhancer({'enabled':True,'texts':[entry]},plan)['texts'][0]
    assets={a['id']:a for a in plan['assets']}
    for image in checked['images']:
        if image['id'] not in {x['id'] for x in dep['images']}:
            raise AssistError('Candidate refers to an unassigned image')
        path=asset_path(assets[image['id']],input_root)
        with path.open('rb') as handle:
            h=hashlib.sha256()
            for block in iter(lambda:handle.read(1024*1024),b''):h.update(block)
        if h.hexdigest()!=image['sha256']:
            raise AssistError('Reference image changed; candidate is stale / 参照画像が変更されました')
    return {'entry':checked}


def preflight_request(body,input_root):
    if not isinstance(body,dict) or set(body)-{'plan'}:raise AssistError('Invalid preflight request')
    plan=normalize_plan(body.get('plan'),allow_audio_overhang=True);used=used_asset_ids(plan)
    errors=[];warnings=[]
    for asset in plan['assets']:
        try:asset_path(asset,input_root)
        except (ValueError,OSError) as exc:
            (errors if asset['id'] in used else warnings).append({'asset_id':asset['id'],'message':str(exc),'used':asset['id'] in used})
    geometry=shot_geometry(plan);parts=execution_plan(plan)
    return {'ok':not errors and max((c['start']+c['duration']for c in plan['audio']),default=0)<=sum(g['frames']for g in geometry)/24+.001,'errors':errors,'warnings':warnings,'shots':len(geometry),
            'parts':len(parts),'part_times':[{'shot':x['shot_index']+1,'start':x['start'],'end':x['end']}for x in parts],
            'frames':sum(g['frames'] for g in geometry),
            'seconds':max(sum(g['frames'] for g in geometry)/24,max((c['start']+c['duration']for c in plan['audio']),default=0)),
            'video_shortfall':max(0,max((c['start']+c['duration']for c in plan['audio']),default=0)-sum(g['frames'] for g in geometry)/24),'audio_clip_volume':True,'model_validation':'runtime'}


def register_routes(server=None):
    if server is None:
        module=sys.modules.get('server')
        server=getattr(getattr(module,'PromptServer',None),'instance',None)
    if server is None or getattr(server,'_h3ez_assist_registered',False):return
    import folder_paths
    from aiohttp import web

    async def read_body(request):
        user_manager=getattr(server,'user_manager',None)
        if user_manager is not None:user_manager.get_request_user_id(request)
        origin=request.headers.get('Origin')
        if origin and urlsplit(origin).netloc != request.host:
            raise web.HTTPForbidden(text='Cross-origin assist request rejected')
        if request.content_type!='application/json':raise web.HTTPUnsupportedMediaType()
        if request.content_length is not None and request.content_length>MAX_BODY:raise web.HTTPRequestEntityTooLarge(max_size=MAX_BODY,actual_size=request.content_length)
        chunks=[];size=0
        async for chunk in request.content.iter_chunked(65536):
            size+=len(chunk)
            if size>MAX_BODY:raise web.HTTPRequestEntityTooLarge(max_size=MAX_BODY,actual_size=size)
            chunks.append(chunk)
        value=json.loads(b''.join(chunks))
        if not isinstance(value,dict):raise AssistError('Request must be a JSON object')
        return value

    def caps():
        import nodes
        names=set(nodes.NODE_CLASS_MAPPINGS)
        missing=sorted({'CLIPLoader','TextGenerateV2','PreviewAny','LoadImage'}-names)
        return {'models':folder_paths.get_filename_list('text_encoders'), 'default_model':DEFAULT_MODEL,
                'missing_nodes':missing, 'profile':PROFILE,'experimental':True,'max_ai_images':MAX_AI_IMAGES}

    async def handle(request, operation):
        try:
            body=await read_body(request)
            root=Path(folder_paths.get_input_directory())
            if operation=='capabilities':
                if body!={'enabled':True}:raise AssistError('Enable prompt enhancer before requesting AI capabilities')
                result=await asyncio.to_thread(caps)
            elif operation=='media-info':
                if set(body)!={'file'}:raise AssistError('Invalid media metadata request')
                from .audio_probe import inspect_audio
                result=await asyncio.to_thread(inspect_audio,body['file'],root)
            elif operation=='prepare':
                # No model discovery or path work before the explicit enable guard.
                checked_plan=normalize_plan(body.get('plan'),allow_audio_overhang=True)
                require_enabled(checked_plan)
                available=await asyncio.to_thread(caps)
                if available['missing_nodes']:
                    raise AssistError('Update ComfyUI: missing '+', '.join(available['missing_nodes']))
                model=body.get('model') or checked_plan.get('prompt_enhancer',{}).get('model') or DEFAULT_MODEL
                identity=model
                if model in available['models']:
                    path=folder_paths.get_full_path('text_encoders',model)
                    if path:
                        st=Path(path).stat();identity=f'{model}|{st.st_size}|{st.st_mtime_ns}'
                result=await asyncio.to_thread(prepare_request,body,root,available['models'],identity)
            elif operation=='adopt':result=await asyncio.to_thread(adopt_request,body,root)
            else:result=await asyncio.to_thread(preflight_request,body,root)
            return web.json_response(result,headers={'Cache-Control':'no-store'})
        except web.HTTPException:raise
        except (ValueError,TypeError,KeyError,OSError,StopIteration) as exc:
            return web.json_response({'error':str(exc)},status=getattr(exc,'status',400),headers={'Cache-Control':'no-store'})

    for operation in ('capabilities','prepare','adopt','preflight','media-info'):
        async def endpoint(request, op=operation):return await handle(request,op)
        server.routes.post(PREFIX+'/'+operation)(endpoint)
    server._h3ez_assist_registered=True
