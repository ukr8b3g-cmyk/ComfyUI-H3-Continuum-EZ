"""Bounded fixed-time seam correction using Continuum's CPU metrics/color guard.

Only two previous frames and five current frames are inspected. Never rewind
the timeline: streamed frames and original audio keep their exact positions.
"""
import math
import torch
from .vendor.continuum.v2.seam_guard import (
    _auto_rejection_reason, _boundary_metrics, _downsample_rgb, _luma,
    _seam_window_peak, apply_color_guard,
)

TAIL_FRAMES = 2
HEAD_FRAMES = 5


def _isolated_exposure(previous, head):
    """A one-frame exposure impulse, not a persistent scene/lighting change."""
    rgb = _downsample_rgb(torch.cat((previous[-1:], head[:3]), dim=0))
    y = _luma(rgb)
    means = y.mean(dim=(1, 2))
    target = float((means[0] + means[2]) / 2)
    impulse = float(means[1]) - target
    if target <= .03 or abs(impulse) < max(.015, target * .04):
        return None
    direction = 1 if impulse > 0 else -1
    # Both sides must support an isolated, broadly distributed brightness change.
    support = ((y[1]-y[0])*direction > .004) & ((y[1]-y[2])*direction > .004)
    if float(support.float().mean()) < .65:
        return None
    if abs(float(means[0]-means[2])) > .03 or abs(float(means[2]-means[3])) > .015:
        return None
    gain = target / max(float(means[1]), 1e-6)
    if not .80 <= gain <= 1.25 or not math.isfinite(gain):
        return None
    result = head.clone()
    frame = result[0, ..., :3]
    luma = _luma(frame).unsqueeze(-1)
    result[0, ..., :3] = (frame + luma * (gain - 1)).clamp(0, 1)
    return result, gain


def correct_boundary(previous_tail, current):
    """Return a corrected bounded prefix, or None when the native seam is safer.

    Candidate acceptance uses the unchanged Continuum Auto component and
    five-frame peak checks. The extra exposure candidate addresses an isolated
    first-frame pulse without altering time, pose, audio or the rest of a part.
    """
    if previous_tail.shape[0] < TAIL_FRAMES or current.shape[0] < HEAD_FRAMES:
        return None, {'method': 'native', 'reason': 'insufficient boundary frames'}
    previous = previous_tail[-TAIL_FRAMES:]
    head = current[:HEAD_FRAMES]
    before = _boundary_metrics(previous, head)
    native_peak = _seam_window_peak(previous, head)
    color, gain, bias, _ = apply_color_guard(previous, head)
    candidates = [('continuum-color', color, gain, bias)]
    pulse = _isolated_exposure(previous, head)
    if pulse is not None:
        candidates.append(('isolated-exposure', pulse[0], pulse[1], (0., 0., 0.)))
    accepted = []
    reasons = []
    for method, candidate, gain, bias in candidates:
        after = _boundary_metrics(previous, candidate)
        peak = _seam_window_peak(previous, candidate)
        improvement = (before.score-after.score) / max(before.score, 1e-12)
        reason = _auto_rejection_reason(before, after, improvement=improvement,
            absolute_improvement=before.score-after.score,
            native_window_peak=native_peak, candidate_window_peak=peak)
        if reason is None:
            accepted.append((peak, after.score, candidate, dict(method=method,
                gain=float(gain), bias=list(bias), peak_before=native_peak,
                peak_after=peak, score_before=before.score, score_after=after.score)))
        else:
            reasons.append(method+': '+reason)
    if not accepted:
        return None, dict(method='native', peak_before=native_peak,
            peak_after=native_peak, reason='; '.join(reasons))
    _, _, prefix, report = min(accepted, key=lambda x: (x[0], x[1]))
    return prefix, report
