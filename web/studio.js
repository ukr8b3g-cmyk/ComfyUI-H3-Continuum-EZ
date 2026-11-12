import {editorDuration,placeAudio as placeFullAudio,duplicateAudio,audioTrimLength} from './audio_edit.js';
import {newProject,saveProject,loadProject,MAX_PROJECT_BYTES} from './project.js';
import {applyUIHelp} from './ui_help.js';
import {imageAspectFromDimensions,resolutionAspect} from './resolution.js';
import {mediaLabel,mediaHelp} from './media_labels.js';
import {AssistClient} from './assist.js';
import {DEFAULT_INSTRUCTION} from './default_instruction.js';
import {createAssistPanel} from './assist_panel.js';
import {activateEntry,restoreOriginal,pruneTargets,resolveText} from './enhancer.js';
import {storyPanel} from './story_panel.js';
import {translator,errorText} from './i18n.js';
import {ASPECT_RATIOS,DEFAULT_CHUNK_SECONDS,resolutionSize,clone,uid,read,geometry,duration as videoDuration,executionPlan,resizeShot,MAX_SHOT_SECONDS,refsFor,firstFor,commonPrompt,editPrompt,effective,validate,registerReference,assetUsage as describeAssetUsage,removeAsset,insertShot,moveShot,splitShot,splitAudio,parseScript,History} from './state.js';

