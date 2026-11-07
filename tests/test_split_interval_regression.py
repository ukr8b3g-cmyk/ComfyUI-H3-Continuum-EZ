import json
from h3ezstudio.plan import default_plan, normalize_plan, execution_plan, shot_geometry


def test_fifteen_second_shot_uses_default_two_parts_without_changing_input():
    plan=default_plan();plan['shots'][0]['seconds']=15
    plan['shots'][0]['dialogue']=[{'speaker':None,'text':'first line','at':1},{'speaker':None,'text':'second line','at':9}]
    plan=normalize_plan(json.dumps(plan))
    assert plan['chunking']=={'enabled':True,'seconds':7.5}
    parts=execution_plan(plan)
    assert len(parts)==2
    assert parts[0]['transition']=='cut' and parts[1]['transition']=='continue'
    assert parts[0]['end']==parts[1]['start']
    assert sum(x['frames']for x in parts)==shot_geometry(plan)[0]['frames']==362
    assert normalize_plan(json.dumps(plan))['chunking']['seconds']==7.5


def test_explicit_interval_applies_below_fifteen_seconds_and_off_stays_single():
    plan=default_plan();plan['shots'][0]['seconds']=10;plan['chunking']['seconds']=5
    assert len(execution_plan(normalize_plan(plan)))==2
    plan['chunking']['enabled']=False
    assert len(execution_plan(normalize_plan(plan)))==1
