"""Stream audio metadata and a bounded waveform, including audio in video files."""
from pathlib import Path
import numpy as np
from .plan import asset_path,PlanError

def inspect_audio(file, input_root):
    import av
    path=asset_path({'file':file},Path(input_root))
    peaks=[];block=2048;pending=0;level=0.;samples=0;largest_frame=0
    with av.open(str(path)) as c:
        if not c.streams.audio:raise PlanError('The file has no audio stream / 音声トラックがありません')
        stream=c.streams.audio[0];rate=int(stream.codec_context.sample_rate or 0)
        if not 8000<=rate<=192000:raise PlanError('Unsupported audio sample rate')
        channels=stream.codec_context.channels
        declared=round(float(stream.duration*stream.time_base)*rate) if stream.duration else None
        for frame in c.decode(stream):
            raw=frame.to_ndarray();data=raw.astype(np.float32)
            if np.issubdtype(raw.dtype,np.integer):data/=float(2**(np.iinfo(raw.dtype).bits-1))
            if not np.isfinite(data).all():raise PlanError('Audio contains NaN/Inf')
            values=np.abs(data).max(axis=0)if frame.format.is_planar else np.abs(data.reshape(-1,channels)).max(axis=1)
            samples+=frame.samples;largest_frame=max(largest_frame,frame.samples);offset=0
            while offset<len(values):
                n=min(block-pending,len(values)-offset);level=max(level,float(values[offset:offset+n].max()));pending+=n;offset+=n
                if pending==block:
                    peaks.append(level);pending=0;level=0.
                    if len(peaks)>=2048:peaks=[max(peaks[i:i+2])for i in range(0,len(peaks),2)];block*=2
        if pending:peaks.append(level)
        has_video=bool(c.streams.video)
    if not samples:raise PlanError('Audio file is empty')
    # Container audio duration excludes encoder padding. Disregard implausible
    # headers rather than using them to truncate the source.
    if declared and 0<=samples-declared<=largest_frame*2:samples=declared
    return {'duration':samples/rate,'sample_rate':rate,'channels':channels,'peaks':peaks,'has_video':has_video}
