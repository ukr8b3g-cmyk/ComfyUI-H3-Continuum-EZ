const ROUTE='/h3-continuum-ez/review/';
const PROPERTY='h3ez_review';
const ENGINE='H3ContinuumEZEngine';
const token=()=>crypto.randomUUID().replaceAll('-','');

export function reviewEngine(prompt, timelineIds){
  const matches=Object.entries(prompt).filter(([,node])=>node.class_type===ENGINE&&
    Array.isArray(node.inputs?.timeline)&&timelineIds.includes(String(node.inputs.timeline[0])));
  if(matches.length!==1)throw new Error('reviewEngineMissing');
  return matches[0];
}

export function reviewPreview(api, record, labels){
  if(!record||record.type!=='output'||!/^h3_continuum_ez\/runs\/[a-f0-9]{32}\/previews$/.test(record.subfolder)||
    !/^EZ_[a-f0-9]{32}\.mp4$/.test(record.filename))return null;
  const q=new URLSearchParams({filename:record.filename,subfolder:record.subfolder,type:record.type});
  return {url:api.apiURL('/view?'+q),label:record.boundary==null?labels.part:labels.join(record.boundary)};
}

export function createReview({api,node,workflow,nodeIds,compile,attached,signal,onState}){
  const owns=b=>b?.workflow===workflow&&b?.node===String(node.id);
  const saved=()=>owns(node.properties?.[PROPERTY])?node.properties[PROPERTY]:null;
  let current=null, busy=false, error='', revision=0;
  const show=()=>{if(!signal.aborted)onState({state:current,busy,error,active:!!saved()});};
  const guard=()=>{if(signal.aborted||!attached())throw new Error('reviewWorkflowChanged');};
  async function json(route,options={}){
    const response=await api.fetchApi(route,{signal,...options});
    const value=await response.json();
    if(!response.ok)throw new Error(value.error?.message||value.error||'reviewRequestFailed');
    return value;
  }
  async function refresh(binding=saved()){
    if(!binding)return null;
    const ticket=++revision;
    const {state}=await json(ROUTE+binding.run,{headers:{'X-H3EZ-Binding':binding.binding},cache:'no-store'});
    if(ticket===revision&&saved()===binding&&attached()&&!signal.aborted){current=state;show();}
    return state;
  }
  function replace(){
    guard();
    revision++;
    delete node.properties?.[PROPERTY];
    node.setDirtyCanvas?.(true,true);
    current=null;error='';show();
  }
  async function dispatch(action){
    if(busy||signal.aborted)return;
    const initial=current;
    busy=true;error='';show();
    try{
      guard();
      const {output,workflow:serialized}=await compile();
      const [engineId,engine]=reviewEngine(output,nodeIds());
      if(!(Number.isSafeInteger(engine.inputs.seed)&&engine.inputs.seed>=0)&&
        !(typeof engine.inputs.seed==='string'&&/^[0-9]+$/.test(engine.inputs.seed)))throw new Error('reviewSeedWidget');
      guard();
      let binding=saved();
      if(!binding){
        binding={run:token(),binding:token(),workflow,node:String(node.id)};
        (node.properties??={})[PROPERTY]=binding;
        node.setDirtyCanvas?.(true,true);
      }
      const state=await refresh(binding);
      guard();
      if((state?.revision??0)!==(initial?.revision??0))throw new Error('reviewStateChanged');
      const final=action==='next'&&state?.candidate&&state.accepted+1===state.total||
        action==='resume'&&state?.pending==='export'||action==='save';
      // Serialize the uint64 from one prompt without asking ComfyUI to advance its widget.
      const id=crypto.randomUUID();
      engine.inputs.execution_control=JSON.stringify({
        run:binding.run,binding:binding.binding,command_id:id.replaceAll('-',''),
        action,revision:state?.revision??0,candidate:state?.candidate?.id??null,
      });
      // The command exists only in this execution prompt.
      const request={prompt:output,prompt_id:id,partial_execution_targets:[engineId],
        ...(final?{h3ez_review_export:engineId}:{}),client_id:api.clientId,
        extra_data:{extra_pnginfo:{workflow:serialized}}};
      let effectiveId=id;
      let checks=0;
      const inQueue=async id=>{
        const q=await json('/queue');
        return [...q.queue_running,...q.queue_pending].some(item=>item[1]===id);
      };
      try{
        const answer=await json('/prompt',{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
        effectiveId=answer.prompt_id||id;
      }catch(e){
        if(signal.aborted)throw e;
        const history=await json('/history/'+id);
        if(!history[id]&&!await inQueue(id))throw e;
      }
      while(!signal.aborted){
        guard();
        if(saved()!==binding)return;
        const history=(await json('/history/'+effectiveId))[effectiveId];
        if(history){
          if(history.status?.status_str!=='success'){
            const detail=history.status?.messages?.find(row=>row[0]==='execution_error')?.[1];
            throw new Error(detail?.exception_message||'reviewOperationFailed');
          }
          break;
        }
        if(++checks%5===0&&!await inQueue(effectiveId)&&!(await json('/history/'+effectiveId))[effectiveId]){
          throw new Error('reviewQueueLost');
        }
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      await refresh(binding);
    }catch(e){
      if(!signal.aborted){
        error=e.message;
        await refresh().catch(()=>{});
      }
    }finally{busy=false;show();}
  }
  const start=()=>{show();return refresh().catch(e=>{error=e.message;show();});};
  return {start,dispatch,replace,makePreview:(record,labels)=>reviewPreview(api,record,labels)};
}
