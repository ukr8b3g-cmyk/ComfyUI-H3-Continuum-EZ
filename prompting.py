"""Deterministic EZ prompt assembly; never captions, translates or rewrites user text.

Keep web/prompting.js in sync. Cross-language fixtures cover the exact TE text.
Continuum owns timing and continuation; a prompt describes one sampling segment.
"""
from __future__ import annotations

import re

BASE_FIELDS = ('integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music')
REF_FIELDS = ('subject_definitions', 'summary', 'retention_analysis', 'detailed_description',
              'overall_soundscape', 'non_diegetic_music')
FIELD_RE = re.compile(r'^[ \t]*(' + '|'.join(dict.fromkeys(BASE_FIELDS + REF_FIELDS)) + r'):', re.M)
FIRST_FRAME = ('For the target video, at 0.00 seconds into the target video, '
               '<Picture 1> (from [Shot 1]) is fully referenced.')


def assemble_prompt(text: str, pictures: list[str], *, has_first: bool, continuing: bool, last_picture=None) -> str:
    # Preserve existing complete H3 sections. Bind selected images that the
    # supplied prompt has not mentioned; never wrap a whole H3 prompt twice.
    fields = set(FIELD_RE.findall(text))
    if all(f in fields for f in BASE_FIELDS) or all(f in fields for f in REF_FIELDS):
        missing = [picture for picture in pictures if picture not in text]
        bindings = []
        if last_picture:
            bindings.append(f'At the end of this segment, converge to the composition in {last_picture}.')
        if missing:
            bindings.append('Additional visual reference sources: ' + ', '.join(missing)
                            + '. Use the relevant content according to the description.')
        if has_first and '<Picture 1>' not in text:
            bindings.append('Use <Picture 1> as the visual reference for the ongoing scene.'
                            if continuing else FIRST_FRAME)
        if not bindings:
            return text
        binding = '\n'.join(bindings) + '\n\n'
        subject_field = re.search(r'^[ \t]*subject_definitions:', text, re.M)
        if subject_field:
            end = subject_field.end()
            return text[:end] + '\n' + binding + text[end:]
        return binding + text

    # Do not derive a subject count or role from image count, file names or order.
    # The multimodal encoder sees the pixels; the user's prose defines the scene.
    source_list = ', '.join(pictures)
    detail = text
    if last_picture:
        detail += f'\n\nAt the end of this segment, converge to the composition in {last_picture}.'
    if continuing:
        detail = 'Continue the scene from the preceding video context.\n\n' + detail
    detail = '[Shot 1]\n' + detail
    sound = 'overall_soundscape: Follow the ambience and sound instructions in the description.'
    music = 'non_diegetic_music: Follow the background music instructions in the description.'

    if not pictures:
        sections = ['integrated_multimodal_description:\n' + detail, sound, music]
        if has_first:
            # On continuation, Core replaces the first keyframe with context.
            # Do not ask the model to return to the original opening frame.
            sections.insert(0, 'Use <Picture 1> as the visual reference for the ongoing scene.'
                            if continuing else FIRST_FRAME)
        return '\n\n'.join(sections)

    definitions = (f'The reference sources are {source_list}. Match the subjects, setting and style '
                   'described below to the relevant visual content in these images. '
                   'The description determines which subjects and reference roles appear.')
    retention = (f'{source_list}: Preserve the relevant visual features according to their roles '
                 'in the description, including any requested changes.')
    task = 'reference generation'
    if last_picture:
        task = 'keyframe completion + reference generation'
        definitions += f'\n{last_picture} is the ending frame of this segment.'
        retention += f'\n{last_picture}: Use its composition as the ending frame.'
    if has_first:
        if continuing:
            definitions += '\n<Picture 1> supplies the visual identity of the ongoing scene.'
            retention += '\n<Picture 1>: Maintain visual identity as the current action continues.'
        else:
            task = 'keyframe completion + reference generation'
            definitions += '\n<Picture 1> is the opening frame of this scene.'
            retention += '\n<Picture 1>: fully_preserved - Use it as the opening frame.'

    return '\n\n'.join([
        'subject_definitions:\n' + definitions,
        f'summary:\n[{task}] Create the described scene using the selected visual references.',
        'retention_analysis:\n' + retention,
        'detailed_description:\n' + detail,
        sound, music,
    ])
