import {editorDuration} from './audio_edit.js';
import {openStorageDialog} from './storage_settings.js';
import {getLocale,translator,errorText} from './i18n.js';
import {app} from '../../scripts/app.js';
import {api} from '../../scripts/api.js';
import {ensureStudioStyles,openStudio} from './studio.js';
import {findPreviousVideo,resultVideo} from './result_preview.js';
import {mergeProgress} from './generation.js';
import {timelineQueue,timelineHistory,graphNodes,normalizeModelChoices,canvasEnhancerModel,canvasEnhancerBinding,canvasGenerationSize,canvasAIInstruction} from './queue_status.js';
import {instructionGraph} from './instruction_graph.js';
import {syncSeedControls} from './seed_controls.js';
import {referenceCounts} from './node_summary.js';
import {read,duration,roundEven} from './state.js';

const NODE='H3ContinuumEZTimeline';
const ENGINE='H3ContinuumEZEngine';
const mounted=new WeakSet(),editors=new WeakMap();
const queueEditors=new Map();
let queueTimer=null,queueRequest=null,queueAgain=false;
const rootGraph=()=>app.rootGraph||app.graph;
const seedHosts=new WeakSet();
function installSeedControls(node){
  if(!node.subgraph)return;
  const sync=()=>syncSeedControls(node,translator(getLocale(app))('seedControl'));
  if(!seedHosts.has(node)){
    seedHosts.add(node);
    for(const name of ['onConfigure','onConnectionsChange']){
      const old=node[name];node[name]=function(...args){const out=old?.apply(this,args);queueMicrotask(sync);return out;};
    }
  }
  sync();
}
async function refreshQueue(){
  if(!queueEditors.size)return;
  if(queueRequest){queueAgain=true;return queueRequest;}
  queueRequest=(async()=>{
    try{
      const response=await api.fetchApi('/queue');
      if(!response.ok)throw new Error('Queue HTTP '+response.status);
      const data=await response.json(),nodes=graphNodes(rootGraph());
      let recentHistory=null;
      for(const [node,state] of queueEditors){
        const ids=nodes.filter(x=>x.node===node).map(x=>x.id);
        const next=timelineQueue(data,ids,activeWorkflowId(),String(widget(node)?.value));
        for(const job of next.jobs)if(!state.knownIds.includes(job.id))state.knownIds=[...state.knownIds,job.id].slice(-16);
        if(next.phase==='idle'&&!state.terminal&&(!state.historyChecked||state.historyAttempts<4&&state.submittedAt)){
          const responses=state.knownIds.length?await Promise.all(state.knownIds.map(async id=>{const r=await api.fetchApi('/history/'+encodeURIComponent(id));if(!r.ok)throw new Error('History HTTP '+r.status);return r.json();})):
            [await (recentHistory??=(async()=>{const r=await api.fetchApi('/history?max_items=10');if(!r.ok)throw new Error('History HTTP '+r.status);return r.json();})())];
          state.historyChecked=true;state.historyAttempts++;
          state.terminal=timelineHistory(Object.assign({},...responses),ids,activeWorkflowId(),String(widget(node)?.value),{knownIds:state.knownIds,since:state.submittedAt||0});
        }
        if(next.phase==='idle'&&state.terminal)Object.assign(next,state.terminal);
        else if(next.jobs.length)state.terminal=null;
        state.value=next;state.editor.setQueue(next);
      }
    }catch(error){for(const state of queueEditors.values())state.editor.setQueue({phase:'offline',jobs:[]});}
    finally{queueRequest=null;if(queueAgain){queueAgain=false;void refreshQueue();}}
  })();return queueRequest;
}
function watchQueue(node,editor){
  queueEditors.set(node,{editor,value:null,terminal:null,knownIds:[],historyChecked:false,historyAttempts:0,submittedAt:0});
  if(!queueTimer)queueTimer=setInterval(()=>void refreshQueue(),1500);
  void refreshQueue();
}
function unwatchQueue(node){queueEditors.delete(node);if(!queueEditors.size){clearInterval(queueTimer);queueTimer=null;}}
function queueEnded(phase,detail){
  if(!detail?.prompt_id)return;
  for(const state of queueEditors.values())if(state.knownIds.includes(detail.prompt_id)||state.value?.jobs.some(j=>j.id===detail.prompt_id)){
    state.terminal={phase,detail:detail.exception_message||''};
    state.editor.setQueue({...state.value,...state.terminal,running:0});
  }
  void refreshQueue();
}
function timelineNode(id){
  let graph=rootGraph(),target;
  for(const part of String(id).split(':')){target=graph?.getNodeById?.(part);graph=target?.subgraph;}
  return (target?.comfyClass||target?.type)===NODE?target:null;
}
function onProgress({detail}){
  if(detail?.node_id==null)return;
  const node=timelineNode(detail.node_id);if(!node)return;
  if(detail.event==='start'){
    try{if(JSON.stringify(read(widget(node).value))!==JSON.stringify(detail.plan))return;}catch{return;}
  }
  const next=mergeProgress(api,node._h3ez_progress,detail);
  if(!next||next===node._h3ez_progress)return;
  node._h3ez_progress=next;editors.get(node)?.setProgress(next);
}
function activeWorkflowId(){
  const workflow=app.extensionManager?.workflow?.activeWorkflow;
  return workflow?.activeState?.id ?? workflow?.initialState?.id;
}
function onVideoExecuted({detail}){
  if(!detail || (detail.workflow_id && detail.workflow_id!==activeWorkflowId()))return;
  const record=detail.output?.h3ez_video?.[0];
  if(record?.node_id!=null){
    // Use the Timeline's execution id even when the Engine is inside another subgraph.
    const target=timelineNode(record.node_id);
    if((target?.comfyClass||target?.type)!==NODE)return;
    const video=resultVideo(api,record);
    if(!video)return;
    target._h3ez_resultVideo=video;
    target._h3ez_progress=null;
    editors.get(target)?.setResult(video);
  }
  if(detail.output?.h3ez_preview_error)console.error('[H3 EZ] Preview export:',detail.output.h3ez_preview_error[0]);
}
function restoreVideo(node,editor,signal){
  const workflowId=activeWorkflowId();
  if(!workflowId || node._h3ez_resultVideo || node.graph!==app.graph)return;
  void findPreviousVideo(api,workflowId,node.id,signal).then(video=>{
    if(!video || signal.aborted || editors.get(node)!==editor || node._h3ez_resultVideo ||
        node.graph!==app.graph || activeWorkflowId()!==workflowId)return;
    node._h3ez_resultVideo=video;
    editor.setResult(video,{restored:true});
  }).catch(error=>{
    if(!signal.aborted)console.debug('[H3 EZ] Preview history unavailable',error);
  });
}
const widget=n=>n.widgets?.find(w=>w.name==='timeline_json');
const connected=n=>n.inputs?.some(i=>i.name==='external_prompt'&&i.link!=null)||false;
function mediaUrl(a){const q=new URLSearchParams({filename:a.file.name,subfolder:a.file.subfolder||'',type:'input'});return api.apiURL(`/view?${q}`);}
async function upload(file,kind,t){
  let duration,peaks;
  const body=new FormData();body.append('image',file);body.append('type','input');body.append('subfolder','h3_continuum_ez');
  const response=await api.fetchApi('/upload/image',{method:'POST',body});
  if(!response.ok)throw new Error(t('httpUploadFailed',response.status));
  const result=await response.json();if(!result.name)throw new Error(t('missingFilename'));
  const descriptor={name:result.name,subfolder:result.subfolder||'',type:'input'};
  if(kind==='audio'){
    const probe=await api.fetchApi('/h3-continuum-ez/assist/media-info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:descriptor})});
    const info=await probe.json();if(!probe.ok)throw new Error(info.error||t('audioDurationMissing'));
    duration=info.duration;peaks=info.peaks;
  }
  return {file:descriptor,duration,peaks};
}
function install(node){
  if((node.comfyClass||node.type)!==NODE||mounted.has(node))return;
  const w=widget(node);if(!w)return;
  mounted.add(node);
  ensureStudioStyles();
  w.hidden=true;w.options={...w.options,hidden:true};
  let summary;
  if(typeof node.addDOMWidget==='function'){
    summary=document.createElement('div');summary.className='h3ez-summary';
    const display=node.addDOMWidget('h3ez_summary','h3ez_summary',summary,{serialize:false,hideOnZoom:true,getMinHeight:()=>52,getMaxHeight:()=>64});
    display.serialize=false;display.options.serialize=false;
  }
  const refresh=()=>{
    const t=translator(getLocale(app));
    open.label=t('openStudio');
    if(!summary)return;summary.replaceChildren();
    try{
      const p=read(widget(node).value),line=document.createElement('div');
      line.textContent=t('nodeSummary',p.shots.length,duration(p).toFixed(2))+(editorDuration(p)>duration(p)+.001?t('audioEndSummary',editorDuration(p).toFixed(2)):'')+(connected(node)&&p.prompt_source!=='studio'?' · '+t('externalBadge'):'');
      const counts=referenceCounts(p),refs=document.createElement('div');
      refs.textContent=t('nodeReferences',counts.individual,counts.shared);refs.title=t('nodeReferencesHelp');
      summary.append(line,refs);
    }catch(e){summary.textContent=t('timelineInvalid',errorText(e,t));}
  };
  const open=node.addWidget('button','Open Timeline Studio',null,()=>{
    if(editors.has(node)){editors.get(node).focus();return;}
    const locale=getLocale(app),t=translator(locale);
    let baseline=String(widget(node).value);
    const previewLookup=new AbortController();
    try{
      const workflowAtOpen=activeWorkflowId();
      const editor=openStudio({value:baseline,assistApi:api,getCanvasModel:()=>canvasEnhancerModel(node,rootGraph()),getInstructionGraph:async binding=>instructionGraph((await app.graphToPrompt()).output,binding),assistIdentity:()=>({instructionBinding:canvasAIInstruction(node,rootGraph()),outputSize:canvasGenerationSize(node,rootGraph()),canvasLoader:canvasEnhancerBinding(node,rootGraph()),workflow:activeWorkflowId()??null,openedWorkflow:workflowAtOpen??null,node:String(node.id),present:graphNodes(rootGraph()).some(x=>x.node===node)}),mediaUrl,upload:(file,kind)=>upload(file,kind,t),locale,onStorage:openStorageDialog,resultVideo:node._h3ez_resultVideo??null,generation:node._h3ez_progress??null,externalConnected:connected(node),lastExternal:node._h3ez_lastCommon??null,
        onApply:plan=>{
          if(!node.graph)throw new Error(t('nodeRemoved'));
          if(String(widget(node).value)!==baseline)throw new Error(t('nodeChanged'));
          const graph=node.graph;graph.beforeChange?.();try{
            const text=JSON.stringify(plan);widget(node).value=text;widget(node).callback?.(text);baseline=text;node.setDirtyCanvas?.(true,true);refresh();
          }finally{graph.afterChange?.();}
        },
        onQueue:async()=>{
          if(typeof app.queuePrompt!=='function')throw new Error(t('useComfyQueue'));
          const state=queueEditors.get(node);if(state){state.terminal=null;state.submittedAt=Date.now();state.knownIds=[];state.historyChecked=false;state.historyAttempts=0;}
          normalizeModelChoices(rootGraph());
          const accepted=await app.queuePrompt(0,1);
          if(accepted===false){if(state)state.terminal={phase:'failed',detail:t('queueRejected')};throw new Error(t('queueRejected'));}
          await refreshQueue();
        },
        onClose:()=>{previewLookup.abort();unwatchQueue(node);editors.delete(node);}});
      editors.set(node,editor);
      watchQueue(node,editor);
      restoreVideo(node,editor,previewLookup.signal);
    }catch(e){console.error('[H3 EZ]',e);alert(`H3 EZ Studio: ${errorText(e,t)}`);}
  },{serialize:false});open.serialize=false;open.options.serialize=false;
  const originalCallback=w.callback;w.callback=function(...args){const out=originalCallback?.apply(this,args);refresh();return out;};
  for(const method of ['onConfigure','onConnectionsChange']){
    const original=node[method];node[method]=function(...args){const out=original?.apply(this,args);queueMicrotask(()=>{refresh();editors.get(node)?.setExternal?.(connected(node),node._h3ez_lastCommon??null);});return out;};
  }
  const executed=node.onExecuted;node.onExecuted=function(message,...rest){const out=executed?.call(this,message,...rest);if(message?.h3ez_external)node._h3ez_lastCommon=message.h3ez_external[0];else if(message?.h3ez_common)node._h3ez_lastCommon=message.h3ez_common[0];editors.get(node)?.setExternal?.(connected(node),node._h3ez_lastCommon??null);return out;};
  const settings=app.ui?.settings;
  const refreshLocale=()=>{refresh();node.setDirtyCanvas?.(true,true);};
  settings?.addEventListener?.('Comfy.Locale.change',refreshLocale);
  const removed=node.onRemoved;node.onRemoved=function(...args){settings?.removeEventListener?.('Comfy.Locale.change',refreshLocale);editors.get(node)?.close();editors.delete(node);return removed?.apply(this,args);};
  node.setSize?.([Math.max(380,node.size?.[0]||0),Math.max(150,node.computeSize?.()[1]||150)]);refresh();
}
function installEngineSize(node){
  if((node.comfyClass||node.type)!==ENGINE||mounted.has(node))return;
  const byName=Object.fromEntries((node.widgets||[]).map(w=>[w.name,w]));
  const {megapixels,aspect,width,height}=byName;
  if(!megapixels||!aspect||!width||!height)return;
  mounted.add(node);
  const isLinked=name=>node.inputs?.some(input=>input.name===name&&input.link!=null);
  const useLegacyLinks=()=>
    (isLinked('megapixels')||isLinked('aspect'))&&!isLinked('width')&&!isLinked('height');
  for(const w of [megapixels,aspect,width,height]){
    const legacy=w===megapixels||w===aspect;
    if(legacy){
      w.hidden=true;
      w.options={...w.options,hidden:true};
    }
    // Keep legacy widgets in workflow JSON, but only send the active inputs to execution.
    w.serializeValue=()=>legacy===!!useLegacyLinks()?w.value:undefined;
  }
  const configure=node.onConfigure;
  node.onConfigure=function(info,...args){
    const result=configure?.call(this,info,...args);
    if(!this.outputs?.some(output=>output.name==='video'))this.addOutput?.('video','VIDEO');
    if(!this.outputs?.some(output=>output.name==='output_images'))this.addOutput?.('output_images','BOOLEAN');
    const named=info?.widgets_values_named;
    const values=info?.widgets_values;
    const hasDimensions=named?.width!=null||named?.height!=null||values?.length>=6;
    if(!hasDimensions){
      const mp=named?.megapixels??values?.[2];
      const ratio=({'16:9':16/9,'9:16':9/16,'1:1':1,'4:3':4/3,'3:4':3/4})[named?.aspect??values?.[3]];
      if(Number.isFinite(mp)&&mp>=.1&&mp<=2&&Number.isFinite(ratio)){
        width.value=Math.max(32,roundEven(Math.sqrt(mp*1e6*ratio)/32)*32);
        height.value=Math.max(32,roundEven(Math.sqrt(mp*1e6/ratio)/32)*32);
      }
    }
    return result;
  };
}

app.registerExtension({
  name:'h3.continuum.ez.studio.v2',
  setup(){
    api.addEventListener('executed',onVideoExecuted);api.addEventListener('h3ez_progress',onProgress);
    // Standard ComfyUI events; no global patch of loaders, queuePrompt or models.
    api.addEventListener('promptQueueing',()=>normalizeModelChoices(rootGraph()));
    for(const name of ['status','promptQueued','execution_start','reconnected'])api.addEventListener(name,()=>void refreshQueue());
    api.addEventListener('execution_success',({detail})=>queueEnded('complete',detail));
    api.addEventListener('execution_error',({detail})=>queueEnded('failed',detail));
    api.addEventListener('execution_interrupted',({detail})=>queueEnded('interrupted',detail));
  },
  nodeCreated(node){install(node);installEngineSize(node);installSeedControls(node);},
  afterConfigureGraph(){for(const {node} of graphNodes(rootGraph())){install(node);installEngineSize(node);installSeedControls(node);}normalizeModelChoices(rootGraph());},
});
