# Changelog

## 0.13.5

- Preview the first generated chunk while later chunks are still rendering. The finished video replaces the chunk preview when it is ready.
- Keep saved AI text selected when shot timing or output dimensions change.
- Let **Save Project** choose a file name and folder in supported browsers, with a browser download as a fallback.
- Remove the toolbar's **Expand Prompt** shortcut. **Expand Editor** remains in the prompt panel.
- Distinguish the add, duplicate and delete timeline actions with color and update the English and Japanese README walkthroughs with twelve numbered controls.

## 0.13.4

- Show checking/submitting, red rejection feedback, and a green acceptance check on Apply and Queue.
- Display actionable input errors near the button without hiding running/completed/interrupted job status.
- Recover matching terminal status from queue history, scoped to the workflow, output-connected Timeline, known job IDs and submission time.
- Record real mouse queue acceptance and execution start in the usual ComfyUI; subsequent interruptions were user-confirmed cancellations, not completed-render checks.
- Preserve model wiring, seed controls, workflow templates and the generation backend.

## 0.13.3

- Keep Apply and Queue available on editable input errors; retain validation before queue submission and show the reason beside the action and in its tooltip.
- Centralize temporary upload/apply/submit locking and completion/error recovery; lock immediately when applying starts.
- Publish isolated-browser recovery observations and explicit live/native-upload testing limits. No model wiring, seed, workflow or generation-backend changes.

## 0.13.2

- Reduce continuation-boundary motion hitches using unchanged Continuum cosine blending and Auto safety checks, after existing exposure/color correction.
- Keep a fixed previous-2/next-5-frame analysis window; blend at most two leading frames only when accepted. Preserve timing, audio, model wiring, seeds and vendor algorithms.
- Record a real FastH3 two-chunk GPU before/after comparison: boundary five-frame change peak reduced by 28.8%, 379 frames and 682 AAC packets preserved; localized softness remains.
- Python 346 / JavaScript 99 tests passed. Continuity diagnostics remain off by default.

## 0.13.1

- Add opt-in continuity Context and model-wrapper diagnostics; default off, no new UI controls or workflow inputs.
- Distinguish actual layout validations from forecast-only or unexecuted fixtures; keep report mode diagnostic failures non-fatal.
- Record real FastH3 two-chunk GPU verification: metadata valid, 8 actual validations, zero failures; audio/frame timing and workflow wiring/seeds preserved.
- Python 340 / JavaScript 99 tests passed.

## 0.13.0 — 2026-11-08

- Add editable video-oriented AI Instructions in Studio, saved in project files, with optional Engine `ai_instruction` STRING input. External input takes priority while Studio instructions are retained.
- Execute external instruction nodes only for explicit AI generation; keep AI model/instruction dependencies out of ordinary video validation. Common text remains separate and provides read-only context for shot AI.
- Preserve saved common/shot AI text and Original/AI Text selections when only Studio MP changes. Keep reference, timing, aspect and Engine-size validation.
- Add bounded continuation-boundary correction using unchanged Continuum CPU seam metrics/color guard and a conservative isolated-exposure candidate. Inspect two previous and five current frames; retain the original when safety checks fail.
- Preserve scene cuts, frame count, seeds and original audio timing. Stream corrected video without allocating a full-timeline RGB buffer. Report the applied method and boundary metrics.
- Document real Windows/Chrome AI inference and two-chunk FastH3 GPU verification, alongside CPU/JavaScript tests. Keep both model workflow templates byte-identical to v0.12.0.

## 0.12.0 — 2026-11-08

- Add New Project, Open Project and Save Project to the Studio toolbar. Save editing plans as `.h3ez.json`, retaining text, AI selections, media references, audio edits and output settings.
- Protect unsaved edits with Cancel/Replace, a close button and Escape. Keep Undo across project replacement and reject invalid files without replacing the current plan.
- Keep FastH3 OmniRef eight-step as the main workflow. Offer the earlier REF2VA + Pika Flex workflow as an optional template, preserving both workflows' model connections and seed settings.
- Separate historical development test logs from the dated v0.11.2 revalidation records and document the current prompt-selection behavior.

## 0.11.2 — 2026-11-07

- Replace the README walkthrough with separate Japanese and English screenshots of the current Studio UI, each with eight numbered controls and matching instructions.
- Clarify that the supplied NVFP4 AWQ text encoder is not Blackwell-only, in both READMEs and the template's documentation note.
- Preserve the FastH3 model connections, sampling settings and generation implementation.

## 0.11.1 — 2026-11-07

