"""Small shot orchestrator over the ORIGINAL Continuum reference-context primitives.

Managed temporary buffers only; no Resume, Review or persistent generation cache.
"""
from __future__ import annotations
import logging
from contextlib import ExitStack, nullcontext
from functools import wraps
from . import storage
from .vendor.continuum import storage_settings
from pathlib import Path
import torch
from .plan import (normalize_plan, shot_geometry, execution_plan, compile_part_prompt, effective_references, asset_path,
                   FPS, PlanError, DEFAULT_WIDTH, DEFAULT_HEIGHT, validate_dimension, studio_resolution)
from .media import load_image, render_original_audio, resolve_resolution
from .vendor.continuum.constants import V2_CONTINUITY_AUTO
from .vendor.continuum.temporal import make_extension_shape, largest_context_capacity
from .vendor.continuum.state import (capture_state, select_context, context_fingerprint, assert_context_unchanged)
from .vendor.continuum.continuation import prepare_conditioning, POLICY_REPLACE
from .vendor.continuum.model_patch import clone_model_for_chunk
from .vendor.continuum.reference import (prepare_reference_assets, encode_reference_latents,
                                        encode_reference_prompt, ReferenceImageBundle)
from .vendor.continuum.driving_audio import (prepare_driving_audio_source, encode_driving_audio,
                                           slice_driving_audio_latent, attach_driving_audio)
from .vendor.continuum.v2.h3_builder import (prepare_identity_assets, encode_prompt_conditioning,
                                          attach_keyframes, empty_h3_latent)
from .vendor.continuum.v2.sampling import sample_chunk, latent_to_cpu, latent_from_cpu
from .vendor.continuum.v2.motion import choose_context_frames
from .vendor.continuum.v2.seeds import derive_chunk_seed
from .vendor.continuum.decode_base import decode_video, decode_audio

LOG = logging.getLogger('h3_continuum_ez')


def _cancel():
    import comfy.model_management
    comfy.model_management.throw_exception_if_processing_interrupted()


def _memory_check(frames, width, height):
    # Estimate final float32 RGB alone, not a universal RAM guarantee.
    estimate = int(frames) * int(width) * int(height) * 3 * 4
    try:
        import psutil
    except ImportError:
        return estimate
    available = psutil.virtual_memory().available
    if estimate > available * .7:
        raise MemoryError(f'EZ output RGB requires about {estimate/2**30:.2f} GiB, before decode workspace; reduce resolution or shots (available {available/2**30:.2f} GiB)')
    return estimate


def _managed_run(function):
    @wraps(function)
    def call(**kwargs):
        manager = storage_settings.get_manager()
        try:
            with manager.operation() if manager else nullcontext():
                with ExitStack() as stack:
                    return function(**kwargs, _stack=stack)
        finally:
            # The unchanged Continuum backend only reclaims storage with no live aliases.
            try:
                storage.collect()
            except Exception:
                LOG.warning('Deferred scratch cleanup', exc_info=True)
    return call


