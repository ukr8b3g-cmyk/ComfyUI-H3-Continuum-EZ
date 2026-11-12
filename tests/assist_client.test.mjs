import test from 'node:test';import assert from 'node:assert/strict';
import {AssistClient,AssistCancelled} from '../web/assist.js';
import {initial,clone,effective} from '../web/state.js';
import {activateEntry,setEnhancer,canonical,dependencyPayload,sha256} from '../web/enhancer.js';
import {canvasEnhancerModel} from '../web/queue_status.js';
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise};};
function fixture(explicitRequests=false){
 const plan=initial();plan.shots[0].prompt='歩く';let identity={workflow:'w',node:'7'},alive=true;
 const calls=[],events=[],jobs=new Map(),q={queue_running:[],queue_pending:[]};let count=0;
 const mode={prepareGate:null,submitGate:null,submitError:null,http400:false,hold:false,text:'ゆっくり歩く',adoptGate:null,dropAck:false};
 const target={field:'prompt',shot_id:plan.shots[0].id};
 const api={clientId:'test-client',async fetchApi(path,options={}){
  const body=options.body?JSON.parse(options.body):null;calls.push({path,body});
  if(path.endsWith('/capabilities'))return response({models:['test.safetensors'],missing_nodes:[]});
  if(path.endsWith('/prepare')){
   if(mode.prepareGate)await mode.prepareGate.promise;
   const dep=dependencyPayload(body.plan,body.target,body.external_prompt,body.contract,null,body.output_size);
   const output_id='own_output_'+(++count);const receipt={target:body.target,dependencies:dep,images:[],base_text_hash:sha256(dep.text),dependency_hash:sha256(canonical(dep))};
   return response({request_id:'request_'+count,graph:{[output_id]:{class_type:'PreviewAny',inputs:{source:'test'}}},output_id,receipt,cache_key:sha256(canonical({dep,model:body.model}))});
  }
  if(path==='/prompt'){
   if(mode.http400)return response({error:{message:'invalid graph'}},400);
   if(mode.submitError)throw mode.submitError;
   const id='job_'+count,output=Object.keys(body.prompt)[0];jobs.set(id,{output,graph:body.prompt});q.queue_pending.push([1,id,body.prompt,body.extra_data]);
   if(mode.submitGate)await mode.submitGate.promise;
   if(mode.dropAck)throw new Error('lost acknowledgement');
   return response({prompt_id:id});
  }
  if(path==='/queue'&&!body)return response(q);
  if(path==='/queue'&&body){q.queue_pending=q.queue_pending.filter(x=>!body.delete.includes(x[1]));return response({});}
  if(path.startsWith('/history/')){
   const id=decodeURIComponent(path.slice('/history/'.length)),job=jobs.get(id);
   if(mode.hold||!job)return response({});
   q.queue_pending=q.queue_pending.filter(x=>x[1]!==id);
   return response({[id]:{outputs:{[job.output]:{text:[mode.text]}},status:{completed:true}}});
  }
  if(path.startsWith('/history?'))return response({});
  if(path.endsWith('/adopt')){if(mode.adoptGate)await mode.adoptGate.promise;return response({entry:{...body.receipt,text:body.candidate}});}
  if(path.endsWith('/preflight'))return response({ok:true,errors:[],warnings:[]});
  throw new Error('Unexpected request '+path);
 }};
 const client=new AssistClient({api,getState:()=>({plan,identity,alive,external:null}),onStatus:x=>events.push(x),pollMs:1,maxPolls:50,explicitRequests});
 return{plan,target,api,client,calls,events,q,jobs,mode,enable(){setEnhancer(plan,true);client.sync();},off(){setEnhancer(plan,false);client.sync();},setIdentity(x){identity=x;client.sync();},close(){alive=false;client.dispose();},submit:()=>client.generate({target,model:'test.safetensors'})};
}
const spin=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,1));}throw new Error('condition timeout');};

