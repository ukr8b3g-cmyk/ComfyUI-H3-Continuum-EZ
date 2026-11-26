import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {initial} from '../web/state.js';

const listeners=new Map();
const workflow={activeWorkflow:null};
const app={extensionManager:{workflow},registerExtension:extension=>extension.setup()};
const api={apiURL:path=>path,addEventListener:(name,handler)=>listeners.set(name,handler)};
globalThis.h3ezPreviewHost={app,api};
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier==='../../scripts/app.js')return {url:'data:text/javascript,export const app=globalThis.h3ezPreviewHost.app',shortCircuit:true};
  if(specifier==='../../scripts/api.js')return {url:'data:text/javascript,export const api=globalThis.h3ezPreviewHost.api',shortCircuit:true};
  return next(specifier,context);
}});
try{await import('../web/extension.js');}
finally{hooks.deregister();delete globalThis.h3ezPreviewHost;}

const plan=initial();
const nodeId='12:7';
const newTimeline=()=>({type:'H3ContinuumEZTimeline',widgets:[{name:'timeline_json',value:JSON.stringify(plan)}]});
function activate(id,timeline){
  workflow.activeWorkflow={activeState:{id}};
  app.rootGraph={getNodeById:key=>key==='12'?{subgraph:{getNodeById:child=>child==='7'?timeline:null}}:null};
}
function executed(promptId,digit){
  const filename=`EZ_${digit.repeat(32)}.mp4`;
  const record={node_id:nodeId,plan,filename,subfolder:'h3_continuum_ez',type:'output'};
  return listeners.get('executed')({detail:{prompt_id:promptId,output:{h3ez_video:[record]}}});
}
const job=(id,workflow_id)=>({ok:true,json:async()=>({id,workflow_id})});

test('a final video stays with its workflow when another tab has the same Timeline ID',async()=>{
  const a=newTimeline(),b=newTimeline();
  activate('A',a);
  const original={url:'previous-B'};
  b._h3ez_resultVideo=original;
  activate('B',b);
  api.fetchApi=async path=>{
    assert.equal(path,'/jobs/prompt-A');
    return job('prompt-A','A');
  };
  await executed('prompt-A','a');
  assert.equal(b._h3ez_resultVideo,original);

  api.fetchApi=async()=>job('prompt-B','B');
  await executed('prompt-B','b');
  assert.match(b._h3ez_resultVideo.url,/EZ_b{32}\.mp4/);
});

test('a pending job lookup cannot update a Timeline after switching workflows',async()=>{
  const a=newTimeline(),b=newTimeline();
  activate('A',a);
  let resolve;
  api.fetchApi=()=>new Promise(done=>{resolve=done;});
  const pending=executed('prompt-A','a');
  activate('B',b);
  resolve(job('prompt-A','A'));
  await pending;
  assert.equal(a._h3ez_resultVideo,undefined);
  assert.equal(b._h3ez_resultVideo,undefined);
});

test('an older result cannot replace a newer result after slow job verification',async()=>{
  const timeline=newTimeline();
  activate('A',timeline);
  let resolve;
  api.fetchApi=path=>path==='/jobs/old'?new Promise(done=>{resolve=done;}):Promise.resolve(job('new','A'));
  const pending=executed('old','a');
  await executed('new','b');
  resolve(job('old','A'));
  await pending;
  assert.match(timeline._h3ez_resultVideo.url,/EZ_b{32}\.mp4/);
});

test('an unverified final result leaves the active preview untouched',async()=>{
  const timeline=newTimeline();
  activate('A',timeline);
  api.fetchApi=async()=>({ok:false,status:404});
  await executed('missing','a');
  assert.equal(timeline._h3ez_resultVideo,undefined);
});

test('identical Timeline settings do not allow another workflow to start a preview',()=>{
  const timeline=newTimeline();
  activate('B',timeline);
  const detail={event:'start',run_id:'a'.repeat(32),seq:1,node_id:nodeId,plan};
  const progress=listeners.get('h3ez_progress');
  progress({detail:{...detail,workflow_id:'A'}});
  progress({detail});
  assert.equal(timeline._h3ez_progress,undefined);
  progress({detail:{...detail,workflow_id:'B'}});
  assert.equal(timeline._h3ez_progress?.runId,detail.run_id);
});