@_managed_run
@torch.inference_mode()
def run_engine(*, model, clip, video_vae, audio_vae, sampler, sigmas,
               timeline: dict, seed: int, input_root: Path, width: int | None = None,
               height: int | None = None, megapixels: float | None = None, aspect: str | None = None,
               buffer_backend='RAM', output_mode='Images', output_root=None, video_result=None,
               progress=None, preview_session=None, _stack=None):
    from comfy import model_base

    music_model_type = getattr(model_base, 'MiniMaxMusic3', None)
    if music_model_type is not None and isinstance(getattr(model, 'model', None), music_model_type):
        raise PlanError('MODEL is MiniMax Music3. Select a MiniMax H3 video model in the upstream loader. '
                        'MODELに音楽用のMiniMax Music3が接続されています。上流のLoaderで映像用のMiniMax H3を選んでください。')
    if output_mode not in ('Images', 'Long video'):
        raise PlanError('Unknown output mode')
    streaming = output_mode == 'Long video'
    if streaming and (output_root is None or video_result is None):
        raise PlanError('Long video requires an output directory and result receiver')
    plan = normalize_plan(timeline['plan'])
    if plan.get('resolution', {}).get('source') == 'studio':
        width, height = studio_resolution(plan['resolution'])
    legacy_size = width is None and height is None and (megapixels is not None or aspect is not None)
    if not legacy_size:
        width = DEFAULT_WIDTH if width is None else width
        height = DEFAULT_HEIGHT if height is None else height
        validate_dimension(width, 'Width')
        validate_dimension(height, 'Height')
    external = timeline.get('external_prompt')
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**64:
        raise PlanError('Seed must be uint64')
    if not torch.is_tensor(sigmas) or sigmas.ndim != 1 or sigmas.numel() < 2 or not bool(torch.isfinite(sigmas).all()):
        raise PlanError('SIGMAS must be a finite 1D schedule')
    if not bool((sigmas[:-1] >= sigmas[1:]).all()) or float(sigmas[-1]) != 0:
        raise PlanError('EZ requires a descending full-denoise SIGMAS schedule ending at zero')
    if audio_vae is None: raise PlanError('Connect the H3 Audio VAE')
    geometry = shot_geometry(plan)
    parts = execution_plan(plan)
    emit = progress or (lambda *a, **kw: None)
    total_frames = sum(g['frames'] for g in geometry)
    by_id = {a['id']: a for a in plan['assets']}
    # Validate every referenced input before expensive model work.
    paths = {aid: asset_path(asset, input_root) for aid, asset in by_id.items()}
    if legacy_size:
        first = parts[0]['first_image']
        width, height = resolve_resolution(
            .3 if megapixels is None else megapixels,
            '16:9' if aspect is None else aspect,
            load_image(paths[first], (2048,2048)) if first else None,
        )
    estimate = total_frames * width * height * 3 * 4
    if streaming:
        # Only the largest working chunk needs decoding; no full-length IMAGE buffer.
        backend = storage.select_backend('Disk-backed', max(g['frames']+39 for g in parts)*width*height*12)
    elif buffer_backend == 'RAM':
        _memory_check(total_frames, width, height)
        backend = 'RAM'
    else:
        backend = storage.select_backend(buffer_backend, estimate)
    writer = None
    if streaming:
        from .stream_video import StreamVideo
        writer = _stack.enter_context(StreamVideo(output_root, width, height, FPS, _cancel))
    emit('start', parts=parts)
    audio_master = render_original_audio(plan, input_root, total_frames, stack=_stack, cancel=_cancel)
    previous, records = None, []
    frames_out, generated_audio, audio_rate = None, None, None
    image_allocation = audio_allocation = None
    for i, g in enumerate(parts):
        _cancel()
        shot = plan['shots'][g['shot_index']]
        event = dict(shot_id=g['shot_id'],part_index=g['part_index'],part_count=g['part_count'])
        emit('preparing', **event)
        if g['transition'] == 'cut': previous = None
        context_frames, score, reason = 0, 0., 'scene start'
        if previous is not None:
            context_frames, score, reason = choose_context_frames(V2_CONTINUITY_AUTO, previous)
            shape = make_extension_shape(context_frames, g['seconds'])
            physical = shape.total_frames
            if shape.net_new_frames != g['frames']: raise RuntimeError('Planner/core frame disagreement')
        else:
            physical = g['frames']
        # At most the current part's sources/conditioning exist. Pillow shrinks
        # before float32 conversion; no all-shot image or conditioning cache.
        refs = effective_references(plan, shot)
        image_ids = {plan['reference_slots'][r-1] for r in refs}
        image_ids.update(x for x in (g['first_image'],g['last_image']) if x)
        images = {aid:load_image(paths[aid], (width,height)) for aid in image_ids}
        identity = prepare_identity_assets(video_vae,width=width,height=height,
            first_frame=images.get(g['first_image']),last_frame=images.get(g['last_image']))
        padded = [images[plan['reference_slots'][r-1]] for r in refs]+[None]*(9-len(refs))
        ra = prepare_reference_assets(reference_image_1=padded[0],reference_image_2=padded[1],
            reference_image_3=padded[2],image_references=ReferenceImageBundle(tuple(padded[3:])),
            output_width=width,output_height=height,size_mode='Match Output')
        ra = encode_reference_latents(video_vae, ra) if ra else None
        text, picture_map = compile_part_prompt(plan,g,external)
        if ra:
            base = encode_reference_prompt(clip,text,ra,first_image=identity.first_image,last_image=identity.last_image)
        else:
            base = encode_prompt_conditioning(clip,text,first_image=identity.first_image,last_image=identity.last_image)
        latent = empty_h3_latent(width, height, physical)
        conditioning = attach_keyframes(base, frame_count=physical, first_latent=identity.first_latent, last_latent=identity.last_latent)
        protected = None
        if previous is not None:
            vc, ac, phase = select_context(previous, context_frames, include_audio=True)
            protected = (vc, ac, context_fingerprint(vc, ac))
            conditioning = prepare_conditioning(conditioning, video_context=vc, audio_context=ac,
                         audio_grid_offset=phase, context_frames=context_frames, new_frame_count=physical,
                         first_frame_policy=POLICY_REPLACE, preserve_last_frame=g['last_image'] is not None)
        guide = None
        if audio_master is not None:
            rate = int(audio_master['sample_rate'])
            start = round((g['start_frame']-context_frames)*rate/FPS)
            count = round(physical*rate/FPS)
            window = audio_master['waveform'][...,start:start+count]
            if window.shape[-1]<count: window=torch.nn.functional.pad(window,(0,count-window.shape[-1]))
            source=prepare_driving_audio_source({'waveform':window,'sample_rate':rate},audio_vae,target_frames=physical,fps=FPS)
            audio_assets=encode_driving_audio(source,audio_vae)
            guide=slice_driving_audio_latent(audio_assets,cumulative_retained_before=0,total_frames=physical,trim_frames=0,fps=FPS)
            del window,source,audio_assets
        conditioning = attach_driving_audio(conditioning, guide)
        chunk_model = clone_model_for_chunk(model, strict=False, debug=False, chunk_index=i+1,
                                            context_frames=context_frames or None)
        shot_seed = derive_chunk_seed(seed, g['shot_index'], 0)
        actual_seed = shot_seed if g['part_index']==0 else derive_chunk_seed(shot_seed,g['part_index'],0)
        LOG.info('EZ Shot %d/%d part %d/%d: %.3fs seed=%s context=%df (%s)',
                 g['shot_index']+1,len(geometry),g['part_index']+1,g['part_count'],g['seconds'],actual_seed,context_frames,reason)
        emit('sampling', **event)
        sampled = sample_chunk(model=chunk_model, conditioning=conditioning, latent=latent,
                               sampler=sampler, sigmas=sigmas, seed=actual_seed, enable_preview=True)
        if protected: assert_context_unchanged(*protected)
        video, audio = latent_to_cpu(sampled)
        stored = latent_from_cpu(video, audio)
        previous = capture_state(stored, source_frame_count=physical, clip_index=i+1,
                                 capacity_frames=largest_context_capacity(g['frames']))
        records.append({'shot':g['shot_index']+1,'seed':actual_seed,'context_frames':context_frames,
                        'physical_frames':physical,**g,'picture_map':picture_map})
        del sampled,chunk_model,conditioning,latent,guide,video,audio,images,padded,ra,identity,base,protected
        latent, trim = stored, context_frames
        del stored
        _cancel()
        emit('decoding', **event)
        raw = decode_video(video_vae, latent)
        if raw.shape[0] < physical: raise RuntimeError('Video VAE returned fewer frames than requested')
        if raw.shape[1:3] != (height, width): raise RuntimeError('Video VAE changed output geometry')
        if not bool(torch.isfinite(raw).all()): raise RuntimeError('Decoded video contains NaN/Inf')
        part = raw[trim:physical]
        if part.shape[0] != g['frames']: raise RuntimeError('Decoded video count mismatch')
        if not streaming:
            if frames_out is None:
                shape = (total_frames, *part.shape[1:])
                if backend == 'Disk-backed':
                    image_allocation = storage.allocate(_stack, shape, part.dtype)
                    frames_out = image_allocation.tensor
                else:
                    frames_out = torch.empty(shape, dtype=part.dtype, device='cpu')
            frames_out[g['start_frame']:g['start_frame']+g['frames']].copy_(part)
        # Imported audio is authoritative: do not decode/normalize discarded model audio.
        if audio_master is None:
            decoded = decode_audio(audio_vae, latent)
            rate, wav = decoded['sample_rate'], decoded['waveform']
            if not bool(torch.isfinite(wav).all()): raise RuntimeError('Decoded audio contains NaN/Inf')
            if audio_rate is None:
                audio_rate = rate
                shape = (1, wav.shape[1], round(total_frames*rate/FPS))
                if backend == 'Disk-backed':
                    audio_allocation = storage.allocate(_stack, shape, wav.dtype)
                    generated_audio = audio_allocation.tensor
                else:
                    generated_audio = torch.empty(shape, dtype=wav.dtype)
            elif audio_rate != rate: raise RuntimeError('Audio sample rate changed between shots')
            start = round(g['start_frame']*rate/FPS)
            stop = round((g['start_frame']+g['frames'])*rate/FPS)
            source_start = round(trim*rate/FPS)
            wanted = stop-start
            wave_part = wav[..., source_start:source_start+wanted]
            missing = wanted-wave_part.shape[-1]
            if missing > math_ceil_sample_tick(rate):
                raise RuntimeError('Decoded audio is shorter than its H3 frame grid allows')
            if missing:
                wave_part = torch.nn.functional.pad(wave_part, (0, missing))
            generated_audio[..., start:stop].copy_(wave_part)
        track = audio_master if audio_master is not None else {'sample_rate':audio_rate, 'waveform':generated_audio}
        if writer:
            writer.configure_audio(int(track['sample_rate']), int(track['waveform'].shape[1]))
            writer.append(part)
        preview = {}
        if preview_session is not None:
            rate = track['sample_rate']
            segment_audio={'sample_rate':rate,'waveform':track['waveform'][...,round(g['start_frame']*rate/FPS):round((g['start_frame']+g['frames'])*rate/FPS)]}
            preview=preview_session.append(part,segment_audio,g,geometry[g['shot_index']],_cancel)
            del segment_audio
        emit('part_complete', **event, **preview)
        del raw, part, latent
        if audio_master is None:
            del decoded, wav, wave_part
        if backend == 'Disk-backed':
            storage.collect()
    previous = None
    if image_allocation:
        frames_out = image_allocation.publish()
    if audio_allocation:
        generated_audio = audio_allocation.publish()
    final_audio = audio_master if audio_master is not None else {'waveform': generated_audio, 'sample_rate': audio_rate}
    if writer:
        video_result.update(writer.finish(final_audio, total_frames))
    report = '\n'.join([
        'H3 Continuum EZ Studio 0.9.0 — original reference_context_v1',
        f'{width}x{height}, {total_frames} frames at 24 fps, {total_frames/FPS:.3f}s',
        f'Audio: {"original edited source; no generated audio mixed" if audio_master is not None else "H3 generated"}',
        f'Output: {output_mode}; backend: {backend}; full RGB size: {estimate/2**30:.2f} GiB ({"not allocated" if streaming else "logical size"}). Original Continuum seed derivation retained.',
        *[f"Shot {r['shot']} part {r['part_index']+1}/{r['part_count']}: {r['seconds']:.3f}s, context {r['context_frames']}f, seed {r['seed']}, {r['picture_map']}" for r in records]
    ])
    return frames_out, final_audio, float(FPS), report


def math_ceil_sample_tick(rate):
    import math
    return math.ceil(rate / 40) + 2
