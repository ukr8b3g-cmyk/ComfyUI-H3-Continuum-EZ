"""Bounded-frame MP4 encoder. Does not build a full RGB tensor."""
from fractions import Fraction
from pathlib import Path
from uuid import uuid4
import shutil
import torch


class StreamVideo:
    def __init__(self, output_root, width, height, fps, cancel, *, subfolder='h3_continuum_ez', preset='medium', crf='18', file_type='output'):
        import av
        self.av, self.cancel = av, cancel
        self.subfolder, self.file_type = subfolder, file_type
        self.folder = Path(output_root) / subfolder
        self.folder.mkdir(parents=True, exist_ok=True)
        self.check_space()
        self.name = f'EZ_{uuid4().hex}.mp4'
        self.path = self.folder / self.name
        self.partial = self.path.with_suffix('.partial.mp4')
        self.closed = False
        self.published = False
        self.count = 0
        self.fps = Fraction(str(fps))
        self.container = av.open(str(self.partial), mode='w', format='mp4')
        try:
            self.video = self.container.add_stream('libx264', rate=self.fps)
            self.video.width, self.video.height = width, height
            self.video.pix_fmt = 'yuv420p'
            self.video.options = {'crf': str(crf), 'preset': preset}
        except BaseException:
            self.close()
            raise

    def check_space(self):
        if shutil.disk_usage(self.folder).free < 2 * 1024**3:
            raise OSError('MP4 output needs at least 2 GiB of free disk reserve')

    def configure_audio(self, rate, channels):
        if hasattr(self, 'audio'):
            if (self.audio_rate, self.audio_channels) != (rate, channels):
                raise ValueError('Audio format changed between shots')
            return
        layout = {1:'mono', 2:'stereo', 6:'5.1'}.get(channels)
        if layout is None:
            raise ValueError('MP4 audio supports mono, stereo or 5.1')
        self.audio_rate, self.audio_channels = rate, channels
        self.audio = self.container.add_stream('aac', rate=rate, layout=layout)

    def append(self, images):
        self.check_space()
        for image in images:
            self.cancel()
            pixels = (image[..., :3] * 255).clamp(0,255).to(device='cpu', dtype=torch.uint8).numpy()
            frame = self.av.VideoFrame.from_ndarray(pixels, format='rgb24')
            frame.pts = self.count
            frame.time_base = 1 / self.fps
            self.container.mux(self.video.encode(frame))
            self.count += 1

    def finish(self, audio, expected_frames):
        if self.count != expected_frames:
            raise RuntimeError('Streaming video frame count mismatch')
        self.cancel()
        self.container.mux(self.video.encode(None))
        rate = int(audio['sample_rate'])
        wave = audio['waveform'][0]
        layout = {1:'mono', 2:'stereo', 6:'5.1'}.get(wave.shape[0])
        if layout is None:
            raise ValueError('MP4 audio supports mono, stereo or 5.1')
        stream = self.audio
        # Bounded audio blocks; never convert the whole waveform to a second array.
        for start in range(0, wave.shape[-1], 16384):
            self.cancel()
            frame = self.av.AudioFrame.from_ndarray(wave[:, start:start+16384].float().cpu().contiguous().numpy(), format='fltp', layout=layout)
            frame.sample_rate = rate
            frame.pts = start
            frame.time_base = Fraction(1, rate)
            self.container.mux(stream.encode(frame))
        self.container.mux(stream.encode(None))
        self.container.close()
        self.closed = True
        self.partial.replace(self.path)
        self.published = True
        return {'filename': self.name, 'subfolder':self.subfolder, 'type':self.file_type}

    def close(self):
        try:
            if not self.closed:
                self.container.close()
        finally:
            self.closed = True
            if not self.published:
                self.partial.unlink(missing_ok=True)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
