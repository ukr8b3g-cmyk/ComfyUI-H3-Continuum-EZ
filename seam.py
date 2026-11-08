"""Bounded fixed-time seam correction using Continuum's CPU guards and blend.

Only two previous frames and five current frames are inspected. Never rewind
the timeline: streamed frames and original audio keep their exact positions.
"""
import math
from dataclasses import replace
import torch
from .vendor.continuum.v2.seam_guard import (
    _auto_rejection_reason, _boundary_metrics, _downsample_rgb, _luma,
    _seam_window_peak, apply_color_guard, apply_video_blend, choose_video_blend,
)

TAIL_FRAMES = 2
HEAD_FRAMES = 5


def _motion_bridge(previous, head):
    """Bounded next-side adaptation of Continuum's cosine overlap blend.

    Trusted previous velocity predicts the same next-frame timestamps; neither
    emitted frames nor the audio clock are rewound. Accept only when the stock
    Auto checks improve every component and the whole five-frame transition.
    """
    prev = _downsample_rgb(previous[-2:])
    nxt = _downsample_rgb(head)
    previous_motion = float((prev[1]-prev[0]).abs().mean())
    internal = (nxt[1:]-nxt[:-1]).abs().mean((1, 2, 3))
    future_motion = float(internal[1:].median())
    cross = float((prev[-1]-nxt[0]).abs().mean())
    typical = float(torch.cat((internal, internal.new_tensor([previous_motion]))).median())
    # Continuum V3's motion-hitch criterion, plus a persistent-change guard.
    # Do not smooth scene changes, fast motion, isolated local flashes or a
    # naturally large transition relative to its own neighboring movement.
    if cross < .006 or cross < max(typical, 1e-5)*1.6 or future_motion > .04:
        return None
    if cross >= .12 and future_motion <= cross*.35:
        return None
    if float((prev[-1]-nxt[2]).abs().mean()) < cross*.5:
        return None
    before = _boundary_metrics(previous, head)
    peak_before = _seam_window_peak(previous, head)
    # Select blend length from the already-observed movement, not from the
    # boundary artifact itself. The future window has its own fast-motion veto.
    maximum = choose_video_blend(replace(before, motion=previous_motion))
    accepted = []
    for count in range(1, maximum+1):
        predicted = previous[-1:].expand(count, *previous.shape[1:]).clone()
        velocity = previous[-1]-previous[-2]
        for index in range(count):
            predicted[index].add_(velocity, alpha=index+1).clamp_(0, 1)
        patch = apply_video_blend(predicted, head[:count], blend_frames=count)
        candidate = head.clone()
        candidate[:count].copy_(patch)
        after = _boundary_metrics(previous, candidate)
        peak = _seam_window_peak(previous, candidate)
        reason = _auto_rejection_reason(before, after,
            improvement=(before.score-after.score)/max(before.score, 1e-12),
            absolute_improvement=before.score-after.score,
            native_window_peak=peak_before, candidate_window_peak=peak)
        if reason is None:
            accepted.append((peak, after.score, candidate, dict(
                blend_frames=count, motion_peak_before=peak_before,
                motion_peak_after=peak, motion_score_before=before.score,
                motion_score_after=after.score, peak_after=peak,
                score_after=after.score)))
    if not accepted:
        return None
    _, _, prefix, report = min(accepted, key=lambda x: (x[0], x[1]))
    return prefix, report


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
    A qualified motion bridge additionally blends at most two next-side frames
    at their original timestamps, using the trusted previous-frame velocity.
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
    if accepted:
        _, _, prefix, report = min(accepted, key=lambda x: (x[0], x[1]))
    else:
        prefix = None
        report = dict(method='native', peak_before=native_peak,
            peak_after=native_peak, reason='; '.join(reasons))
    bridge = _motion_bridge(previous, head if prefix is None else prefix)
    if bridge is not None:
        prefix, motion = bridge
        report['method'] = (report['method']+'+' if report['method']!='native' else '')+'continuum-motion-blend'
        report.update(motion)
    return prefix, report
