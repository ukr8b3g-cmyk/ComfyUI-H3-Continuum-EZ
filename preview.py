"""Write a browser-playable result using ComfyUI's installed video encoder."""
from fractions import Fraction
from pathlib import Path
from uuid import uuid4


def save_preview(images, audio, fps, output_root):
    from comfy_api.latest import InputImpl, Types
    folder = Path(output_root) / 'h3_continuum_ez'
    folder.mkdir(parents=True, exist_ok=True)
    name = f'EZ_{uuid4().hex}.mp4'
    target = folder / name
    pending = folder / (name + '.partial.mp4')
    try:
        video = InputImpl.VideoFromComponents(Types.VideoComponents(
            images=images, audio=audio, frame_rate=Fraction(str(fps))))
        video.save_to(str(pending), format=Types.VideoContainer('mp4'),
                      codec=Types.VideoCodec('h264'))
        pending.replace(target)
    except BaseException:
        pending.unlink(missing_ok=True)
        raise
    return {'filename': name, 'subfolder': 'h3_continuum_ez', 'type': 'output'}
