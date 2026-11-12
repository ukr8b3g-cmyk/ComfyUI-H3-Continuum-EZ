import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {initial,read,validate,executionPlan,effective,clone,History,insertShot,resizeShot,splitShot} from '../web/state.js';
import {loadProject,saveProject} from '../web/project.js';
import {VISUAL_CONTRACT} from '../web/assist_context.js';
import {sha256,canonical,resolveText,setEnhancer,dependencyPayload,adoptEntry,activateEntry,restoreOriginal,validateEnhancer,validateCandidate} from '../web/enhancer.js';
const fixtures=JSON.parse(fs.readFileSync(new URL('./contracts/assist_parity.json',import.meta.url),'utf8'));
test('timeline and output edits preserve both AI fields through project reload and compilation',()=>{
 let p=initial();p.global_prompt='COMMON';p.shots[0].prompt='SHOT';p.resolution={source:'studio',aspect:'16:9',megapixels:.3};
 insertShot(p);
 p.assets=[
  {id:'ref',kind:'image',label:'Ref',file:{name:'ref.png',type:'input'}},
  {id:'other',kind:'image',label:'Other',file:{name:'other.png',type:'input'}},
  {id:'sound',kind:'audio',label:'Sound',duration:30,file:{name:'sound.wav',type:'input'}},
 ];
 p.reference_slots[0]='ref';p.reference_slots[1]='other';p.global_refs=[1];
 const targets=[{field:'global_prompt'},{field:'prompt',shot_id:p.shots[0].id}];
 for(const target of targets){const dependencies=dependencyPayload(p,target,null,VISUAL_CONTRACT);activateEntry(p,{target,text:`AI_${target.field}`,dependencies,base_text_hash:sha256(dependencies.text),dependency_hash:sha256(canonical(dependencies)),images:[]});}
 const saved=clone(p.prompt_enhancer);
 const changes=[
  ()=>{p.shots[0].seconds=20;},
  ()=>{p=resizeShot(p,p.shots[0].id,'right',9,{disableSnap:true}).plan;},
  ()=>{p.shots[0].label='Renamed';p.assets[0].label='New label';p.shots[0].refs=[1];},
  ()=>{Object.assign(p.shots[1],{seconds:12,prompt:'Different next shot',refs:[2],transition:'cut'});},
  ()=>{p.chunking.seconds=6;p.output_mode='Images';},
  ()=>{p.audio.push({id:'clip',asset_id:'sound',start:0,source_in:1,duration:25,volume:.5});},
  ()=>{Object.assign(p.resolution,{aspect:'9:16',megapixels:.6});},
  ()=>{p.resolution.source='engine';},
 ];
 for(const change of changes){
  change();
  const loaded=loadProject(saveProject(p));
  for(const target of targets)assert.equal(resolveText(loaded,target).status,'enhanced');
  assert.match(effective(loaded,0).text,/AI_global_prompt[\s\S]*AI_prompt/);
  assert.deepEqual(loaded.prompt_enhancer,saved);
 }
 restoreOriginal(p,targets[1]);p.shots[0].seconds=8;assert.equal(resolveText(p,targets[1]).status,'off');
 activateEntry(p,p.prompt_enhancer.texts[1]);assert.equal(resolveText(p,targets[1]).status,'enhanced');
 p.shots[0].prompt='Rewritten original';assert.equal(resolveText(p,targets[1]).status,'stale');
 assert.equal(p.prompt_enhancer.texts[1].text,'AI_prompt');
 p.shots[0].prompt='SHOT';p.shots[0].refs=[2];
 assert.equal(resolveText(p,targets[1]).status,'stale');
 assert.equal(resolveText(p,targets[0]).status,'enhanced');
 assert.deepEqual(loadProject(saveProject(p)).prompt_enhancer,saved);
});
for(const text of ['', 'abc','日本語😀\\"\r\n','長文'.repeat(10000)])test('SHA-256 parity '+text.slice(0,10),()=>assert.equal(sha256(text),crypto.createHash('sha256').update(text).digest('hex')));
for(const f of fixtures)test('Python/JS compile parity '+f.scenario,()=>{
 const p=read(JSON.stringify(f.plan));validate(p);
 assert.deepEqual(dependencyPayload(p,f.target,f.external,f.contract,null,f.output_size),f.dependency);
 assert.deepEqual(resolveText(p,f.target,f.external),{text:f.resolved[0],status:f.resolved[1]});
 assert.deepEqual(executionPlan(p),f.parts);
 assert.deepEqual(f.parts.map(x=>effective(p,x.shot_index,f.external,x.part_index).text),f.prompts);
});
test('old plan stays schema 1 when OFF',()=>{const p=initial(),before=clone(p);setEnhancer(p,false);assert.deepEqual(p,before);});
test('non-destructive OFF ON and Undo',()=>{let p=clone(fixtures.find(x=>x.scenario==='on').plan),h=new History();const before=clone(p);h.record(p);setEnhancer(p,false);assert.equal(resolveText(p,fixtures[2].target).status,'off');p=h.undo(p);assert.deepEqual(p,before);p=h.redo(p);setEnhancer(p,true);assert.deepEqual(p,before);});
test('unadopted ON keeps original',()=>{const p=initial();p.shots[0].prompt='original';setEnhancer(p,true);assert.equal(resolveText(p,{field:'prompt',shot_id:p.shots[0].id}).text,'original');});
test('corrupt candidate and duplicate targets rejected',()=>{const p=clone(fixtures.find(x=>x.scenario==='on').plan);p.prompt_enhancer.texts.push(clone(p.prompt_enhancer.texts[0]));assert.throws(()=>validateEnhancer(p));});
for(const value of ['', '<think>hidden', 'Edit <Picture 1>', '```bad', '{"x":1}'])test('reject candidate '+value,()=>assert.throws(()=>validateCandidate(value)));
test('splitting a shot preserves explicit action times and carries a state',()=>{const p=clone(fixtures.find(x=>x.scenario==='story').plan);const g=executionPlan(p);const next=splitShot(p,p.shots[0].id,10);assert.ok(next.actions.length>0);validate(p);assert.equal(p.shots[0].camera,'follow');});

