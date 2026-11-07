from pathlib import Path
import json
from h3ezstudio.ez_nodes import NODE_CLASS_MAPPINGS
from h3ezstudio.plan import normalize_plan
ROOT=Path(__file__).resolve().parents[1]

def test_workflow_links_and_node_contracts():
    paths = list((ROOT/'examples').glob('*.json'))
    assert [path.name for path in paths] == ['H3_Continuum_EZ_Studio.json']
    for path in paths:
        if '.api.' in path.name:continue
        d=json.loads(path.read_text(encoding='utf-8'))
        graphs=[d,*d.get('definitions',{}).get('subgraphs',[])]
        nodes=[n for graph in graphs for n in graph['nodes']]
        assert sum(n['type'] in NODE_CLASS_MAPPINGS for n in nodes)==2
        assert not any('Spectrum' in n['type'] for n in nodes)
        for graph in graphs:
            by={n['id']:n for n in graph['nodes']};assert len(by)==len(graph['nodes'])
            for link in graph['links']:
                if isinstance(link,dict):
                    lid,source,slot,target,tslot,typ=(link[k] for k in ('id','origin_id','origin_slot','target_id','target_slot','type'))
                else:lid,source,slot,target,tslot,typ=link
                if source==graph.get('inputNode',{}).get('id'):
                    output=graph['inputs'][slot];assert lid in output['linkIds']
                else:
                    output=by[source]['outputs'][slot];assert lid in output['links']
                if target==graph.get('outputNode',{}).get('id'):
                    inp=graph['outputs'][tslot];assert lid in inp['linkIds']
                else:
                    inp=by[target]['inputs'][tslot];assert inp['link']==lid
                assert output['type'] in (typ,'*') and inp['type'] in (typ,'*')


def test_template_has_portable_model_defaults_and_no_local_media():
    d=json.loads((ROOT/'examples/H3_Continuum_EZ_Studio.json').read_text(encoding='utf-8'))
    timeline=next(n for n in d['nodes'] if n['type']=='H3ContinuumEZTimeline')
    serialized=timeline['widgets_values_named']['timeline_json']
    assert serialized==timeline['widgets_values'][0]
    plan=normalize_plan(serialized)
    assert len(plan['shots'])==2 and not plan['assets'] and not plan['audio']
    assert all(shot['refs'] is None for shot in plan['shots'])
    graph,=d['definitions']['subgraphs']
    host=next(n for n in d['nodes'] if n['type']==graph['id'])
    nodes={n['id']:n for n in graph['nodes']}
    links={l['id']:l for l in graph['links']}
    model_ports={'unet_name','clip_name','clip_name_1','vae_name','vae_name_1'}
    assert model_ports <= {port['name'] for port in graph['inputs']}
    for index,port in enumerate(graph['inputs']):
        if port['name'] not in model_ports:continue
        link_id,=port['linkIds']
        loader=nodes[links[link_id]['target_id']]
        model,=loader['properties']['models']
        assert loader['widgets_values'][0]==host['widgets_values'][index]==host['widgets_values_named'][port['name']]==model['name']
        assert '/' not in model['name'] and chr(92) not in model['name']
