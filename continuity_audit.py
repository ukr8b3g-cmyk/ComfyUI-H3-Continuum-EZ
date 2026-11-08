"""Read-only proof of H3 Continuum reference-context wiring.

This module never reads tensor values, modifies conditioning, or retains tensors.
Used only when H3EZ_CONTINUITY_AUDIT=report|assert is set.
"""
from __future__ import annotations

import math
import os

import torch

from .vendor.continuum.constants import (
    MARK_AUDIO_CONTEXT,
    MARK_AUDIO_END_FRAME,
    MARK_AUDIO_OVERHANG,
    MARK_CONTEXT_FRAMES,
    MARK_VIDEO_CONTEXT,
)
from .vendor.continuum.temporal import audio_latent_t, context_slots


AUDIT_ENV = "H3EZ_CONTINUITY_AUDIT"
AUDIT_MODES = frozenset({"off", "report", "assert"})


def _number(value):
    # Tensor scalar coercion could synchronize a GPU; inspect Python metadata only.
    return type(value) in (int, float) and math.isfinite(value)


def build_audit_record(*, part, shot, transition, context_frames, motion_score,
                       selection_reason, context, profiler):
    """Scalar-only evidence; forecast-only callbacks are not actual evaluations."""
    continued = context_frames > 0
    proof = {
        'part': part, 'shot': shot, 'transition': transition,
        'context_frames': context_frames,
        'motion_score': round(motion_score, 6) if _number(motion_score) else None,
        'selection_reason': selection_reason, 'continuation_applicable': continued,
    }
    proof.update(context or {'metadata_ok': not continued, 'metadata_errors': []})
    statuses = dict(profiler.status_counts) if profiler is not None else {}
    actual = sum(statuses.get(s, 0) for s in ('baseline_created', 'baseline_matched'))
    proof.update(
        wrapper_validation_calls=profiler.validation_calls if profiler is not None else 0,
        wrapper_full_validations=profiler.full_validation_count if profiler is not None else 0,
        wrapper_failed_validations=profiler.failed_validation_count if profiler is not None else 0,
        wrapper_actual_validations=actual, wrapper_statuses=statuses,
    )
    proof['ok'] = bool(
        proof['metadata_ok'] and proof['wrapper_validation_calls'] > 0
        and proof['wrapper_full_validations'] > 0 and actual > 0
        and proof['wrapper_failed_validations'] == 0
    ) if continued else transition == 'cut' and context is None and profiler is None
    return proof


def get_audit_mode() -> str:
    """Opt-in only; never silently enable checks on a normal production run."""
    mode = os.environ.get(AUDIT_ENV, "off").strip().lower()
    if mode not in AUDIT_MODES:
        raise ValueError(f"{AUDIT_ENV} must be off, report or assert (got {mode!r})")
    return mode


def inspect_context(
    conditioning: list,
    *,
    video_context: torch.Tensor,
    audio_context: torch.Tensor,
    context_frames: int,
    audio_grid_offset: float,
) -> dict:
    """Check the exact refs handed to the sampler without tensor contents.

    This validates metadata/shape connectivity, not generated video quality.
    A nonzero LayoutValidationProfiler count after sampling is additionally
    required before claiming that the model wrapper executed.
    """
    frames = int(context_frames)
    video_slots = context_slots(frames)
    audio_ticks = audio_latent_t(frames)
    errors: list[str] = []
    video_shape = tuple(video_context.shape) if torch.is_tensor(video_context) else ()
    audio_shape = tuple(audio_context.shape) if torch.is_tensor(audio_context) else ()
    if len(video_shape) != 5 or video_shape[:3] != (1, 24, video_slots):
        errors.append("video context shape/temporal slots mismatch")
    if len(audio_shape) != 4 or audio_shape[:3] != (1, 32, 2) or audio_shape[-1] != audio_ticks:
        errors.append("audio context shape/ticks mismatch")
    valid_phase = _number(audio_grid_offset) and abs(audio_grid_offset) <= 0.500001
    if not valid_phase:
        errors.append("invalid signed audio-grid offset")

    marked_total = 0
    if not isinstance(conditioning, (list, tuple)) or not conditioning:
        errors.append("empty/invalid conditioning")
    else:
        for row_index, item in enumerate(conditioning):
            if not isinstance(item, (list, tuple)) or len(item) != 2 or not isinstance(item[1], dict):
                errors.append(f"conditioning row {row_index}: invalid metadata")
                continue
            refs = item[1].get("minimax_refs", ())
            if not isinstance(refs, (list, tuple)):
                errors.append(f"conditioning row {row_index}: invalid minimax_refs")
                continue
            matches = [ref for ref in refs if isinstance(ref, dict)
                       and (ref.get(MARK_VIDEO_CONTEXT) is True or ref.get(MARK_AUDIO_CONTEXT) is True)]
            marked_total += len(matches)
            if len(matches) != 1:
                errors.append(f"conditioning row {row_index}: expected one Continuum video reference, got {len(matches)}")
                continue
            ref = matches[0]
            expected = {MARK_CONTEXT_FRAMES: frames, 'latent_t': video_slots,
                        'latent_h': video_shape[-2] if len(video_shape) == 5 else None,
                        'latent_w': video_shape[-1] if len(video_shape) == 5 else None,
                        'ref_audio_t': audio_ticks}
            if (ref.get("kind") != "video_audio" or ref.get(MARK_VIDEO_CONTEXT) is not True
                    or any(type(ref.get(key)) is not int or ref[key] != value
                           for key, value in expected.items())):
                errors.append(f"conditioning row {row_index}: video/audio reference metadata mismatch")
            if ref.get(MARK_AUDIO_CONTEXT) is not True:
                errors.append(f"conditioning row {row_index}: missing audio context marker")
            if not _number(ref.get(MARK_AUDIO_END_FRAME)) or ref[MARK_AUDIO_END_FRAME] != frames:
                errors.append(f"conditioning row {row_index}: incorrect audio end frame")
            video_latent = ref.get("latent")
            audio_latent = ref.get("audio_latent")
            if not torch.is_tensor(video_latent) or tuple(video_latent.shape) != video_shape:
                errors.append(f"conditioning row {row_index}: video reference tensor/shape mismatch")
            if not torch.is_tensor(audio_latent) or tuple(audio_latent.shape) != audio_shape:
                errors.append(f"conditioning row {row_index}: audio reference tensor/shape mismatch")
            # select_context supplies contiguous tensors and prepare_conditioning
            # preserves those objects. A same-shaped replacement is not proof.
            if video_latent is not video_context or audio_latent is not audio_context:
                errors.append(f"conditioning row {row_index}: context tensor identity mismatch")
            phase = ref.get(MARK_AUDIO_OVERHANG)
            if not _number(phase) or not valid_phase or abs(phase - audio_grid_offset) > 1e-6:
                errors.append(f"conditioning row {row_index}: signed audio-grid phase mismatch")

    return {
        "metadata_ok": not errors,
        "metadata_errors": errors,
        "conditioning_rows": len(conditioning) if isinstance(conditioning, (list, tuple)) else 0,
        "continuum_ref_rows": marked_total,
        "context_frames": frames,
        "video_context_slots": video_slots,
        "audio_context_ticks": audio_ticks,
        "audio_grid_offset": round(audio_grid_offset, 6) if _number(audio_grid_offset) else None,
    }
