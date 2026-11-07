import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineQueue,canonicalModelChoice,normalizeModelChoices,graphNodes} from '../web/queue_status.js';

const plan='{"schema":1}',id='18:7';
const item=(job,workflow='workflow-1',output=true)=>[0,job,{
  [id]:{class_type:'H3ContinuumEZTimeline',inputs:{timeline_json:plan}},
  '18:8':{class_type:'H3ContinuumEZEngine',inputs:{timeline:[id,0]}},
  save:{class_type:'SaveVideo',inputs:{video:['18:8',4]}}
},{extra_pnginfo:{workflow:{id:workflow}}},output?['save']:[]];

test('queue belongs to the output-connected Timeline and correct workflow',()=>{
  const data={queue_running:[item('other','another')],queue_pending:[item('unrelated','another'),item('ours'),item('unused','workflow-1',false)]};
  const v=timelineQueue(data,[id],'workflow-1',plan);
  assert.equal(v.phase,'waiting');assert.equal(v.position,2);assert.equal(v.pending,1);assert.equal(v.jobs[0].id,'ours');
  data.queue_running.push(item('active'));
  assert.equal(timelineQueue(data,[id],'workflow-1',plan).phase,'running');
  assert.equal(timelineQueue({},[id],'workflow-1',plan).phase,'idle');
});
test('legacy queue needs the matching committed plan; a nested graph uses execution IDs',()=>{
  const data={queue_pending:[item('old',undefined)]};delete data.queue_pending[0][3].extra_pnginfo.workflow.id;
  assert.equal(timelineQueue(data,[id],null,'different').pending,0);
  assert.equal(timelineQueue(data,[id],null,plan).pending,1);
  const child={id:7},subgraph={_nodes:[child]},root={_nodes:[{id:18,subgraph}]};
  assert.equal(graphNodes(root).find(x=>x.node===child).id,id);
});
test('only an unambiguous existing model filename is normalized, never another model',()=>{
  const good='minimax\\DasiwaMinimaxH3_dasiwaHybridV4_int8.safetensors',unix=good.replaceAll('\\','/');
  assert.equal(canonicalModelChoice(unix,[good]),good);
  assert.equal(canonicalModelChoice('missing.safetensors',[good]),'missing.safetensors');
  assert.equal(canonicalModelChoice('randomize',['fixed']),'randomize');
  assert.equal(canonicalModelChoice('a\\b/c.safetensors',['a/b/c.safetensors','a\\b\\c.safetensors']),'a\\b/c.safetensors');
  const w={value:unix,options:{values:()=>[good]}},loader={id:1,widgets:[w]};
  const root={_nodes:[{id:18,subgraph:{_nodes:[loader,{id:8,type:'H3ContinuumEZEngine'}]}}]};
  assert.equal(normalizeModelChoices(root),1);assert.equal(w.value,good);
  assert.equal(normalizeModelChoices(root),0);w.value=unix;
  assert.equal(normalizeModelChoices({_nodes:[loader]}),0);assert.equal(w.value,unix);
});
import {canvasGenerationSize} from '../web/queue_status.js';

test('AI size follows Engine literals and the standard Resolution Selector through wires',()=>{
 const timeline={id:7,type:'H3ContinuumEZTimeline'},engine={id:8,type:'H3ContinuumEZEngine',inputs:[{name:'timeline',link:1}],widgets:[{name:'width',value:736},{name:'height',value:416}]};
 const graph={_nodes:[timeline,engine],links:{1:[1,7,0,8,0,'H3_EZ_STUDIO_PLAN']}};timeline.graph=graph;
 assert.deepEqual(canvasGenerationSize(timeline),{width:736,height:416});
 const size={id:9,type:'ResolutionSelector',widgets:[{name:'aspect_ratio',value:'2:3 (Portrait Photo)'},{name:'megapixels',value:.5},{name:'multiple',value:32}]};graph._nodes.push(size);
 engine.inputs.push({name:'width',link:2},{name:'height',link:3});graph.links[2]=[2,9,0,8,1,'INT'];graph.links[3]=[3,9,1,8,2,'INT'];
 assert.deepEqual(canvasGenerationSize(timeline),{width:576,height:896});
 size.type='UnknownDynamicNode';assert.equal(canvasGenerationSize(timeline),null);
});
