"""Measure the frames and sound around known joins of exported review videos."""
import argparse
from collections import defaultdict
from fractions import Fraction
import json
from pathlib import Path

import av
import numpy as np


def inspect(path, boundaries, radius=5):
    rows = defaultdict(list)
    count = 0
    previous = None
    with path.open('rb') as file, av.open(file, container_options={'protocol_whitelist': ''}) as video:
        stream = video.streams.video[0]
        fps = stream.average_rate
        if not fps:
            raise ValueError('A known video frame rate is required')
        size = [stream.width, stream.height]
        for index, frame in enumerate(video.decode(stream)):
            count += 1
            if not any(abs(index - boundary) <= radius + 1 for boundary in boundaries):
                previous = None
                continue
            pixels = frame.to_ndarray(format='rgb24')
            luma = pixels[::max(1, pixels.shape[0] // 256), ::max(1, pixels.shape[1] // 256)] @ np.array([.2126, .7152, .0722])
            movement = float(np.abs(luma - previous).mean()) if previous is not None else None
            previous = luma
            texture = float(np.abs(np.diff(luma, axis=0)).mean() + np.abs(np.diff(luma, axis=1)).mean()) if min(luma.shape)>1 else None
            for boundary in boundaries:
                if abs(index - boundary) <= radius:
                    rows[boundary].append({'index': index, 'time': float(frame.pts * frame.time_base),
                                           'luma': float(luma.mean()), 'motion': movement, 'texture': texture})
    audio = {}
    samples = 0
    last_sample = None
    with path.open('rb') as file, av.open(file, container_options={'protocol_whitelist': ''}) as video:
        if video.streams.audio:
            for frame in video.decode(audio=0):
                samples += frame.samples
                if frame.pts is None:
                    continue
                wave = frame.to_ndarray()
                if not frame.format.is_planar:
                    wave = wave.reshape(-1, len(frame.layout.channels)).T
                if np.issubdtype(wave.dtype, np.integer):
                    wave = wave.astype(np.float32) / max(-np.iinfo(wave.dtype).min, np.iinfo(wave.dtype).max)
                for boundary in boundaries:
                    sample = round((Fraction(boundary, 1) / fps - frame.pts * frame.time_base) * frame.sample_rate)
                    if 0 <= sample < frame.samples:
                        before = wave[:, sample - 1] if sample else last_sample
                        if before is not None:
                            audio[boundary] = float(np.abs(wave[:, sample] - before).max())
                last_sample = wave[:, -1]
    if any(b >= count or b < 1 for b in boundaries):
        raise ValueError('A boundary is outside the video')
    return {
        'file': str(path), 'frames': count, 'size': size, 'fps': str(fps), 'audio_samples_per_channel': samples,
        'boundaries': [
            {'index': boundary, 'kind': kind, 'audio_step': audio.get(boundary), 'frames': rows[boundary]}
            for boundary, kind in sorted(boundaries.items())
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('videos', nargs='+', type=Path)
    parser.add_argument('--join', nargs='*', type=int, default=[])
    parser.add_argument('--cut', nargs='*', type=int, default=[])
    parser.add_argument('--manifest', type=Path, help='Use accepted review parts for frame boundaries')
    args = parser.parse_args()
    boundaries = {}
    if args.manifest:
        manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
        boundaries.update({row['record']['start_frame']: row['record']['transition']
                           for row in manifest['accepted'][1:]})
    boundaries.update(dict.fromkeys(args.join, 'continue'))
    boundaries.update(dict.fromkeys(args.cut, 'cut'))
    if not boundaries:
        parser.error('Specify a --manifest or supply --join/--cut frame indices')
    print(json.dumps([inspect(path, boundaries) for path in args.videos], indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
