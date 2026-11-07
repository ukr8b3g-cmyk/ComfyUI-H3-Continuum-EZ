import copy,json,subprocess
from pathlib import Path
import pytest
from h3ezstudio.plan import default_plan,normalize_plan,shot_geometry,execution_plan,compile_part_prompt,PlanError
from h3ezstudio.vendor.continuum.temporal import make_extension_shape


def fixture():
    p=default_plan()
    for name in ('first','last','man','woman'):
        p['assets'].append({'id':name,'kind':'image','label':name,'file':{'name':name+'.png','type':'input','subfolder':''}})
    p['reference_slots'][:2]=['man','woman'];p['global_refs']=[1,2]
    p['assets'][2]['subject_name']='男性';p['assets'][3]['subject_name']='女性'
    p['shots'][0].update(seconds=30,last_image='last',dialogue=[{'speaker':'woman','text':'こんにちは！','at':None},{'speaker':'man','text':'こんばんは！','at':22}])
    p['shots'].append({**copy.deepcopy(p['shots'][0]),'id':'shot-2','seconds':5,'transition':'continue','dialogue':[],'last_image':None})
    return p


def test_long_parts_preserve_duration_context_and_last_frame_scope():
    p=fixture();p['chunking']={'enabled':True,'seconds':5};p=normalize_plan(p);parts=execution_plan(p);gs=shot_geometry(p)
    assert sum(x['frames'] for x in parts)==sum(x['frames'] for x in gs)
    assert len(parts)>len(gs)
    for part in parts:
        assert part['frames']<=124
        if part['transition']=='continue':
            for context in (5,22,39):assert make_extension_shape(context,part['seconds']).net_new_frames==part['frames']
    with_last=[x for x in parts if x['last_image']]
    assert len(with_last)==1 and with_last[0]['part_index']==with_last[0]['part_count']-1
    prompts=[compile_part_prompt(p,x)[0] for x in parts]
    assert sum('こんにちは！' in x for x in prompts)==1
    assert sum('こんばんは！' in x for x in prompts)==1
    assert '"女性" refers to the subject shown in <Picture 2>' in prompts[0]
    assert '"女性" refers to the subject shown in <Picture 3>' in prompts[-2]


def test_invalid_speaker_or_dialogue_time_never_silently_changes_text():
    p=fixture();p['shots'][0]['refs']=[1]
    with pytest.raises(PlanError,match='speaker'):normalize_plan(p)
    p=fixture();p['shots'][0]['seconds']=10
    with pytest.raises(PlanError,match='Dialogue time'):normalize_plan(p)
    p=fixture();p['assets'][2]['subject_name']='a'*81
    with pytest.raises(PlanError,match='80'):normalize_plan(p)


def test_python_and_browser_segment_and_prompt_parity():
    cases=[]
    for seconds in (2,5,8,15,15.1,30,60,599.9,600):
        for first in (None,'first'):
            for last in (None,'last'):
                p=fixture();p['first_image']=first;p['shots'][0].update(seconds=seconds,last_image=last)
                p['shots'][0]['dialogue'][1]['at']=None
                cases.append(normalize_plan(p))
    source="""import {executionPlan,effective} from './web/state.js';let s='';for await(const x of process.stdin)s+=x;console.log(JSON.stringify(JSON.parse(s).map(p=>{const parts=executionPlan(p);return {parts,prompts:parts.map(x=>effective(p,x.shot_index,null,x.part_index))};})));"""
    root=Path(__file__).resolve().parents[1]
    proc=subprocess.run(['node','--input-type=module','-e',source],input=json.dumps(cases),text=True,encoding='utf-8',capture_output=True,cwd=root,check=True)
    for p,js in zip(cases,json.loads(proc.stdout)):
        parts=execution_plan(p)
        assert parts==js['parts']
        assert [{'text':t,'map':m} for t,m in (compile_part_prompt(p,x) for x in parts)]==js['prompts']


def test_configurable_internal_parts_preserve_frames_and_native_context():
    cases=[]
    for seconds in (2,5,8,15,15.1,30,60,600):
        for target in (2,3.7,5,8,10,15):
            p=fixture();p['shots'][0]['seconds']=seconds;p['shots'][0]['dialogue']=[]
            p['chunking']={'enabled':True,'seconds':target};p=normalize_plan(p);cases.append(p)
            parts=execution_plan(p)
            assert sum(x['frames'] for x in parts)==sum(x['frames'] for x in shot_geometry(p))
            assert len([x for x in parts if x['last_image']])==1
            if seconds<=target:assert parts[0]['part_count']==1
            for part in parts:
                if part['transition']=='continue':
                    for context in (5,22,39):assert make_extension_shape(context,part['seconds']).net_new_frames==part['frames']
            assert max(x['frames'] for x in parts if x['shot_index']==0)<=17*max(3,round(target*24/17))+5
    source="""import {executionPlan,validate} from './web/state.js';let s='';for await(const x of process.stdin)s+=x;console.log(JSON.stringify(JSON.parse(s).map(p=>executionPlan(validate(p)))));"""
    proc=subprocess.run(['node','--input-type=module','-e',source],input=json.dumps(cases),text=True,encoding='utf-8',capture_output=True,cwd=Path(__file__).resolve().parents[1],check=True)
    assert json.loads(proc.stdout)==[execution_plan(p) for p in cases]


def test_disabled_splitting_rejects_long_shots_before_model_work():
    p=fixture();p['chunking']={'enabled':False,'seconds':8}
    with pytest.raises(PlanError,match='Automatic splitting is off'):normalize_plan(p)
    p['shots'][0].update(seconds=15,dialogue=[])
    p=normalize_plan(p);assert len(execution_plan(p))==2
    for value in (0,1,16,float('inf'),True):
        p['chunking']['seconds']=value
        with pytest.raises(PlanError):normalize_plan(p)
