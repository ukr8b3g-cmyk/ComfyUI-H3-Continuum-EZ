# Changelog

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
