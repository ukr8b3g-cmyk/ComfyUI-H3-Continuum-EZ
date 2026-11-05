# EZ Studio: select images and describe the scene

Local update, 2026-11-06; this supplements the frozen initial 2.0.0 specification.

1. Add images and click the reference thumbnails for the selected shot. Drop images into **Shared refs** to use them throughout the timeline.
2. Put the shared characters, setting, atmosphere and style in **Common Prompt**.
3. Describe the action, dialogue, camera or sound for the current interval in **This Shot**.
4. Set seconds and continuation/cut on the timeline, then apply and generate.

You do not need reference numbers, slots, chunk headers, H3 field names or an external text node. Either text field can be left empty.

Common Prompt:
```text
A man in orange and a woman in white talk in a quiet garden. Soft afternoon light, anime style.
```

First shot:
```text
The woman turns to the man and says, “Shall we go?” He nods.
```

Next shot, with **Continue previous shot**:
```text
They start walking side by side along the garden path. The camera follows slowly from behind.
```

Use visible descriptions to distinguish characters. Two selected images can depict two people, one person from different angles, or a person and a background. Studio does not infer subject count or roles from image count or filenames.

The compiler binds selected images in their actual encoder order, accounting for start images and inherited/per-shot selections. Plain text is placed into H3's basic or reference structure automatically. Your original text, language, whitespace and dialogue remain intact. There is no added LLM, image captioning, translation or summarization.

**Effective Prompt** has editable common and shot sections. Common edits apply to every shot using common text; body edits affect only the selected shot. These edit the same saved fields as the individual tabs, not separate overrides. **Inspect generated text** opens the read-only assembled model input. **Shot prompt only** omits the common section and text but keeps selected images.

When external STRING is connected, choose **Studio** or **External text**. Editing common text automatically chooses Studio so the external input cannot silently replace your edits. Switching back keeps your local text saved. External preview shows the last execution's input, or saved text if not yet executed; the actual external text is resolved at execution. Old workflows without a source selection retain external precedence. No external node is needed.

For two shots, put the setting/characters/style in common text, the opening action in Shot 1, and the response or next action in Shot 2. Set continuation and target seconds on the timeline. Start with one speaker per shot for dialogue. Do not paste labels or chunk headings into these fields.

Continuum Core still aligns duration, selects video/audio context and samples one segment per shot. The compiler does not ask a continuing shot to restart at the original opening frame. Shot count, target duration and scene cuts remain timeline choices. The original audio guide/output path is unchanged; the compiler creates no fictitious audio reference labels.

Legacy reference tags remain supported. Inactive tags fail early rather than bind to the wrong image. Complete H3-formatted input is not wrapped twice; bindings for unmentioned selected images are added. For optional bulk import, `examples/Shot_Prompt_Template.txt` contains headings for the existing import dialog only. Direct shot editing needs no headings. Bulk import changes existing shot text, not shot count, durations or media.

Image references require REF2VA/a compatible hybrid model. Character identity, dialogue delivery, interpretation of vague text and performance with this new assembly require real H3 GPU evaluation; CPU/browser tests do not establish them. The 250,000-character input limit is not a model context-length guarantee.

Internal structures follow the [MiniMax base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md) and [reference guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md). This compiler assembles inputs; it does not perform the semantic rewriting described by a full prompt rewriter.
