[日本語](README_JA.md) · [v0.11.1 release](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/tag/v0.11.1) · [ZIP](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.11.1/ComfyUI-H3-Continuum-EZ-v0.11.1.zip) · [Workflow](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.11.1/H3_Continuum_EZ_Studio.json)

# H3 Continuum EZ Studio

An interactive ComfyUI timeline powered by the [H3 Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum) continuation engine. Arrange media, edit each shot, and export a video with audio. The engine splits long shots into internal parts and carries the scene across them.

## Get started

1. Extract the [release ZIP](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.11.1/ComfyUI-H3-Continuum-EZ-v0.11.1.zip) and place `ComfyUI-H3-Continuum-EZ` in `ComfyUI/custom_nodes/`. For a Git install, run `git clone https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ.git` from `custom_nodes`. Update a Git install with `git pull --ff-only`. Restart ComfyUI and refresh the browser after installing or updating.
2. Drag [H3_Continuum_EZ_Studio.json](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.11.1/H3_Continuum_EZ_Studio.json) into ComfyUI. The [same template](examples/H3_Continuum_EZ_Studio.json) is in the repository.
3. Install the models below and check their file selections on the subgraph. Open **Timeline Studio** on the H3 Continuum EZ Timeline node. The template starts with two sample shots set in a garden.

## Studio walkthrough

![Studio screenshot with eight numbered controls described below.](docs/studio-guide-en.svg)

| No. | What to do |
| --- | --- |
| ① Media | Use **Add Media** or drop images and audio into the library. Reuse an image by adding it to the selected shot's references. User-provided media in this screenshot is an example. |
| ② Timeline and audio | Select, add, duplicate, delete, reorder or split shots. Drag a shot edge to change its duration. Drag audio from the library to the lower track, then select a clip to edit or delete that placement. |
| ③ Shot, references and size | Set **Target seconds** and **Scene cut / Continue** for the selected shot. Choose shared or shot references, click the images to use, and optionally choose an **End image**. Aspect ratio and MP set the output size for the whole video. **Time** shows H3-aligned duration. |
| ④ Prompts | Edit the selected scene in **Shot Prompt**, or reusable details in **Common Prompt**. **Common text on/off** controls whether the selected shot includes common text. **Generation Prompt** shows the combined text sent to the video model. |
| ⑤ AI text | Click **Generate AI** directly below the field. **Original / AI Text** selects the text used for video generation; both are retained. Shot AI automatically receives its images, timing and size, while common text remains separate. **Generate All Shots** on the top bar processes shot text only. |
| ⑥ Dialogue and direction | **Add Dialogue** adds a speaker, words and optional start time. Choose **Camera**, add actions, or assign a reference role below. These become model instructions rather than exact motion or speech timing controls. |
| ⑦ Preview | Use **Layout** before generation and **Generated video** after rendering. Playback and seeking follow the timeline. Mute and volume here affect preview only. Optional **Start image** and **Shared refs** are below the player; select shared references in the shot controls to inherit them. |
| ⑧ Apply and generate | **Apply to Node** saves the Studio draft to the workflow without rendering. **Apply and Queue** starts the video job. Save the workflow in ComfyUI to keep edits. **Output Settings** controls output and automatic splitting; **Temporary storage** manages the server's working storage. |

The P-H3 prompt upsampler is optional. Without it, keep **Original** selected and generate video with the existing wiring. **Generate AI** creates and selects AI text; it does not start a video job. You can edit the AI text or switch back to **Original** before generating video.

Shot AI automatically receives the shot’s active reference images, start/end images, duration and output aspect ratio. Common text stays separate; its AI action receives only common text and shared references. The reference count beside **Generate AI** shows the images sent, with details on hover. No image selector or additional setup is needed. Images are reduced to a bounded total size for AI analysis; original assets are unchanged. Changing the original, references, duration or output size makes the saved AI text stale until regenerated.

## Template models

The current single template is based on the supplied **FastH3 OmniRef** workflow. Download it from [examples/H3_Continuum_EZ_Studio.json](examples/H3_Continuum_EZ_Studio.json). The release ZIP includes this same FastH3 template. Model weights and reference media are not bundled.

### Requirements

