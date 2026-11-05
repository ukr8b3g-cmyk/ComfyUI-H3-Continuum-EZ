# H3 Continuum EZ Studio 0.9

[日本語](README.md) · [Download and release notes](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/tag/v0.9) · [Validation (Japanese)](docs/RELEASE_VALIDATION_JA.md)

**A visual timeline for ComfyUI that uses the [H3 Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum) generation engine as its backend.** Arrange shots, see your images and audio in Studio, write a few lines for each shot, and export a video with sound. The two included nodes, **Timeline** and **Engine**, keep the controls focused on editing and export.

The engine handles continuation and long-shot splitting internally. Advanced generation controls from full Continuum, including regenerating individual chunks, resuming a run and Second Pass, are outside EZ Studio's scope. EZ does not require a separate Continuum installation.

Shut down ComfyUI, extract the [v0.9 install ZIP](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.9/ComfyUI-H3-Continuum-EZ-v0.9.zip), and place `ComfyUI-H3-Continuum-EZ` in `ComfyUI/custom_nodes/`. Move an older copy of EZ out of `custom_nodes` first. Leave ordinary Continuum and its Runs/Takes in place. Workflows from the legacy EZ 1.0 prototype are not migrated. Restart ComfyUI and open the [REF2VA workflow template](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.9/H3_EZ_Studio_REF2VA_Template.json).

## REF2VA template and model downloads

The [template source](examples/H3_EZ_Studio_REF2VA_Template.json) is a two-shot reference-to-video example. Add your own pictures to **Shared refs**, then edit the common situation and each shot's action. The template starts at portrait 2:3, 0.5 MP, and exports MP4 with audio. It uses core nodes saved with ComfyUI 0.44.0 and needs no custom nodes other than EZ. Model weights are separate downloads.

