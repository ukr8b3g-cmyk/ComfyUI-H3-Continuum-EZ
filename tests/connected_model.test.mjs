import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {canvasEnhancerBinding,canvasEnhancerModel} from '../web/queue_status.js';
import {mediaLabel} from '../web/media_labels.js';
import {referenceCounts} from '../web/node_summary.js';
export function fixture(){
 const d=JSON.parse(fs.readFileSync(new URL('../examples/H3_Continuum_EZ_Studio_FastH3_OmniRef.json',import.meta.url),'utf8'));
 const build=data=>{const graph={_nodes:data.nodes,links:new Map(data.links.map(l=>Array.isArray(l)?[l[0],l]:[l.id,l])),inputNode:data.inputNode,inputs:data.inputs,outputs:data.outputs};
  for(const n of graph._nodes){n.graph=graph;n.widgets=Object.entries(n.widgets_values_named||{}).map(([name,value])=>({name,value}));const sub=d.definitions?.subgraphs.find(s=>s.id===n.type);if(sub)n.subgraph=build(sub);}return graph;};
 const root=build(d),timeline=root._nodes.find(n=>n.type==='H3ContinuumEZTimeline'),host=root._nodes.find(n=>n.subgraph),engine=host.subgraph._nodes.find(n=>n.type==='H3ContinuumEZEngine'),loader=host.subgraph._nodes.find(n=>n.outputs?.some(o=>o.links?.some(id=>host.subgraph.links.get(id)?.target_slot===engine.inputs.findIndex(i=>i.name==='prompt_clip'))));
 return {root,timeline,host,engine,loader};
}
test('model follows the real subgraph connection without tags or position assumptions',()=>{
 const f=fixture(),first=canvasEnhancerBinding(f.timeline,f.root);assert.equal(first.model,'p-h3-image_prompt_upsampler_w4a8.safetensors');
 f.loader.pos=[99999,-99999];f.loader.properties={};f.host.subgraph._nodes.reverse();assert.deepEqual(canvasEnhancerBinding(f.timeline,f.root),first);
 f.host.widgets.find(w=>w.name==='clip_name_1').value='another/model.safetensors';assert.equal(canvasEnhancerModel(f.timeline,f.root),'another/model.safetensors');
});
test('disconnected, bypassed, non-minimax and conflicting sources fail closed',()=>{
 const f=fixture(),input=f.engine.inputs.find(i=>i.name==='prompt_clip'),id=input.link;input.link=null;assert.equal(canvasEnhancerModel(f.timeline,f.root),'');input.link=id;
 f.loader.mode=4;assert.equal(canvasEnhancerModel(f.timeline,f.root),'');f.loader.mode=0;
 f.loader.widgets.find(w=>w.name==='type').value='stable_diffusion';assert.equal(canvasEnhancerModel(f.timeline,f.root),'');
});
test('unconnected marked loader is ignored; connected model device is preserved',()=>{
 const f=fixture();f.host.subgraph._nodes.push({id:999,type:'CLIPLoader',properties:{h3ez_enhancer_loader:true},widgets:[{name:'clip_name',value:'WRONG.safetensors'}]});
 f.loader.widgets.find(w=>w.name==='device').value='cpu';const binding=canvasEnhancerBinding(f.timeline,f.root);assert.equal(binding.device,'cpu');assert.equal(binding.node,'18:25');
});
test('a promoted model uses the outer widget without requiring any rewiring',()=>{
 const {root,timeline,host,loader}=fixture();
 loader.widgets.find(w=>w.name==='clip_name').value='inner/stale.safetensors';
 const promoted=host.widgets.find(w=>w.name==='clip_name_1');
 promoted.value='outer/selected.safetensors';
 assert.equal(canvasEnhancerModel(timeline,root),promoted.value);
 promoted.value='outer/changed.safetensors';
 assert.equal(canvasEnhancerModel(timeline,root),promoted.value);
 host.inputs.push({name:promoted.name,link:992});
 assert.equal(canvasEnhancerModel(timeline,root),'');
});
test('multiple reference buttons use short distinct names, preserving user names',()=>{
 const plan={assets:Array.from({length:9},(_,i)=>({id:String(i),kind:'image',label:'long filename '+i+'.png'}))};
 assert.equal(mediaLabel(plan,plan.assets[0],'ja'),'画像1');assert.equal(mediaLabel(plan,plan.assets[8],'en'),'Image 9');
 plan.assets[1].subject_name='女性';assert.equal(mediaLabel(plan,plan.assets[1],'ja'),'女性');
});
test('node summary counts unique individual and shared references separately',()=>{
 const p={assets:[{id:'a',kind:'image'},{id:'b',kind:'image'}],reference_slots:['a','b'],global_refs:[],shots:[{refs:[1,2]},{refs:[1,2]}]};
 assert.deepEqual(referenceCounts(p),{individual:2,shared:0});
 p.global_refs=[1];p.shots[1].refs=null;assert.deepEqual(referenceCounts(p),{individual:2,shared:1});
 p.shots.forEach(s=>s.refs=null);assert.deepEqual(referenceCounts(p),{individual:0,shared:1});
});
