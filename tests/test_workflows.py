from pathlib import Path
import json
from h3ezstudio.ez_nodes import NODE_CLASS_MAPPINGS
from h3ezstudio.plan import normalize_plan
ROOT=Path(__file__).resolve().parents[1]

def assert_links(graph):
    by={n['id']:n for n in graph['nodes']}
    assert len(by)==len(graph['nodes'])
    for link in graph['links']:
        if isinstance(link,dict):
            lid,source,slot,target,tslot,typ=(link[k] for k in ('id','origin_id','origin_slot','target_id','target_slot','type'))
        else:
            lid,source,slot,target,tslot,typ=link
        outgoing=graph['inputs'][slot] if source==-10 else by[source]['outputs'][slot]
        incoming=graph['outputs'][tslot] if target==-20 else by[target]['inputs'][tslot]
        assert lid in outgoing['linkIds' if source==-10 else 'links']
        assert lid in incoming['linkIds'] if target==-20 else incoming['link']==lid
        assert outgoing['type']==typ==incoming['type']

def test_workflow_links_and_node_contracts():
    for path in (ROOT/'examples').glob('*.json'):
        if '.api.' in path.name:continue
        d=json.loads(path.read_text(encoding='utf-8'))
        graphs=[d,*d.get('definitions',{}).get('subgraphs',[])]
        for graph in graphs:assert_links(graph)
        nodes=[n for graph in graphs for n in graph['nodes']]
        assert sum(n['type'] in NODE_CLASS_MAPPINGS for n in nodes)==2
        assert not any('Spectrum' in n['type'] for n in nodes)

def test_ref2va_template_models_and_timeline():
    d=json.loads((ROOT/'examples/H3_EZ_Studio_REF2VA_Template.json').read_text(encoding='utf-8'))
    timeline=next(n for n in d['nodes'] if n['type']=='H3ContinuumEZTimeline')
    saved=timeline['widgets_values_named']['timeline_json']
    assert timeline['widgets_values'][0]==saved
    plan=normalize_plan(saved)
    assert len(plan['shots'])==2 and plan['output_mode']=='Long video'
    assert not plan['assets'] and not plan['audio'] and not plan['global_refs']
    assert all(s['refs'] is None and s['first_image'] is None for s in plan['shots'])
    g,=d['definitions']['subgraphs']
    host=next(n for n in d['nodes'] if n['type']==g['id'])
    note=next(n for n in d['nodes'] if n['type']=='MarkdownNote')['widgets_values'][0]
    by={n['id']:n for n in g['nodes']}
    links={l['id']:l for l in g['links']}
    for index, slot in enumerate(g['inputs'][:5]):
        link_id,=slot['linkIds']
        node=by[links[link_id]['target_id']]
        model,=node['properties']['models']
        name=model['name']
        assert node['widgets_values'][0]==host['widgets_values'][index]==host['widgets_values_named'][slot['name']]==name
        assert model['url'].endswith('/'+model['directory']+'/'+name)
        assert model['url'] in note
        assert all(model['url'] in (ROOT/doc).read_text(encoding='utf-8') for doc in ('README.md','README_EN.md'))

def test_api_workflows_inputs():
    for path in (ROOT/'examples').glob('*.api.json'):
        d=json.loads(path.read_text());timeline=d['7'];normalize_plan(timeline['inputs']['timeline_json'])
        for n in d.values():
            cls=NODE_CLASS_MAPPINGS.get(n['class_type'])
            if not cls:continue
            types=cls.INPUT_TYPES();expected=set(types.get('required',{}))|set(types.get('optional',{}))
            assert set(types.get('required',{}))<=set(n['inputs'])<=expected
        assert d['9']['inputs']['fps']==['8',2]
