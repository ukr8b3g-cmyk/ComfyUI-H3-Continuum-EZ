import test from 'node:test';import assert from 'node:assert/strict';
import {instructionGraph} from '../web/instruction_graph.js';
import {canvasAIInstruction} from '../web/queue_status.js';
import {saveProject,loadProject,newProject} from '../web/project.js';

test('instruction graph includes only STRING ancestors and leaves model/seed graph unchanged',()=>{
 const output={text:{class_type:'PrimitiveStringMultiline',inputs:{value:'Preserve motion.'}},
  combine:{class_type:'StringConcatenate',inputs:{string_a:['text',0],string_b:' Keep voice.'}},
  engine:{class_type:'H3ContinuumEZEngine',inputs:{ai_instruction:['combine',0],seed:123}},
  model:{class_type:'UNETLoader',inputs:{unet_name:'KEEP'}}};
 const before=structuredClone(output),binding={connected:true,engineIds:['engine']};
 const r=instructionGraph(output,binding);
 assert.deepEqual(Object.keys(r.graph).filter(k=>k!==r.output_id).sort(),['combine','text']);
 assert.deepEqual(r.graph[r.output_id].inputs.source,['combine',0]);assert.deepEqual(output,before);
 output.combine.inputs.string_a=['engine',0];assert.throws(()=>instructionGraph(output,binding),/video generation/);
 output.combine.inputs.string_a=['combine',0];assert.throws(()=>instructionGraph(output,binding),/Cyclic/);
});
test('literal and disconnected instructions need no queue; conflicting engines do not pick arbitrarily',()=>{
 assert.equal(instructionGraph({}, {connected:false}),null);
 assert.deepEqual(instructionGraph({e:{inputs:{ai_instruction:'TEXT'}}},{connected:true,engineIds:['e']}),{text:'TEXT'});
 assert.throws(()=>instructionGraph({e:{inputs:{ai_instruction:'A'}},f:{inputs:{ai_instruction:'B'}}},{connected:true,engineIds:['e','f']}));
});
test('subgraph instruction binding follows wires and reflects external text edits',()=>{
 const timeline={id:7,type:'H3ContinuumEZTimeline'},text={id:4,type:'PrimitiveStringMultiline',widgets:[{name:'value',value:'ONE'}]};
 const engine={id:8,type:'H3ContinuumEZEngine',inputs:[{name:'timeline',link:1},{name:'ai_instruction',link:2}]};
 const subgraph={_nodes:[engine],inputs:[{name:'timeline'},{name:'ai_instruction'}],links:{1:[1,-10,0,8,0],2:[2,-10,1,8,1]}};
 const host={id:18,subgraph,inputs:[{name:'timeline',link:3},{name:'ai_instruction',link:4}]};
 const root={_nodes:[timeline,text,host],links:{3:[3,7,0,18,0],4:[4,4,0,18,1]}};
 const binding=canvasAIInstruction(timeline,root);assert.equal(binding.connected,true);assert.deepEqual(binding.engineIds,['18:8']);
 assert.equal(binding.signature.widgets[0][1],'ONE');text.widgets[0].value='TWO';assert.equal(canvasAIInstruction(timeline,root).signature.widgets[0][1],'TWO');
 engine.inputs[1].link=null;assert.deepEqual(canvasAIInstruction(timeline,root),{connected:false});
});
test('project stores local instruction independently of AI enable/selection',()=>{
 const p=newProject();p.schema=2;p.prompt_enhancer={enabled:false,texts:[],instruction:'動画の動作\nKeep dialogue.'};
 assert.deepEqual(loadProject(saveProject(p)),p);
 p.prompt_enhancer.instruction='x'.repeat(8001);assert.throws(()=>saveProject(p));
});
