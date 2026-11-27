import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
import {createReview,reviewEngine,reviewPreview} from '../web/review.js';

globalThis.crypto??=webcrypto;
const prompt=()=>({
  '3':{class_type:'H3ContinuumEZTimeline',inputs:{}},
  '5:8':{class_type:'H3ContinuumEZEngine',inputs:{timeline:['3',0],seed:'18446744073709551614'}},
  '9':{class_type:'SaveVideo',inputs:{video:['5:8',4]}},
});
const candidate={id:'c'.repeat(32),record:{shot:1,part_index:1,part_count:2}};
const response=value=>({ok:true,json:async()=>value});

function fixture(options={}){
  const node={id:3,properties:{}},signal=new AbortController().signal,calls=[],states=[];
  let serverState=null;
  const set=value=>{serverState=value;};
  const api={
    clientId:'test',
    apiURL:route=>route,
    async fetchApi(route,options={}){
      if(route.startsWith('/h3-continuum-ez/review/')){
        assert.equal(options.headers['X-H3EZ-Binding'],node.properties.h3ez_review.binding);
        return response({state:serverState});
      }
      if(route==='/prompt'){
        const request=JSON.parse(options.body);
        calls.push(request);
        serverState={revision:(serverState?.revision??0)+1,total:2,accepted:1,candidate};
        return response({prompt_id:request.prompt_id});
      }
      const id=route.split('/').at(-1);
      return response({[id]:{status:{status_str:'success'}}});
    },
  };
  const review=createReview({api,node,signal,workflow:'my-workflow',attached:()=>true,
    nodeIds:()=>['3'],compile:async()=>({output:prompt(),workflow:{}}),
    onState:state=>states.push(state),...options});
  return {review,node,calls,states,set,api};
}

test('only the compiled linked Engine is used and final export keeps the seed exact',async()=>{
  const {review,node,calls,states}=fixture();
  await review.start();
  await review.dispatch('next');
  assert.deepEqual(calls[0].partial_execution_targets,['5:8']);
  assert.equal(calls[0].h3ez_review_export,undefined);
  const first=JSON.parse(calls[0].prompt['5:8'].inputs.execution_control);
  assert.equal(first.revision,0);
  assert.equal(first.candidate,null);
  assert.equal(calls[0].prompt['5:8'].inputs.seed,'18446744073709551614');
  assert.equal(states.at(-1).state.candidate.id,candidate.id);
  assert.deepEqual(Object.keys(node.properties.h3ez_review).sort(),['binding','node','run','workflow']);
  await review.dispatch('next');
  assert.equal(calls[1].h3ez_review_export,'5:8');
  assert.equal(JSON.parse(calls[1].prompt['5:8'].inputs.execution_control).candidate,candidate.id);
});

test('a failed downstream save leaves the completed review available for saving again',async()=>{
  const {review,calls,states,set,api}=fixture();
  await review.dispatch('next');
  const original=api.fetchApi.bind(api);
  let attempt=0;
  api.fetchApi=async(route,options)=>{
    if(route==='/prompt'){
      const answer=await original(route,options);
      set({revision:2+attempt,total:2,accepted:2,pending:null,complete:true,can_save:true});
      attempt++;
      return answer;
    }
    if(route.startsWith('/history/')&&attempt===1){
      return response({[route.split('/').at(-1)]:{status:{status_str:'error',
        messages:[['execution_error',{exception_message:'SaveVideo failed'}]]}}});
    }
    return original(route,options);
  };
  await review.dispatch('next');
  assert.equal(states.at(-1).error,'SaveVideo failed');
  assert.equal(states.at(-1).state.can_save,true);
  await review.dispatch('save');
  assert.equal(states.at(-1).error,'');
  assert.equal(calls[2].h3ez_review_export,'5:8');
  const control=JSON.parse(calls[2].prompt['5:8'].inputs.execution_control);
  assert.equal(control.action,'save');
  assert.equal(control.revision,2);
  assert.equal(control.candidate,null);
});

test('a refresh cannot silently adopt a different candidate',async()=>{
  const {review,calls,states,set}=fixture();
  await review.dispatch('next');
  set({revision:9,total:2,accepted:1,candidate:{...candidate,id:'d'.repeat(32)}});
  await review.dispatch('next');
  assert.equal(calls.length,1);
  assert.equal(states.at(-1).error,'reviewStateChanged');
});

test('review does not follow unrelated, ambiguous or copied node bindings',async()=>{
  assert.throws(()=>reviewEngine(prompt(),['9']),/reviewEngineMissing/);
  const graph=prompt();
  graph.extra=graph['5:8'];
  assert.throws(()=>reviewEngine(graph,['3']),/reviewEngineMissing/);
  const original=fixture();
  await original.review.dispatch('next');
  const copy=fixture({node:{id:4,properties:original.node.properties}});
  await copy.review.start();
  assert.equal(copy.states.at(-1).active,false);
});

test('only generated review videos become preview sources',()=>{
  const api={apiURL:value=>value};
  const item={type:'output',subfolder:'h3_continuum_ez/runs/'+'a'.repeat(32)+'/previews',
    filename:'EZ_'+'b'.repeat(32)+'.mp4',boundary:2};
  assert.equal(reviewPreview(api,item,{join:seconds=>seconds+' s'}).label,'2 s');
  assert.equal(reviewPreview(api,{...item,filename:'../../file.mp4'},{}),null);
});
