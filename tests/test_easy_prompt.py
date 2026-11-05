"""Easy input -> multimodal text contract, including browser/server parity."""
import copy
import json
from pathlib import Path
import re
import shutil
import subprocess

import pytest
from h3ezstudio.plan import default_plan, normalize_plan, preview_prompts, common_prompt, PlanError


def make_plan():
    p = default_plan()
    p['assets'] = [dict(id=n, kind='image', label=n+'.png',
                        file=dict(name=n+'.png', subfolder='', type='input'))
                   for n in ('start', 'orange', 'white', 'garden')]
    p['reference_slots'][1] = 'orange'
    p['reference_slots'][4] = 'white'
    p['reference_slots'][8] = 'garden'
    p['global_refs'] = [2, 5]
    p['global_prompt'] = 'オレンジの服の男性と白い服の女性。静かな庭。'
    p['shots'][0]['prompt'] = '女性が「おはよう！」と話し、男性がうなずく。'
    p['shots'] += [{**p['shots'][0], 'id':'shot-2', 'transition':'continue'},
                  {**p['shots'][0], 'id':'shot-3', 'transition':'cut', 'refs':[9]}]
    return p


@pytest.mark.parametrize('source', [None, 'studio', 'external'])
@pytest.mark.parametrize('external', [None, '', 'New external text'])
def test_common_source_survives_save_and_applies_to_all_appending_shots(source, external):
    p=make_plan();p['shots'][1]['prompt']='Second action only'
    p['shots'][2]['prompt_mode']='replace'
    if source is not None:p['prompt_source']=source
    restored=normalize_plan(json.dumps(p,ensure_ascii=False))
    assert restored==p
    chosen=p['global_prompt'] if source=='studio' or external is None else external
    assert common_prompt(restored,external)==chosen
    from h3ezstudio.ez_nodes import H3ContinuumEZTimeline
    result=H3ContinuumEZTimeline().compile(json.dumps(p),external)
    assert result['ui']['h3ez_common']==[chosen]
    assert result['ui']['h3ez_external']==[external]  # switching back must not preview the local text
    prompts=result['ui']['h3ez_prompts'][0]
    if chosen:
        assert chosen in prompts[0]['prompt'] and chosen in prompts[1]['prompt']
    assert 'Second action only' in prompts[1]['prompt'] and 'Second action only' not in prompts[0]['prompt']
    assert p['global_prompt'] not in prompts[2]['prompt']
    assert restored['global_prompt']==p['global_prompt']


@pytest.mark.parametrize('source', ['', 'auto', True, None])
def test_invalid_common_source_is_rejected(source):
    p=default_plan();p['prompt_source']=source
    with pytest.raises(PlanError,match='common prompt source'):normalize_plan(p)


def test_no_tags_needed_and_original_text_is_untouched():
    p = make_plan()
    before = copy.deepcopy(p)
    rows = preview_prompts(normalize_plan(p))
    assert p == before
    assert rows[0]['picture_map'] == {'@R2':'<Picture 1>', '@R5':'<Picture 2>'}
    assert rows[0]['prompt'].startswith('subject_definitions:')
    assert '[reference generation]' in rows[0]['prompt']
    for row in rows:
        assert p['global_prompt']+'\n\n'+p['shots'][0]['prompt'] in row['prompt']
        assert row['prompt'].count(p['shots'][0]['prompt']) == 1
        assert '@R' not in row['prompt']
        assert '<Subject' not in row['prompt']  # no invented per-image person/role
        assert all(label in row['prompt'] for label in row['picture_map'].values())
    assert 'preceding video context' not in rows[0]['prompt']
    assert 'preceding video context' in rows[1]['prompt']
    assert 'preceding video context' not in rows[2]['prompt']
    assert rows[2]['picture_map'] == {'@R9':'<Picture 1>'}
    assert '<Picture 2>' not in rows[2]['prompt']


def test_first_image_offset_and_cut_reset_without_restarting_continuation():
    p = make_plan(); p['first_image'] = 'start'
    rows = preview_prompts(normalize_plan(p))
    assert rows[0]['picture_map'] == {'@R2':'<Picture 2>', '@R5':'<Picture 3>'}
    assert rows[1]['picture_map'] == rows[0]['picture_map']
    assert 'opening frame' in rows[0]['prompt']
    assert 'opening frame' not in rows[1]['prompt']
    assert 'ongoing scene' in rows[1]['prompt']
    assert rows[2]['picture_map'] == {'@R9':'<Picture 1>'}
    assert rows[2]['first_image'] is None


def test_text_only_keyframe_and_explicit_empty_reference_selection():
    p = make_plan(); p['global_refs'] = []
    p['first_image'] = 'start'; p['shots'][2]['refs'] = []
    rows = preview_prompts(normalize_plan(p))
    assert rows[0]['prompt'].startswith('For the target video, at 0.00 seconds')
    assert '0.00 seconds' not in rows[1]['prompt']
    assert rows[2]['prompt'].startswith('integrated_multimodal_description:')
    assert '<Picture' not in rows[2]['prompt']
    assert all(row['picture_map'] == {} for row in rows)