test('still-image editing commands are rejected, not rewritten',()=>{
  for(const text of ['Edit the image to change the outfit.','Modify this picture to show another background.','Alter the photo by removing a person.'])assert.throws(()=>validateCandidate(text));
});

test('inline adoption activates only its target and restore retains reusable saved text',()=>{
 const p=initial();p.global_prompt='A garden';p.shots[0].prompt='Walking';
 const common={field:'global_prompt'},shot={field:'prompt',shot_id:p.shots[0].id};
 const entry=(target,text)=>{const dependencies=dependencyPayload(p,target);return {target,text,dependencies,base_text_hash:sha256(dependencies.text),dependency_hash:sha256(canonical(dependencies)),images:[]};};
 activateEntry(p,entry(common,'A quiet garden'));setEnhancer(p,false);
 const shotEntry=entry(shot,'Walking slowly');activateEntry(p,shotEntry);
 assert.equal(resolveText(p,common).text,'A garden');assert.equal(resolveText(p,shot).text,'Walking slowly');
 restoreOriginal(p,shot);const saved=read(JSON.stringify(p));validate(saved);
 assert.equal(resolveText(saved,shot).text,'Walking');assert.equal(saved.prompt_enhancer.texts.length,2);
 activateEntry(saved,saved.prompt_enhancer.texts.find(e=>e.target.field==='prompt'));
 assert.equal(resolveText(saved,shot).text,'Walking slowly');assert.equal(resolveText(saved,common).text,'A garden');
 assert.equal(saved.shots[0].prompt,'Walking');
});