test('external instruction evaluates separately before AI and never changes the video plan',async()=>{
 const f=fixture(true),before=clone(f.plan);f.setIdentity({instructionBinding:{connected:true,signature:'A'}});
 f.client.getInstructionGraph=async()=>({graph:{instruction_result:{class_type:'PreviewAny',inputs:{source:'External instruction'}}},output_id:'instruction_result',request_id:'instruction-test'});
 await f.submit();
 const submissions=f.calls.filter(x=>x.path==='/prompt');assert.equal(submissions.length,2);
 assert.equal(submissions[0].body.extra_data.h3ez_assist.kind,'ai-instruction');
 assert.equal(submissions[1].body.extra_data.h3ez_assist.kind,'prompt-enhancer');
 assert.equal(f.calls.find(x=>x.path.endsWith('/prepare')).body.ai_instruction,f.mode.text);
 assert.deepEqual(f.plan,before);
});

test('external instruction failure or change does not submit the AI model job',async()=>{
 const f=fixture(true);f.setIdentity({instructionBinding:{connected:true,signature:'A'}});
 f.client.getInstructionGraph=async()=>({text:'x'.repeat(8001)});
 await assert.rejects(f.submit(),/8000/);assert.equal(f.calls.length,0);
 const gate=deferred();f.client.getInstructionGraph=async()=>{await gate.promise;return {text:'External instruction'};};
 const pending=f.submit();f.setIdentity({instructionBinding:{connected:true,signature:'B'}});gate.resolve();
 await assert.rejects(pending,AssistCancelled);assert.equal(f.calls.length,0);
});

test('changing the Studio instruction invalidates only in-flight AI work',async()=>{
 const f=fixture(true);f.mode.prepareGate=deferred();const pending=f.submit();
 setEnhancer(f.plan,true);f.plan.prompt_enhancer.instruction='NEW INSTRUCTION';f.client.sync();f.mode.prepareGate.resolve();
 await assert.rejects(pending,AssistCancelled);assert.equal(f.calls.filter(x=>x.path==='/prompt').length,0);
});
test('OFF makes zero requests for inference and capabilities',async()=>{const f=fixture();await assert.rejects(f.submit(),/OFF/);await assert.rejects(f.client.capabilities(),/OFF/);assert.equal(f.calls.length,0);});
test('ON alone starts no work',()=>{const f=fixture();f.enable();assert.equal(f.calls.length,0);});

test('inline generation and receipt validation need no switch or saved-plan mutation',async()=>{
 const f=fixture(true),before=clone(f.plan);await f.client.capabilities();const r=await f.submit();const e=await f.client.adopt(r,'Edited candidate');
 assert.deepEqual(f.plan,before);assert.equal(e.text,'Edited candidate');
 for(const c of f.calls.filter(c=>/\/(prepare|adopt)$/.test(c.path))){assert.equal(c.body.plan.schema,2);assert.equal(c.body.plan.prompt_enhancer.enabled,true);}
 assert.ok(f.events.every(e=>e.target?.shot_id===f.target.shot_id));
});

test('shot requests and saved candidates are independent of the common text',async()=>{
 const f=fixture(true);f.plan.global_prompt='SHARED';
 const r=await f.submit();
 assert.equal(r.receipt.dependencies.common,'');
 f.plan.global_prompt='EDITED SHARED';f.plan.shots[0].prompt_mode='replace';
 activateEntry(f.plan,await f.client.adopt(r));
 assert.ok(effective(f.plan,0).text.includes(r.text));
 assert.ok(!effective(f.plan,0).text.includes('EDITED SHARED'));
 f.plan.shots[0].prompt_mode='append';
 assert.ok(effective(f.plan,0).text.includes('EDITED SHARED\n\n'+r.text));
});

test('inline cancellation rejects a late result and permits a new request',async()=>{
 const f=fixture(true);f.mode.prepareGate=deferred();const a=f.submit(),rejected=assert.rejects(a,AssistCancelled);f.client.invalidate();f.mode.prepareGate.resolve();await rejected;
 f.mode.prepareGate=null;assert.equal((await f.submit()).text,'ゆっくり歩く');assert.equal(f.calls.filter(c=>c.path==='/prompt').length,1);
});