def test_common_replace_external_and_empty_inputs():
    p = make_plan()
    p['shots'][1]['prompt_mode'] = 'replace'
    rows = preview_prompts(normalize_plan(p), 'External scene — 台詞をそのまま。')
    assert 'External scene' in rows[0]['prompt']
    assert p['global_prompt'] not in rows[0]['prompt']
    assert 'External scene' not in rows[1]['prompt']
    assert p['global_prompt'] not in rows[1]['prompt']
    assert '<Picture 2>' in rows[1]['prompt']  # images survive prompt replace
    assert p['global_prompt'].startswith('オレンジ')
    for text in ('', '  \n', '  rain, night\r\n風  ', '<d>[Japanese] そのまま！</d>'):
        p = default_plan(); p['shots'][0]['prompt'] = text
        output = preview_prompts(p)[0]['prompt']
        assert '[Shot 1]\n'+text+'\n\noverall_soundscape:' in output


def test_reference_order_replacement_and_selection_do_not_depend_on_filename():
    p = make_plan(); p['global_refs'] = [5, 2]
    before = preview_prompts(p)
    p['assets'][1]['file']['name'] = 'new_person.png'
    p['assets'][1]['label'] = 'irrelevant_person_999'
    assert preview_prompts(p) == before
    p['shots'][0]['refs'] = [5]
    after = preview_prompts(p)[0]
    assert after['picture_map'] == {'@R5':'<Picture 1>'}
    assert '<Picture 2>' not in after['prompt']


def test_complete_h3_prompt_is_not_wrapped_twice_and_unmentioned_images_are_bound():
    p = make_plan()
    p['shots'] = p['shots'][:1]
    raw = ('subject_definitions:\nThe woman in @R2.\n\nsummary: [reference generation] A conversation.\n\n'
           'retention_analysis: Keep her coat.\n\ndetailed_description: She says "こんばんは！"\n\n'
           'overall_soundscape: Wind.\n\nnon_diegetic_music: N/A')
    p['global_prompt'] = raw; p['shots'][0]['prompt'] = ''
    p['shots'][0]['refs'] = [2]
    assert preview_prompts(p)[0]['prompt'] == raw.replace('@R2', '<Picture 1>')
    p['shots'][0]['refs'] = [2, 5]
    text = preview_prompts(p)[0]['prompt']
    assert '<Picture 2>' in text
    assert 'She says "こんばんは！"' in text
    for field in ('subject_definitions', 'summary', 'detailed_description', 'overall_soundscape'):
        assert text.count(field+':') == 1


def test_browser_preview_equals_server_text_for_all_prompt_paths():
    node = shutil.which('node')
    if node is None:
        pytest.skip('Node.js is required only for cross-language development tests')
    cases = []
    for first in (None, 'start'):
        for refs in ([], [2], [5, 2], [9, 2, 5]):
            for external in (None, '', 'External 日本語\r\n<D>Literal</D>'):
                p = make_plan(); p['first_image'] = first; p['global_refs'] = refs
                p['shots'][1]['prompt_mode'] = 'replace'
                cases.append(dict(plan=p, external=external))
    p = make_plan(); p['shots'][1]['transition'] = 'cut'; p['shots'][1]['first_image'] = 'garden'
    p['global_prompt'] = (' 長文・台詞「おはよう」。 <d>[Japanese] こんにちは！</d>\r\n' * 800)
    cases.append(dict(plan=p, external=None))
    for source in ('studio','external'):
        for external in (None,'','External latest input'):
            p=make_plan();p['prompt_source']=source;p['shots'][1]['prompt_mode']='replace'
            cases.append(dict(plan=p,external=external))
    for first in (None, 'start'):
        p = make_plan(); p['first_image'] = first
        p['global_prompt'] = 'integrated_multimodal_description: Test.\noverall_soundscape: Wind.\nnon_diegetic_music: N/A'
        cases.append(dict(plan=p, external=None))
        p = copy.deepcopy(p)
        p['shots'][2]['refs'] = [2, 9]
        p['global_prompt'] = 'subject_definitions: @R2\nsummary: [reference generation] Test\nretention_analysis: Keep it\ndetailed_description: Test.\noverall_soundscape: Wind\nnon_diegetic_music: N/A'
        cases.append(dict(plan=p, external=None))
    root = Path(__file__).resolve().parents[1]
    script = """import {effective} from './web/state.js';
let input='';for await(const s of process.stdin)input+=s;
console.log(JSON.stringify(JSON.parse(input).map(({plan,external})=>plan.shots.map((_,i)=>effective(plan,i,external)))));"""
    proc = subprocess.run([node, '--input-type=module', '-e', script], input=json.dumps(cases, ensure_ascii=False),
                          text=True, encoding='utf-8', capture_output=True, cwd=root, check=True)
    js = json.loads(proc.stdout)
    for case, rows in zip(cases, js, strict=True):
        expected = preview_prompts(normalize_plan(case['plan']), case['external'])
        assert rows == [dict(text=row['prompt'], map=row['picture_map']) for row in expected]
