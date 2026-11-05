"""Unchanged function bodies extracted from v2/decoder.py; see provenance."""
from typing import Any
import torch

def decode_video(video_vae:Any,latent:dict[str,Any])->torch.Tensor:
    samples=latent["samples"]; video=list(samples.unbind())[0] if hasattr(samples,"unbind") else samples[0]; images=video_vae.decode(video)
    if images.ndim==5: images=images.reshape(-1,images.shape[-3],images.shape[-2],images.shape[-1])
    if images.ndim!=4: raise ValueError(f"video VAE returned unexpected shape {tuple(images.shape)}")
    return images.detach().to("cpu").contiguous()

def decode_audio(audio_vae:Any,latent:dict[str,Any])->dict[str,Any]:
    samples=latent["samples"]; audio_latent=list(samples.unbind())[-1] if hasattr(samples,"unbind") else samples[-1]; audio=audio_vae.decode(audio_latent).movedim(-1,1); std=torch.std(audio,dim=[1,2],keepdim=True)*5.0; std[std<1.0]=1.0; audio=(audio/std).detach().to("cpu").contiguous(); sample_rate=getattr(audio_vae,"audio_sample_rate_output",getattr(audio_vae,"audio_sample_rate",32000)); return {"waveform":audio,"sample_rate":int(sample_rate)}