test('regenerate submits again instead of returning the client cache',async()=>{
 const f=fixture(true);await f.submit();await f.client.generate({target:f.target,model:'test.safetensors',refresh:true});assert.equal(f.calls.filter(c=>c.path==='/prompt').length,2);
});
test('wired canvas model overrides the default and disconnected wires block requests',async()=>{
 const f=fixture();f.enable();
 const model={name:'clip_name',value:'custom/p-h3.safetensors',options:{values:['custom\\p-h3.safetensors']}};
 const loader={id:11,type:'CLIPLoader',widgets:[model]};
 const timeline={id:7,type:'H3ContinuumEZTimeline'};
 const engine={id:8,type:'H3ContinuumEZEngine',inputs:[{name:'timeline',link:1},{name:'prompt_clip',link:2}]};
 timeline.graph={_nodes:[timeline,engine,loader],links:{1:[1,7,0,8,0,'H3_EZ_STUDIO_PLAN'],2:[2,11,0,8,1,'CLIP']}};
 const select=()=>f.setIdentity({canvasModel:canvasEnhancerModel(timeline)});
 select();await f.submit();assert.equal(f.calls.find(x=>x.path.endsWith('/prepare')).body.model,'custom\\p-h3.safetensors');
 engine.inputs[1].link=null;select();f.calls.length=0;await assert.rejects(f.submit(),/Load CLIP/);assert.equal(f.calls.length,0);
});
test('candidate is not automatically adopted',async()=>{const f=fixture();f.enable();const original=clone(f.plan);const r=await f.submit();assert.equal(r.text,'ゆっくり歩く');assert.deepEqual(f.plan,original);assert.equal(f.calls.filter(x=>x.path==='/prompt').length,1);});
test('same in-flight request shares one promise',async()=>{const f=fixture();f.enable();f.mode.prepareGate=deferred();const a=f.submit(),b=f.submit();assert.equal(a,b);f.mode.prepareGate.resolve();await a;assert.equal(f.calls.filter(x=>x.path.endsWith('/prepare')).length,1);});
test('OFF during preparation prevents queue submission',async()=>{const f=fixture();f.enable();f.mode.prepareGate=deferred();const a=f.submit(),rejected=assert.rejects(a,AssistCancelled);f.off();f.mode.prepareGate.resolve();await rejected;assert.equal(f.calls.filter(x=>x.path==='/prompt').length,0);});
test('OFF ON does not revive an earlier request',async()=>{const f=fixture();f.enable();f.mode.prepareGate=deferred();const a=f.submit(),rejected=assert.rejects(a,AssistCancelled);f.off();f.enable();f.mode.prepareGate.resolve();await rejected;assert.deepEqual(f.plan.prompt_enhancer.texts,[]);});
test('source change blocks a late candidate',async()=>{const f=fixture();f.enable();f.mode.prepareGate=deferred();const a=f.submit(),rejected=assert.rejects(a,AssistCancelled);f.plan.shots[0].prompt='座る';f.client.sync();f.mode.prepareGate.resolve();await rejected;assert.equal(f.calls.filter(x=>x.path==='/prompt').length,0);});
test('another workflow cannot adopt a ready result',async()=>{const f=fixture();f.enable();const result=await f.submit();f.setIdentity({workflow:'other',node:'7'});await assert.rejects(f.client.adopt(result),AssistCancelled);assert.equal(f.calls.filter(x=>x.path.endsWith('/adopt')).length,0);});
test('adoption validates on the server and retains original',async()=>{const f=fixture();f.enable();const result=await f.submit();const entry=await f.client.adopt(result);assert.equal(entry.text,'ゆっくり歩く');assert.equal(f.plan.shots[0].prompt,'歩く');assert.deepEqual(f.plan.prompt_enhancer.texts,[]);});
test('edit during adoption rejects the returned entry',async()=>{const f=fixture();f.enable();const r=await f.submit();f.mode.adoptGate=deferred();const a=f.client.adopt(r),rejected=assert.rejects(a,AssistCancelled);f.plan.shots[0].prompt='変化';f.mode.adoptGate.resolve();await rejected;});
test('changing Studio size while saving an edit retains the saved AI text',async()=>{
 const f=fixture(true),result=await f.submit(),entry=await f.client.adopt(result);
 activateEntry(f.plan,entry);f.mode.adoptGate=deferred();
 const saving=f.client.editAdopted(entry,'振り返って歩く');
 Object.assign(f.plan.resolution,{aspect:'2:3',megapixels:.5});
 f.mode.adoptGate.resolve();
 const updated=await saving;activateEntry(f.plan,updated);
 assert.match(effective(f.plan,0).text,/振り返って歩く/);
});
test('completed candidate cache avoids another model job',async()=>{const f=fixture();f.enable();await f.submit();const r=await f.submit();assert.equal(r.text,'ゆっくり歩く');assert.equal(f.calls.filter(x=>x.path==='/prompt').length,1);});
test('explicit Core rejection is not mistaken for lost acknowledgement',async()=>{const f=fixture();f.enable();f.mode.http400=true;await assert.rejects(f.submit(),/invalid graph/);assert.equal(f.client.uncertain,null);assert.equal(f.calls.filter(x=>x.path==='/queue').length,0);});
test('lost ack reconciles the exact request without resubmission',async()=>{const f=fixture();f.enable();f.mode.dropAck=true;const r=await f.submit();assert.equal(r.text,'ゆっくり歩く');assert.equal(f.calls.filter(x=>x.path==='/prompt').length,1);});
test('unknown submission blocks blind retry',async()=>{const f=fixture();f.enable();f.mode.submitError=new Error('network');await assert.rejects(f.submit(),/network/);await assert.rejects(f.submit(),/unconfirmed/);assert.equal(f.calls.filter(x=>x.path==='/prompt').length,1);});
test('cancel only removes own pending job after a late acknowledgement',async()=>{
 const f=fixture();f.enable();f.q.queue_pending.push([0,'someone_else',{other:{class_type:'H3ContinuumEZEngine'}}]);f.mode.submitGate=deferred();
 const a=f.submit(),rejected=assert.rejects(a,AssistCancelled);await spin(()=>f.jobs.size===1);f.off();f.mode.submitGate.resolve();await rejected;
 assert.deepEqual(f.q.queue_pending.map(x=>x[1]),['someone_else']);assert.ok(!f.calls.some(x=>x.path.includes('interrupt')));
});
test('empty and thinking output never becomes a candidate',async()=>{for(const text of ['', '<think>internal reasoning']){const f=fixture();f.enable();f.mode.text=text;await assert.rejects(f.submit());assert.equal(f.client.cache.size,0);}});
test('close during work rejects its result',async()=>{const f=fixture();f.enable();f.mode.prepareGate=deferred();const a=f.submit(),rejected=assert.rejects(a,AssistCancelled);f.close();f.mode.prepareGate.resolve();await rejected;});

test('visual context changes cancel a late result; common edits do not cancel a shot',async()=>{
 for(const change of [f=>{f.plan.shots[0].seconds=8;},f=>{f.plan.resolution.aspect='2:3';}]){
  const f=fixture(true);f.mode.prepareGate=deferred();const a=f.submit(),rejected=assert.rejects(a,AssistCancelled);
  change(f);f.client.sync();f.mode.prepareGate.resolve();await rejected;
  assert.equal(f.calls.filter(c=>c.path==='/prompt').length,0);
 }
 const f=fixture(true);f.mode.prepareGate=deferred();const result=f.submit();f.plan.global_prompt='NEW COMMON';f.client.sync();f.mode.prepareGate.resolve();assert.equal((await result).text,'ゆっくり歩く');
});
