"""Safe input loading and non-destructive original-audio assembly."""
from __future__ import annotations
import math
import wave
from pathlib import Path
import numpy as np
import torch
from PIL import Image, ImageOps
from .plan import PlanError, asset_path, FPS


def load_image(path: Path, target_size=None) -> torch.Tensor:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        if im.width * im.height > 64 * 1024 * 1024:
            raise PlanError('Image exceeds 64 megapixels')
        if target_size is not None:
            im.thumbnail(target_size, Image.Resampling.LANCZOS)
        data = np.array(im.convert('RGB'), dtype=np.float32) / 255.0
    return torch.from_numpy(data).unsqueeze(0)


def _load_pcm_wave(path: Path) -> dict:
    with wave.open(str(path), 'rb') as w:
        channels, rate, width = w.getnchannels(), w.getframerate(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if channels not in (1, 2): raise PlanError('Only mono/stereo audio is supported')
    if width == 1:
        values = (np.frombuffer(raw, np.uint8).astype(np.float32) - 128) / 128
    elif width == 2:
        values = np.frombuffer(raw, '<i2').astype(np.float32) / 32768
    elif width == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | b[:, 1] << 8 | b[:, 2] << 16
        values = ((v ^ 0x800000) - 0x800000).astype(np.float32) / 8388608
    elif width == 4:
        values = np.frombuffer(raw, '<i4').astype(np.float32) / 2147483648
    else: raise PlanError('Unsupported PCM WAV sample width')
    tensor = torch.from_numpy(values.reshape(-1, channels).T.copy()).unsqueeze(0)
    if channels == 1: tensor = tensor.repeat(1, 2, 1)
    return {'waveform': tensor, 'sample_rate': rate}


def load_audio(path: Path) -> dict:
    # PyAV is supplied by current ComfyUI. PCM fallback also supports isolated CPU tests.
    try:
        import av
    except ImportError:
        if path.suffix.lower() == '.wav': return _load_pcm_wave(path)
        raise RuntimeError('Audio import requires the PyAV dependency supplied by ComfyUI; use PCM WAV or repair the ComfyUI environment')
    try:
        with av.open(str(path)) as c:
            if not c.streams.audio: raise PlanError('File contains no audio stream')
            stream = c.streams.audio[0]
            rate = int(stream.codec_context.sample_rate or stream.rate or 32000)
            if not 8000 <= rate <= 192000: raise PlanError('Unsupported audio sample rate')
            convert = av.AudioResampler(format='fltp', layout='stereo', rate=rate)
            arrays = []
            for frame in c.decode(stream):
                for output in convert.resample(frame): arrays.append(output.to_ndarray())
            for output in convert.resample(None): arrays.append(output.to_ndarray())
        if not arrays: raise PlanError('Audio file is empty')
        tensor = torch.from_numpy(np.concatenate(arrays, axis=1).copy()).float().unsqueeze(0)
        if not bool(torch.isfinite(tensor).all()): raise PlanError('Audio contains NaN/Inf')
        return {'waveform': tensor, 'sample_rate': rate}
    except PlanError: raise
    except Exception as exc:
        raise RuntimeError(f'Cannot decode audio {path.name}: {exc}') from exc


def render_original_audio(plan: dict, root: Path, total_frames: int, *, loader=load_audio, resampler=None, stack=None, cancel=lambda:None) -> dict | None:
    if not plan['audio']: return None
    if stack is not None:
        return _render_audio_to_disk(plan, root, total_frames, stack, cancel)
    by_id = {a['id']: a for a in plan['assets']}
    loaded = {}
    for clip in plan['audio']:
        aid = clip['asset_id']
        if aid not in loaded: loaded[aid] = loader(asset_path(by_id[aid], root))
    rate = int(loaded[plan['audio'][0]['asset_id']]['sample_rate'])
    output = torch.zeros((1, 2, round(total_frames * rate / FPS)), dtype=torch.float32)
    if resampler is None:
        from .vendor.continuum.audio_compat import resample_audio
        resampler = resample_audio
    for clip in plan['audio']:
        source = loaded[clip['asset_id']]
        src_rate, waveform = int(source['sample_rate']), source['waveform']
        if waveform.ndim != 3 or waveform.shape[0] != 1 or waveform.shape[1] not in (1, 2):
            raise PlanError('Audio must be mono/stereo with batch size 1')
        if not bool(torch.isfinite(waveform).all()): raise PlanError('Audio contains NaN/Inf')
        source_start = round(clip['source_in'] * src_rate)
        source_stop = round((clip['source_in'] + clip['duration']) * src_rate)
        if source_stop > waveform.shape[-1] + 1: raise PlanError('Audio source trim exceeds decoded samples')
        part = waveform[..., source_start:min(source_stop, waveform.shape[-1])].clone()
        if part.shape[1] == 1: part = part.repeat(1, 2, 1)
        if src_rate != rate: part = resampler(part, src_rate, rate)
        start = round(clip['start'] * rate)
        stop = round((clip['start'] + clip['duration']) * rate)
        wanted = stop - start
        if stop > output.shape[-1]: raise PlanError('Audio exceeds rendered timeline')
        if abs(part.shape[-1] - wanted) > 2: raise PlanError('Audio resampler returned an unexpected sample count')
        count = min(wanted, part.shape[-1])
        output[..., start:start+count].copy_(part[..., :count])
    return {'waveform': output.contiguous(), 'sample_rate': rate}


def _render_audio_to_disk(plan, root, total_frames, stack, cancel):
    """Decode in bounded blocks; no whole source or full timeline PCM RAM copy."""
    import av
    from . import storage
    assets = {a['id']:a for a in plan['assets']}
    paths = {c['asset_id']:asset_path(assets[c['asset_id']], root) for c in plan['audio']}
    with av.open(str(paths[plan['audio'][0]['asset_id']])) as container:
        if not container.streams.audio: raise PlanError('File contains no audio stream')
        stream = container.streams.audio[0]
        rate = int(stream.codec_context.sample_rate or stream.rate or 32000)
    if not 8000 <= rate <= 192000: raise PlanError('Unsupported audio sample rate')
    allocation = storage.allocate(stack, (1, 2, round(total_frames*rate/FPS)), torch.float32)
    output = allocation.tensor
    output.zero_()
    for aid, path in paths.items():
        clips = [c for c in plan['audio'] if c['asset_id']==aid]
        spans = [(round(c['source_in']*rate), round((c['source_in']+c['duration'])*rate), round(c['start']*rate)) for c in clips]
        required = max(b for a,b,d in spans)
        cursor = 0
        def copy_block(frame):
            nonlocal cursor
            cancel()
            block = torch.from_numpy(frame.to_ndarray()).unsqueeze(0)
            if not bool(torch.isfinite(block).all()): raise PlanError('Audio contains NaN/Inf')
            stop = cursor+block.shape[-1]
            for a,b,d in spans:
                lo,hi = max(a,cursor), min(b,stop)
                if hi>lo:
                    dst = d+lo-a
                    count = min(hi-lo, output.shape[-1]-dst)
                    if count<hi-lo: raise PlanError('Audio exceeds rendered timeline')
                    output[...,dst:dst+count].copy_(block[...,lo-cursor:lo-cursor+count])
            cursor=stop
        with av.open(str(path)) as container:
            if not container.streams.audio: raise PlanError('File contains no audio stream')
            stream=container.streams.audio[0]
            convert=av.AudioResampler(format='fltp', layout='stereo', rate=rate)
            for frame in container.decode(stream):
                for converted in convert.resample(frame): copy_block(converted)
                if cursor>=required: break
            else:
                for converted in convert.resample(None): copy_block(converted)
        if cursor+2<required: raise PlanError('Audio source trim exceeds decoded samples')
    return {'waveform':allocation.publish(), 'sample_rate':rate}


def resolve_resolution(megapixels: float, aspect: str, first_image=None) -> tuple[int, int]:
    mp = float(megapixels)
    if not math.isfinite(mp) or not .1 <= mp <= 2: raise PlanError('Megapixels must be between 0.1 and 2.0')
    ratios = {'16:9': 16/9, '9:16': 9/16, '1:1': 1., '4:3': 4/3, '3:4': 3/4}
    if aspect not in ratios: raise PlanError('Unsupported aspect ratio')
    ratio = first_image.shape[2] / first_image.shape[1] if first_image is not None else ratios[aspect]
    width = max(32, round(math.sqrt(mp * 1_000_000 * ratio) / 32) * 32)
    height = max(32, round(math.sqrt(mp * 1_000_000 / ratio) / 32) * 32)
    return width, height