const duration=editorDuration;
const cssUrl=new URL('./studio.css',import.meta.url).href;
export function ensureStudioStyles(){if(!document.querySelector('link[data-h3ez-style]')){const l=document.createElement('link');l.rel='stylesheet';l.href=cssUrl;l.dataset.h3ezStyle='1';document.head.append(l);}}
function el(tag,cls='',text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function btn(text,fn,cls=''){const b=el('button',cls,text);b.type='button';if(fn)b.addEventListener('click',fn);return b;}
function inputNumber(value,fn,min=0,max=9999,step=.01){const e=el('input');e.type='number';e.value=value;e.min=min;e.max=max;e.step=step;e.addEventListener('change',()=>fn(Number(e.value)));return e;}
function select(options,value,fn){const s=el('select');for(const [v,t] of options){const o=el('option','',t);o.value=v;s.append(o);}s.value=value;s.onchange=()=>fn(s.value);return s;}
function field(label,control){const e=el('label','ez-field');e.append(el('span','',label),control);return e;}
const stamp=n=>`${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toFixed(2).padStart(5,'0')}`;
const studioResolutionDefaults={source:'studio',aspect:'16:9',megapixels:.3};
const escapeDrop=e=>{e.preventDefault();e.stopPropagation();};

export function openStudio({value,mediaUrl,upload,onApply,onQueue,externalConnected=false,lastExternal=null,onClose=null,locale='en',resultVideo=null,generation=null,onStorage=null,assistApi=null,assistIdentity=()=>({}),getCanvasModel=()=>null,getInstructionGraph=null,draftStore=null,restoredDraft=null,draftReadError=false,sizePreference='workflow'}){
  const t=translator(locale);
  ensureStudioStyles();let p=read(value),saved=JSON.stringify(p);
  if(restoredDraft){try{p=read(restoredDraft.plan);}catch{restoredDraft=null;draftReadError=true;}}
  const useSizePreference=plan=>{if(['studio','engine'].includes(sizePreference)&&(plan.resolution?.source??'studio')!==sizePreference)plan.resolution={...studioResolutionDefaults,...plan.resolution,source:sizePreference};};
  useSizePreference(p);
  const view=restoredDraft?.view;
  let selected=p.shots.find(s=>s.id===view?.selected)?.id??p.shots[0]?.id,selectedAudio=p.audio.find(c=>c.id===view?.selectedAudio)?.id??null;
  let playhead=Math.max(0,Math.min(duration(p),view?.playhead||0)),zoom=Math.max(1,Math.min(8,view?.zoom||1)),promptTab=['shot','common','effective'].includes(view?.promptTab)?view.promptTab:'shot',focusMode=!!view?.focusMode,busy=0,closed=false;
  const history=new History(),abort=new AbortController(),waves=new Map(),pendingWaves=new Set(),previousShotRefs=new Map();
  let projectSaved=view?.projectWasSaved?JSON.stringify(p):saved,projectName=view?.projectName||'H3_EZ_Project.h3ez.json',projectWorking=false;
  let mediaError=null, assistPanel=null, applying=false,audioDragCancel=null,selectionKind=selectedAudio?'audio':'shot',closePrompt=null;
  const roleSelection=new Map();
  const assistState=()=>({plan:p,external:externalConnected?lastExternal:null,
    outputSize:assistIdentity().outputSize??null,
    externalUnknown:externalConnected&&p.prompt_source!=='studio'&&lastExternal===null,
    identity:{...assistIdentity(),canvasModel:getCanvasModel()??''},alive:!closed});
  const assist=assistApi?new AssistClient({api:assistApi,getState:assistState,getInstructionGraph,explicitRequests:true,onStatus:value=>assistPanel?.setStatus(value)}):null;
  let editCheckTimer=null;
  const deferredChecks=()=>{assist?.sync();clearTimeout(editCheckTimer);editCheckTimer=setTimeout(()=>{if(!closed){checks();}},100);};
  let observer=null,monitorObserver=null,monitorFrame=null,monitor=null,videoSize=null,queueState={phase:'checking'},submitting=false,inputIssue='',submissionError='',noticeKey='',noticeDismissed=false,queueAcknowledged=false;
  let playing=false,frame=0,clock=0,clockStart=0,media=new Audio(),activeAudio=null,monitorImage=null,head=null,clockLabel=null,timelineWidth=1000;
  let previewLoop=false,previewVolume=1,previewMuted=false,previewLastVolume=1,refreshPreviewVolume=null;
  media.preload='auto';
  let previewMode='auto', resultLabel=null, resultToggle=null, playControl=null, resultMatches=false,activeVideo=null,shotDragCancel=null,suppressShotClick=false;
  let previewRunId=null;
  // Compare the plan only after edits or incoming generation records, never per animation frame.
  let planText=JSON.stringify(p),resultPlanText=resultVideo?JSON.stringify(read(resultVideo.plan)):null,
      generationPlanText=generation?JSON.stringify(generation.plan):null;
  function refreshPlanIdentity(){planText=JSON.stringify(p);}
  const video=el('video','ez-result-video');video.controls=true;video.playsInline=true;video.preload='metadata';
  const samePlan=()=>!!resultVideo&&resultPlanText===planText;
  const runMatches=()=>!!generation&&generationPlanText===planText;
  const partialAt=time=>generation?.clips.find(c=>time>=c.start&&time<c.end);
  const videoOffset=()=>activeVideo?.start||0;
  function resultActive(){
    return !!activeVideo && previewMode!=='layout';
  }
  function syncVideoLoop(){
    // A partial clip must reach its ended event so the next available clip can play.
    video.loop=previewLoop&&resultActive()&&activeVideo.end==null;
  }
  function updateResultState({keepEndFrame=true}={}){
    const wasSynced=resultActive()&&resultMatches;
    const currentRun=runMatches()?generation:null;
    const hasClips=!!currentRun?.clips.length;
    const firstPreview=hasClips&&previewRunId!==currentRun.runId;
    const resume=firstPreview&&playing;
    if(firstPreview){
      previewRunId=currentRun.runId;
      pause();
      previewMode='auto';
      if(!partialAt(playhead))playhead=currentRun.clips[0].start;
    }
    const hasFinal=!currentRun&&samePlan();
    resultMatches=hasClips||hasFinal;
    if(resultMatches && previewMode==='previous')previewMode='auto';
    let source=null;
    if(hasClips){
      source=partialAt(playhead);
      if(!source&&keepEndFrame)source=currentRun.clips.find(clip=>clip.url===activeVideo?.url&&clip.end===playhead);
    }else if(previewMode==='previous'||hasFinal){
      source=resultVideo;
    }
    const changed=activeVideo?.url!==source?.url;
    activeVideo=source||null;
    if(changed&&activeVideo){videoSize=null;video.src=activeVideo.url;video.currentTime=Math.max(0,playhead-videoOffset());}
    if(!resultActive()&&!video.paused)pause();
    video.hidden=!resultActive();
    syncVideoLoop();
    if(!wasSynced && resultActive() && resultMatches)video.currentTime=Math.max(0,playhead-videoOffset());
    if(resultToggle){
      resultToggle.textContent=t(resultVideo&&!resultMatches?'previousVideo':'resultPreview');
      resultToggle.disabled=!hasClips&&!resultVideo;
      resultToggle.classList.toggle('selected',resultActive());
    }
    updatePlayhead();
    if(resume&&resultActive())playback();
  }
  function updateVideoTime(){
    if(!resultActive())return;
    if(resultMatches)playhead=Math.min(activeVideo.end??videoDuration(p),videoOffset()+video.currentTime);
    updatePlayhead();
  }
  video.addEventListener('play',()=>{if(!resultActive()){video.pause();return;}media.pause();playing=true;cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);});
  video.addEventListener('pause',()=>{if(resultActive()){playing=false;cancelAnimationFrame(frame);updatePlayhead();}});
  video.addEventListener('timeupdate',updateVideoTime);
  video.addEventListener('seeked',updateVideoTime);
  video.addEventListener('volumechange',()=>{
    if(closed||(video.volume===previewVolume&&video.muted===previewMuted))return;
    previewVolume=video.volume;previewMuted=video.muted;if(previewVolume>0)previewLastVolume=previewVolume;
    refreshPreviewVolume?.();
  },{signal:abort.signal});
  video.addEventListener('loadedmetadata',()=>{videoSize={width:video.videoWidth,height:video.videoHeight};if(resultMatches&&activeVideo)video.currentTime=Math.max(0,playhead-videoOffset());updatePlayhead();});
  video.addEventListener('ended',()=>{
    if(closed||!resultActive())return;
    playing=false;cancelAnimationFrame(frame);
    const next=activeVideo.end;
    if(next!=null&&runMatches()){
      if(partialAt(next)){seek(next);playback();return;}
      if(previewLoop){
        let start=activeVideo.start;
        // Repeat the contiguous section that just played, without crossing a gap.
        for(const clip of [...generation.clips].reverse()){
          if(clip.end===start)start=clip.start;
        }
        seek(start);playback();return;
      }
    }
    updatePlayhead();
  });
  video.addEventListener('error',()=>{if(resultActive())message(t('videoError'),true);});
  const dialog=el('dialog','h3ez-studio');dialog.lang=locale;dialog.setAttribute('aria-label','H3 Continuum EZ Studio');
  const shell=el('div','ez-shell'),top=el('header','ez-top'),work=el('div','ez-work'),library=el('aside','ez-library'),preview=el('section','ez-preview'),splitter=el('div','ez-splitter'),inspector=el('section','ez-inspector'),timeline=el('section','ez-timeline'),footer=el('footer','ez-footer'),status=el('span','ez-status');
  timeline.tabIndex=-1;
  const timelineSplitter=el('div','ez-timeline-splitter');
  timelineSplitter.tabIndex=0;
  timelineSplitter.title=t('resizeTimeline');
  timelineSplitter.setAttribute('role','separator');
  timelineSplitter.setAttribute('aria-orientation','horizontal');
  timelineSplitter.setAttribute('aria-label',timelineSplitter.title);
  shell.append(top,work,timelineSplitter,timeline,footer);work.append(library,preview,splitter,inspector);dialog.append(shell);
  top.append(el('h2','','H3 Continuum EZ Studio'));
  const timelineTab=btn(t('timelineTab'),()=>{focusMode=false;renderLayout();},'selected');
  const undo=btn('↶',()=>{p=history.undo(p);reconcile();render();});undo.title=t('undo');undo.setAttribute('aria-label',t('undo'));
  const redo=btn('↷',()=>{p=history.redo(p);reconcile();render();});redo.title=t('redo');
  const importButton=btn(t('importText'),()=>openImporter());
  const apply=btn(t('applyToNode'),()=>applyDraft(false),'ez-apply');
  const queue=btn(t('applyAndQueue'),()=>applyDraft(true),'primary');
  const restore=btn('□',()=>dialog.classList.toggle('is-restored'));restore.title=t('maximizeRestore');
  const closeButton=btn('×',()=>requestClose(),'ez-close');
  closeButton.title=t('close');
  closeButton.setAttribute('aria-label',t('close'));
  const editTools=el('div','ez-top-group ez-edit-tools');
  const projectGroup=el('div','ez-project-group'),projectActions=el('div','ez-project-actions');projectActions.hidden=true;projectActions.setAttribute('role','menu');
  const projectMenu=btn(`${t('project')} ▾`,()=>{const show=projectActions.hidden;projectActions.hidden=!show;projectMenu.setAttribute('aria-expanded',String(show));if(show)projectActions.querySelector('button').focus();});
  projectMenu.setAttribute('aria-haspopup','menu');projectMenu.setAttribute('aria-expanded','false');
  const closeProjectMenu=()=>{projectActions.hidden=true;projectMenu.setAttribute('aria-expanded','false');};
  for(const [action,key] of [['new','projectNew'],['load','projectLoad'],['save','projectSave']]){
    const control=btn(t(key),()=>{closeProjectMenu();if(action==='load')pickProject();else void projectOperation(action);});control.setAttribute('role','menuitem');control.title=t('projectHelp');projectActions.append(control);
  }
  projectGroup.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeProjectMenu();projectMenu.focus();}
    else if(!projectActions.hidden&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...projectActions.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);buttons[e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowDown'?1:-1)+3)%3].focus();}
  });
  document.addEventListener('pointerdown',e=>{if(!projectGroup.contains(e.target))closeProjectMenu();},{signal:abort.signal});
  projectGroup.addEventListener('focusout',e=>{if(!projectGroup.contains(e.relatedTarget))closeProjectMenu();});
  projectMenu.className='ez-project-menu';projectMenu.setAttribute('aria-label',t('project'));projectMenu.title=`${projectName}\n${t('projectHelp')}`;
  const projectFileInput=el('input');projectFileInput.type='file';projectFileInput.accept='.h3ez.json,.json,application/json';projectFileInput.hidden=true;
  projectFileInput.onchange=()=>{if(projectFileInput.files?.[0])void projectOperation('load',projectFileInput.files[0]);};
  projectGroup.append(projectMenu,projectActions,projectFileInput);top.append(projectGroup);
  editTools.append(timelineTab,undo,redo,importButton);
  const settingsTools=el('div','ez-top-group ez-settings-tools');
  const instructionButton=btn(t('aiInstruction'),()=>openInstruction(),'ez-ai-instruction-button');
  instructionButton.title=t('aiInstructionHelp');settingsTools.append(instructionButton);
  if(onStorage)settingsTools.append(btn(t('storageManager'),onStorage));
  const runTools=el('div','ez-top-group ez-run-tools');
  const queueStatus=el('span','ez-queue-status');queueStatus.setAttribute('role','status');queueStatus.setAttribute('aria-live','polite');
  const renderStatus=el('div','ez-render-progress'),renderDetail=el('span','ez-render-detail'),renderCount=el('span','ez-render-count'),renderBar=el('progress','ez-render-bar');
  renderStatus.hidden=true;renderStatus.setAttribute('role','status');renderStatus.title=t('queueStatusHelp');
  renderBar.setAttribute('aria-label',t('videoGenerating'));
  renderStatus.append(el('strong','',t('videoGenerating')),renderDetail,renderCount,renderBar);
  const runNotice=el('div','ez-run-notice'),runNoticeText=el('span');runNotice.hidden=true;runNotice.setAttribute('role','alert');
  const dismissNotice=btn('×',()=>{
    noticeDismissed=true;
    refreshRunNotice();
    queue.focus({preventScroll:true});
  },'ez-close');
  dismissNotice.title=t('dismissNotice');
  dismissNotice.setAttribute('aria-label',dismissNotice.title);
  runNotice.append(runNoticeText,dismissNotice);
  runTools.append(queueStatus,apply,queue);
  const windowTools=el('div','ez-top-group ez-window-tools');
  windowTools.append(restore,closeButton);
  const advanced = el('details', 'ez-output-details');
  advanced.append(el('summary', '', t('advancedOutput')));
  const outputChoices = [['Long video', t('exportVideo')], ['Images', t('exportFrames')], ['', t('followEngineOutput')]];
  const output = select(outputChoices, p.output_mode ?? '', value => mutate(() => {
    if (value) p.output_mode = value;
    else delete p.output_mode;
  }));
  output.setAttribute('aria-label', t('outputFormat'));
  const outputPanel = el('div', 'ez-output-panel');
  const outputHeading=el('div','ez-dialog-heading'),outputClose=btn('×',()=>{advanced.open=false;advanced.querySelector('summary').focus();},'ez-close');outputClose.title=t('closeOutput');outputClose.setAttribute('aria-label',t('closeOutput'));outputHeading.append(el('strong','',t('advancedOutput')),outputClose);outputPanel.append(outputHeading);
  output.title=t('studioOutputHelp');outputPanel.append(field(t('outputFormat'),output));
  const chunkToggle=el('input');chunkToggle.type='checkbox';chunkToggle.setAttribute('aria-label',t('autoSplit'));
  const chunkSeconds=inputNumber(p.chunking?.seconds??DEFAULT_CHUNK_SECONDS,value=>mutate(()=>{p.chunking={enabled:chunkToggle.checked,seconds:value};}),2,15,.1);
  chunkSeconds.setAttribute('aria-label',t('partSeconds'));
  chunkToggle.onchange=()=>mutate(()=>{p.chunking={enabled:chunkToggle.checked,seconds:p.chunking?.seconds??DEFAULT_CHUNK_SECONDS};});
  const chunkRow=el('div','ez-chunk-options');chunkRow.append(field(t('autoSplit'),chunkToggle),field(t('partSeconds'),chunkSeconds));
  chunkToggle.title=chunkSeconds.title=t('autoSplitHelp');outputPanel.append(chunkRow);
  advanced.append(outputPanel);
  document.addEventListener('pointerdown',e=>{if(advanced.open&&!advanced.contains(e.target))advanced.open=false;},{signal:abort.signal});
  advanced.addEventListener('keydown',e=>{if(e.key==='Escape'&&advanced.open){e.preventDefault();e.stopPropagation();advanced.open=false;advanced.querySelector('summary').focus();}});
  settingsTools.append(advanced);
  top.append(editTools,settingsTools,runTools,windowTools,renderStatus,runNotice);
  footer.append(status);preview.title=t('previewHelp');
  function message(text,error=false){
    status.textContent=text;
    status.title=error?text:'';
    status.classList.toggle('error',error);
  }
  function dirty(){return JSON.stringify(p)!==saved;}
  function projectReady(){
    if(projectWorking||busy||applying||assistPanel?.isBusy())throw new Error(t('projectBusy'));
  }
  async function replaceProject(next,name){
    if(JSON.stringify(p)!==projectSaved||assistPanel?.hasPendingEdits()){
      const accepted=await new Promise(resolve=>{
        const d=el('dialog','h3ez-import ez-project-confirm'),heading=el('div','ez-dialog-heading');d.lang=locale;d.setAttribute('aria-label',t('project'));
        const cancel=()=>d.close(),x=btn('×',cancel,'ez-close');x.title=t('close');x.setAttribute('aria-label',t('close'));
        heading.append(el('h3','',t('project')),x);const actions=el('div','ez-import-actions');
        actions.append(btn(t('cancel'),cancel),btn(t('projectReplace'),()=>d.close('replace'),'primary'));
        d.append(heading,el('p','',t('projectDiscard')),actions);dialog.append(d);
        d.addEventListener('close',()=>{const ok=d.returnValue==='replace';d.remove();resolve(ok);},{once:true});d.showModal();d.querySelector('.ez-import-actions button').focus();
      });
      if(!accepted||closed)return false;
      if(busy||applying||assistPanel?.isBusy())throw new Error(t('projectBusy'));
    }
    pause();shotDragCancel?.();audioDragCancel?.();assist?.invalidate('project changed');assistPanel?.reset();
    history.record(p);p=next;useSizePreference(p);selected=p.shots[0]?.id;selectedAudio=null;selectionKind='shot';playhead=0;zoom=1;
    waves.clear();previousShotRefs.clear();roleSelection.clear();mediaError=null;
    resultVideo=null;generation=null;resultPlanText=null;generationPlanText=null;activeVideo=null;video.removeAttribute('src');video.load();previewMode='auto';previewRunId=null;videoSize=null;
    clearTimeout(editCheckTimer);projectName=name;projectMenu.title=`${name}\n${t('projectHelp')}`;projectSaved=JSON.stringify(p);reconcile();render();return true;
  }
  async function projectOperation(action,file=null){
    try{projectReady();}catch(e){message(errorText(e,t),true);return;}
    projectWorking=true;
    try{
      if(action==='save'){
        let fileHandle=null;
        if(typeof window.showSaveFilePicker==='function'){
          // Open the picker while the project menu click still grants user activation.
          try{
            fileHandle=await window.showSaveFilePicker({
              id:'h3ez-project',suggestedName:projectName,
              types:[{description:t('projectFileType'),accept:{'application/json':['.json']}}],
            });
          }catch(error){
            if(error.name==='AbortError')return;
            if(error.name!=='SecurityError')throw error;
          }
        }
        if(closed)return;
        await assistPanel?.flush();if(closed)return;
        const text=saveProject(p),snapshot=JSON.stringify(p);
        if(fileHandle){
          const writer=await fileHandle.createWritable();
          try{await writer.write(text);await writer.close();}
          catch(error){await writer.abort().catch(()=>{});throw error;}
          projectName=fileHandle.name;
          projectMenu.title=`${projectName}\n${t('projectHelp')}`;
          message(t('projectSaved'));
        }else{
          const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
          const a=el('a');a.href=url;a.download=projectName;dialog.append(a);
          try{a.click();message(t('projectDownloadStarted'));}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
        }
        projectSaved=snapshot;
      }else if(action==='new'){
        if(await replaceProject(newProject(),'H3_EZ_Project.h3ez.json'))message(t('projectCreated'));
      }else if(file){
        if(file.size>MAX_PROJECT_BYTES)throw new Error(t('projectTooLarge'));
        const next=loadProject(await file.text());if(closed)return;
        if(busy||applying||assistPanel?.isBusy())throw new Error(t('projectBusy'));
        if(await replaceProject(next,file.name))message(t('projectLoaded'));
      }
    }catch(e){clearTimeout(editCheckTimer);if(!closed)message(errorText(e,t),true);}finally{projectWorking=false;}
  }
  function pickProject(){
    try{projectReady();}catch(e){message(errorText(e,t),true);return;}
    projectFileInput.value='';projectFileInput.click();
  }
  function current(){return p.shots.find(s=>s.id===selected)||p.shots[0];}
  function reconcile(){pruneTargets(p);refreshPlanIdentity();assist?.sync();if(!p.shots.some(s=>s.id===selected))selected=p.shots[0]?.id;if(selectedAudio&&!p.audio.some(c=>c.id===selectedAudio)){selectedAudio=null;if(selectionKind==='audio')selectionKind=null;}playhead=Math.min(playhead,duration(p));}
  function mutate(fn,{strict=false,onError=null}={}){
    const before=clone(p);
    try{fn();if(strict)validate(p);history.record(before);reconcile();render();}
    catch(e){
      p=before;reconcile();
      if(onError)onError(e);
      render();
      if(!onError)message(errorText(e,t),true);
    }
  }
  function checks(){
    applyUIHelp(dialog,locale);
    refreshPlanIdentity();assist?.sync();assistPanel?.update();
    output.value = p.output_mode ?? '';
    chunkToggle.checked=p.chunking?.enabled??true;chunkSeconds.value=p.chunking?.seconds??DEFAULT_CHUNK_SECONDS;chunkSeconds.disabled=!chunkToggle.checked;
    updateResultState();
    if(!runMatches()&&!samePlan()){
      timeline.querySelectorAll('.ez-shot-status,.ez-filmstrip').forEach(e=>e.remove());
      timeline.querySelectorAll('.has-filmstrip').forEach(e=>e.classList.remove('has-filmstrip'));
    }
    undo.disabled=!history.back.length;redo.disabled=!history.forward.length;
    if(busy){updateApplyControls();message(t('uploading',busy));return;}
    const previousInputIssue=inputIssue;inputIssue='';
    try{
      validate(p);
      if(!externalConnected||p.prompt_source==='studio'||lastExternal!==null)p.shots.forEach((_,i)=>effective(p,i,externalConnected?lastExternal:null));
      const summary=t('studioStatus',t(dirty()?'unsaved':'applied'),p.shots.length,duration(p).toFixed(3))+(externalConnected?' · '+t(p.prompt_source==='studio'?'studioCommonStatus':'externalStatus'):'');
      message(mediaError?.text??summary,mediaError!==null);
    }
    catch(e){inputIssue=errorText(e,t);message(inputIssue,true);}
    if(submissionError===previousInputIssue&&inputIssue!==previousInputIssue)submissionError='';
    updateApplyControls();
  }
  function updateApplyControls(){
    // A validation issue must remain inspectable by clicking the action. Only an
    // operation in flight temporarily locks it; applyDraft still validates first.
    apply.disabled=queue.disabled=busy>0||applying||submitting;
    const acknowledged=queueAcknowledged&&!dirty();
    queue.textContent=applying?t(submitting?'queue_submitting':'queueValidating'):submissionError?t('queueInputError'):t(acknowledged?'queueAddedButton':'applyAndQueue');
    queue.dataset.feedback=applying?'busy':submissionError?'rejected':acknowledged?'accepted':'';
    queue.setAttribute('aria-busy',String(applying||submitting));
    queue.title=busy?t('waitUpload'):(applying||submitting)?t('queue_submitting'):inputIssue||t(acknowledged?'queueAddedHelp':'applyQueueHelp');
    setQueue(queueState);
  }
  function refreshRunNotice(){
    const text=inputIssue||submissionError||(queueState.phase==='failed'?queueState.detail:'')||'';
    if(text!==noticeKey){
      noticeKey=text;
      noticeDismissed=false;
      runNoticeText.textContent=text;
    }
    runNotice.hidden=!text||noticeDismissed;
  }
  function renderLayout(){shell.classList.toggle('prompt-focus',focusMode);timelineTab.classList.toggle('selected',!focusMode);renderInspector();}
  function mediaAsset(id){return p.assets.find(a=>a.id===id);}
  function img(id,cls=''){const e=el('img',cls);const a=mediaAsset(id);if(a){e.src=mediaUrl(a);e.alt=a.label;e.loading='lazy';}return e;}
  function bindDrop(target,handler,{label='',kind=null,assetOnly=false,shotLabel=''}={}){
    if(label)target.dataset.dropLabel=t(label);
    target.addEventListener('dragover',e=>{
      escapeDrop(e);
      const types=e.dataTransfer?.types??[];
      const files=[...(e.dataTransfer?.items??[])].filter(item=>item.kind==='file');
      const shot=shotLabel&&types.includes('application/x-h3ez-shot');
      const asset=kind==='image'&&types.includes('application/x-h3ez-asset');
      const external=!assetOnly&&types.includes('Files')&&(!kind||!files.length||files.some(file=>
        !file.type || file.type==='application/octet-stream' ||
        (kind==='image'?file.type.startsWith('image/'):/^(audio|video)\//.test(file.type))));
      if(label)target.dataset.dropLabel=t(shot?shotLabel:label);
      target.classList.toggle('drop-hover',!!(shot||asset||external));
    });
    target.addEventListener('dragleave',e=>{if(!target.contains(e.relatedTarget))target.classList.remove('drop-hover');});
    target.addEventListener('drop',async e=>{escapeDrop(e);target.classList.remove('drop-hover');try{await handler(e);}catch(err){message(errorText(err,t),true);}});
  }
  async function addFiles(files,place='library'){
    const accepted=[...files], targetShot=current()?.id;if(!accepted.length)return;
    if(!busy)mediaError=null;
    for(const file of accepted){
      const kind=/^image\//.test(file.type)||/\.(png|jpe?g|webp|bmp)$/i.test(file.name)?'image':/^(audio|video)\//.test(file.type)||/\.(wav|mp3|flac|m4a|ogg|aac|mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)?'audio':null;
      if(!kind){retainMediaError(t('mediaOnly',file.name));checks();continue;}
      if(place!=='library'&&kind!==(place==='audio'?'audio':'image')){
        retainMediaError(t(place==='audio'?'audioDropOnly':'imageDropOnly',file.name));checks();continue;
      }
      busy++;
      try{
        checks();
        const uploaded=await upload(file,kind);
        if(closed)break;
        const asset={id:uid('asset'),label:file.name,kind,file:uploaded.file};
        if(kind==='audio'){asset.duration=uploaded.duration;if(!Number.isFinite(asset.duration)||asset.duration<=0)throw new Error(t('audioDurationMissing'));}
        mutate(()=>{
          p.assets.push(asset);
          if(kind==='audio'&&place==='audio'){try{placeAudio(asset.id,0);}catch(e){retainMediaError(errorText(e,t));}}
          else if(place==='first')p.first_image=asset.id;
          else if(place==='shot'){const target=p.shots.find(s=>s.id===targetShot);if(target)assignImage(asset.id,target);}
          else if(place==='newshot'){const s=insertShot(p);assignImage(asset.id,s);selected=s.id;}
          if(uploaded.peaks)waves.set(asset.id,uploaded.peaks);
        },{onError:e=>retainMediaError(errorText(e,t))});
      }catch(e){if(!closed)retainMediaError(t('uploadFailed',errorText(e,t)));}
      finally{busy--;if(!closed)checks();}
    }
  }
  function filePicker(){const f=el('input');f.type='file';f.multiple=true;f.accept='image/png,image/jpeg,image/webp,image/bmp,audio/*,video/*,.flac,.m4a,.mkv';f.onchange=()=>addFiles(f.files);f.click();}
  function dropAsset(e){return e.dataTransfer?.getData('application/x-h3ez-asset')||null;}
  function assignImage(id,shot){const slot=registerReference(p,id);if(shot.refs===null)shot.refs=[...p.global_refs];if(!shot.refs.includes(slot))shot.refs.push(slot);shot.refs.sort((a,b)=>a-b);}
  function assignSharedImage(id){
    const slot=registerReference(p,id);
    if(!p.global_refs.includes(slot))p.global_refs.push(slot);
    p.global_refs.sort((a,b)=>a-b);
  }
  function placeAudio(id,at){
    const c=placeFullAudio(p,id,at);selectedAudio=c.id;selectionKind='audio';
  }

  function retainMediaError(text){mediaError={text};}
  function placeExistingAudio(id,at,strict=false){
    if(!busy)mediaError=null;
    mutate(()=>placeAudio(id,at),{strict,onError:e=>retainMediaError(errorText(e,t))});
  }
  async function replaceFile(asset,file){
    if(!file)return;
    if(!busy)mediaError=null;
    busy++;
    const fail=e=>{if(!closed)retainMediaError(t('replaceFailed',errorText(e,t)));};
    try{
      checks();
      const result=await upload(file,asset.kind);if(closed)return;
      mutate(()=>{
        const a=mediaAsset(asset.id);if(!a)return;
        a.file=result.file;a.label=file.name;if(a.kind==='audio')a.duration=result.duration;
        validate(p);
        waves.delete(a.id);if(result.peaks)waves.set(a.id,result.peaks);
      },{onError:fail});
    }catch(e){fail(e);}finally{busy--;if(!closed)checks();}
  }
  function replacePicker(asset){const f=el('input');f.type='file';f.accept=asset.kind==='image'?'image/png,image/jpeg,image/webp,image/bmp':'audio/*,video/*,.flac,.m4a,.mkv';f.onchange=()=>replaceFile(asset,f.files[0]);f.click();}
  const assetUsage=new Map();
  function updateAssetUsage(shot,index){
    const roles=new Map();
    const add=(id,key)=>{
      if(!id)return;
      if(!roles.has(id))roles.set(id,[]);
      roles.get(id).push(t(key));
    };
    add(firstFor(p,index),'mediaUseStart');
    add(shot.last_image,'mediaUseEnd');
    for(const slot of refsFor(p,shot))add(p.reference_slots[slot-1],shot.refs==null?'mediaUseShared':'mediaUseShot');
    for(const id of new Set(p.audio.map(clip=>clip.asset_id)))add(id,'mediaUseAudio');
    for(const [id,badge] of assetUsage){
      const label=roles.get(id)?.join(' · ')??'';
      badge.textContent=label;
      badge.hidden=!label;
    }
  }
  function renderLibrary(){
    assetUsage.clear();
    library.replaceChildren(el('h3','',t('media')));
    const hasAssets=p.assets.length>0;
    const drop=el('div',hasAssets?'ez-drop ez-drop-compact':'ez-drop',t(hasAssets?'dropMediaCompact':'dropMedia'));
    if(!hasAssets)drop.append(el('div','ez-help',t('chooseFile')));
    drop.tabIndex=0;drop.role='button';drop.onclick=filePicker;
    drop.onkeydown=e=>{if(e.key==='Enter'||e.code==='Space'){e.preventDefault();e.stopPropagation();filePicker();}};
    bindDrop(drop,e=>addFiles(e.dataTransfer.files));
    const assets=el('div','ez-assets');
    for(const a of p.assets){
      const card=el('div','ez-asset');card.draggable=true;card.dataset.assetId=a.id;card.title=a.label;
      card.ondragstart=e=>{e.dataTransfer.setData('application/x-h3ez-asset',a.id);e.dataTransfer.effectAllowed='copy';};
      if(a.kind==='audio'){card.draggable=false;card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',t('audioClip',a.label));card.title=t('audioLibraryHelp');card.onkeydown=e=>{if(e.target===card&&(e.key==='Enter'||e.code==='Space')){e.preventDefault();e.stopPropagation();placeExistingAudio(a.id,playhead);}};bindLibraryAudioDrag(card,a);}
      if(a.kind==='image')card.append(img(a.id));else card.append(el('div','ez-audio-icon','♫'));
      if(a.kind==='image'){
        const name=el('input','ez-subject-name');name.value=a.subject_name||'';name.placeholder=mediaLabel(p,a,locale);name.maxLength=80;
        name.title=t('subjectNameHelp');name.setAttribute('aria-label',t('nameAsset',a.label));name.onchange=()=>mutate(()=>a.subject_name=name.value.trim(),{strict:true});
        name.onpointerdown=e=>e.stopPropagation();name.ondblclick=e=>e.stopPropagation();name.ondragstart=e=>e.preventDefault();card.append(name);
      }else card.append(el('span','ez-asset-name',a.label),el('span','ez-help',stamp(a.duration)));
      const usage=el('span','ez-asset-usage');
      usage.hidden=true;
      assetUsage.set(a.id,usage);
      card.append(usage);
      const rm=btn('×',async e=>{
        e.stopPropagation();
        if(await confirmMediaRemoval(a)&&!closed)mutate(()=>removeAsset(p,a.id));
      },'ez-remove');
      rm.title=t('unlinkMedia');rm.setAttribute('aria-label',t('removeAssetLabel',a.kind==='image'?mediaLabel(p,a,locale):a.label));
      card.append(rm);const replace=btn('↻',e=>{e.stopPropagation();replacePicker(a);},'ez-replace');replace.title=t('replaceMedia');replace.setAttribute('aria-label',t('replaceAssetLabel',a.label));card.append(replace);
      card.ondblclick=()=>a.kind==='image'?mutate(()=>assignImage(a.id,current())):placeExistingAudio(a.id,playhead);
      assets.append(card);
    }
    library.title=t('mediaHelp');library.append(drop,btn(t('addMedia'),filePicker),assets);applyUIHelp(library,locale);
  }
  function previewAsset(){
    const shots=geometry(p);
    if(playhead>=(shots.at(-1)?.end??0))return {asset:null,fallback:false,shot:null};
    const index=shots.findIndex(g=>playhead<g.end);
    const i=index===-1?shots.length-1:index;
    const shot=p.shots[i];
    const reference=p.reference_slots[(refsFor(p,shot)[0]||0)-1];
    const assigned=mediaAsset(shot.first_image || (i===0?p.first_image:null) || reference || firstFor(p,i));
    if(assigned)return {asset:assigned,fallback:false,shot};
    const end=mediaAsset(shot.last_image);
    if(end)return {asset:end,fallback:false,end:true,shot};
    return {asset:p.assets.find(a=>a.kind==='image'),fallback:true,shot};
  }
  function renderPreview(){
    pause();preview.replaceChildren();
    const first=el('div','ez-first-global');
    first.title=t('dropStart');
    if(p.first_image){first.append(img(p.first_image),el('span','ez-help',t('compactStartAssigned')),btn('×',()=>mutate(()=>p.first_image=null),'quiet'));}
    else first.append(el('span','ez-help',t('compactStart')));
    bindDrop(first,async e=>{const id=dropAsset(e);if(id){if(mediaAsset(id)?.kind!=='image')return;mutate(()=>p.first_image=id);}else await addFiles(e.dataTransfer.files,'first');},{label:'dropStartAction',kind:'image'});
    monitorObserver?.disconnect();monitor=el('div','ez-monitor');monitorFrame=el('div','ez-media-frame');monitorImage=el('img');monitorImage.alt=t('layoutPreview');resultLabel=el('div','ez-monitor-label');monitorFrame.append(monitorImage,video,resultLabel);monitor.append(monitorFrame);
    monitorObserver=new ResizeObserver(()=>fitMonitor());monitorObserver.observe(monitor);
    monitorImage.addEventListener('load',fitMonitor);
    const transport=el('div','ez-preview-tools'),play=btn(playing?'❚❚':'▶',()=>{playing?pause():playback();play.textContent=playing?'❚❚':'▶';});playControl=play;play.setAttribute('aria-label',t('playPause')); clockLabel=el('span','ez-help');
    const startButton=btn(t('seekStart'),()=>{
      if(resultActive()&&!resultMatches){
        video.currentTime=0;
        updatePlayhead();
      }else seek(0);
    });
    const loopButton=btn(t('loopPreview'),()=>{
      previewLoop=!previewLoop;
      refreshLoopButton();
      syncVideoLoop();
    });
    const refreshLoopButton=()=>{
      loopButton.classList.toggle('selected',previewLoop);
      loopButton.setAttribute('aria-pressed',String(previewLoop));
    };
    loopButton.title=t('loopPreviewHelp');
    refreshLoopButton();
    transport.append(play,startButton,loopButton,clockLabel);
    const common=el('div','ez-ref-strip');common.title=t('dropCommonHint');
    for(const slot of p.global_refs){const aid=p.reference_slots[slot-1],name=mediaAsset(aid)?.label||t('referenceImage');const b=btn('',()=>mutate(()=>p.global_refs=p.global_refs.filter(x=>x!==slot),{strict:true}),'ez-ref-chip');b.append(img(aid));b.title=t('removeNamedRef',name);b.setAttribute('aria-label',b.title);common.append(b);}
    common.prepend(el('span','ez-help',t('compactCommon')));
    bindDrop(common,e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>assignSharedImage(id));},{label:'dropSharedAction',kind:'image',assetOnly:true});
    resultToggle=btn(t('resultPreview'),()=>{
      pause();
      previewMode=resultMatches?'auto':'previous';
      if(runMatches()&&!partialAt(playhead)&&generation.clips.length)playhead=generation.clips[0].start;
      updateResultState();
      if(resultMatches)seek(playhead);
    });
    transport.append(btn(t('layoutMode'),()=>{pause();previewMode='layout';updateResultState();}),resultToggle);
    const volume=el('div','ez-volume-control ez-preview-volume'),level=el('input'),percent=el('output','ez-volume-percent');
    volume.setAttribute('role','group');volume.setAttribute('aria-label',t('previewVolume'));
    level.type='range';level.min=0;level.max=100;level.step=1;level.setAttribute('aria-label',t('previewVolume'));level.title=t('previewVolumeHelp');
    const mute=btn('',()=>{if(previewMuted||previewVolume===0){previewMuted=false;if(previewVolume===0)previewVolume=previewLastVolume;}else previewMuted=true;refreshVolume();});
    const refreshVolume=()=>{const silent=previewMuted||previewVolume===0;mute.textContent=silent?'🔇':'🔊';mute.classList.toggle('selected',silent);mute.setAttribute('aria-pressed',String(silent));mute.setAttribute('aria-label',t(silent?'unmutePreview':'mutePreview'));mute.title=t(silent?'unmutePreview':'mutePreview')+' · '+t('previewVolumeHelp');level.value=Math.round(previewVolume*100);percent.textContent=level.value+'%';level.setAttribute('aria-valuetext',percent.textContent);updatePreviewAudio();};
    refreshPreviewVolume=refreshVolume;
    level.oninput=()=>{previewVolume=Number(level.value)/100;if(previewVolume>0)previewLastVolume=previewVolume;previewMuted=false;refreshVolume();};
    volume.append(mute,level,percent);transport.append(volume);refreshVolume();
    const sources=el('div','ez-preview-sources');
    sources.append(first,common);
    preview.append(monitor,transport,sources);
    updateResultState();
  }
  function renderResolution(){
    const box=el('div','ez-resolution');
    box.setAttribute('role','group');
    box.setAttribute('aria-label',t('resolutionTitle'));
    const r=p.resolution||{...studioResolutionDefaults};
    const size=el('span','ez-resolution-size','—');size.setAttribute('aria-live','polite');
    if(r.source==='engine'){
      const dims=assistIdentity().outputSize;
      size.textContent=dims?`${dims.width} × ${dims.height}`:t('sizeAtRun');
      box.append(el('span','ez-help',t('engineSize')),size);box.title=t('sizeExternalHelp');return box;
    }
    const usingImage=r.aspect==='image';
    const options=ASPECT_RATIOS.map(value=>[value,value]);
    if(usingImage){
      let ratio='—';
      try{ratio=resolutionAspect(r);}catch{/* The editor can still switch to a preset. */}
      options.unshift(['image',t('imageAspect',ratio)]);
    }
    const aspect=select(options,r.aspect,value=>{
      if(value==='image')return;
      mutate(()=>{p.resolution={source:'studio',aspect:value,megapixels:r.megapixels};},{strict:true});
    });
    aspect.setAttribute('aria-label',t('aspectRatio'));
    aspect.title=t('aspectRatio');
    const fit=btn((usingImage?'✓ ':'')+t('fitImage'),()=>void chooseImageAspect(fit),'ez-fit-image'+(usingImage?' selected':''));
    fit.disabled=!p.assets.some(asset=>asset.kind==='image');
    fit.title=t(fit.disabled?'fitImageEmpty':usingImage?'fitImageActive':'fitImageHelp');
    if(usingImage)fit.setAttribute('aria-label',t('fitImageActiveLabel'));
    box.append(aspect,fit);
    const showSize=({width,height})=>{
      size.textContent=`${width} × ${height}`;
      size.title=t('calculatedSize',width,height);
    };
    box.title=t('sizeRounding');
    const mp=inputNumber(r.megapixels,v=>{
      if (r.source==='studio' && v===r.megapixels) return;
      mutate(()=>{p.resolution={...r,source:'studio',megapixels:v};},{strict:true});
    },.01,16,.01);
    mp.setAttribute('aria-label',t('megapixels'));
    mp.title=t('megapixels');
    const display=value=>{
      try{
        showSize(resolutionSize({...r,megapixels:value}));
      }catch(e){
        size.textContent='—';
        size.title=errorText(e,t);
      }
    };
    mp.addEventListener('input',()=>{
      const megapixels=mp.valueAsNumber;
      display(megapixels);
      if (!Number.isFinite(megapixels) || megapixels<.01 || megapixels>16) return;
      if (r.source==='studio' && megapixels===r.megapixels) return;
      history.record(clone(p));
      Object.assign(r,{source:'studio',megapixels});
      p.resolution={...r};
      checks();
    });
    display(r.megapixels);
    box.append(field('MP',mp),size);
    return box;
  }
  function loadSizeImage(picture,asset){
    return new Promise((resolve,reject)=>{
      picture.onload=()=>resolve(picture);
      picture.onerror=()=>reject(new Error(t('imageSizeReadError')));
      picture.src=mediaUrl(asset);
    });
  }
  async function chooseImageAspect(trigger){
    const images=p.assets.filter(asset=>asset.kind==='image');
    if(!images.length)return;
    const origin=p,originalResolution=p.resolution;
    const megapixels=originalResolution?.megapixels??studioResolutionDefaults.megapixels;
    const imageResolution=ratio=>({source:'studio',aspect:'image',megapixels,image_aspect:ratio});
    const applyAspect=(asset,file,ratio)=>{
      if(closed||p!==origin||p.resolution!==originalResolution||mediaAsset(asset.id)?.file!==file)return false;
      const current=p.resolution;
      if(current?.aspect==='image'&&current.image_aspect===ratio)return true;
      let failure;
      mutate(()=>{
        p.resolution=imageResolution(ratio);
      },{strict:true,onError:error=>{failure=error;}});
      if(failure)throw failure;
      inspector.querySelector('.ez-fit-image')?.focus({preventScroll:true});
      return true;
    };
    if(images.length===1){
      const asset=images[0],file=asset.file;
      trigger.disabled=true;trigger.setAttribute('aria-busy','true');
      try{
        const picture=await loadSizeImage(new Image(),asset);
        applyAspect(asset,file,imageAspectFromDimensions(picture.naturalWidth,picture.naturalHeight));
      }catch(e){if(!closed&&p===origin)message(errorText(e,t),true);}
      finally{trigger.disabled=false;trigger.removeAttribute('aria-busy');}
      return;
    }

    const d=el('dialog','h3ez-import ez-project-confirm ez-image-fit-dialog');d.lang=locale;
    d.setAttribute('aria-label',t('fitImage'));
    const heading=el('header','ez-dialog-heading'),x=btn('×',()=>d.close(),'ez-close');
    x.title=t('close');x.setAttribute('aria-label',t('close'));
    heading.append(el('h3','',t('fitImage')),x);
    const row=el('div','ez-ai-ref-choice'),preview=el('div','ez-fit-thumb');
    const caption=el('p','ez-fit-caption',t('fitImageChoose'));caption.setAttribute('role','status');
    const choice=select([['',t('fitImageChoose')],...images.map(asset=>[asset.id,mediaLabel(p,asset,locale)])],'',()=>void previewAspect());
    choice.setAttribute('aria-label',t('fitImageChoose'));
    const actions=el('div','ez-import-actions');
    const apply=btn(t('fitImageApply'),()=>{
      if(!selection)return;
      const {asset,file,ratio}=selection;
      try{
        if(applyAspect(asset,file,ratio)){d.close();inspector.querySelector('.ez-fit-image')?.focus({preventScroll:true});}
        else caption.textContent=t('fitImageChanged');
      }catch(e){caption.textContent=errorText(e,t);}
      selection=null;apply.disabled=true;
    },'primary');
    apply.disabled=true;
    let selection=null,request=0;
    async function previewAspect(){
      const attempt=++request,asset=mediaAsset(choice.value);
      selection=null;apply.disabled=true;preview.replaceChildren();
      caption.textContent=t(asset?'fitImageLoading':'fitImageChoose');
      if(!asset)return;
      const file=asset.file,picture=el('img');picture.alt=mediaLabel(p,asset,locale);
      preview.append(picture);
      try{
        await loadSizeImage(picture,asset);
        if(!d.open||request!==attempt)return;
        const ratio=imageAspectFromDimensions(picture.naturalWidth,picture.naturalHeight);
        const {width,height}=resolutionSize(imageResolution(ratio));
        selection={asset,file,ratio};apply.disabled=false;
        caption.textContent=t('fitImageDimensions',ratio,width,height);
      }catch(e){if(d.open&&request===attempt)caption.textContent=errorText(e,t);}
    }
    row.append(preview,choice);
    actions.append(btn(t('cancel'),()=>d.close()),apply);
    d.append(heading,row,caption,actions);
    d.addEventListener('keydown',e=>e.stopPropagation());
    d.addEventListener('cancel',e=>e.stopPropagation());
    d.addEventListener('close',()=>d.remove(),{once:true});
    dialog.append(d);d.showModal();choice.focus();
  }
  function editLabel(s){const e=el('input');e.value=s.label;e.setAttribute('aria-label',t('shotName'));e.onchange=()=>mutate(()=>s.label=e.value);return e;}
  if(assist){
    assistPanel=createAssistPanel({client:assist,getState:assistState,locale,
      onMissingReferences:confirmAIReferences,
      onAdopt:entry=>{let error;mutate(()=>activateEntry(p,entry),{strict:true,onError:e=>{error=e;}});if(error)throw error;},
      onRestore:target=>mutate(()=>restoreOriginal(p,target),{strict:true}),
      onRestoreAll:()=>mutate(()=>{for(const entry of p.prompt_enhancer?.texts||[])entry.inactive=true;},{strict:true})});
    assistPanel.restoreDraftEdits(restoredDraft?.aiEdits);
    editTools.append(assistPanel.global);
  }
  function renderInspector(){
    assistPanel?.beginRender();
    inspector.replaceChildren();const s=current();if(!s)return;
    const index=p.shots.indexOf(s),g=geometry(p)[index];
    updateAssetUsage(s,index);
    const title=el('div','ez-row ez-shot-title');title.append(editLabel(s),field(t('targetSeconds'),inputNumber(Number(s.seconds.toFixed(3)),n=>mutate(()=>s.seconds=n,{strict:true}),2,MAX_SHOT_SECONDS,.1)),
      select([['continue',t('continuePrevious')],['cut',t('cut')]],index===0?'cut':s.transition,v=>mutate(()=>{if(v==='continue'&&s.first_image)throw new Error(t('removeStartToContinue'));s.transition=v;})));
    title.querySelector('input[type=number]').classList.add('ez-seconds');
    title.lastChild.disabled=index===0;title.lastChild.setAttribute('aria-label',locale==='ja'?'ショット境界':'Shot boundary');title.lastChild.title=index===0?(locale==='ja'?'最初のショットは場面転換です。':'The first shot starts a new scene.'):(locale==='ja'?'前の映像を継続するか、新しい場面から開始するか選びます。':'Continue the previous video or start a new scene.');
    const timing=el('div','ez-help ez-shot-timing',t('shotTiming',g.seconds.toFixed(2),stamp(g.start),stamp(g.end)));
    timing.title=[t('timeFrames',g.frames,g.start.toFixed(3),g.end.toFixed(3)),t('shotTimingHelp')].join('\n');
    const internalParts=executionPlan(p).filter(x=>x.shot_id===s.id);
    if(internalParts.length>1){timing.append(' · '+t('autoParts',internalParts.length));timing.title+='\n'+t('autoPartsHelp');}
    const tabs=el('div','ez-row ez-prompt-tabs');
    for(const [key,label] of [['shot',t('shotPromptTab')],['global',t('commonPrompt')],['effective',t('effectivePrompt')]]){
      const tab=btn(label,()=>{promptTab=key;renderInspector();},`ez-tab-${key}`+(promptTab===key?' selected':''));
      tab.setAttribute('aria-pressed',String(promptTab===key));
      if(key==='shot')tab.title=[t('shotPromptHelp'),t('autoPromptHelp'),t('noShortening')].join('\n');
      if(key==='global')tab.title=[t('commonPromptHelp'),t('commonSyncHelp')].join('\n');
      tabs.append(tab);
    }
    const references=el('div','ez-shot-references');
    const refMode=select([['inherit',t('inheritRefs')],['custom',t('customRefs')]],s.refs===null?'inherit':'custom',v=>mutate(()=>{
      if(v==='inherit'){
        previousShotRefs.set(s.id,s.refs.map(slot=>[slot,p.reference_slots[slot-1]]));
        s.refs=null;
      }else{
        const previous=previousShotRefs.get(s.id);
        s.refs=previous ? previous.filter(([slot,asset])=>p.reference_slots[slot-1]===asset).map(([slot])=>slot) : [...p.global_refs];
      }
    },{strict:true}));
    refMode.setAttribute('aria-label',t('referenceSource'));
    const strip=el('div','ez-ref-strip');
    const selectedRefs=refsFor(p,s);
    strip.setAttribute('aria-label',t('referenceImages'));
    for(const asset of p.assets.filter(a=>a.kind==='image')){
      const aid=asset.id,slot=p.reference_slots.indexOf(aid)+1,active=slot>0&&selectedRefs.includes(slot);
      const b=btn('',()=>mutate(()=>{const r=registerReference(p,aid);if(s.refs===null)s.refs=[...p.global_refs];s.refs=s.refs.includes(r)?s.refs.filter(n=>n!==r):[...s.refs,r].sort((a,b)=>a-b);},{strict:true}),'ez-ref-chip'+(active?' selected':''));
      const label=mediaLabel(p,asset,locale);
      b.append(img(aid),el('span','ez-ref-name',label));
      b.setAttribute('aria-pressed',String(active));
      b.setAttribute('aria-label',t('referenceNamed',label));
      b.title=t(active?'referenceSelected':'referenceUnselected',label)+'\n'+mediaHelp(p,asset,locale);
      strip.append(b);
    }
    if(!p.assets.some(a=>a.kind==='image'))strip.append(el('span','ez-help',t('dropShotRef')));
    bindDrop(strip,async e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>assignImage(id,s));else if(e.dataTransfer.files.length)await addFiles(e.dataTransfer.files,'shot');},{label:'dropShotAction',kind:'image'});
    const modeRow=el('div','ez-row ez-prompt-actions');
    if(promptTab!=='global'){
      const usesCommon=s.prompt_mode!=='replace';
      const include=btn(t(usesCommon?'commonPromptOn':'commonPromptOff'),()=>{
        mutate(()=>s.prompt_mode=usesCommon?'replace':'append');
        inspector.querySelector('.ez-use-common')?.focus({preventScroll:true});
      },'ez-use-common'+(usesCommon?' selected':''));
      include.setAttribute('aria-pressed',String(usesCommon));
      include.title=t('useCommonPromptHelp');
      modeRow.append(include);
    }
    const toggleEditor=btn(t(focusMode?'returnToTimeline':'expandEditor'),()=>{
      focusMode=!focusMode;
      renderLayout();
      inspector.querySelector('.ez-toggle-editor')?.focus({preventScroll:true});
    },'ez-toggle-editor');
    modeRow.append(toggleEditor);
    const shotControls=el('div','ez-shot-controls');
    const setup=el('div','ez-shot-setup');
    setup.append(title,renderResolution());
    references.append(strip);
    strip.tabIndex=0;
    strip.setAttribute('role','group');
    const context=el('div','ez-shot-context');
    context.append(refMode,timing);
    shotControls.append(setup,context,references);
    const toolbar=el('div','ez-prompt-toolbar');
    const target=el('span','ez-prompt-target',promptTab==='global'?t('editingShared'):promptTab==='effective'?t('viewingShot',s.label):t('editingShot',s.label));
    target.title=target.textContent;
    toolbar.append(tabs,target,modeRow);
    inspector.append(shotControls,toolbar);
    const extras=el('section','ez-shot-extras');
    extras.setAttribute('aria-label',t('shotDialogue'));
    const dialogueHead=el('div','ez-row ez-dialogue-head');
    const addLine=btn(t('addDialogue'),()=>{
      mutate(()=>{s.dialogue??=[];if(s.dialogue.length>=32)throw new Error(t('dialogueLimit'));s.dialogue.push({speaker:null,text:'',at:null});});
      [...inspector.querySelectorAll('.ez-dialogue-row textarea')].at(-1)?.focus();
    });
    addLine.title=t('dialogueHelp');addLine.disabled=(s.dialogue?.length||0)>=32;
    addLine.classList.add('ez-dialogue-add');dialogueHead.append(addLine);extras.append(dialogueHead);
    const endRow=el('div','ez-end-image');
    const endSelect=select([['',t('noEndImage')],...p.assets.filter(a=>a.kind==='image').map(a=>[a.id,mediaLabel(p,a,locale)])],s.last_image||'',value=>mutate(()=>s.last_image=value||null));
    endSelect.setAttribute('aria-label',t('endImage'));endSelect.title=t('endImageHelp');
    endRow.append(field(t('endImage'),endSelect));if(s.last_image)endRow.append(img(s.last_image));
    bindDrop(endRow,e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>s.last_image=id);},{label:'dropEndAction',kind:'image',assetOnly:true});
    context.insertBefore(endRow,timing);
    for(const [lineIndex,line] of (s.dialogue||[]).entries()){
      const row=el('div','ez-dialogue-row');
      const who=select([['',t('narrator')],...p.assets.filter(a=>a.kind==='image').map(a=>[a.id,mediaLabel(p,a,locale)])],line.speaker||'',value=>mutate(()=>{line.speaker=value||null;if(value)assignImage(value,s);},{strict:true}));
      who.setAttribute('aria-label',t('speaker',lineIndex+1));who.title=t('speakerHelp');
      const words=el('textarea');words.rows=2;words.value=line.text;words.maxLength=5000;words.setAttribute('aria-label',t('dialogueText',lineIndex+1));words.placeholder=t('dialoguePlaceholder');
      let dialogueBefore=null;
      words.onfocus=()=>dialogueBefore=clone(p);
      words.oninput=()=>{dialogueBefore??=clone(p);line.text=words.value;deferredChecks();updateCompiled();};
      words.onblur=()=>{if(dialogueBefore&&JSON.stringify(dialogueBefore)!==JSON.stringify(p)){history.record(dialogueBefore);dialogueBefore=null;checks();}};
      const timingInput=el('input');timingInput.type='number';timingInput.min=0;timingInput.max=g.seconds;timingInput.step=.1;
      timingInput.value=line.at??'';timingInput.placeholder=t('automatic');timingInput.setAttribute('aria-label',t('dialogueTime',lineIndex+1));timingInput.title=t('dialogueTimeHelp');
      // Blank means automatic placement, while 0 is an explicit start time.
      timingInput.onchange=()=>mutate(()=>line.at=timingInput.value===''?null:timingInput.valueAsNumber,{strict:true});
      const remove=btn('×',()=>mutate(()=>s.dialogue.splice(lineIndex,1)));remove.title=t('removeDialogue');remove.setAttribute('aria-label',t('removeDialogue'));
      row.append(who,words,timingInput,remove);extras.append(row);
    }
    const usesExternal=()=>externalConnected&&p.prompt_source!=='studio';
    const sourceNote=el('span','ez-help ez-common-source-note');
    let sourceSelect=null,compiledArea=null,compiledPart=0;
    function updateSource(){
      if(sourceSelect)sourceSelect.value=p.prompt_source==='studio'?'studio':'external';
      sourceNote.textContent=usesExternal()?t(lastExternal===null?'externalCommonPending':'externalCommonPreview'):'';
    }
    if(externalConnected&&promptTab==='global'){
      const sourceRow=el('div','ez-common-source');
      sourceSelect=select([['studio',t('sourceStudioPrompt')],['external',t('sourceExternalPrompt')]],p.prompt_source==='studio'?'studio':'external',v=>mutate(()=>p.prompt_source=v));
      sourceSelect.setAttribute('aria-label',t('commonSource'));sourceSelect.title=t('commonSourceHelp');
      sourceNote.title=t('commonSyncHelp');sourceRow.append(sourceSelect,sourceNote);inspector.append(sourceRow);
    }
    function updateCompiled(){
      if(!compiledArea)return;
      try{compiledArea.value=effective(p,index,externalConnected?lastExternal:null,compiledPart,assistState().outputSize).text;}catch(e){compiledArea.value=errorText(e,t);}
    }
    function editor(part){
      const common=part==='global',wrap=el('div','ez-prompt-block'+(common?' ez-common-block':''));
      const area=el('textarea','ez-prompt');area.spellcheck=false;
      area.setAttribute('aria-label',t(common?'commonPromptLabel':'shotPromptLabel'));
      area.placeholder=t(common?'commonPlaceholder':'shotPlaceholder');
      area.value=common?commonPrompt(p,externalConnected?lastExternal:null):s.prompt;
      const counter=el('span','ez-help ez-character-count');counter.title=t('characterUsageHelp');
      const count=()=>{counter.textContent=t('characterUsage',area.value.length.toLocaleString(locale),(250000).toLocaleString(locale));if(!common){const caption=[...timeline.querySelectorAll('.ez-shot')].find(card=>card.dataset.shotId===s.id)?.querySelector('.ez-shot-prompt');if(caption)caption.textContent=area.value.trim().slice(0,45)||t('usingCommon');}};count();
      let beforeText=null;
      area.onfocus=()=>{beforeText=clone(p);};
      area.oninput=()=>{
        beforeText??=clone(p);
        editPrompt(p,index,part,area.value);count();updateSource();updateCompiled();
        deferredChecks();
      };
      area.onblur=()=>{if(beforeText&&JSON.stringify(beforeText)!==JSON.stringify(p)){history.record(beforeText);beforeText=null;checks();}};
      wrap.append(area);
      if(assistPanel)wrap.append(assistPanel.bind({target:common?{field:'global_prompt'}:{field:'prompt',shot_id:s.id},area,wrap,counter,onDisplay:count}));
      else wrap.append(counter);
      return wrap;
    }
    if(promptTab==='effective'){
      const compiled=el('div','ez-prompt-block ez-compiled');
      const heading=el('div','ez-row ez-compiled-heading');
      if(internalParts.length>1){const partSelect=select(internalParts.map(x=>[String(x.part_index),t('internalPart',x.part_index+1,internalParts.length)]),'0',v=>{compiledPart=Number(v);updateCompiled();});partSelect.setAttribute('aria-label',t('internalPartSelect'));heading.append(partSelect);}
      if(heading.childElementCount)compiled.append(heading);
      if(usesExternal()&&s.prompt_mode!=='replace')compiled.append(el('span','ez-help',t(lastExternal===null?'externalNotRun':'externalLastRun')));
      compiledArea=el('textarea','ez-prompt');compiledArea.readOnly=true;compiledArea.spellcheck=false;compiledArea.setAttribute('aria-label',t('compiledPromptLabel'));
      compiled.append(compiledArea);inspector.append(compiled);updateCompiled();
    }else{
      inspector.append(editor(promptTab));
    }
    updateSource();
    if(promptTab==='shot')inspector.append(extras);
    if(promptTab==='shot'&&s.transition==='cut'&&index>0){
      const key=el('div','ez-first-global');key.append(el('span','ez-help',t('shotStart')));if(s.first_image)key.append(img(s.first_image),btn('×',()=>mutate(()=>s.first_image=null),'quiet'));
      bindDrop(key,e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>s.first_image=id);},{label:'dropStartAction',kind:'image',assetOnly:true});inspector.append(key);
    }
    if(promptTab==='shot'){
      inspector.append(storyPanel({plan:p,shot:s,mutate,locale,mediaUrl,selectedRole:roleSelection.get(s.id),onRole:id=>roleSelection.set(s.id,id),onEdit:deferredChecks,onCommit:before=>{history.record(before);checks();}}));
    }
    assistPanel?.update();
    if(selectedAudio)renderAudioInspector();
    applyUIHelp(inspector,locale);
  }
  function deleteAudio(id){mutate(()=>{p.audio=p.audio.filter(c=>c.id!==id);selectedAudio=null;selectionKind=null;});timeline.focus({preventScroll:true});}
  function deleteSelection(){
    if(selectedAudio){deleteAudio(selectedAudio);return;}
    if(selectionKind!=='shot')return;
    mutate(()=>{if(p.shots.length===1)throw new Error(t('lastShot'));p.shots=p.shots.filter(s=>s.id!==selected);p.shots[0].transition='cut';});timeline.focus({preventScroll:true});
  }
  function confirmAIReferences(targets,batchMode){
    if(closed)return false;
    const target=targets[0],shared=target.field==='global_prompt';
    const shot=shared?null:p.shots.find(s=>s.id===target.shot_id);
    if(!batchMode&&!shared&&!shot)return false;
    return new Promise(resolve=>{
      const d=el('dialog','h3ez-import ez-project-confirm ez-ai-ref-dialog');d.lang=locale;
      d.setAttribute('aria-label',t('aiReferenceTitle'));
      const heading=el('header','ez-dialog-heading'),x=btn('×',()=>d.close(),'ez-close');
      x.title=t('close');x.setAttribute('aria-label',t('close'));
      heading.append(el('h3','',t('aiReferenceTitle')),x);
      const description=batchMode?t('aiReferenceBatch',targets.length):t(shared?'aiReferenceCommon':'aiReferenceShot',shot?.label);
      d.append(heading,el('p','',description));
      const actions=el('div','ez-import-actions'),cancel=btn(t('cancel'),()=>d.close());
      actions.append(cancel,btn(t(batchMode?'aiReferenceContinueBatch':'aiReferenceTextOnly'),()=>d.close('generate'),batchMode?'primary':''));
      if(!batchMode){
        const images=p.assets.filter(a=>a.kind==='image');
        const thumb=el('img');thumb.alt='';
        const error=el('p','ez-ai-error');error.hidden=true;error.setAttribute('role','alert');
        const choice=select([['',t('aiReferenceChoose')],...images.map(a=>[a.id,mediaLabel(p,a,locale)])],images.length===1?images[0].id:'',refreshChoice);
        const use=btn(t('aiReferenceAssign'),()=>{
          const id=choice.value,liveShot=shared?null:p.shots.find(s=>s.id===target.shot_id);
          if(mediaAsset(id)?.kind!=='image'||!shared&&!liveShot)return;
          let failed=false;
          mutate(()=>{if(shared)assignSharedImage(id);else assignImage(id,liveShot);},{strict:true,onError:e=>{
            failed=true;error.textContent=errorText(e,t);error.hidden=false;
          }});
          if(!failed)d.close('generate');
        },'primary');
        function refreshChoice(){
          const asset=mediaAsset(choice.value);
          use.disabled=!asset;thumb.hidden=!asset;
          if(asset){thumb.src=mediaUrl(asset);thumb.title=mediaHelp(p,asset,locale);}
        }
        refreshChoice();
        choice.setAttribute('aria-label',t('aiReferenceChoose'));
        const row=el('div','ez-ai-ref-choice');row.append(thumb,choice);d.append(row,error);
        actions.append(use);
      }
      d.append(actions);
      d.addEventListener('keydown',e=>e.stopPropagation());
      d.addEventListener('cancel',e=>e.stopPropagation());
      d.addEventListener('close',()=>{const accepted=d.returnValue==='generate';d.remove();resolve(accepted);},{once:true});
      dialog.append(d);d.showModal();cancel.focus();
    });
  }
  function confirmMediaRemoval(asset){
    return new Promise(resolve=>{
      const d=el('dialog','h3ez-import ez-remove-media');d.lang=locale;d.setAttribute('aria-label',t('removeMedia'));
      const heading=el('div','ez-dialog-heading'),close=btn('×',()=>d.close(),'ez-close');
      close.title=t('close');close.setAttribute('aria-label',t('close'));
      heading.append(el('h3','',t('removeMedia')),close);
      const name=asset.kind==='image'?mediaLabel(p,asset,locale):asset.label;
      const filename=asset.file?.name||asset.label;
      d.append(heading,el('p','ez-remove-name',name));
      if(filename!==name)d.append(el('div','ez-remove-filename',filename));

      const external=externalConnected&&p.prompt_source!=='studio'?lastExternal:null;
      const usage=describeAssetUsage(p,asset.id,external),list=el('ul','ez-remove-usage');
      if(usage.shared)list.append(el('li','',t('mediaUsageShared')));
      if(usage.first)list.append(el('li','',t('mediaUsageProjectStart')));
      if(usage.commonPrompt)list.append(el('li','',t('mediaUsageCommonPrompt',usage.tag)));
      if(usage.externalPrompt)list.append(el('li','',t('mediaUsageExternalPrompt',usage.tag)));
      for(const shot of usage.shots){
        const locations=[];
        if(shot.first)locations.push(t('mediaUsageStart'));
        if(shot.inheritedFirst)locations.push(t('mediaUsageInheritedStart'));
        if(shot.last)locations.push(t('mediaUsageEnd'));
        if(shot.reference)locations.push(t(shot.reference==='shared'?'mediaUsageInheritedRef':'mediaUsageShotRef'));
        if(shot.role)locations.push(t('mediaUsageRole'));
        if(shot.dialogue.length)locations.push(t('mediaUsageSpeaker',shot.dialogue.join(', ')));
        if(shot.prompt)locations.push(t('mediaUsageShotPrompt',usage.tag));
        if(shot.direction)locations.push(t('mediaUsageDirection',usage.tag));
        const row=el('li');row.append(el('strong','',t('mediaUsageShot',shot.index+1,shot.label)),el('div','',locations.join(' · ')));list.append(row);
      }
      for(const clip of usage.audio)list.append(el('li','',t('mediaUsageClip',stamp(clip.start),stamp(clip.start+clip.duration))));
      if(list.childElementCount){
        const label=el('h4','',t('mediaUsageHeading'));label.id=uid('media-usage');
        list.tabIndex=0;list.setAttribute('aria-labelledby',label.id);d.append(label,list);
      }else d.append(el('p','ez-remove-note',t('mediaUnused')));
      d.append(el('p','ez-remove-note',t('removeMediaConfirm')));
      if(usage.shots.some(shot=>shot.dialogue.length))d.append(el('p','ez-remove-note',t('mediaSpeakerFallback')));
      if(usage.commonPrompt||usage.externalPrompt||usage.shots.some(shot=>shot.prompt||shot.direction))d.append(el('p','ez-remove-note',t('mediaPromptTagNote',usage.tag)));

      const actions=el('div','ez-import-actions'),cancel=btn(t('cancel'),()=>d.close());
      actions.append(cancel,btn(t('removeMedia'),()=>d.close('remove'),'primary'));d.append(actions);
      d.addEventListener('keydown',e=>e.stopPropagation());
      d.addEventListener('cancel',e=>e.stopPropagation());
      d.addEventListener('close',()=>{const yes=d.returnValue==='remove';d.remove();resolve(yes);},{once:true});
      dialog.append(d);d.showModal();cancel.focus();
    });
  }
  function bindLibraryAudioDrag(card,asset){
    card.onpointerdown=e=>{
      if(e.button!==0||e.target.closest('button,input'))return;e.preventDefault();card.setPointerCapture(e.pointerId);
      const x=e.clientX,y=e.clientY;let ghost=null;
      let hoveredLane=null;
      const move=ev=>{
        if(!ghost&&Math.hypot(ev.clientX-x,ev.clientY-y)>5){ghost=el('div','ez-library-drag',asset.label);dialog.append(ghost);}
        if(!ghost)return;
        ghost.style.left=`${ev.clientX+12}px`;
        ghost.style.top=`${ev.clientY+12}px`;
        const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.ez-audio-lane');
        const lane=target&&timeline.contains(target)?target:null;
        if(lane!==hoveredLane){
          hoveredLane?.classList.remove('drop-hover');
          hoveredLane=lane;
          hoveredLane?.classList.add('drop-hover');
        }
      };
      const cleanup=()=>{card.removeEventListener('pointermove',move);card.removeEventListener('pointerup',finish);card.removeEventListener('pointercancel',cancel);ghost?.remove();hoveredLane?.classList.remove('drop-hover');audioDragCancel=null;};
      const finish=ev=>{
        const dragged=!!ghost;
        cleanup();
        if(!dragged)return;
        const lane=timeline.querySelector('.ez-audio-lane');
        const rect=lane.getBoundingClientRect();
        if(ev.clientX>=rect.left&&ev.clientX<=rect.right&&ev.clientY>=rect.top&&ev.clientY<=rect.bottom){
          placeExistingAudio(asset.id,0,true);
        }
      };
      const cancel=()=>cleanup();audioDragCancel=cancel;card.addEventListener('pointermove',move);card.addEventListener('pointerup',finish);card.addEventListener('pointercancel',cancel);
    };
  }
  function renderAudioInspector(){
    const c=p.audio.find(x=>x.id===selectedAudio);if(!c)return;
    const box=el('div','ez-audio-editor');box.append(el('h3','',t('audioClip',mediaAsset(c.asset_id)?.label||'')));
    const row=el('div','ez-row');
    for(const [key,prop,min] of [['audioStart','start',0],['sourceIn','source_in',0],['length','duration',.001]]){
      const input=inputNumber(Number(c[prop].toFixed(3)),v=>mutate(()=>c[prop]=v,{strict:true}),min,9999,.001);
      input.title=t(key+'Help');row.append(field(t(key),input));
    }
    const trim=audioTrimLength(p,c);
    const fit=btn(t('trimAudioToVideo'),()=>{if(trim!==null)mutate(()=>c.duration=trim,{strict:true});});
    fit.disabled=trim===null;fit.title=t(trim===null?'trimAudioUnavailable':'trimAudioToVideoHelp');
    const split=btn(t('split'),()=>mutate(()=>splitAudio(p,c.id,playhead),{strict:true}));split.title=t('splitAudioHelp');
    const remove=btn(t('deleteAudioClip'),()=>deleteAudio(c.id));remove.title=t('deleteAudioClipHelp');
    row.append(fit,split,remove);box.append(row);inspector.append(box);
    const volume=el('label','ez-field ez-volume-control'),level=el('input'),percent=el('output','ez-volume-percent');let before=null;
    level.type='range';level.min=0;level.max=100;level.step=1;level.value=Math.round((c.volume??1)*100);level.setAttribute('aria-label',t('clipVolume'));level.title=t('clipVolumeHelp');
    const show=()=>{percent.textContent=level.value+'%';level.setAttribute('aria-valuetext',percent.textContent);};show();
    level.oninput=()=>{before??=clone(p);c.volume=Number(level.value)/100;show();updatePreviewAudio();deferredChecks();};
    level.onchange=()=>{if(before){history.record(before);before=null;}renderTimeline();checks();};
    volume.append(el('span','',t('volume')),level,percent);row.insertBefore(volume,row.querySelector('button'));
  }
  function zoomTimeline(factor){
    const pane=timeline.querySelector('.ez-scroll');if(!pane)return;
    const next=Math.max(1,Math.min(8,zoom*factor));if(next===zoom)return;
    const cursor=duration(p)?playhead/duration(p)*timelineWidth:0,visible=cursor>=pane.scrollLeft&&cursor<=pane.scrollLeft+pane.clientWidth;
    const anchor=visible?cursor:pane.scrollLeft+pane.clientWidth/2,offset=anchor-pane.scrollLeft;
    const nextScroll=anchor*next/zoom-offset;zoom=next;renderTimeline(nextScroll);
  }
  function renderTimeline(nextScroll=null){
    const scrollBefore=nextScroll??timeline.querySelector('.ez-scroll')?.scrollLeft??0;
    const focusedZoom=timeline.contains(document.activeElement)?document.activeElement.dataset.zoomAction:null;
    timeline.replaceChildren();const controls=el('div','ez-track-head');
    controls.append(el('h3','',t('timelineDuration',duration(p).toFixed(3))),btn(t('addShot'),()=>mutate(()=>{selected=insertShot(p,p.shots.findIndex(x=>x.id===selected)).id;selectedAudio=null;selectionKind='shot';}),'ez-timeline-add'),
      btn(t('duplicate'),()=>mutate(()=>{if(selectedAudio){selectedAudio=duplicateAudio(p,selectedAudio).id;selectionKind='audio';return;}if(p.shots.length>=16)throw new Error(t('maxShots'));const i=p.shots.indexOf(current()),copy={...clone(current()),id:uid('shot'),label:`${current().label} copy`};p.shots.splice(i+1,0,copy);selected=copy.id;selectedAudio=null;selectionKind='shot';}),'ez-timeline-duplicate'),
      btn(t(selectedAudio?'deleteAudioClip':'deleteShot'),deleteSelection,'ez-timeline-delete'),
      btn('←',()=>{if(!selectedAudio)mutate(()=>moveShot(p,selected,p.shots.indexOf(current())-1));}),btn('→',()=>{if(!selectedAudio)mutate(()=>moveShot(p,selected,p.shots.indexOf(current())+1));}),
      btn(t('splitHere'),()=>mutate(()=>{if(selectedAudio){splitAudio(p,selectedAudio,playhead);return;}const g=geometry(p).find(g=>g.id===selected);splitShot(p,selected,playhead-g.start);})),el('span','spacer'));
    const zoomControls=el('div','ez-zoom-controls');
    const zoomOut=btn('−',()=>zoomTimeline(1/1.25));
    const fit=btn(t('fitTimeline'),()=>{zoom=1;renderTimeline(0);});
    const zoomIn=btn('＋',()=>zoomTimeline(1.25));
    zoomOut.disabled=fit.disabled=zoom<=1;
    zoomIn.disabled=zoom>=8;
    for(const [button,action] of [[zoomOut,'zoomOut'],[fit,'fitTimeline'],[zoomIn,'zoomIn']]){
      button.dataset.zoomAction=action;
      button.setAttribute('aria-label',t(action));
      button.title=t(action+'Help');
      zoomControls.append(button);
    }
    controls.append(zoomControls);
    if(selectedAudio)for(const b of controls.querySelectorAll('button')){if(b.textContent===t('duplicate'))b.title=t('duplicateAudioHelp');if(b.textContent===t('splitHere'))b.title=t('splitAudioHelp');if(b.textContent===t('deleteAudioClip'))b.title=t('deleteAudioClipHelp');if(['←','→'].includes(b.textContent))b.disabled=true;}
    applyUIHelp(controls,locale);
    const scroll=el('div','ez-scroll'),track=el('div','ez-track-content'),ruler=el('div','ez-ruler'),shots=el('div','ez-shot-lane'),audioLane=el('div','ez-audio-lane');
    scroll.append(track);timeline.append(controls,scroll);
    timelineWidth=Math.max(1,scroll.clientWidth)*zoom;track.style.width=`${timelineWidth}px`;const total=duration(p),scale=timelineWidth/total;
    // Keep neighboring labels far enough apart at any zoom and use familiar intervals.
    const minimum=Math.max(.05,72/scale);
    const magnitude=10**Math.floor(Math.log10(minimum));
    const interval=magnitude*[1,2,5,10].find(n=>n*magnitude>=minimum);
    const decimals=Math.max(0,-Math.floor(Math.log10(interval)));
    for(let i=0;i*interval<total;i++){
      const seconds=i*interval;
      const tick=el('span','ez-tick',`${seconds.toFixed(decimals)}s`);
      tick.style.left=`${seconds*scale}px`;
      ruler.append(tick);
    }
    const seekEvent=e=>{const rect=track.getBoundingClientRect();seek(Math.max(0,Math.min(total,(e.clientX-rect.left)/scale)));};
    ruler.onpointerdown=e=>{seekEvent(e);ruler.setPointerCapture(e.pointerId);const move=e=>seekEvent(e);ruler.addEventListener('pointermove',move);ruler.onpointerup=()=>ruler.removeEventListener('pointermove',move);};
    for(const g of geometry(p)){
      const s=p.shots[g.index],card=el('div','ez-shot'+(selected===s.id&&!selectedAudio&&selectionKind==='shot'?' active':''));card.dataset.shotId=s.id;card.style.left=`${g.start*scale}px`;card.style.width=`${Math.max(20,g.seconds*scale-5)}px`;card.draggable=true;
      card.classList.toggle('ez-shot-narrow',g.seconds*scale<112);
      const image=s.first_image || (g.index===0?p.first_image:null) || p.reference_slots[(refsFor(p,s)[0]||0)-1];if(image)card.append(img(image));
      const length=t('shotCard',g.seconds.toFixed(2),t(g.index===0||s.transition==='cut'?'cut':'continued'));
      const prompt=resolveText(p,{field:'prompt',shot_id:s.id},externalConnected?lastExternal:null,assistState().outputSize).text.trim().slice(0,45)||t('usingCommon');
      card.title=[s.label,length,prompt].join('\n');
      card.append(el('strong','',s.label),el('small','ez-shot-duration',length),el('small','ez-shot-prompt',prompt));
      card.onclick=()=>{if(suppressShotClick)return;selected=s.id;selectedAudio=null;selectionKind='shot';seek(g.start);renderInspector();renderTimeline();};
      const state=runMatches()?generation.states[s.id]:samePlan()?{phase:'complete',done:[],total:0}:null;
      if(state){
        const phase=t('status_'+state.phase);
        const count=state.total>1?` · ${state.done.length}/${state.total}`:'';
        const badge=el('span','ez-shot-status '+state.phase,phase+count);
        card.title+='\n'+phase+(state.total?' · '+t('partsDone',state.done.length,state.total):'');
        card.append(badge);
      }
      const thumbs=(runMatches()?generation.thumbnails:samePlan()?resultVideo.thumbnails:[])||[];
      const images=thumbs.filter(x=>x.shot_id===s.id);
      if(images.length){
        card.classList.add('has-filmstrip');const strip=el('div','ez-filmstrip');
        for(const image of images){
          const thumb=btn('',e=>{e.stopPropagation();selected=s.id;selectedAudio=null;selectionKind='shot';previewMode='auto';seek(image.time);renderInspector();renderTimeline();playback();});
          thumb.disabled=runMatches()&&!partialAt(image.time);
          thumb.title=thumb.disabled?t('partialPreviewUnavailable'):t('playAt',stamp(image.time));thumb.setAttribute('aria-label',thumb.title);
          const picture=el('img');picture.src=image.url;picture.alt='';picture.draggable=false;thumb.append(picture);strip.append(thumb);
        }card.append(strip);
      }
      for(const edge of ['left','right']){
        if(edge==='left'&&g.index===0)continue;
        const handle=el('span','ez-shot-handle '+edge);handle.tabIndex=0;handle.setAttribute('role','slider');
        handle.setAttribute('aria-label',t(edge==='left'?'resizeShotLeft':'resizeShotRight',s.label));handle.title=t(edge==='left'?'resizeLeftHelp':'resizeRightHelp');
        handle.setAttribute('aria-valuenow',String(edge==='left'?g.start:g.end));handle.setAttribute('aria-valuemin','0');handle.setAttribute('aria-valuemax','3600');
        bindShotResize(handle,s,scale,edge);card.append(handle);
      }
      card.ondragstart=e=>{e.dataTransfer.setData('application/x-h3ez-shot',s.id);e.dataTransfer.effectAllowed='move';};
      bindDrop(card,async e=>{const source=e.dataTransfer.getData('application/x-h3ez-shot'),aid=dropAsset(e);if(source)mutate(()=>moveShot(p,source,g.index));else if(aid&&mediaAsset(aid)?.kind==='image')mutate(()=>assignImage(aid,s));else if(e.dataTransfer.files.length){selected=s.id;await addFiles(e.dataTransfer.files,'shot');}},{label:'dropShotAction',kind:'image',shotLabel:'dropMoveShotAction'});
      shots.append(card);
      if(g.index>0){
        const cut=s.transition==='cut';
        const marker=el('span',`ez-shot-boundary ${cut?'cut':'continue'}`,cut&&g.seconds*scale>=70?t('cutMarker'):'');
        marker.style.left=`${g.start*scale-2.5}px`;
        marker.setAttribute('aria-hidden','true');
        shots.append(marker);
      }
    }
    bindDrop(shots,async e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>{const s=insertShot(p);assignImage(id,s);selected=s.id;});else if(e.dataTransfer.files.length)await addFiles(e.dataTransfer.files,'newshot');},{label:'dropNewShotAction',kind:'image'});
    if(!p.audio.length)audioLane.append(el('div','ez-audio-empty',t('emptyAudio')));
    bindDrop(audioLane,async e=>{
      const id=dropAsset(e);
      if(id)placeExistingAudio(id,0,true);
      else await addFiles(e.dataTransfer.files,'audio');
    },{label:'dropAudioAction',kind:'audio'});
    for(const c of p.audio){
      const a=mediaAsset(c.asset_id),card=el('div','ez-audio-clip'+(selectedAudio===c.id?' active':''));card.dataset.audioId=c.id;card.tabIndex=0;card.setAttribute('role','option');card.setAttribute('aria-label',t('audioClip',a?.label||''));card.setAttribute('aria-selected',String(selectedAudio===c.id));card.style.left=`${c.start*scale}px`;card.style.width=`${Math.max(10,c.duration*scale)}px`;
      const cv=el('canvas');cv.width=Math.max(20,Math.round(c.duration*scale));cv.height=42;card.append(cv,el('span','ez-audio-name',a?.label||t('audio')));
      const left=el('span','ez-trim left'),right=el('span','ez-trim right');card.append(left,right);
      bindAudioDrag(card,c,scale,'move');bindAudioDrag(left,c,scale,'left');bindAudioDrag(right,c,scale,'right');
      drawWave(cv,c);audioLane.append(card);ensureWave(a);
    }
    head=el('div','ez-playhead');track.append(ruler,shots,audioLane,head);scroll.scrollLeft=scrollBefore;updatePlayhead();
    if(focusedZoom){
      const button=[zoomOut,fit,zoomIn].find(b=>b.dataset.zoomAction===focusedZoom&&!b.disabled);
      (button??(zoomIn.disabled?zoomOut:zoomIn)).focus({preventScroll:true});
    }
  }
  function bindShotResize(target,s,scale,edge){
    target.onclick=e=>e.stopPropagation();target.ondragstart=e=>e.preventDefault();
    target.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();
      const g=geometry(p).find(g=>g.id===s.id),at=(edge==='left'?g.start:g.end)+(e.key==='ArrowLeft'?-17:17)/24;
      mutate(()=>p=resizeShot(p,s.id,edge,at,{disableSnap:true}).plan,{strict:true});
    };
    target.onpointerdown=e=>{
      if(e.button!==0)return;e.preventDefault();e.stopPropagation();pause();
      const before=clone(p),gs=geometry(p),g=gs.find(x=>x.id===s.id),x=e.clientX,boundary=edge==='left'?g.start:g.end;
      const snapTimes=[playhead,...gs.flatMap(x=>[x.start,x.end]),...p.audio.flatMap(c=>[c.start,c.start+c.duration])];
      let failure=null;selected=s.id;suppressShotClick=true;target.setPointerCapture(e.pointerId);
      const track=target.closest('.ez-track-content'),line=el('div','ez-snap-line');track.append(line);
      const move=event=>{
        try{
          const resized=resizeShot(before,s.id,edge,boundary+(event.clientX-x)/scale,{snapTimes,scale,disableSnap:event.altKey});p=resized.plan;failure=null;
          for(const item of geometry(p)){
            const card=[...timeline.querySelectorAll('.ez-shot')].find(c=>c.dataset.shotId===item.id);
            card.style.left=`${item.start*scale}px`;card.style.width=`${Math.max(20,item.seconds*scale-5)}px`;
            card.querySelector('.ez-shot-duration').textContent=t('shotCard',item.seconds.toFixed(2),t(item.index===0||p.shots[item.index].transition==='cut'?'cut':'continued'));
          }
          timelineWidth=duration(p)*scale;track.style.width=`${timelineWidth}px`;line.style.left=`${resized.at*scale}px`;line.classList.toggle('snapped',resized.snapped);
          message(t(resized.snapped?'resizeSnapped':'resizePosition',stamp(resized.at)));updatePlayhead();
        }catch(error){failure=error;message(errorText(error,t),true);}
      };
      const cleanup=()=>{target.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',cancel);shotDragCancel=null;setTimeout(()=>suppressShotClick=false,0);};
      const finish=()=>{cleanup();if(failure){p=before;render();message(errorText(failure,t),true);}else{if(JSON.stringify(p)!==JSON.stringify(before))history.record(before);reconcile();render();}};
      const cancel=()=>{cleanup();p=before;reconcile();render();};shotDragCancel=cancel;
      target.addEventListener('pointermove',move);document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',cancel);
    };
  }
  function bindAudioDrag(target,c,scale,mode){
    target.onpointerdown=e=>{
      if(e.button!==0)return;e.preventDefault();e.stopPropagation();selectedAudio=c.id;selectionKind='audio';renderInspector();
      timeline.querySelectorAll('.ez-audio-clip').forEach(x=>x.classList.toggle('active',x.dataset.audioId===c.id));timeline.querySelectorAll('.ez-shot.active').forEach(x=>x.classList.remove('active'));target.closest('.ez-audio-clip').focus({preventScroll:true});
      const before=clone(p),x=e.clientX,start=c.start,len=c.duration,src=c.source_in,max=mediaAsset(c.asset_id).duration;
      target.setPointerCapture(e.pointerId);const card=target.closest('.ez-audio-clip');
      const move=e=>{const delta=(e.clientX-x)/scale;
        if(mode==='move')c.start=Math.max(0,Math.min(3600-len,start+delta));
        if(mode==='left'){const d=Math.max(-src,-start,Math.min(len-.01,delta));c.start=start+d;c.source_in=src+d;c.duration=len-d;}
        if(mode==='right')c.duration=Math.max(.01,Math.min(max-src,3600-start,len+delta));
        card.style.left=`${c.start*scale}px`;card.style.width=`${Math.max(10,c.duration*scale)}px`;
      };
      const focusClip=()=>timeline.querySelector(`[data-audio-id="${c.id}"]`)?.focus({preventScroll:true});
      const finish=e=>{cleanup();try{validate(p);if(JSON.stringify(before)!==JSON.stringify(p))history.record(before);render();}catch(err){p=before;render();message(errorText(err,t),true);}focusClip();};
      const cancel=()=>{cleanup();p=before;render();focusClip();};
      const cleanup=()=>{audioDragCancel=null;document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',cancel);};
      audioDragCancel=cancel;
      document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',cancel);
    };
  }
  function drawWave(canvas,c){
    const data=waves.get(c.asset_id);if(!data)return;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#8ed5d3';ctx.lineWidth=1;
    const len=mediaAsset(c.asset_id)?.duration||1;ctx.beginPath();
    for(let x=0;x<canvas.width;x++){const at=(c.source_in+c.duration*x/canvas.width)/len;const peak=data[Math.max(0,Math.min(data.length-1,Math.floor(at*data.length)))]||0;const y=peak*17*(c.volume??1);ctx.moveTo(x,23-y);ctx.lineTo(x,23+y);}ctx.stroke();
  }
  async function ensureWave(a){
    if(!a||waves.has(a.id)||pendingWaves.has(a.id))return;pendingWaves.add(a.id);
    try{
      if(!assistApi?.fetchApi)return;
      const r=await assistApi.fetchApi('/h3-continuum-ez/assist/media-info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:a.file}),signal:abort.signal});
      const info=await r.json();if(!r.ok)throw new Error(info.error||'audio preview unavailable');
      const peaks=info.peaks;
      if(!closed){waves.set(a.id,peaks);for(const c of p.audio.filter(c=>c.asset_id===a.id)){const cv=timeline.querySelector(`[data-audio-id="${c.id}"] canvas`);if(cv)drawWave(cv,c);}}
    }catch(e){if(!closed&&!mediaError&&e.name!=='AbortError')message(t('waveUnavailable'));}
  }
  function updatePlayhead(){
    if(playControl)playControl.textContent=playing?'❚❚':'▶';
    if(head)head.style.left=`${duration(p)?playhead/duration(p)*timelineWidth:0}px`;
    const showingResult=resultActive();
    const stale=!!resultVideo&&!resultMatches;
    if(clockLabel){
      const previous=showingResult&&stale;
      const position=previous?video.currentTime:playhead;
      const total=previous?video.duration:showingResult?videoDuration(p):duration(p);
      clockLabel.textContent=`${stamp(position)} / ${Number.isFinite(total)?stamp(total):'—'}`;
    }
    const {asset,fallback,end,shot}=previewAsset();
    if(resultLabel){
      const mode=showingResult?(stale?'previousVideoUnsynced':'resultPreview'):
        asset&&fallback?'libraryPreview':end?'endImagePreview':'previewNotGenerated';
      let label=showingResult&&activeVideo?.end!=null?t('partialPreview',stamp(activeVideo.start),stamp(activeVideo.end)):t(mode);
      if(shot&&!(showingResult&&stale))label+=` · ${shot.label}`;
      if(showingResult&&videoSize?.width)label+=` · ${videoSize.width} × ${videoSize.height}`;
      if(resultLabel.textContent!==label){resultLabel.textContent=label;resultLabel.title=label;}
    }
    if(monitorImage){
      monitorImage.style.display=asset&&!showingResult?'':'none';
      if(asset&&monitorImage.dataset.asset!==asset.id){
        monitorImage.src=mediaUrl(asset);
        monitorImage.dataset.asset=asset.id;
      }
    }
    fitMonitor();
  }
  function fitMonitor(){
    if(!monitor||!monitorFrame)return;
    let size=resultActive()?videoSize:null;
    if(!resultActive()&&p.resolution?.source==='studio'){try{size=resolutionSize(p.resolution);}catch{}}
    if(!size?.width||!size?.height)size={width:monitorImage?.naturalWidth||16,height:monitorImage?.naturalHeight||9};
    const ratio=size.width/size.height,w=Math.max(0,monitor.clientWidth),h=Math.max(0,monitor.clientHeight);
    const fitted=Math.min(w,h*ratio);monitorFrame.style.width=`${fitted}px`;monitorFrame.style.height=`${fitted/ratio}px`;
  }
  function setQueue(value){
    queueState=value||{phase:'checking'};
    const {phase,pending=0,position=0}=queueState;
    queueStatus.dataset.phase=phase;
    queueStatus.textContent=t(phase==='waiting'?'queueWaiting':phase==='running'?(pending?'queueRunningMore':'queueRunning'):'queue_'+phase,phase==='waiting'?position:pending);
    queueStatus.title=queueState.detail||(['complete','interrupted','failed'].includes(phase)?t('queueLastRunHelp',t('queue_'+phase)):t('queueStatusHelp'));
    updateRenderStatus();
    refreshRunNotice();
  }
  function updateRenderStatus(){
    renderStatus.hidden=queueState.phase!=='running';
    if(renderStatus.hidden)return;
    const progress=generationPlanText===saved&&generation&&!generation.ended?generation:null;
    const done=progress?Object.values(progress.states).reduce((n,s)=>n+s.done.length,0):0;
    const total=progress?.parts?.length??0,part=progress?.activePart;
    const shot=part&&progress.plan.shots.find(s=>s.id===part.shotId);
    const stage=shot?t('videoChunkStage',shot.label,part.index+1,t(part.phase==='decoding'?'videoDecoding':'status_'+part.phase)):
      total&&done===total?t('videoSaving'):done?'':t('videoPreparing');
    const count=total?t('videoChunkProgress',done,total):'';
    if(renderDetail.textContent!==stage)renderDetail.textContent=stage;
    if(renderCount.textContent!==count)renderCount.textContent=count;
    if(done){renderBar.max=total;renderBar.value=done;}
    else renderBar.removeAttribute('value');
  }
  function syncAudio(){
    updatePreviewAudio();
    if(resultActive()){media.pause();return;}
    const c=p.audio.find(c=>playhead>=c.start&&playhead<c.start+c.duration);
    if(!c){media.pause();activeAudio=null;return;}
    if(activeAudio!==c.id){media.src=mediaUrl(mediaAsset(c.asset_id));activeAudio=c.id;media.currentTime=c.source_in+(playhead-c.start);}
    const expected=c.source_in+(playhead-c.start);if(Math.abs(media.currentTime-expected)>.15)media.currentTime=expected;
    if(playing&&media.paused)media.play().catch(()=>{});else if(!playing)media.pause();
  }
  function updatePreviewAudio(){
    const c=p.audio.find(c=>playhead>=c.start&&playhead<c.start+c.duration);
    video.volume=previewVolume;video.muted=previewMuted;
    media.volume=previewVolume*(c?.volume??1);media.muted=previewMuted;
  }
  function tick(now){
    if(!playing||closed)return;
    if(resultActive()){
      updateVideoTime();
    }else{
      playhead=Math.min(duration(p),clockStart+(now-clock)/1000);
      if(previewLoop&&playhead>=duration(p)){
        seek(0);
      }else{
        updatePlayhead();syncAudio();
        if(playhead>=duration(p)){pause();return;}
      }
    }
    frame=requestAnimationFrame(tick);
  }
  function playback(){
    if(resultActive()){
      if(resultMatches){
        if(video.ended||playhead>=(activeVideo.end??videoDuration(p)))playhead=videoOffset();
        video.currentTime=Math.max(0,playhead-videoOffset());
      }
      else if(video.ended)video.currentTime=0;
      video.play().catch(()=>message(t('videoError'),true));return;
    }
    if(playhead>=duration(p))playhead=0;
    playing=true;clock=performance.now();clockStart=playhead;syncAudio();frame=requestAnimationFrame(tick);
  }
  function pause(){playing=false;cancelAnimationFrame(frame);media.pause();video.pause();if(playControl)playControl.textContent='▶';}
  function seek(position){
    const resume=playing;
    playhead=Math.max(0,Math.min(duration(p),position));
    updateResultState({keepEndFrame:false});
    if(resultActive()&&resultMatches)video.currentTime=Math.max(0,playhead-videoOffset());
    if(resume&&resultActive())video.play().catch(()=>message(t('videoError'),true));
    if(playing){clock=performance.now();clockStart=playhead;}
    updatePlayhead();syncAudio();
  }
  splitter.onpointerdown=e=>{e.preventDefault();splitter.setPointerCapture(e.pointerId);const move=e=>{const rect=work.getBoundingClientRect();const right=Math.max(330,Math.min(rect.width-380,rect.right-e.clientX));work.style.setProperty('--work-columns',`200px minmax(180px,1fr) 7px ${right}px`);};const end=()=>{splitter.removeEventListener('pointermove',move);splitter.removeEventListener('pointerup',end);};splitter.addEventListener('pointermove',move);splitter.addEventListener('pointerup',end);};
  function setTimelineHeight(height) {
    shell.style.setProperty('--timeline-height', `${Math.max(0,height)}px`);
  }
  let timelineDrag=null;
  timelineSplitter.onpointerdown=e=>{
    if(e.button!==0||timelineDrag)return;
    e.preventDefault();
    timelineSplitter.setPointerCapture(e.pointerId);
    timelineDrag={pointerId:e.pointerId,y:e.clientY,height:timeline.getBoundingClientRect().height};
  };
  timelineSplitter.onpointermove=e=>{
    if(timelineDrag?.pointerId===e.pointerId){
      setTimelineHeight(timelineDrag.height+timelineDrag.y-e.clientY);
    }
  };
  timelineSplitter.onlostpointercapture=()=>{timelineDrag=null;};
  timelineSplitter.onkeydown=e=>{
    if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;
    e.preventDefault();
    setTimelineHeight(timeline.getBoundingClientRect().height+(e.key==='ArrowUp'?24:-24));
  };
  function render(){refreshPlanIdentity();assist?.sync();renderLibrary();renderPreview();renderInspector();renderTimeline();checks();}
  async function applyDraft(doQueue){
    if(projectWorking){message(t('projectBusy'),true);return;}
    if(applying)return;
    if(doQueue)noticeDismissed=false;
    submissionError='';queueAcknowledged=false;applying=true;updateApplyControls();clearTimeout(editCheckTimer);
    try{
      if(busy)throw new Error(t('waitUpload'));
      await assistPanel?.flush();
      if(assistPanel?.isBusy())throw new Error(locale==='ja'?'AI処理が終わってからノード反映してください。':'Wait for AI processing before applying.');
      const previousMediaError=mediaError;
      const editAtStart=JSON.stringify(p);
      const draft=clone(p);
      draft.resolution??={...studioResolutionDefaults};
      draft.chunking??={enabled:true,seconds:DEFAULT_CHUNK_SECONDS};
      validate(draft);
      if(!externalConnected||draft.prompt_source==='studio'||lastExternal!==null)draft.shots.forEach((_,i)=>effective(draft,i,externalConnected?lastExternal:null));
      if(doQueue&&assist){
        const checked=await assist.preflight(draft).catch(e=>{
          if(draft.resolution.aspect==='image'&&['Unsupported aspect ratio','Missing image dimensions'].includes(e.message))throw new Error(t('restartForImageSize'));
          throw e;
        });
        if(closed)return;
        if(draft.audio.some(c=>(c.volume??1)!==1)&&checked.audio_clip_volume!==true)throw new Error(t('restartForVolume'));
        if(editAtStart!==JSON.stringify(p))throw new Error(locale==='ja'?'確認中に編集されました。もう一度実行してください。':'Edits occurred during preflight. Run again.');
        if(!checked.ok)throw new Error(checked.errors.map(x=>x.message).join(' | ')||t('queueInputError'));
      }
      await onApply(draft);
      if(closed)return;
      if(!p.resolution)p.resolution={...studioResolutionDefaults};
      if(!p.chunking)p.chunking={enabled:true,seconds:DEFAULT_CHUNK_SECONDS};
      saved=JSON.stringify(draft);
      if(restoredDraft){restoredDraft=null;draftStore?.clear().catch(()=>{});}
      if(mediaError===previousMediaError)mediaError=null;
      checks();
      if(doQueue){if(!onQueue)throw new Error(t('queueUnavailable'));submitting=true;queue.disabled=true;setQueue({phase:'submitting'});await onQueue();queueAcknowledged=true;message(t('queued'));}
    }catch(e){submissionError=errorText(e,t);if(doQueue&&submitting)setQueue({phase:'failed',detail:submissionError});message(submissionError,true);}finally{applying=false;submitting=false;if(!closed)updateApplyControls();}
  }
  function requestClose(){
    if(closePrompt)return;
    if(applying||projectWorking||busy){message(t('closeWait'),true);return;}
    if(!dirty()&&!assistPanel?.hasPendingEdits()&&!restoredDraft){close();return;}
    const d=closePrompt=el('dialog','h3ez-import ez-project-confirm ez-close-draft');d.lang=locale;d.setAttribute('aria-label',t('draftClose'));
    const heading=el('header','ez-dialog-heading'),x=btn('×',()=>d.close(),'ez-close');x.title=t('close');x.setAttribute('aria-label',t('close'));
    heading.append(el('h3','',t('draftClose')),x);
    const actions=el('div','ez-import-actions'),notice=el('p','ez-draft-error');notice.setAttribute('role','alert');notice.hidden=true;
    let working=false;
    const finish=async keep=>{
      if(working)return;
      working=true;for(const b of d.querySelectorAll('button'))b.disabled=true;
      try{
        if(keep)await draftStore.save(saved,{plan:clone(p),aiEdits:assistPanel?.draftEdits()??[],view:{selected,selectedAudio,playhead,zoom,promptTab,focusMode,projectName,projectWasSaved:JSON.stringify(p)===projectSaved,scroll:timeline.querySelector('.ez-scroll')?.scrollLeft??0}});
        else if(restoredDraft)await draftStore.clear();
        close();
      }catch{notice.textContent=t(keep?'draftSaveError':'draftDiscardError');notice.hidden=false;}
      finally{working=false;for(const b of d.querySelectorAll('button'))b.disabled=false;}
    };
    const cancel=btn(t('cancel'),()=>d.close());cancel.title=t('draftCancelHelp');
    const discard=btn(t('draftDiscard'),()=>finish(false));discard.title=t('draftDiscardHelp');
    actions.append(cancel,discard);
    if(draftStore){const keep=btn(t('draftKeep'),()=>finish(true),'primary');keep.title=t('draftKeepHelp');actions.append(keep);}
    d.append(heading,el('p','',t(draftStore?'draftCloseHelp':'draftCloseNoStore')),notice,actions);dialog.append(d);
    d.addEventListener('keydown',e=>e.stopPropagation());
    d.addEventListener('cancel',e=>{e.stopPropagation();if(working)e.preventDefault();});
    d.addEventListener('close',()=>{d.remove();closePrompt=null;if(!closed)closeButton.focus();},{once:true});
    d.showModal();cancel.focus();
  }
  function close(){if(closed)return;shotDragCancel?.();audioDragCancel?.();closed=true;clearTimeout(editCheckTimer);assistPanel?.dispose();observer?.disconnect();monitorObserver?.disconnect();pause();abort.abort();video.removeAttribute('src');video.load();media.removeAttribute('src');media.load();dialog.close();dialog.remove();onClose?.();}
  function openInstruction(){
    const d=el('dialog','h3ez-import ez-instruction-dialog');d.lang=locale;d.setAttribute('aria-label',t('aiInstruction'));
    const heading=el('header','ez-dialog-heading'),close=btn('×',()=>d.close(),'ez-close');close.title=t('close');close.setAttribute('aria-label',t('close'));
    heading.append(el('h3','',t('aiInstruction')),close);
    const binding=assistIdentity().instructionBinding,source=el('div','ez-instruction-source',t(binding?.connected?'aiInstructionExternal':p.prompt_enhancer?.instruction?.trim()?'aiInstructionStudio':'aiInstructionDefault'));
    source.title=t('aiInstructionHelp');
    const area=el('textarea');area.value=p.prompt_enhancer?.instruction||DEFAULT_INSTRUCTION;area.setAttribute('aria-label',t('aiInstructionStudio'));area.title=t('aiInstructionHelp');area.spellcheck=false;
    const counter=el('span','ez-char-count'),actions=el('div','ez-import-actions'),error=el('div','error');error.setAttribute('role','alert');
    const save=btn(t('aiInstructionSave'),()=>{
      if([...area.value].length>8000||area.value.includes('\0'))return;
      try{mutate(()=>{p.schema=2;p.prompt_enhancer??={enabled:false,texts:[]};p.prompt_enhancer.instruction=area.value===DEFAULT_INSTRUCTION?'':area.value;},{strict:true});d.close();}
      catch(e){error.textContent=errorText(e,t);}
    },'ez-apply');
    const refresh=()=>{const n=[...area.value].length;counter.textContent=`${n.toLocaleString(locale)} / 8,000`;save.disabled=n>8000||area.value.includes('\0');error.textContent=save.disabled?t('aiInstructionLimit'):'';};
    area.oninput=refresh;refresh();
    const reset=btn(t('aiInstructionReset'),()=>{area.value=DEFAULT_INSTRUCTION;refresh();});reset.title=t('aiInstructionResetHelp');
    save.title=t('aiInstructionSaveHelp');
    actions.append(reset,counter,btn(t('cancel'),()=>d.close()),save);d.append(heading,source,area,error,actions);
    d.addEventListener('close',()=>{d.remove();instructionButton.focus();},{once:true});document.body.append(d);d.showModal();area.focus();
  }
  function openImporter(){
    const d=el('dialog','h3ez-import');
    d.lang=locale;
    d.setAttribute('aria-label',t('importTitle'));
    const heading=el('header','ez-dialog-heading');
    const closeImport=btn('×',()=>d.close(),'ez-close');
    closeImport.title=t('close');
    closeImport.setAttribute('aria-label',t('close'));
    heading.append(el('h3','',t('importTitle')),closeImport);
    d.append(heading);heading.title=t('importHelp');
    const area=el('textarea');area.title=t('importHelp');area.setAttribute('aria-label',t('importAria'));area.placeholder='[Shot 1]\nThe character...\n\n[Shot 2]\n...';const info=el('p',''),actions=el('div','ez-import-actions');let parsed=null;
    const applyImport=btn(t('importApply'),()=>{if(!parsed)return;mutate(()=>{for(const x of parsed)p.shots[x.index].prompt=x.text;});d.close();d.remove();},'primary');applyImport.disabled=true;
    area.oninput=()=>{parsed=null;applyImport.disabled=true;info.textContent=t('importChanged');};
    actions.append(btn(t('cancel'),()=>{d.close();d.remove();}),btn(t('checkImport'),()=>{try{parsed=parseScript(area.value,p.shots.length);info.textContent=parsed.map(x=>t('importCharacters',p.shots[x.index].label,x.text.length.toLocaleString(locale))).join(' / ');applyImport.disabled=false;}catch(e){info.textContent=errorText(e,t);applyImport.disabled=true;}}),applyImport);d.append(area,info,actions);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();applyUIHelp(d,locale);
  }
  dialog.addEventListener('cancel',e=>{e.preventDefault();if(shotDragCancel)shotDragCancel();else requestClose();});
  dialog.addEventListener('keydown',e=>{
    e.stopPropagation();const text=/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable;
    if(e.key==='Escape'&&(shotDragCancel||audioDragCancel)){e.preventDefault();(shotDragCancel||audioDragCancel)();return;}
    if(!text&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();p=e.shiftKey?history.redo(p):history.undo(p);reconcile();render();}
    if(!text&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();if(!e.repeat)deleteSelection();return;}
    if(!text&&e.code==='Space'&&!e.target.closest('button,summary,[role=button]')){e.preventDefault();playing?pause():playback();}
  });
  // Prevent image drops over this dialog from being interpreted as workflow imports.
  dialog.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();});
  dialog.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();});
  document.body.append(dialog);dialog.showModal();
  if(focusMode){shell.classList.add('prompt-focus');timelineTab.classList.remove('selected');}
  render();if(view?.scroll)timeline.querySelector('.ez-scroll').scrollLeft=view.scroll;
  if(restoredDraft)message(t('draftRestored'));else if(draftReadError)message(t('draftReadError'),true);
  let timelineWidthObserved=timeline.clientWidth;
  observer=new ResizeObserver(()=>{
    if(closed||shotDragCancel||audioDragCancel)return;
    timelineSplitter.setAttribute('aria-valuenow',String(Math.round(100*timeline.clientHeight/shell.clientHeight)));
    const width=timeline.clientWidth;
    if(width!==timelineWidthObserved){
      timelineWidthObserved=width;
      renderTimeline();
    }
  });
  observer.observe(timeline);
  const originalClose=close; // observer is also released by the public cleanup below.
  dialog.addEventListener('close',()=>observer.disconnect(),{once:true});
  function setResult(result,{restored=false}={}){
    resultVideo=result;resultPlanText=JSON.stringify(read(result.plan));
    if(!restored){
      pause();
      generation=null;generationPlanText=null;
      previewMode='auto';
    }
    updateResultState();
    if(!restored&&resultActive()&&resultMatches)seek(playhead);
    renderTimeline();
  }
  function setProgress(value){generation=value;generationPlanText=value?JSON.stringify(value.plan):null;updateRenderStatus();if(shotDragCancel)return;updateResultState();renderTimeline();if(value?.warning)message(t('partialPreviewUnavailable'),true);}
  setQueue(queueState);
  return {setResult,setProgress,setQueue,setExternal:(linked,text)=>{externalConnected=linked;lastExternal=text;renderInspector();checks();},focus:()=>dialog.focus(),close:()=>{observer.disconnect();originalClose();},getDraft:()=>clone(p),element:dialog};
}

