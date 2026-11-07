"""Versioned, side-effect-free editor plan. No generation history or hidden rewriting."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any
from .prompting import assemble_prompt

FPS = 24
DEFAULT_WIDTH = 736
DEFAULT_HEIGHT = 416
MAX_DIMENSION = 16384
MAX_SHOTS = 16
MAX_SHOT_SECONDS = 600
MAX_TIMELINE_SECONDS = 3600
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_TEXT_CHARS = 250_000  # Input-safety limit, NOT a model context-size claim.
DEFAULT_CHUNK_SECONDS = 7.5
REF_RE = re.compile(r"@R([1-9])(?![0-9A-Za-z_])")
UNKNOWN_REF_RE = re.compile(r"@R\d+")

class PlanError(ValueError):
    pass


def validate_dimension(value: int, name: str) -> None:
    if type(value) is not int or not 32 <= value <= MAX_DIMENSION or value % 32:
        raise PlanError(f'{name} must be a multiple of 32 between 32 and {MAX_DIMENSION}. '
                        'Set Resolution Selector multiple to 32.')


def default_plan() -> dict[str, Any]:
    return {"schema": 1, "assets": [], "reference_slots": [None] * 9,
            "global_refs": [], "first_image": None, "global_prompt": "",
            "shots": [{"id": "shot-1", "label": "Shot 1", "seconds": 5.0,
                       "transition": "cut", "prompt": "", "prompt_mode": "append",
                       "refs": None, "first_image": None}], "audio": [],
            "chunking": {"enabled": True, "seconds": DEFAULT_CHUNK_SECONDS}}

ASPECT_RATIOS = ('1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9')
DEFAULT_RESOLUTION = {'source': 'studio', 'aspect': '16:9', 'megapixels': 0.3}


def studio_resolution(value):
    if not isinstance(value, dict) or value.get('source') not in ('studio', 'engine'):
        raise PlanError('Invalid resolution source')
    aspect = value.get('aspect')
    if aspect not in ASPECT_RATIOS:
        raise PlanError('Unsupported aspect ratio')
    mp = value.get('megapixels')
    if isinstance(mp, bool) or not isinstance(mp, (int, float)) or not math.isfinite(mp) or not .01 <= mp <= 16:
        raise PlanError('Megapixels must be between 0.01 and 16')
    a, b = map(int, aspect.split(':'))
    w = max(32, round(math.sqrt(mp * 1e6 * a / b) / 32) * 32)
    h = max(32, round(math.sqrt(mp * 1e6 * b / a) / 32) * 32)
    validate_dimension(w, 'Width'); validate_dimension(h, 'Height')
    return w, h


DEFAULT_JSON = json.dumps({**default_plan(), 'resolution': DEFAULT_RESOLUTION, 'output_mode': 'Long video'}, ensure_ascii=False, separators=(",", ":"))


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str):
        raise PlanError(f"{name}: text is required")
    if len(value) > MAX_TEXT_CHARS:
        raise PlanError(f"{name}: exceeds the {MAX_TEXT_CHARS:,}-character input safety limit")
    return value


def _number(value: Any, name: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PlanError(f"{name}: a number is required")
    n = float(value)
    if not math.isfinite(n) or not lo <= n <= hi:
        raise PlanError(f"{name}: must be within {lo} .. {hi}")
    return n


def _uid(value: Any, name: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,96}", value):
        raise PlanError(f"{name}: invalid ID")
    return value


def validate_file_ref(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or value.get("type", "input") != "input":
        raise PlanError("Only ComfyUI input assets are accepted")
    name, sub = value.get("name"), value.get("subfolder", "")
    if not isinstance(name, str) or not name or name in {".", ".."}:
        raise PlanError("Invalid asset filename")
    if not isinstance(sub, str):
        raise PlanError("Invalid asset subfolder")
    # Both separators must be checked even on Linux (Windows portable workflows).
    if any(x in name for x in ('/', '\\', ':', '\0')):
        raise PlanError("Filename must be a relative basename")
    sub = sub.replace('\\', '/')
    if sub.startswith('/') or ':' in sub or '\0' in sub or '..' in sub.split('/'):
        raise PlanError("Asset path must remain under ComfyUI input")
    return {"name": name, "subfolder": sub.strip('/'), "type": "input"}


def asset_path(asset: dict[str, Any], input_root: str | Path) -> Path:
    ref = validate_file_ref(asset["file"])
    root = Path(input_root).resolve()
    path = (root / ref["subfolder"] / ref["name"]).resolve()
    if not path.is_relative_to(root):
        raise PlanError("Asset resolves outside ComfyUI input")
    if not path.is_file():
        raise PlanError(f"Missing input asset: {ref['subfolder']}/{ref['name']}")
    return path


def normalize_plan(value: str | dict, *, allow_audio_overhang=False) -> dict:
    if isinstance(value, str):
        if len(value.encode('utf-8')) > MAX_JSON_BYTES:
            raise PlanError("Timeline JSON is too large")
        try:
            raw = json.loads(value)
        except (ValueError, TypeError) as exc:
            raise PlanError(f"Invalid timeline JSON: {exc}") from exc
    else:
        raw = copy.deepcopy(value)
    if not isinstance(raw, dict) or type(raw.get('schema')) is not int or raw['schema'] not in (1, 2):
        raise PlanError("Unsupported timeline schema (expected 1 or 2)")
    p = default_plan()
    p['schema'] = raw['schema']
    if 'chunking' in raw:
        chunking = raw['chunking']
        if not isinstance(chunking, dict) or type(chunking.get('enabled')) is not bool:
            raise PlanError('Invalid automatic splitting settings')
        p['chunking'] = {'enabled':chunking['enabled'],
                         'seconds':_number(chunking.get('seconds'), 'Internal part duration', 2, 15)}
    if 'prompt_source' in raw:
        if raw['prompt_source'] not in ('studio', 'external'):
            raise PlanError('Invalid common prompt source')
        p['prompt_source'] = raw['prompt_source']
    if 'output_mode' in raw:
        if raw['output_mode'] not in ('Long video', 'Images'):
            raise PlanError('Invalid Studio output mode')
        p['output_mode'] = raw['output_mode']
    if 'resolution' in raw:
        studio_resolution(raw['resolution'])
        p['resolution'] = {k: raw['resolution'][k] for k in ('source', 'aspect', 'megapixels')}
    p['global_prompt'] = _text(raw.get('global_prompt', ''), 'Common prompt')
    assets = raw.get('assets', [])
    if not isinstance(assets, list) or len(assets) > 128:
        raise PlanError("At most 128 assets are supported")
    seen = set()
    for a in assets:
        if not isinstance(a, dict): raise PlanError("Invalid asset")
        aid = _uid(a.get('id'), 'Asset')
        if aid in seen: raise PlanError(f"Duplicate asset ID: {aid}")
        seen.add(aid)
        if a.get('kind') not in ('image', 'audio'): raise PlanError("Only image/audio assets are supported")
        clean = {'id': aid, 'kind': a['kind'], 'file': validate_file_ref(a.get('file')),
                 'label': _text(a.get('label', a['file'].get('name', '')), 'Asset label')}
        if 'subject_name' in a:
            name = _text(a['subject_name'], 'Subject name')
            if a['kind'] != 'image' or len(name) > 80 or '\n' in name or '\r' in name:
                raise PlanError('Image subject names must be a single line of up to 80 characters')
            clean['subject_name'] = name
        if a['kind'] == 'audio':
            clean['duration'] = _number(a.get('duration'), 'Audio duration', .001, 86400)
        p['assets'].append(clean)
    by_id = {a['id']: a for a in p['assets']}
    def image_id(aid):
        if aid is None: return None
        if aid not in by_id or by_id[aid]['kind'] != 'image': raise PlanError(f"Missing image asset: {aid}")
        return aid
    slots = raw.get('reference_slots', [None] * 9)
    if not isinstance(slots, list) or len(slots) != 9: raise PlanError("Reference registry requires nine slots")
    p['reference_slots'] = [image_id(x) for x in slots]
    occupied = [x for x in slots if x is not None]
    if len(set(occupied)) != len(occupied): raise PlanError("One image cannot occupy two Reference slots")
    def refs(value):
        if not isinstance(value, list) or len(value) > 9: raise PlanError("Reference selection must be a list of up to nine slots")
        if any(type(x) is not int or not 1 <= x <= 9 for x in value): raise PlanError("Reference slots must be integers 1..9")
        if len(set(value)) != len(value): raise PlanError("Duplicate Reference selection")
        if any(slots[x - 1] is None for x in value): raise PlanError("Selected Reference slot has no image")
        return sorted(value)
    p['global_refs'] = refs(raw.get('global_refs', []))
    p['first_image'] = image_id(raw.get('first_image'))
    shots = raw.get('shots')
    if not isinstance(shots, list) or not 1 <= len(shots) <= MAX_SHOTS: raise PlanError("Timeline requires 1–16 shots")
    p['shots'], seen = [], set()
    for i, shot in enumerate(shots):
        if not isinstance(shot, dict): raise PlanError("Invalid shot")
        sid = _uid(shot.get('id'), 'Shot')
        if sid in seen: raise PlanError(f"Duplicate shot ID: {sid}")
        seen.add(sid)
        transition = shot.get('transition', 'continue')
        if transition not in ('continue', 'cut'): raise PlanError("Boundary must be continue or cut")
        if i == 0: transition = 'cut'
        first = image_id(shot.get('first_image'))
        if first and transition == 'continue': raise PlanError(f"Shot {i+1}: a new start image requires a scene cut")
        mode = shot.get('prompt_mode', 'append')
        if mode not in ('append', 'replace'): raise PlanError("Prompt mode must be append or replace")
        p['shots'].append({'id': sid, 'label': _text(shot.get('label', f'Shot {i+1}'), 'Shot label'),
                           'seconds': _number(shot.get('seconds'), f'Shot {i+1} duration', 2, MAX_SHOT_SECONDS),
                           'transition': transition, 'first_image': first,
                           'prompt': _text(shot.get('prompt', ''), f'Shot {i+1} prompt'), 'prompt_mode': mode,
                           'refs': None if shot.get('refs') is None else refs(shot['refs'])})
        clean = p['shots'][-1]
        if 'last_image' in shot: clean['last_image'] = image_id(shot['last_image'])
        if 'dialogue' in shot:
            lines = shot['dialogue']
            if not isinstance(lines, list) or len(lines) > 32: raise PlanError('At most 32 dialogue lines per shot')
            clean['dialogue'] = []
            active = {p['reference_slots'][r-1] for r in effective_references(p, clean)}
            for line in lines:
                if not isinstance(line, dict): raise PlanError('Invalid dialogue line')
                speaker = image_id(line.get('speaker'))
                if speaker is not None and speaker not in active: raise PlanError('A dialogue speaker image must remain selected as a reference')
                words = _text(line.get('text', ''), 'Dialogue')
                if len(words) > 5000: raise PlanError('A dialogue line must be at most 5000 characters')
                at = line.get('at')
                if at is not None: at = _number(at, 'Dialogue time', 0, MAX_SHOT_SECONDS)
                clean['dialogue'].append({'speaker':speaker, 'text':words, 'at':at})
    clips = raw.get('audio', [])
    if not isinstance(clips, list) or len(clips) > 128: raise PlanError("At most 128 audio clips are supported")
    p['audio'], seen = [], set()
    total = sum(x['frames'] for x in shot_geometry(p)) / FPS
    if total > MAX_TIMELINE_SECONDS: raise PlanError('Timeline exceeds the 3600-second limit')
    if not p.get('chunking', {}).get('enabled', True) and any(s['seconds'] > 15 for s in p['shots']):
        raise PlanError('Automatic splitting is off: each shot must be 15 seconds or less. '
                        '自動分割がオフです。各ショットを15秒以下にするか、自動分割をオンにしてください。')
    for shot, g in zip(p['shots'], shot_geometry(p)):
        if any(line['at'] is not None and line['at'] >= g['seconds'] for line in shot.get('dialogue', [])):
            raise PlanError('Dialogue time is outside its shot; move the line before shortening')
    for clip in clips:
        if not isinstance(clip, dict): raise PlanError("Invalid audio clip")
        cid = _uid(clip.get('id'), 'Audio clip')
        if cid in seen: raise PlanError(f"Duplicate audio clip ID: {cid}")
        seen.add(cid)
        aid = clip.get('asset_id')
        if aid not in by_id or by_id[aid]['kind'] != 'audio': raise PlanError("Missing audio asset")
        start = _number(clip.get('start'), 'Audio start', 0, 86400)
        source_in = _number(clip.get('source_in'), 'Audio source in', 0, 86400)
        duration = _number(clip.get('duration'), 'Audio length', .001, 86400)
        if not allow_audio_overhang and start + duration > total + .001: raise PlanError("Audio extends beyond the video; use Match video to audio before generating")
        if start + duration > MAX_TIMELINE_SECONDS: raise PlanError('Audio exceeds the 3600-second timeline limit')
        if source_in + duration > by_id[aid]['duration'] + .01: raise PlanError("Audio trim exceeds the source file")
        clean = {'id': cid, 'asset_id': aid, 'start': start, 'source_in': source_in, 'duration': duration}
        if 'volume' in clip: clean['volume'] = _number(clip['volume'], 'Audio volume', 0, 1)
        p['audio'].append(clean)
    p['audio'].sort(key=lambda c: c['start'])
    for left, right in zip(p['audio'], p['audio'][1:]):
        if left['start'] + left['duration'] > right['start'] + .000001:
            raise PlanError("Audio clips overlap. This version has one non-overlapping audio lane")
    if p['schema'] == 2:
        from .enhancer import normalize_enhancer
        from .story_tools import normalize_story
        try:
            normalize_story(raw, p)
            p['prompt_enhancer'] = normalize_enhancer(raw.get('prompt_enhancer', {}), p)
        except (ValueError, KeyError, TypeError) as exc:
            raise PlanError(str(exc)) from exc
    elif 'prompt_enhancer' in raw or any(any(k in x for k in ('actions','camera','reference_roles')) for x in raw['shots']):
        raise PlanError('Enhanced features require timeline schema 2; no silent downgrade')
    return p


def shot_geometry(plan: dict) -> list[dict]:
    """Same visible frame counts as original Continuum; context 5/22/39 has the same phase."""
    cursor, out = 0, []
    for i, s in enumerate(plan['shots']):
        requested = round(float(s['seconds']) * FPS)
        if i == 0 or s.get('transition') == 'cut':
            frames = requested + (5 - requested) % 17
        else:
            frames = max(17, ((requested + 8) // 17) * 17)
        out.append({'id': s['id'], 'index': i, 'start_frame': cursor, 'frames': frames,
                    'start': cursor / FPS, 'end': (cursor + frames) / FPS,
                    'seconds': frames / FPS, 'requested_seconds': float(s['seconds'])})
        cursor += frames
    return out


def effective_references(plan: dict, shot: dict) -> list[int]:
    return sorted(plan['global_refs'] if shot['refs'] is None else shot['refs'])


def execution_plan(plan: dict) -> list[dict]:
    """Partition aligned logical shots without accumulating rounding errors."""
    out = []
    first = plan['shots'][0]['first_image'] or plan['first_image']
    settings = plan.get('chunking', {'enabled':True, 'seconds':DEFAULT_CHUNK_SECONDS})
    unit_limit = max(3, round(float(settings['seconds']) * FPS / 17))
    for shot, g in zip(plan['shots'], shot_geometry(plan)):
        cut = g['index'] == 0 or shot['transition'] == 'cut'
        if g['index'] and cut: first = shot['first_image']
        phase = 5 if cut else 0
        units = (g['frames'] - phase) // 17
        count = math.ceil(units / unit_limit) if settings['enabled'] else 1
        base, extra = divmod(units, count)
        start = g['start_frame']
        for part in range(count):
            frames = 17 * (base + int(part < extra)) + (phase if part == 0 else 0)
            out.append({'id':f"{shot['id']}-part-{part+1}", 'index':len(out), 'shot_id':shot['id'],
                        'shot_index':g['index'], 'part_index':part, 'part_count':count,
                        'shot_start_frame':g['start_frame'], 'start_frame':start, 'frames':frames,
                        'start':start/FPS, 'end':(start+frames)/FPS, 'seconds':frames/FPS,
                        'transition':'cut' if cut and part == 0 else 'continue',
                        'first_image':first, 'last_image':shot.get('last_image') if part == count-1 else None})
            start += frames
    return out


def dialogue_for_part(plan, shot, part):
    lines = shot.get('dialogue', [])
    geometry = shot_geometry(plan)[part['shot_index']]
    selected = []
    for i, line in enumerate(lines):
        at = line.get('at')
        frame = round(at*FPS) if at is not None else (i*geometry['frames']//max(1,len(lines)))
        frame = min(frame, geometry['frames']-1)
        absolute = geometry['start_frame'] + frame
        if part['start_frame'] <= absolute < part['start_frame'] + part['frames']:
            selected.append({**line, 'offset':(absolute-part['start_frame'])/FPS})
    return selected


def common_prompt(plan: dict, external_prompt: str | None = None) -> str:
    """Old plans retain external precedence; Studio edits explicitly select local text."""
    if plan.get('prompt_source') == 'studio' or external_prompt is None:
        return plan['global_prompt']
    return _text(external_prompt, 'External prompt')


def compile_prompt(plan: dict, shot: dict, *, has_first: bool,
                   external_prompt: str | None = None, has_last=False,
                   continuing=None, dialogue=None, extra_text=None) -> tuple[str, dict[str, str]]:
    from .enhancer import resolve_prompt_text
    common, _ = resolve_prompt_text(plan, {'field': 'global_prompt'}, external_prompt)
    own, _ = resolve_prompt_text(plan, {'field': 'prompt', 'shot_id': shot['id']}, external_prompt)
    raw = own if shot['prompt_mode'] == 'replace' else '\n\n'.join(x for x in (common, own) if x)
    if extra_text: raw += '\n\n' + extra_text
    slots = effective_references(plan, shot)
    mapping = {f'@R{slot}': f'<Picture {pos + 1 + int(has_first) + int(has_last)}>' for pos, slot in enumerate(slots)}
    for token in UNKNOWN_REF_RE.findall(raw):
        if token not in mapping: raise PlanError(f"{shot['label']}: {token} is not active in this shot")
    text = REF_RE.sub(lambda m: mapping[m.group(0)], raw)
    assets = {a['id']:a for a in plan['assets']}
    subjects = {}
    for slot in slots:
        aid = plan['reference_slots'][slot-1]
        picture = mapping[f'@R{slot}']
        name = assets[aid].get('subject_name', '')
        subjects[aid] = json.dumps(name, ensure_ascii=False) if name else f'the subject in {picture}'
        if name: text += f'\n\n{json.dumps(name, ensure_ascii=False)} refers to the subject shown in {picture}.'
    for line in dialogue or []:
        if not line['text']: continue
        speaker = subjects[line['speaker']] if line['speaker'] else 'An off-screen narrator'
        text += f"\n\nAbout {line['offset']:.3f} seconds into the new action, {speaker} says: {json.dumps(line['text'], ensure_ascii=False)}"
    if continuing is None: continuing = shot['id'] != plan['shots'][0]['id'] and shot['transition'] == 'continue'
    last_picture = f'<Picture {1+int(has_first)}>' if has_last else None
    return assemble_prompt(text, list(mapping.values()), has_first=has_first, continuing=continuing, last_picture=last_picture), mapping


def compile_part_prompt(plan, part, external_prompt=None):
    shot = plan['shots'][part['shot_index']]
    from .story_tools import story_text
    extra = story_text(plan, part)
    return compile_prompt(plan, shot, has_first=part['first_image'] is not None,
                          has_last=part['last_image'] is not None, continuing=part['transition']=='continue',
                          external_prompt=external_prompt, dialogue=dialogue_for_part(plan, shot, part), extra_text=extra)


def preview_prompts(plan: dict, external_prompt: str | None = None) -> list[dict]:
    active_first, rows = None, []
    for i, shot in enumerate(plan['shots']):
        if i == 0: active_first = shot['first_image'] or plan['first_image']
        elif shot['transition'] == 'cut': active_first = shot['first_image']
        part = next(x for x in execution_plan(plan) if x['shot_index']==i)
        text, mapping = compile_part_prompt(plan, part, external_prompt)
        rows.append({'id': shot['id'], 'prompt': text, 'picture_map': mapping, 'first_image': active_first})
    return rows


def fingerprint(plan: dict, input_root: Path) -> str:
    h = hashlib.sha256(json.dumps(plan, sort_keys=True, ensure_ascii=False).encode())
    used = used_asset_ids(plan)
    for asset in plan['assets']:
        if asset['id'] not in used: continue
        path = asset_path(asset, input_root)
        with path.open('rb') as f:
            for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def used_asset_ids(plan):
    """One source of truth for inputs needed by actual generation, not the library."""
    used = set()
    for part in execution_plan(plan):
        used.update(x for x in (part['first_image'], part['last_image']) if x)
    for shot in plan['shots']:
        used.update(plan['reference_slots'][r-1] for r in effective_references(plan, shot))
        used.update(d['speaker'] for d in shot.get('dialogue', []) if d.get('speaker'))
    used.update(c['asset_id'] for c in plan['audio'])
    return used
