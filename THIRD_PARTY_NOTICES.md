# Source notices

Private library vendor/continuum is from ukr8b3g-cmyk/ComfyUI-H3-Continuum v3.10.2, MIT, copyright (c) 2026 ukr8b3g-cmyk. See LICENSE and docs/CORE_PROVENANCE.json. Original function bodies are retained; no original node registration or persistence runtime is loaded.

The new Studio is independently implemented. The Music3 Semantic Studio interaction pattern was consulted, not its audio editor/DSP/VST implementation. No code or assets from other Director projects are bundled. ComfyUI and model weights retain their own licenses; neither is bundled.

Additional storage reuse: the five Continuum 3.10.2 files listed in vendor/continuum/STORAGE_PROVENANCE.json are byte-identical copies. EZ storage_api.py and web/storage_settings.js adapt the upstream storage routes/UI to a separate EZ namespace. storage.py integrates the original buffer and lifetime APIs. stream_video.py is new incremental MP4 output code.
