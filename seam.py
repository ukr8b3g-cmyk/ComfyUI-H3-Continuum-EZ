"""Bounded fixed-time seam correction using Continuum's CPU guards and blend.

The original five-frame guard handles flash and motion. The exposure ramp
uses reduced comparison frames and patches at most six images at their original times.
"""
import math
from dataclasses import replace
import torch
from .vendor.continuum.v2.seam_guard import (
    _auto_rejection_reason, _boundary_metrics, _downsample_rgb, _luma,
    _seam_window_peak, apply_color_guard, apply_video_blend, choose_video_blend,
)

from .vendor.continuum.review_video_seam import _downsample_rgb as _analysis_rgb, analyze_video_boundary

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

def exposure_reference(frames):
    """Keep the analysis history at Continuum's comparison resolution."""
    return _analysis_rgb(frames[-4:])


def _stable_luma_shift(previous, current):
    """Measure luminance only in tiles with matching spatial detail."""
    luma = _luma(torch.cat((previous, current)))
    grid_rows, grid_cols = 6, 8
    frames, height, width = luma.shape
    tile_h, tile_w = height // grid_rows, width // grid_cols
    if min(tile_h, tile_w) < 2:
        return 0.0
    tiled = luma[:, :grid_rows * tile_h, :grid_cols * tile_w]
    tiled = tiled.reshape(frames, grid_rows, tile_h, grid_cols, tile_w)
    left, right = tiled.permute(0, 1, 3, 2, 4).flatten(1, 2).flatten(2).chunk(2)
    before, after = left.mean(-1), right.mean(-1)
    correlation = torch.nn.functional.cosine_similarity(left - before[..., None],
                                                        right - after[..., None], dim=-1)
    stable = (correlation > .925) & (left.std(-1) > .012) & (right.std(-1) > .012)
    if stable.sum().item() < .35 * stable.numel():
        return 0.0
    differences = (after - before)[stable]
    shift = float(differences.median())
    if abs(shift) < .01 or float((differences * math.copysign(1, shift) > .002).float().mean()) < .8:
        return 0.0
    return shift


def correct_exposure_ramp(previous, current, overlap):
    """Fade a verified exposure step over six frames at the original timestamps."""
    correction_frames = 6
    if len(previous) < 4 or len(current) <= correction_frames:
        return None, None

    head = _analysis_rgb(current[:12])
    analysis = analyze_video_boundary(previous, head, trim_frames=0)
    if analysis.classification not in ('clean_boundary', 'exposure_ramp', 'motion_hitch'):
        return None, None
    boundary_shift = _stable_luma_shift(previous[-1:], head[:1])
    if not boundary_shift:
        return None, None
    # At the same output times, exposure changes in the decoded overlap are
    # evidence of decoder drift even if the short-window analyzer marks it clean.
    if analysis.classification != 'exposure_ramp':
        if len(overlap) < 2:
            return None, None
        overlap_shift = _stable_luma_shift(previous[-2:], _analysis_rgb(overlap[-2:]))
        if not (.4 <= (boundary_shift / overlap_shift if overlap_shift else 0.) <= 1.7):
            return None, None

    luma_means = _luma(torch.cat((previous[-1:], head[:correction_frames + 1]))).mean((1, 2))
    fractions = torch.arange(1, correction_frames + 1, dtype=torch.float32) / (correction_frames + 1)
    targets = torch.lerp(luma_means[0], luma_means[-1], fractions)
    gains = targets / luma_means[1:-1].clamp_min(.08)
    if float((gains - 1).abs().max()) > .08:
        return None, None

    patch = current[:correction_frames].clone()
    for original, frame, gain in zip(current, patch, gains.tolist()):
        frame.mul_(gain)
        if gain > 1 and float(((frame > 1) & (original < .998)).float().mean()) > .005:
            return None, None
        frame.clamp_(0, 1)

    candidate = torch.cat((_analysis_rgb(patch), head[correction_frames:]))
    before = _boundary_metrics(previous, head)
    after = _boundary_metrics(previous, candidate)
    peak_before = _exposure_window_peak(previous, head)
    peak_after = _exposure_window_peak(previous, candidate)
    result = analyze_video_boundary(previous, candidate, trim_frames=0)
    if (peak_after > peak_before * .90 or result.flash_luma_shift > analysis.flash_luma_shift * .70
            or after.edge_norm > before.edge_norm * 1.02 + .0001):
        return None, None
    return patch, dict(method='continuum-exposure-ramp', peak_before=peak_before,
                       peak_after=peak_after, luma_before=analysis.flash_luma_shift,
                       luma_after=result.flash_luma_shift, frames=correction_frames)


def _exposure_window_peak(previous, head):
    frames = torch.cat((previous[-1:], head))
    return float(frames.diff(dim=0).abs().mean((1, 2, 3)).max())
