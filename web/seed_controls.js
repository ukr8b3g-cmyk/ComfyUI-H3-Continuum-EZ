// Display the existing control mode. ComfyUI remains the only seed randomizer.
const modes=['fixed','increment','decrement','randomize'];
const mirrors=new WeakMap();
function seedTargets(host,input,seen=new Set()){
  const graph=host.subgraph,slot=input._subgraphSlot||graph?.inputNode?.slots?.find(s=>s.name===input.name);
  if(!slot||seen.has(slot))return [];
  const next=new Set(seen);next.add(slot);const out=[];
  for(const id of slot.linkIds||[]){
    const link=graph.getLink?.(id)||graph.links?.[id];if(!link)continue;
    const resolved=link.resolve?.(graph);
    const node=resolved?.inputNode||graph.getNodeById?.(link.target_id);
    const target=resolved?.input||node?.inputs?.[link.target_slot];
    if(!node||!target)continue;
    if(node.subgraph){out.push(...seedTargets(node,target,next));continue;}
    if((node.comfyClass||node.type)!=='H3ContinuumEZEngine'||target.name!=='seed')continue;
    const widget=node.getWidgetFromSlot?.(target)||node.widgets?.find(w=>w.name==='seed');
    const control=widget?.linkedWidgets?.find(w=>Array.isArray(w.options?.values)&&modes.every(m=>w.options.values.includes(m)));
    if(control)out.push(control);
  }
  return [...new Set(out)];
}

export function syncSeedControls(host,label){
  if(!host.subgraph||typeof host.addWidget!=='function')return;
  let installed=mirrors.get(host);if(!installed){installed=new Map();mirrors.set(host,installed);}
  const wanted=new Set();
  for(const [index,input] of (host.inputs||[]).entries()){
    if(host.isInputConnected?.(index)??input.link!=null)continue;
    const targets=seedTargets(host,input);if(!targets.length)continue;
    // If core already exposes a linked control, do not add a second UI.
    const visible=host.getWidgetFromSlot?.(input);
    if(visible?.linkedWidgets?.some(w=>targets.includes(w)))continue;
    wanted.add(input.name);
    let entry=installed.get(input.name);
    if(!entry){
      entry={targets};
      const widget=host.addWidget('combo','h3ez_seed_control:'+input.name,targets[0].value,value=>{
        if(!modes.includes(value))return;
        host.graph?.beforeChange?.();
        try{for(const control of entry.targets){control.value=value;control.callback?.(value);}host.setDirtyCanvas?.(true,true);}
        finally{host.graph?.afterChange?.();}
      },{values:modes,serialize:false});
      widget.serialize=false;widget.options={...widget.options,values:modes,serialize:false};
      Object.defineProperty(widget,'value',{configurable:true,get:()=>entry.targets[0]?.value||'fixed',set:value=>{if(modes.includes(value))for(const c of entry.targets)c.value=value;}});
      entry.widget=widget;installed.set(input.name,entry);
    }
    entry.targets=targets;entry.widget.label=`${input.label||input.name} · ${label}`;
  }
  for(const [name,entry] of installed)if(!wanted.has(name)){
    host.removeWidget?.(entry.widget);installed.delete(name);
  }
}
