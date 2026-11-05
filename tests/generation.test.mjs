import test from 'node:test';import assert from 'node:assert/strict';
import {initial,insertShot,geometry,duration,resizeShot,executionPlan,validate,registerReference,removeAsset,splitShot,clone} from '../web/state.js';
import {mergeProgress,thumbnail} from '../web/generation.js';
const api={apiURL:x=>x},run='a'.repeat(32);
test('right edge ripples, left edge rolls and snaps on the native grid',()=>{
  const p=initial();insertShot(p);insertShot(p);const gs=geometry(p),before=JSON.stringify(p);
  const right=resizeShot(p,p.shots[0].id,'right',7,{disableSnap:true}).plan;
  assert.equal(geometry(right)[1].frames,gs[1].frames);assert.ok(duration(right)>duration(p));
  const left=resizeShot(p,p.shots[1].id,'left',7,{disableSnap:true}).plan;
  assert.equal(duration(left),duration(p));assert.equal(geometry(left)[2].start,gs[2].start);
  const target=gs[0].end+17/24;
  const snap=resizeShot(p,p.shots[0].id,'right',target+.04,{snapTimes:[target],scale:100});
  assert.ok(snap.snapped);assert.equal(snap.at,target);assert.equal(JSON.stringify(p),before);
  assert.equal(resizeShot(p,p.shots[0].id,'right',target+.04,{snapTimes:[target],scale:100,disableSnap:true}).snapped,false);
});
test('resize preserves exact combined frames at extremes for cut and continued neighbors',()=>{
  for(const a of [2,5,8,15,30,599.9,600])for(const b of [2,5,15,30,600])for(const transition of ['cut','continue']){
    const p=initial();p.shots[0].seconds=a;insertShot(p).seconds=b;p.shots[1].transition=transition;
    for(const at of [0,2,3,8,300,600,1200]){
      const next=resizeShot(p,p.shots[1].id,'left',at,{disableSnap:true}).plan;
      validate(next);assert.equal(duration(next),duration(p));
    }
  }
});
test('resize rejects invalid audio and dialogue offsets without changing the input',()=>{
  const p=initial();p.shots[0].seconds=10;p.shots[0].dialogue=[{speaker:null,text:'stay',at:8}];const before=clone(p);
  assert.throws(()=>resizeShot(p,p.shots[0].id,'right',3),{key:'dialoguePastEnd'});assert.deepEqual(p,before);
  delete p.shots[0].dialogue;p.assets.push({id:'a',kind:'audio',duration:10,file:{name:'a.wav',type:'input'}});p.audio.push({id:'c',asset_id:'a',start:0,source_in:0,duration:9});
  assert.throws(()=>resizeShot(p,p.shots[0].id,'right',3),{key:'audioPastEnd'});
});
test('speaker dependencies and ending images survive editing and split',()=>{
  const p=initial();p.shots[0].seconds=10;p.assets.push({id:'a',kind:'image',subject_name:'女性',file:{name:'a.png',type:'input'}});p.global_refs=[registerReference(p,'a')];p.shots[0].dialogue=[{speaker:'a',text:'一',at:1},{speaker:'a',text:'二',at:8}];p.shots[0].last_image='a';
  assert.throws(()=>removeAsset(p,'a'),{key:'speakerReferenceRequired'});
  const total=duration(p),right=splitShot(p,p.shots[0].id,5);assert.equal(right.last_image,'a');assert.equal(p.shots[0].last_image,null);assert.equal(right.dialogue[0].at,8-geometry(p)[0].seconds);assert.equal(duration(p),total);validate(p);
});
test('progress rejects stale or cross-run events and exposes only final proxy files',()=>{
  const p=initial(),part=executionPlan(p)[0];let state=mergeProgress(api,null,{event:'start',run_id:run,seq:1,plan:p});
  assert.equal(state.states[part.shot_id].phase,'queued');
  assert.equal(mergeProgress(api,state,{event:'sampling',run_id:'b'.repeat(32),seq:2}),state);
  state=mergeProgress(api,state,{event:'sampling',run_id:run,seq:2,shot_id:part.shot_id,part_index:0});
  assert.equal(state.states[part.shot_id].phase,'sampling');
  assert.equal(mergeProgress(api,state,{event:'failed',run_id:run,seq:1}),state);
  state=mergeProgress(api,state,{event:'part_complete',run_id:run,seq:3,shot_id:part.shot_id,part_index:0,clip:{filename:'EZ_'+run+'.partial.mp4',subfolder:'h3_continuum_ez_previews/'+run,type:'temp',start:part.start,end:part.end}});
  assert.equal(state.clips.length,0);assert.equal(state.states[part.shot_id].phase,'complete');
  state=mergeProgress(api,state,{event:'finished',run_id:run,seq:4});assert.equal(mergeProgress(api,state,{event:'failed',run_id:run,seq:5}),state);
  assert.equal(thumbnail(api,{filename:'../../x.jpg',type:'output',subfolder:'h3_continuum_ez',shot_id:'s',time:0}),null);
});
test('finished without matching part completion never marks unexecuted shots complete',()=>{
  const p=initial();insertShot(p);let state=mergeProgress(api,null,{event:'start',run_id:run,seq:1,plan:p});
  state=mergeProgress(api,state,{event:'finished',run_id:run,seq:2});
  assert.ok(Object.values(state.states).every(x=>x.phase==='unknown'));
});
