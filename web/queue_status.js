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

// Follow actual wires, including subgraph input/output boundaries. Coordinates,
// groups, node titles and the former private marker never select a model.
export function canvasEnhancerBinding(timeline,root=timeline.graph){
  const contexts=[],byNode=new Map();
  const visit=(graph,parent=null,path='',parents=new Set())=>{
    if(!graph||parents.has(graph))return;
    const seen=new Set(parents);seen.add(graph);
    const ctx={graph,parent,path};contexts.push(ctx);
    for(const node of graph._nodes||[]){byNode.set(node,ctx);if(node.subgraph)visit(node.subgraph,{node,ctx},path+node.id+':',seen);}
  };visit(root);
  const kind=node=>node?.comfyClass||node?.type;
  const link=(graph,id)=>graph.links?.get?.(id)??graph.links?.[id];
  const fromLink=(ctx,id,seen)=>{
    if(id==null)return null;
    const edge=link(ctx.graph,id);if(!edge)return null;
    const origin=Array.isArray(edge)?edge[1]:edge.origin_id,slot=Array.isArray(edge)?edge[2]:edge.origin_slot;
    return fromOutput(ctx,origin,slot,seen);
  };
  const fromOutput=(ctx,id,slot,seen=new Set())=>{
    const key=ctx.path+id+':'+slot;if(seen.has(key))return null;
    seen=new Set(seen);seen.add(key);
    if(id===(ctx.graph.inputNode?.id??-10)){
      const parent=ctx.parent;
      const name=ctx.graph.inputs?.[slot]?.name;
      const outer=name?parent?.node.inputs?.find(i=>i.name===name):parent?.node.inputs?.[slot];
      return parent?fromLink(parent.ctx,outer?.link,seen):null;
    }
    const node=(ctx.graph._nodes||[]).find(n=>String(n.id)===String(id));
    if(!node||node.mode===2||node.mode===4)return null;
    if(node.subgraph){
      const child=contexts.find(c=>c.parent?.node===node);
      const ids=node.subgraph.outputs?.[slot]?.linkIds||[];
      return child&&ids.length===1?fromLink(child,ids[0],seen):null;
    }
    if(kind(node)==='Reroute')return fromLink(ctx,node.inputs?.[0]?.link,seen);
    return {node,ctx,slot};
  };
  const input=(node,name)=>fromLink(byNode.get(node),node.inputs?.find(i=>i.name===name)?.link,new Set());
  function configWidget(node,ctx,name,slot=node.inputs?.find(i=>i.name===name)){
    if(slot?.link==null){
      const widget=slot&&node.getWidgetFromSlot?.(slot);
      return widget??node.widgets?.find(w=>w.name===(slot?.widget?.name??name));
    }
    const edge=link(ctx.graph,slot.link);
    const origin=Array.isArray(edge)?edge[1]:edge?.origin_id;
    const index=Array.isArray(edge)?edge[2]:edge?.origin_slot;
    const parent=ctx.parent;
    const boundary=ctx.graph.inputs?.[index];
    // Promoted widgets are configured by the enclosing subgraph instance.
    // An arbitrary linked node cannot be treated as a literal widget value.
    if(origin!==(ctx.graph.inputNode?.id??-10)||!parent||!boundary?.name)return null;
    if(parent.node.mode===2||parent.node.mode===4)return null;
    const outer=parent.node.inputs?.find(i=>i.name===boundary.name);
    return configWidget(parent.node,parent.ctx,boundary.name,outer)??null;
  }
  const engines=[...byNode.keys()].filter(n=>kind(n)==='H3ContinuumEZEngine'&&n.mode!==2&&n.mode!==4&&input(n,'timeline')?.node===timeline);
  if(!engines.length)return null;
  const sources=engines.map(n=>input(n,'prompt_clip'));
  // One Timeline driving conflicting models must not pick one arbitrarily.
  if(sources.some(s=>!s||s.slot!==0||kind(s.node)!=='CLIPLoader')||new Set(sources.map(s=>s.node)).size!==1)return null;
  const {node,ctx}=sources[0];
  const model=configWidget(node,ctx,'clip_name');
  const typeWidget=configWidget(node,ctx,'type');
  const deviceWidget=configWidget(node,ctx,'device');
  if(!model||typeWidget===null||deviceWidget===null)return null;
  const choices=typeof model.options?.values==='function'?model.options.values():model.options?.values;
  const value=canonicalModelChoice(model.value,choices);
  const type=typeWidget?.value??'minimax',device=deviceWidget?.value??'default';
  if(typeof value!=='string'||!value.trim()||type!=='minimax'||!['default','cpu'].includes(device))return null;
  return {model:value,type,device,node:ctx.path+node.id};
}
export function canvasEnhancerModel(timeline,root=timeline.graph){return canvasEnhancerBinding(timeline,root)?.model||'';}

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