| Model | Download | Folder under `ComfyUI/models/` |
| --- | --- | --- |
| REF2VA diffusion model, Pruned INT8 | [minimax_h3_ref2va_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors) | `diffusion_models/` |
| Qwen3-VL 32B NVFP4/AWQ text encoder | [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders/` |
| Video VAE | [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae/` |
| Audio VAE | [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae/` |
| Pika H3 Flex REF2VA LoRA | [pika_h3_flex_ref2va_v1_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/pika_h3_flex_ref2va_v1_bf16.safetensors) | `loras/` |

Select the installed files on the subgraph node if you use shared model folders or subfolders such as `minimax/`. The encoder type is `minimax`. The template uses the [Pika Flex settings](https://huggingface.co/Comfy-Org/MiniMax-H3/commit/8118df0eaf5e96acc56eed5daf5229ca81cc05cf): LoRA strength 1.0, LCM and six manual sampling steps. Do not stack a Turbo LoRA. See the [model card](https://huggingface.co/Comfy-Org/MiniMax-H3) for INT8 requirements and alternatives. Block Sparse Attention is bypassed. If Comfy Kitchen Attention is unavailable, select `pytorch attention`. SaveVideo uses the normal `output/video/` folder.

For a FL2VA example without LoRA, use [Basic](examples/H3_EZ_Studio_Basic.json). To see how to connect external text, open [External Prompt](examples/H3_EZ_Studio_External_Prompt.json). Both also have API versions.

Click **Open Timeline Studio**. Select reference thumbnails, arrange shots, and enter target seconds. Write the shared situation in **Common Prompt** and the action in **This Shot**. Image bindings and H3 prompt structure are assembled automatically. No reference numbers, chunk headings, or external text node are required. Japanese ComfyUI locales use Japanese; all other locales use English. Optional external STRING is selected through **External text**. Editing the common text selects **Studio**, preserving the connection and using your edits. You can switch back without losing the saved Studio text.

## Prompt template and example

| Studio field | What to write |
| --- | --- |
| Common Prompt | Who is in the scene, where they are, and what should stay consistent: style, lighting or background sound. |
| Shot 1 → This Shot | The first action. Add the speaker, dialogue or camera direction if useful. |
| Shot 2 → This Shot | What happens next. Add a reaction, expression or camera move if useful. |

**Example: two travelers meet in a garden**

Common Prompt:
```text
Two travelers meet in a quiet garden. Soft afternoon light and gentle wind. Keep their faces and outfits consistent across both shots. No subtitles or logos.
```

Shot 1:
```text
A medium two-shot. One traveler turns to the other and asks, "Shall we go?" The other listens.
```

Shot 2:
```text
Continue with both travelers in view. The listener nods, and they turn toward the path together. The camera gently follows.
```

Add images under **Shared refs** and set Shot 2 to **Continue previous shot**. Set shot lengths and cuts on the timeline. Studio builds the image bindings and prompt format automatically.
See [Easy prompt usage and limits](docs/EASY_PROMPTS_EN.md). **Effective Prompt** lets you edit common text for all shots and the body for the selected shot. **Inspect generated text** reveals the automatically assembled model input. User text stays verbatim; this is deterministic assembly, not an LLM rewrite or image captioner. Real H3 GPU quality for the new assembly remains unverified.

Seconds are targets: output is on the original H3 frame grid. The UI shows effective duration. In **Advanced output**, enable **Auto split** and set **Seconds per part** (2–15, default 5). Shots over 15 seconds are divided into continued parts around that target; shorter shots remain one part. With splitting off, each shot must be 15 seconds or less. Each part is sampled, decoded, saved and released before the next. A cut resets continuation at the start of the logical shot. Input limits with splitting enabled are 2–600 seconds per shot, 16 shots and 60 minutes of actual total duration; these are not a GPU capability guarantee.

The Studio header shows waiting position, running, completion or failure for this Timeline. Running includes model loading and output saving. Generated and previous videos preserve their actual aspect ratio even when the current Studio settings differ. When an EZ Engine seed is exposed as an unconnected subgraph input, **seed · control after generate** mirrors the original control (fixed/increment/decrement/randomize). Native ComfyUI still performs seed updates. An externally connected seed remains controlled by its external node.

Drag the right edge to change duration and shift later shots. Drag the left edge to adjust the two adjacent shots without changing their combined length. Edges snap to the playhead, shot boundaries and audio edges; hold Alt to disable snapping. Arrow keys move an edge one H3 step. Each drag is one Undo action.

Give images optional names in the media library. Expand **Dialogue / End image** to select speakers, enter dialogue and optionally set a starting second. Selecting a speaker selects their reference image automatically. Blank times distribute lines evenly; each line belongs to one internal part. An ending image guides only the final internal part of its shot. Identity, exact speech timing, lip-sync and exact final-frame reproduction remain model-dependent.

Shot badges show actual preparation, generation, saving, completion or failure. Completed parts provide audio MP4 proxies and up to five thumbnails per shot. Click a thumbnail to play at its timeline time. Proxies use managed temporary storage; saved final videos and thumbnails persist in the output folder. Audio remains one non-overlapping lane. Imported PCM is assembled on disk and guides only the current part plus its context. The original edited audio is the final soundtrack, without decoding discarded generated audio. Without imported audio, H3 audio is decoded normally.

All editing remains a draft until **Apply to Node**; **Export video** applies and invokes the standard queue. Workflow saving is a separate ComfyUI action. Uploaded assets remain input files; JSON carries relative references. Video export does not allocate full-length RGB output. Explicit image-frame output retains the full IMAGE contract and can still require substantial memory in downstream nodes. See the [implementation specification](docs/TIMELINE_EVOLUTION_SPEC_JA.md) and [current validation](docs/TIMELINE_EVOLUTION_VALIDATION_JA.md).

The original Continuum v3.10.2 low-level continuation/model-layout/state/sampling code is vendored unchanged; the variable-duration orchestrator and Studio are new. Source provenance and MIT notice are included. This is NOT the standalone 22-frame Masked AV engine from EZ 1.0.0.

**Validation:** CPU tests, JavaScript tests and standalone Chromium checks passed. Seed control display and JSON export were verified in a separate test workflow on Windows with ComfyUI frontend 1.57.6 Classic. Real H3 GPU acceptance, Nodes 2.0 and peak memory on long runs remain unverified. See the [v0.9 validation](docs/RELEASE_VALIDATION_JA.md).
