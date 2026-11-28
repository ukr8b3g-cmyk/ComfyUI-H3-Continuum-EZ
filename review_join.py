"""Read one saved review join on CPU, using the same frames Studio displays."""
from itertools import islice
import re

from .plan import FPS
from .review_store import ReviewError
from .vendor.continuum.review_video_seam import FLASH_WINDOW_FRAMES, analyze_video_boundary


def diagnose_join(run, filename):
    import av
    import torch

    data = run.read()
    if not re.fullmatch(r'EZ_[0-9a-f]{32}\.mp4', filename):
        raise ReviewError('Unknown review join')
    # Only the current candidate and accepted previews belong to this review.
    for item in [*data['accepted'], data['candidate']]:
        join = (item or {}).get('join')
        if join and join['filename'] == filename:
            break
    else:
        raise ReviewError('Unknown review join')

    path = run.folder / 'previews' / filename
    if path.resolve() != path or not path.is_file():
        raise ReviewError('Join preview is unavailable')
    # The stored offset is relative to the proxy, not the timeline.
    boundary = round(join['boundary'] * FPS)
    start = max(0, boundary - 8)
    with av.open(str(path), format='mp4') as container:
        frames = [torch.from_numpy(frame.to_ndarray(format='rgb24'))
                  for frame in islice(container.decode(video=0), start, boundary + FLASH_WINDOW_FRAMES)]
    left = boundary - start
    if left < 4 or len(frames) - left < 3:
        return {'available': False, 'reason': 'short_window'}
    rgb = torch.stack(frames).float().div_(255)
    record = item['record']
    result = analyze_video_boundary(rgb[:left], rgb[left:], trim_frames=0,
                                    boundary_index=record['index'])
    return {'available': True, 'classification': result.classification,
            'timeline_seconds': record['start'], 'planned_cut': record['transition'] == 'cut',
            'flash_luma_shift': result.flash_luma_shift, 'motion_jump_ratio': result.motion_jump_ratio,
            'previous_frames': left, 'next_frames': len(frames) - left}
