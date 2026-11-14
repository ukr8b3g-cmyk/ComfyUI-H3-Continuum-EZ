# Registry review for v0.13.6

The [Registry API](https://api.comfy.org/nodes/comfyui-h3-continuum-ez/versions?include_status_reason=true) reported 15 informational scanner findings against v0.13.5. Line numbers below refer to the 195-file Registry ZIP for v0.13.5, with SHA-256 `efab39331673bca8dcc6edcfe459089ef87bfecb068b774e26ba468be8a46aae`. Each finding was compared with the local source.

| # | Location in v0.13.5 | Disposition |
|---|---|---|
| 1 | `audio_probe.py:9` | The formatting rule matched a line of variable assignments. The surrounding review found a separate gap in media input handling. The fix supplies the validated local file as a stream and denies auxiliary I/O in both audio inspection and rendering. The audio inspection code was also reformatted for readability. |
| 2 | `tests/test_plan_media.py:45` | Formatting. Initializes reference slots for a unit test. |
| 3 | `tests/test_timeline_evolution.py:53` | Formatting. Defines a fixed script that compares Python and JavaScript timeline results. |
| 4 | `tools/assist_browser_check.py:41` | Formatting. Initializes isolated browser fixture state. |
| 5 | `vendor/continuum/decode_base.py:12` | Formatting. Runs the extracted Continuum decode and tensor normalization operations. |
| 6 | `vendor/continuum/layout_adapter.py:643` | Formatting. Computes the audio context positions using established Continuum logic. |
| 7 | `vendor/continuum/v2/seam_guard.py:57` | Formatting. Adjusts luma and color at a continuation boundary. |
| 8 | `continuity_audit.py:61` | False positive for environment modification. Reads the opt-in audit mode, which defaults to off. |
| 9 | `tools/assist_browser_check.py:99` | False positive for environment modification. A developer-supplied environment variable selects the executable used by the isolated browser test. |
| 10 | `ez_nodes.py:39` | False positive for bytecode manipulation. Imports the standard-library JSON module by a fixed name and parses timeline data. |
| 11 | `vendor/continuum/audio_compat.py:12` | False positive for bytecode manipulation. Tries a fixed ComfyUI audio module name for resampling compatibility. |
| 12 | `tests/test_easy_prompt.py:177` | False positive for command injection. The test runs a fixed Node.js script with an argument vector and sends comparison data over stdin. |
| 13 | `tests/test_timeline_evolution.py:55` | False positive for command injection. The test runs a fixed Node.js script to compare parts and prompts. |
| 14 | `tests/test_timeline_evolution.py:77` | False positive for command injection. The test runs a fixed Node.js script to compare automatic splitting results. |
| 15 | `web/studio.js:854` | False positive for networking. The matched method attaches prompt controls to the Studio DOM. |

## Verification

- Python tests passed 363 of 363. JavaScript tests passed 105 of 105.
- A focused test checks that PyAV receives the already-open file and that the additional-resource callback rejects local and remote reference requests. Static review of PyAV and FFmpeg checked the callback and native protocol restriction. The focused test uses a mock at the PyAV boundary.
- A 60-second MP3 and a 12-second MP4 with audio produced identical before-and-after metadata, waveform peaks and decoded PCM. The RAM and disk rendering paths were checked with PyAV 17.0.0 and the ComfyUI_W Python environment with PyAV 19.0.2. The WAV fallback also passed.
- The workflow templates and seed control files were verified byte for byte. The package manifest and 22 upstream provenance hashes passed.
- This release validation used local CPU tests. Live ComfyUI Studio and GPU generation were outside this validation.
