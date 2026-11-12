import {read,validate,executionPlan,clone} from './state.js';

export function thumbnail(api,item){
  if(item?.type!=='output'||item.subfolder!=='h3_continuum_ez'||!/^EZ_[0-9a-f]{32}_s\d+_f\d+\.jpg$/.test(item.filename)||!Number.isFinite(item.time)||item.time<0||typeof item.shot_id!=='string')return null;
  return {...item,url:api.apiURL('/view?'+new URLSearchParams({filename:item.filename,subfolder:item.subfolder,type:item.type}))};
}
export function mergeProgress(api,current,event){
  if(!event||!/^[0-9a-f]{32}$/.test(event.run_id)||!Number.isSafeInteger(event.seq)||event.seq<1)return current;
  if(event.event==='start'){
    let p;try{p=validate(read(event.plan));}catch{return current;}
    if(current?.runId===event.run_id)return current;
    const parts=executionPlan(p);
    return {runId:event.run_id,seq:event.seq,plan:clone(event.plan),parts,clips:[],thumbnails:[],states:Object.fromEntries(p.shots.map(s=>[s.id,{phase:'queued',done:[],total:parts.filter(x=>x.shot_id===s.id).length}]))};
  }
  if(!current||current.runId!==event.run_id||event.seq<=current.seq||current.ended)return current;
  const next={...current,seq:event.seq,states:{...current.states}};
  if(event.preview_warning)next.warning=String(event.preview_warning);
  if(['failed','interrupted','finished'].includes(event.event)){
    next.ended=event.event;
    for(const [id,state] of Object.entries(next.states))if(state.phase!=='complete')next.states[id]={...state,phase:event.event==='finished'?(state.done.length===state.total?'complete':'unknown'):event.event};
    return next;
  }
  const part=current.parts.find(p=>p.shot_id===event.shot_id&&p.part_index===event.part_index),state=current.states[event.shot_id];
  if(!part||!state||!['preparing','sampling','decoding','part_complete'].includes(event.event))return current;
  const done=[...new Set([...state.done,...(event.event==='part_complete'?[part.part_index]:[])])];
  next.activePart=event.event==='part_complete'?null:{shotId:part.shot_id,index:part.part_index,phase:event.event};
  next.states[event.shot_id]={...state,done,phase:done.length===state.total?'complete':event.event==='part_complete'?'preparing':event.event};
  if(event.event==='part_complete'){
    const c=event.clip;
    if(c?.type==='temp'&&c.subfolder===`h3_continuum_ez_previews/${current.runId}`&&/^EZ_[0-9a-f]{32}\.mp4$/.test(c.filename)&&c.start===part.start&&c.end===part.end){
      const url=api.apiURL('/view?'+new URLSearchParams({filename:c.filename,subfolder:c.subfolder,type:c.type}));
      next.clips=[...current.clips.filter(x=>x.start!==c.start),{...c,url}].sort((a,b)=>a.start-b.start);
    }
    const added=(Array.isArray(event.thumbnails)?event.thumbnails:[]).map(x=>thumbnail(api,x)).filter(x=>x&&x.shot_id===part.shot_id&&x.time>=part.start&&x.time<part.end);
    next.thumbnails=[...current.thumbnails,...added.filter(x=>!current.thumbnails.some(y=>y.filename===x.filename))];
  }
  return next;
}
