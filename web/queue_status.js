// Match this Timeline's server queue entries, including subgraph execution IDs.
export function timelineQueue(data, ids, workflowId, plan) {
  const jobs=[];
  for (const [key, phase] of [['queue_running','running'],['queue_pending','waiting']]) {
    for (const [index, item] of (data?.[key] || []).entries()) {
      const prompt=item?.[2], workflow=item?.[3]?.extra_pnginfo?.workflow;
      if (!prompt || (workflowId && workflow?.id && workflow.id!==workflowId)) continue;
      const found=ids.some(id=>{
        const node=prompt[id];
        if(node?.class_type!=='H3ContinuumEZTimeline')return false;
        if(!workflow?.id && node.inputs?.timeline_json!==plan)return false;
        // Only output-connected nodes belong to the queued execution.
        const seen=new Set(), visit=key=>{
          if(String(key)===String(id))return true;
          if(seen.has(String(key)))return false;seen.add(String(key));
          return Object.values(prompt[key]?.inputs||{}).some(v=>Array.isArray(v)&&v.length===2&&visit(v[0]));
        };
        return Array.isArray(item[4])&&item[4].some(visit);
      });
      if(found&&typeof item[1]==='string')jobs.push({id:item[1],phase,position:phase==='waiting'?index+1:0});
    }
  }
  return {phase:jobs.some(j=>j.phase==='running')?'running':jobs.length?'waiting':'idle',
    running:jobs.filter(j=>j.phase==='running').length,pending:jobs.filter(j=>j.phase==='waiting').length,
    position:jobs.find(j=>j.phase==='waiting')?.position||0,jobs};
}

export function graphNodes(root) {
  const out=[];
  function visit(graph,prefix,parents){
    if(!graph||parents.has(graph))return;
    const seen=new Set(parents);seen.add(graph);
    for(const node of graph._nodes||[]){
      const id=prefix+node.id;out.push({node,id});
      if(node.subgraph)visit(node.subgraph,id+':',seen);
    }
  }
  visit(root,'',new Set());return out;
}

export function canonicalModelChoice(value, choices) {
  if(typeof value!=='string'||!Array.isArray(choices)||choices.includes(value)||!/[.](safetensors|ckpt|pt|pth|bin|gguf)$/i.test(value))return value;
  const key=value.replaceAll('\\','/');
  const matches=choices.filter(x=>typeof x==='string'&&x.replaceAll('\\','/')===key);
  return matches.length===1?matches[0]:value;
}

export function normalizeModelChoices(root) {
  const nodes=graphNodes(root);
  if(!nodes.some(({node})=>(node.comfyClass||node.type)==='H3ContinuumEZEngine'))return 0;
  let changed=0;
  for(const {node} of nodes)for(const widget of node.widgets||[]){
    try{
      const choices=typeof widget.options?.values==='function'?widget.options.values():widget.options?.values;
      const next=canonicalModelChoice(widget.value,choices);
      if(next===widget.value)continue;
      widget.value=next;widget.callback?.(next);node.setDirtyCanvas?.(true,true);changed++;
    }catch(error){console.debug('[H3 EZ] Model choice normalization unavailable',error);}
  }
  return changed;
}