| Component | Requirement / verified configuration |
| --- | --- |
| ComfyUI | **v0.44.0 or newer recommended** for this complete subgraph; verified on v0.44.0. Baked-PDD model loading first shipped in **v0.42.0**. Earlier releases cannot load this checkpoint correctly. |
| Frontend | Use the version supplied with ComfyUI. This workflow was saved and checked with **1.57.6**. |
| Python | **3.13 recommended**, verified with **3.13.12**. Python 3.13 is not a checkpoint-specific minimum; other Python environments have not been validated for this template. |
| NVIDIA PyTorch | Use a **CUDA 13.0 or newer build (`cu130+`)**. Verified with **2.14.1+cu130**. A CUDA Toolkit installation alone does not upgrade PyTorch's runtime. |
| Comfy Kitchen | Install ComfyUI's pinned dependencies; verified with **0.2.40**. Its prebuilt CUDA wheels require CUDA runtime 13.0+ and NVIDIA driver **r580+**. |
| Default text encoder | The supplied **NVFP4 AWQ encoder is not Blackwell-only**, as clarified by [Comfy-Org](https://huggingface.co/Comfy-Org/MiniMax-H3). Native NVFP4 acceleration depends on compatible hardware and kernels. Optional alternatives are [BF16](https://huggingface.co/FastVideo/FastH3-Omni-Comfy/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_bf16.safetensors) or [INT8 ConvRot](https://huggingface.co/FastVideo/FastH3-Omni-Comfy/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors) text encoders, selected on the subgraph. |
| Video/audio output | PyAV from ComfyUI's dependencies, **17+**; verified with **19.0.2**. |

The loader boundary comes from [PDD support in ComfyUI v0.42.0](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.42.0). CUDA/Python requirements are documented by [ComfyUI](https://github.com/Comfy-Org/ComfyUI#manual-install-windows-linux) and [Comfy Kitchen](https://github.com/Comfy-Org/comfy-kitchen#requirements); model components and NVFP4 hardware support are documented in the [FastH3 model card](https://huggingface.co/FastVideo/FastH3-Omni-Comfy). The older versions and alternative GPUs have not been validated by this project.


| Purpose | Subgraph field | Download | Under `ComfyUI/models/` |
| --- | --- | --- | --- |
| FastH3 OmniRef diffusion model | `unet_name` | [fasth3_omniref_8step_pruned_int8_convrot.safetensors](https://huggingface.co/FastVideo/FastH3-Omni-Comfy/resolve/main/diffusion_models/fasth3_omniref_8step_pruned_int8_convrot.safetensors) | `diffusion_models/` |
| H3 text encoder | `clip_name` | [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders/` |
| P-H3 prompt upsampler | `clip_name_1` | [p-h3-image_prompt_upsampler_w4a8.safetensors](https://huggingface.co/PrunaAI/p-h3-image-comfy/resolve/main/text_encoders/p-h3-image_prompt_upsampler_w4a8.safetensors) | `text_encoders/` |
| Video VAE | `vae_name` | [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae/` |
| Audio VAE | `vae_name_1` | [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae/` |

If you use a shared model library or a subfolder such as `minimax/`, select the installed filenames on the subgraph. The FastH3 template keeps **Euler / simple / 8 steps**, **video shift 12 / audio shift 3**, **Comfy Kitchen attention**, **VSA 10% over the full interval**, and portrait **2:3 at 0.5 MP** from the supplied workflow. **Do not add the Pika LoRA** used by the earlier REF2VA template. The text encoder and VAEs remain shared H3 components; the internal sampling and attention settings also differ, so replacing only the diffusion filename in the older workflow does not reproduce this setup. The `clip_name_1` model powers the optional AI text controls.

Use **Output Settings** to tune long-shot splitting or switch to progressive video export for lower memory use. Imported audio is used as the soundtrack when present. For chunk regeneration, resume or Second Pass, use [H3 Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum).

Output choices are **Automatic / Save Video / Video + Images**. Video exports include audio; workflows that need image data receive it automatically, without connection changes. Automatic splitting defaults to **7.5 seconds**, so a 15-second shot uses two parts. The entered value is retained while actual durations follow H3's frame grid.

## Audio editing

Import audio through **Add Media** or the media drop area, then drag it from the library to the audio track. Importing to the library keeps the complete source duration; placing a one-minute source creates a one-minute clip. Video files can also be imported for their audio only. The source video is not placed on the picture track.

Select an audio clip to move, trim, split, duplicate or delete it. Delete/Backspace removes the selected placement; the source stays in the library and Undo restores the edit. Audio extending beyond the shots remains visible. Use **Match Video to Audio** to extend the last shot before generating; generation does not silently cut the audio or extend shots.

The player mute and volume control affect preview playback only. The selected clip's volume controls its guide audio and exported soundtrack. This version supports one non-overlapping audio track.

See the [prompt guide](docs/EASY_PROMPTS_EN.md) for more examples. AI text is an experimental adaptation for video prompts. Review the result before generating.