- Ship the supplied FastH3 OmniRef workflow as the single template, preserving its model links, Euler/simple eight-step schedule, shifts 12/3, VSA and Comfy Kitchen attention. No additional Pika LoRA.
- Synchronize the inner and promoted model defaults and include download metadata for all five models. Keep user media out of the distribution template.
- Document Python, ComfyUI, CUDA/PyTorch, Comfy Kitchen, NVFP4 hardware and PyAV requirements in Japanese and English, separating model-loader support from the validated full workflow.
- The generation implementation is unchanged from v0.11.0.

## 0.11.0 — 2026-11-07

- Pass active references, start/end images, duration and output size to shot AI automatically, keeping common text separate.
- Preserve the full duration of imported audio and support audio-only import from video, bounded waveform analysis, library-to-track dragging, clip editing and Match Video to Audio.
- Add separate preview mute/volume and saved per-clip output volume for RAM and disk-backed rendering.
- Honor the automatic split interval for shorter shots as well; use a 7.5-second default and automatically supply IMAGE data when an active output requires it.
- Overlay generated thumbnails on shots, fix timeline zoom anchoring, compact prompt controls, relocate the ending-image selector and remove the manual Check Inputs button. Automatic validation before generation remains.
- Keep one workflow template and the original Continuum vendor algorithms. Centralize the runtime and REPORT version.

## 0.10.1 — 2026-11-07

- Allow ordinary video generation without the optional AI text model while keeping the workflow's model connection intact.
- Preserve validation for video models and explicit AI text jobs.
- Verified real H3 generation from Studio on Windows in both Long video and Images modes, with decoded video and audio.

## 0.10.0 — 2026-11-07

- Ship one two-shot Studio workflow and a numbered walkthrough in Japanese and English.
- Generate and select AI text independently for the shot and common prompt. Batch generation handles shot text only.
- Preview the video prompt directly and toggle shared text per shot. Add dialogue and ending images in their own controls.

## 0.9.1 — 2026-11-06

- Long video follows IMAGE links to output nodes so an unused Create Video branch no longer blocks export.
- Studio keeps media upload, replacement and audio placement errors visible after the operation ends.
- Check input image dimensions before EXIF orientation correction.
- Verified a short H3 GPU render from Studio on Windows with the unused IMAGE branch present and decoded the saved MP4 with its generated stereo audio.

## 0.9.0 (v0.9) — 2026-11-06

First public release of the Timeline Studio with the original Continuum 3.10.2 continuation core.

- Edit shots, references, common and per-shot prompts, dialogue and audio on one timeline. Trim shot edges with snapping and assign a final image to a shot.
- Export an audio MP4 progressively, or return image frames for downstream processing. Choose managed temporary storage and a target interval for long-shot splitting.
- Play generated video at its actual aspect ratio, seek from the timeline and see queue and shot status in Studio.
- Configure output size in Studio, mirror the native seed mode on subgraphs and resolve equivalent Windows model path separators.
- Includes Japanese and English instructions, standard and API workflows, a prompt template and tests. See [validation](docs/RELEASE_VALIDATION_JA.md) for the tested scope.

## Development history — Timeline evolution — 2026-11-06

Shot-edge resize and snapping, per-shot generation states and playable thumbnail filmstrips, bounded internal splitting for shots longer than 15 seconds, optional image names and dialogue rows, and final-part ending images using the unchanged Continuum keyframe path. Generation now prepares/samples/decodes/exports one part at a time. Original audio is streamed into managed PCM buffers and guide encoding is part-bounded. Temporary proxies have active-run protection, expiry and quotas. No Resume, Second Pass, workflow/node renaming, new dependencies or publication. CPU and isolated browser validation are recorded separately from untested live H3 GPU generation.

## Development history — Easy prompt assembly — 2026-11-05

Reference thumbnails now drive automatic image bindings and H3 prompt structure. Common situation and per-shot action can be entered as plain text; reference-number buttons are removed. Text-only, start-image, reference-image and continuation paths share identical browser/server assembly. Existing complete H3 prompts and legacy tags remain compatible; original input text and audio behavior are preserved. Japanese/English hints and EZ-specific examples are included. CPU and isolated-browser validation do not certify real H3 GPU quality.

## Internal prototype 2.0.0 — 2026-11-05
Hybrid Timeline/HTML Studio. Stable image refs; long common/per-shot/external prompts; original-audio edit lane; continue/cut boundaries; vendored original Continuum reference_context_v1 primitives. New node IDs. No automatic migration from 1.0.0. See the validation report for untested runtime gates.
