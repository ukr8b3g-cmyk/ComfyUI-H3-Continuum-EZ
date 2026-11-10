import {editorDuration,placeAudio as placeFullAudio,fitVideoToAudio,duplicateAudio} from './audio_edit.js';
import {newProject,saveProject,loadProject,MAX_PROJECT_BYTES} from './project.js';
import {applyUIHelp} from './ui_help.js';
import {mediaLabel,mediaHelp} from './media_labels.js';
import {AssistClient} from './assist.js';
import {DEFAULT_INSTRUCTION} from './default_instruction.js';
import {createAssistPanel} from './assist_panel.js';
import {activateEntry,restoreOriginal,pruneTargets,resolveText} from './enhancer.js';
import {storyPanel} from './story_panel.js';
import {translator,errorText} from './i18n.js';
import {ASPECT_RATIOS,DEFAULT_CHUNK_SECONDS,resolutionSize,clone,uid,read,geometry,duration as videoDuration,executionPlan,resizeShot,MAX_SHOT_SECONDS,refsFor,firstFor,commonPrompt,editPrompt,effective,validate as validatePlan,registerReference,removeAsset,insertShot,moveShot,splitShot,splitAudio,parseScript,History} from './state.js';

const duration=editorDuration;
const validate=p=>validatePlan(p,{allowAudioOverhang:true});
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

export function openStudio({value,mediaUrl,upload,onApply,onQueue,externalConnected=false,lastExternal=null,onClose=null,locale='en',resultVideo=null,generation=null,onStorage=null,assistApi=null,assistIdentity=()=>({}),getCanvasModel=()=>null,getInstructionGraph=null}){
  const t=translator(locale);
  ensureStudioStyles();let p=read(value),saved=JSON.stringify(p),selected=p.shots[0]?.id,selectedAudio=null,playhead=0,zoom=1,promptTab='shot',focusMode=false,busy=0,closed=false;
  const history=new History(),abort=new AbortController(),waves=new Map(),pendingWaves=new Set(),previousShotRefs=new Map();
  let projectSaved=JSON.stringify(p),projectName='H3_EZ_Project.h3ez.json',projectWorking=false;
  let mediaError=null, assistPanel=null, applying=false,audioDragCancel=null,selectionKind='shot';
  const roleSelection=new Map();
  const assistState=()=>({plan:p,external:externalConnected?lastExternal:null,
    outputSize:assistIdentity().outputSize??null,
    externalUnknown:externalConnected&&p.prompt_source!=='studio'&&lastExternal===null,
    identity:{...assistIdentity(),canvasModel:getCanvasModel()??''},alive:!closed});
  const assist=assistApi?new AssistClient({api:assistApi,getState:assistState,getInstructionGraph,explicitRequests:true,onStatus:value=>assistPanel?.setStatus(value)}):null;
  let editCheckTimer=null;
  const deferredChecks=()=>{assist?.sync();clearTimeout(editCheckTimer);editCheckTimer=setTimeout(()=>{if(!closed){checks();}},100);};
  let observer=null,monitorObserver=null,monitorFrame=null,monitor=null,videoSize=null,queueState={phase:'checking'},submitting=false,inputIssue='',submissionError='',noticeKey='',queueAcknowledged=false;
  let playing=false,frame=0,clock=0,clockStart=0,media=new Audio(),activeAudio=null,monitorImage=null,head=null,clockLabel=null,timelineWidth=1000;
  let previewVolume=1,previewMuted=false,previewLastVolume=1,refreshPreviewVolume=null;
  media.preload='auto';
  let previewMode='auto', resultLabel=null, resultToggle=null, playControl=null, resultMatches=false,activeVideo=null,shotDragCancel=null,suppressShotClick=false;
  // Compare the plan only after edits or incoming generation records, never per animation frame.
  let planText=JSON.stringify(p),resultPlanText=resultVideo?JSON.stringify(read(resultVideo.plan)):null,
      generationPlanText=generation?JSON.stringify(generation.plan):null;
  function refreshPlanIdentity(){planText=JSON.stringify(p);}
  const video=el('video','ez-result-video');video.controls=true;video.playsInline=true;video.preload='metadata';
  if(resultVideo)video.src=resultVideo.url;
  const samePlan=()=>!!resultVideo&&resultPlanText===planText;
  const runMatches=()=>!!generation&&generationPlanText===planText;
  const partialAt=time=>generation?.clips.find(c=>time>=c.start&&time<c.end);
  const videoOffset=()=>activeVideo?.start||0;
  function resultActive(){
    return !!activeVideo && previewMode!=='layout';
  }
  function updateResultState(){
    const wasSynced=resultActive()&&resultMatches;
    resultMatches=runMatches()||samePlan();
    if(resultMatches && previewMode==='previous')previewMode='auto';
    const source=previewMode==='previous'?resultVideo:runMatches()?partialAt(playhead):(samePlan()?resultVideo:null);
    const changed=activeVideo?.url!==source?.url;
    activeVideo=source||null;
    if(changed&&activeVideo){videoSize=null;video.src=activeVideo.url;video.currentTime=Math.max(0,playhead-videoOffset());}
    if(!resultActive()&&!video.paused)pause();
    video.hidden=!resultActive();
    if(!wasSynced && resultActive() && resultMatches)video.currentTime=Math.max(0,playhead-videoOffset());
    if(resultToggle){
      resultToggle.textContent=t(resultVideo&&!resultMatches?'previousVideo':'resultPreview');
      resultToggle.disabled=runMatches()?!generation.clips.length:!resultVideo;
      resultToggle.classList.toggle('selected',resultActive());
    }
    updatePlayhead();
  }
  function updateVideoTime(){
    if(!resultActive())return;
    if(resultMatches)playhead=Math.min(duration(p),videoOffset()+video.currentTime);
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
    const next=activeVideo?.end;
    playing=false;cancelAnimationFrame(frame);
    if(next!=null&&runMatches()&&partialAt(next)){seek(next);playback();}else updatePlayhead();
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
  const textTab=btn(t('widePrompt'),()=>{focusMode=!focusMode;renderLayout();});
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
  projectMenu.className='ez-project-menu';projectMenu.setAttribute('aria-label',t('project'));projectMenu.title=t('projectHelp');
  const projectFileInput=el('input');projectFileInput.type='file';projectFileInput.accept='.h3ez.json,.json,application/json';projectFileInput.hidden=true;
  projectFileInput.onchange=()=>{if(projectFileInput.files?.[0])void projectOperation('load',projectFileInput.files[0]);};
  projectGroup.append(projectMenu,projectActions,projectFileInput);top.append(projectGroup);
  editTools.append(timelineTab,textTab,undo,redo,importButton);
  const settingsTools=el('div','ez-top-group ez-settings-tools');
  const instructionButton=btn(t('aiInstruction'),()=>openInstruction(),'ez-ai-instruction-button');
  instructionButton.title=t('aiInstructionHelp');settingsTools.append(instructionButton);
  if(onStorage)settingsTools.append(btn(t('storageManager'),onStorage));
  const runTools=el('div','ez-top-group ez-run-tools');
  const queueStatus=el('span','ez-queue-status');queueStatus.setAttribute('role','status');queueStatus.setAttribute('aria-live','polite');
  const runNotice=el('div','ez-run-notice'),runNoticeText=el('span');runNotice.hidden=true;runNotice.setAttribute('role','alert');
  const fitNotice=btn(t('fitVideoAudio'),()=>mutate(()=>{p=fitVideoToAudio(p);}));fitNotice.title=t('videoShortfallHelp');runNotice.append(runNoticeText,fitNotice);
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
  top.append(editTools,settingsTools,runTools,windowTools,runNotice);
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
    history.record(p);p=next;selected=p.shots[0]?.id;selectedAudio=null;selectionKind='shot';playhead=0;zoom=1;
    waves.clear();previousShotRefs.clear();roleSelection.clear();mediaError=null;
    resultVideo=null;generation=null;resultPlanText=null;generationPlanText=null;activeVideo=null;video.removeAttribute('src');video.load();previewMode='auto';videoSize=null;
    clearTimeout(editCheckTimer);projectName=name;projectMenu.title=`${name}\n${t('projectHelp')}`;projectSaved=JSON.stringify(p);reconcile();render();return true;
  }
  async function projectOperation(action,file=null){
    try{
      projectReady();projectWorking=true;
      if(action==='save'){
        await assistPanel?.flush();if(closed)return;
        const text=saveProject(p),snapshot=JSON.stringify(p),url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
        const a=el('a');a.href=url;a.download=projectName;dialog.append(a);
        try{a.click();projectSaved=snapshot;message(t('projectSaved'));}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
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
    const previousInputIssue=inputIssue;inputIssue='';updateApplyControls();
    if(busy){message(t('uploading',busy));return;}
    try{
      validate(p);
      if(!externalConnected||p.prompt_source==='studio'||lastExternal!==null)p.shots.forEach((_,i)=>effective(p,i,externalConnected?lastExternal:null));
      const summary=t('studioStatus',t(dirty()?'unsaved':'applied'),p.shots.length,duration(p).toFixed(3))+(externalConnected?' · '+t(p.prompt_source==='studio'?'studioCommonStatus':'externalStatus'):'');
      const shortage=duration(p)-videoDuration(p);
      if(shortage>.001)inputIssue=t('videoShortfall',shortage.toFixed(3));
      message(mediaError?.text??(shortage>.001?t('videoShortfall',shortage.toFixed(3)):summary),mediaError!==null);
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
    queue.textContent=applying?t(submitting?'queue_submitting':'queueValidating'):submissionError?t('queueInputError'):(acknowledged?'✓ ':'')+t('applyAndQueue');
    queue.dataset.feedback=applying?'busy':submissionError?'rejected':acknowledged?'accepted':'';
    queue.setAttribute('aria-busy',String(applying||submitting));
    queue.title=busy?t('waitUpload'):(applying||submitting)?t('queue_submitting'):inputIssue||t('applyQueueHelp');
    setQueue(queueState);
  }
  function refreshRunNotice(){
    const text=inputIssue||submissionError||(queueState.phase==='failed'?queueState.detail:'')||'',fit=!!text&&duration(p)>videoDuration(p)+.001,key=text+'|'+fit;
    if(key===noticeKey)return;noticeKey=key;runNotice.hidden=!text;runNoticeText.textContent=text;fitNotice.hidden=!fit;
  }
  function renderLayout(){shell.classList.toggle('prompt-focus',focusMode);timelineTab.classList.toggle('selected',!focusMode);textTab.classList.toggle('selected',focusMode);renderInspector();}
  function mediaAsset(id){return p.assets.find(a=>a.id===id);}
  function img(id,cls=''){const e=el('img',cls);const a=mediaAsset(id);if(a){e.src=mediaUrl(a);e.alt=a.label;e.loading='lazy';}return e;}
  function bindDrop(target,handler){
    target.addEventListener('dragover',e=>{escapeDrop(e);target.classList.add('drop-hover');});
    target.addEventListener('dragleave',()=>target.classList.remove('drop-hover'));
    target.addEventListener('drop',async e=>{escapeDrop(e);target.classList.remove('drop-hover');try{await handler(e);}catch(err){message(errorText(err,t),true);}});
  }
  async function addFiles(files,place='library',at=playhead){
    const accepted=[...files], targetShot=current()?.id;if(!accepted.length)return;
    if(!busy)mediaError=null;
    for(const file of accepted){
      const kind=/^image\//.test(file.type)||/\.(png|jpe?g|webp|bmp)$/i.test(file.name)?'image':/^(audio|video)\//.test(file.type)||/\.(wav|mp3|flac|m4a|ogg|aac|mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)?'audio':null;
      if(!kind){retainMediaError(t('mediaOnly',file.name));checks();continue;}
      busy++;
      try{
        checks();
        const uploaded=await upload(file,kind);
        if(closed)break;
        const asset={id:uid('asset'),label:file.name,kind,file:uploaded.file};
        if(kind==='audio'){asset.duration=uploaded.duration;if(!Number.isFinite(asset.duration)||asset.duration<=0)throw new Error(t('audioDurationMissing'));}
        mutate(()=>{
          p.assets.push(asset);
          if(kind==='audio'&&place==='audio'){try{placeAudio(asset.id,at);}catch(e){retainMediaError(errorText(e,t));}}
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
  function renderLibrary(){
    library.replaceChildren(el('h3','',t('media')));
    const drop=el('div','ez-drop',t('dropMedia'));drop.append(el('div','ez-help',t('chooseFile')));drop.tabIndex=0;drop.role='button';drop.onclick=filePicker;drop.onkeydown=e=>{if(e.key==='Enter')filePicker();};bindDrop(drop,e=>addFiles(e.dataTransfer.files));
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
      const rm=btn('×',async e=>{e.stopPropagation();if(await confirmMediaRemoval(a))mutate(()=>removeAsset(p,a.id));},'ez-remove');rm.title=t('unlinkMedia');card.append(rm);const replace=btn('↻',e=>{e.stopPropagation();replacePicker(a);},'ez-replace');replace.title=t('replaceMedia');replace.setAttribute('aria-label',t('replaceAssetLabel',a.label));card.append(replace);
      card.ondblclick=()=>a.kind==='image'?mutate(()=>assignImage(a.id,current())):placeExistingAudio(a.id,playhead);
      assets.append(card);
    }
    library.title=t('mediaHelp');library.append(drop,btn(t('addMedia'),filePicker),assets);applyUIHelp(library,locale);
  }
  function previewAsset(){
    const shots=geometry(p);
    if(playhead>=videoDuration(p))return {asset:null,fallback:false};
    const index=shots.findIndex(g=>playhead<g.end);
    const i=index===-1?shots.length-1:index;
    const shot=p.shots[i];
    const reference=p.reference_slots[(refsFor(p,shot)[0]||0)-1];
    const assigned=mediaAsset(shot.first_image || (i===0?p.first_image:null) || reference || firstFor(p,i));
    return assigned ? {asset:assigned,fallback:false} : {asset:p.assets.find(a=>a.kind==='image'),fallback:true};
  }
  function renderPreview(){
    pause();preview.replaceChildren();
    const first=el('div','ez-first-global');
    first.title=t('dropStart');
    if(p.first_image){first.append(img(p.first_image),el('span','ez-help',t('compactStartAssigned')),btn('×',()=>mutate(()=>p.first_image=null),'quiet'));}
    else first.append(el('span','ez-help',t('compactStart')));
    bindDrop(first,async e=>{const id=dropAsset(e);if(id){if(mediaAsset(id)?.kind!=='image')return;mutate(()=>p.first_image=id);}else await addFiles(e.dataTransfer.files,'first');});
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
    transport.append(play,startButton,clockLabel);
    const common=el('div','ez-ref-strip');common.title=t('dropCommonHint');
    for(const slot of p.global_refs){const aid=p.reference_slots[slot-1],name=mediaAsset(aid)?.label||t('referenceImage');const b=btn('',()=>mutate(()=>p.global_refs=p.global_refs.filter(x=>x!==slot),{strict:true}),'ez-ref-chip');b.append(img(aid));b.title=t('removeNamedRef',name);b.setAttribute('aria-label',b.title);common.append(b);}
    common.prepend(el('span','ez-help',t('compactCommon')));
    bindDrop(common,e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>{const slot=registerReference(p,id);if(!p.global_refs.includes(slot))p.global_refs.push(slot);p.global_refs.sort((a,b)=>a-b);});});
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
    const source=select([['studio','Studio'],['engine','Engine']],r.source,v=>mutate(()=>{p.resolution={...r,source:v};},{strict:true}));
    source.setAttribute('aria-label',t('resolutionSource'));
    const aspect=select(ASPECT_RATIOS.map(v=>[v,v]),r.aspect,v=>mutate(()=>{p.resolution={...r,source:'studio',aspect:v};},{strict:true}));aspect.setAttribute('aria-label',t('aspectRatio'));
    const mp=inputNumber(r.megapixels,v=>{
      if (r.source==='studio' && v===r.megapixels) return;
      mutate(()=>{p.resolution={...r,source:'studio',megapixels:v};},{strict:true});
    },.01,16,.01);
    mp.setAttribute('aria-label',t('megapixels'));
    aspect.title=t('aspectRatio');
    mp.title=t('megapixels');
    const estimate=el('span','ez-resolution-estimate',t('sizeEstimate'));
    const size=el('span','ez-resolution-size','—');
    const readout=el('span','ez-resolution-readout');
    readout.append(estimate,size);
    size.setAttribute('aria-live','polite');
    const display=value=>{
      try{
        const {width,height}=resolutionSize({...r,megapixels:value});
        size.textContent=`${width} × ${height}`;
        size.title=t('calculatedSize',width,height);
      }catch{
        size.textContent='—';
        size.title=t('invalidResolution');
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
      source.value='studio';
      estimate.hidden=true;
      source.title=t('sizeRounding');
      readout.title=source.title;
      checks();
    });
    display(r.megapixels);
    estimate.hidden=r.source==='studio';
    source.title=t(r.source==='studio'?'sizeRounding':'sizeExternalHelp');
    readout.title=source.title;
    box.append(source,aspect,field('MP',mp),readout);
    return box;
  }
  function editLabel(s){const e=el('input');e.value=s.label;e.setAttribute('aria-label',t('shotName'));e.onchange=()=>mutate(()=>s.label=e.value);return e;}
  if(assist){
    assistPanel=createAssistPanel({client:assist,getState:assistState,locale,
      onAdopt:entry=>{let error;mutate(()=>activateEntry(p,entry),{strict:true,onError:e=>{error=e;}});if(error)throw error;},
      onRestore:target=>mutate(()=>restoreOriginal(p,target),{strict:true}),
      onRestoreAll:()=>mutate(()=>{for(const entry of p.prompt_enhancer?.texts||[])entry.inactive=true;},{strict:true})});
    editTools.append(assistPanel.global);
  }
  function renderInspector(){
    assistPanel?.beginRender();
    inspector.replaceChildren();const s=current();if(!s)return;
    const index=p.shots.indexOf(s),g=geometry(p)[index];
    const title=el('div','ez-row ez-shot-title');title.append(editLabel(s),field(t('targetSeconds'),inputNumber(Number(s.seconds.toFixed(3)),n=>mutate(()=>s.seconds=n,{strict:true}),2,MAX_SHOT_SECONDS,.1)),
      select([['continue',t('continuePrevious')],['cut',t('cut')]],index===0?'cut':s.transition,v=>mutate(()=>{if(v==='continue'&&s.first_image)throw new Error(t('removeStartToContinue'));s.transition=v;})));
    title.querySelector('input[type=number]').classList.add('ez-seconds');
    title.lastChild.disabled=index===0;title.lastChild.setAttribute('aria-label',locale==='ja'?'ショット境界':'Shot boundary');title.lastChild.title=index===0?(locale==='ja'?'最初のショットは場面転換です。':'The first shot starts a new scene.'):(locale==='ja'?'前の映像を継続するか、新しい場面から開始するか選びます。':'Continue the previous video or start a new scene.');
    const timing=el('div','ez-help ez-shot-timing',t('shotTiming',g.seconds.toFixed(3),stamp(g.start),stamp(g.end)));
    timing.title=t('shotTimingHelp');
    const internalParts=executionPlan(p).filter(x=>x.shot_id===s.id);
    if(internalParts.length>1){timing.append(' · '+t('autoParts',internalParts.length));timing.title=t('autoPartsHelp');}
    const tabs=el('div','ez-row ez-prompt-tabs');
    for(const [key,label] of [['shot',t('shotPromptTab')],['global',t('commonPrompt')],['effective',t('effectivePrompt')]]){
      const tab=btn(label,()=>{promptTab=key;renderInspector();},`ez-tab-${key}`+(promptTab===key?' selected':''));
      tab.setAttribute('aria-pressed',String(promptTab===key));
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
    bindDrop(strip,async e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>assignImage(id,s));else if(e.dataTransfer.files.length)await addFiles(e.dataTransfer.files,'shot');});
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
    toolbar.append(tabs,modeRow);
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
    bindDrop(endRow,e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>s.last_image=id);});
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
      area.title=t(common?'commonPromptHelp':'shotPromptHelp')+'\n'+t('autoPromptHelp')+'\n'+t('noShortening');
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
      if(common)area.title+='\n'+t('commonSyncHelp');
      if(assistPanel)wrap.append(assistPanel.bind({target:common?{field:'global_prompt'}:{field:'prompt',shot_id:s.id},area,wrap,counter,onDisplay:count}));
      else wrap.append(counter);
      return wrap;
    }
    if(promptTab==='effective'){
      const compiled=el('div','ez-prompt-block ez-compiled');
      const heading=el('div','ez-row ez-compiled-heading');
      heading.append(el('span','ez-help',t('compiledForShot',s.label)));
      if(internalParts.length>1){const partSelect=select(internalParts.map(x=>[String(x.part_index),t('internalPart',x.part_index+1,internalParts.length)]),'0',v=>{compiledPart=Number(v);updateCompiled();});partSelect.setAttribute('aria-label',t('internalPartSelect'));heading.append(partSelect);}
      compiled.append(heading);
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
      bindDrop(key,e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>s.first_image=id);});inspector.append(key);
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
  function confirmMediaRemoval(asset){
    return new Promise(resolve=>{
      const d=el('dialog','h3ez-import ez-remove-media');d.lang=locale;d.setAttribute('aria-label',t('removeMedia'));
      const heading=el('div','ez-dialog-heading'),close=btn('×',()=>d.close(),'ez-close');close.setAttribute('aria-label',t('close'));
      heading.append(el('h3','',t('removeMedia')),close);const actions=el('div','ez-import-actions'),cancel=btn(t('cancel'),()=>d.close());
      actions.append(cancel,btn(t('removeMedia'),()=>{d.returnValue='remove';d.close();},'primary'));d.append(heading,el('p','',asset.label),el('p','',t('removeMediaConfirm')),actions);
      d.addEventListener('keydown',e=>e.stopPropagation());d.addEventListener('close',()=>{const yes=d.returnValue==='remove';d.remove();resolve(yes);},{once:true});document.body.append(d);d.showModal();cancel.focus();
    });
  }
  function bindLibraryAudioDrag(card,asset){
    card.onpointerdown=e=>{
      if(e.button!==0||e.target.closest('button,input'))return;e.preventDefault();card.setPointerCapture(e.pointerId);
      const x=e.clientX,y=e.clientY;let ghost=null;
      const move=ev=>{
        if(!ghost&&Math.hypot(ev.clientX-x,ev.clientY-y)>5){ghost=el('div','ez-library-drag',asset.label);dialog.append(ghost);}
        if(ghost){ghost.style.left=`${ev.clientX+12}px`;ghost.style.top=`${ev.clientY+12}px`;}
      };
      const cleanup=()=>{card.removeEventListener('pointermove',move);card.removeEventListener('pointerup',finish);card.removeEventListener('pointercancel',cancel);ghost?.remove();audioDragCancel=null;};
      const finish=ev=>{const dragged=!!ghost;cleanup();if(!dragged)return;const lane=timeline.querySelector('.ez-audio-lane'),rect=lane.getBoundingClientRect();if(ev.clientX>=rect.left&&ev.clientX<=rect.right&&ev.clientY>=rect.top&&ev.clientY<=rect.bottom){placeExistingAudio(asset.id,(ev.clientX-rect.left)/(timelineWidth/duration(p)),true);}};
      const cancel=()=>cleanup();audioDragCancel=cancel;card.addEventListener('pointermove',move);card.addEventListener('pointerup',finish);card.addEventListener('pointercancel',cancel);
    };
  }
  function renderAudioInspector(){
    const c=p.audio.find(x=>x.id===selectedAudio);if(!c)return;
    const box=el('div','ez-audio-editor');box.append(el('h3','',t('audioClip',mediaAsset(c.asset_id)?.label||'')));
    const row=el('div','ez-row');
    row.append(field(t('audioStart'),inputNumber(c.start,v=>mutate(()=>c.start=v,{strict:true}))),field(t('sourceIn'),inputNumber(c.source_in,v=>mutate(()=>c.source_in=v,{strict:true}))),field(t('length'),inputNumber(c.duration,v=>mutate(()=>c.duration=v,{strict:true}),.001)),btn(t('split'),()=>mutate(()=>splitAudio(p,c.id,playhead),{strict:true})),btn(t('deleteAudioClip'),()=>deleteAudio(c.id)));
    row.title=t('audioHelp');box.append(row);inspector.append(box);
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
    timeline.replaceChildren();const controls=el('div','ez-track-head');
    controls.append(el('h3','',t('timelineDuration',duration(p).toFixed(3))),btn(t('addShot'),()=>mutate(()=>{selected=insertShot(p,p.shots.findIndex(x=>x.id===selected)).id;selectedAudio=null;selectionKind='shot';})),
      btn(t('duplicate'),()=>mutate(()=>{if(selectedAudio){selectedAudio=duplicateAudio(p,selectedAudio).id;selectionKind='audio';return;}if(p.shots.length>=16)throw new Error(t('maxShots'));const i=p.shots.indexOf(current()),copy={...clone(current()),id:uid('shot'),label:`${current().label} copy`};p.shots.splice(i+1,0,copy);selected=copy.id;selectedAudio=null;selectionKind='shot';})),
      btn(t(selectedAudio?'deleteAudioClip':'deleteShot'),deleteSelection),
      btn('←',()=>{if(!selectedAudio)mutate(()=>moveShot(p,selected,p.shots.indexOf(current())-1));}),btn('→',()=>{if(!selectedAudio)mutate(()=>moveShot(p,selected,p.shots.indexOf(current())+1));}),
      btn(t('splitHere'),()=>mutate(()=>{if(selectedAudio){splitAudio(p,selectedAudio,playhead);return;}const g=geometry(p).find(g=>g.id===selected);splitShot(p,selected,playhead-g.start);})),el('span','spacer'));
    const zoomControls=el('div','ez-zoom-controls'),zoomOut=btn('−',()=>zoomTimeline(1/1.25)),zoomIn=btn('＋',()=>zoomTimeline(1.25));
    zoomOut.setAttribute('aria-label',t('zoomOut'));zoomIn.setAttribute('aria-label',t('zoomIn'));zoomOut.title=t('zoomOutHelp');zoomIn.title=t('zoomInHelp');zoomOut.disabled=zoom<=1;zoomIn.disabled=zoom>=8;zoomControls.append(zoomOut,zoomIn);controls.append(zoomControls);
    if(selectedAudio)for(const b of controls.querySelectorAll('button')){if(b.textContent===t('duplicate'))b.title=t('duplicateAudioHelp');if(b.textContent===t('splitHere'))b.title=t('splitAudioHelp');if(['←','→'].includes(b.textContent))b.disabled=true;}
    if(duration(p)>videoDuration(p)+.001)controls.insertBefore(btn(t('fitVideoAudio'),()=>mutate(()=>{p=fitVideoToAudio(p);}),'primary'),controls.querySelector('.spacer'));
    applyUIHelp(controls,locale);
    const scroll=el('div','ez-scroll'),track=el('div','ez-track-content'),ruler=el('div','ez-ruler'),shots=el('div','ez-shot-lane'),audioLane=el('div','ez-audio-lane');
    scroll.append(track);timeline.append(controls,scroll);
    timelineWidth=Math.max(1,scroll.clientWidth)*zoom;track.style.width=`${timelineWidth}px`;const total=duration(p),scale=timelineWidth/total;
    for(let t=0;t<total+.01;t+=Math.max(1,Math.ceil(total/14))){const tick=el('span','ez-tick',`${t}s`);tick.style.left=`${t*scale}px`;ruler.append(tick);}
    const seekEvent=e=>{const rect=track.getBoundingClientRect();seek(Math.max(0,Math.min(total,(e.clientX-rect.left)/scale)));};
    ruler.onpointerdown=e=>{seekEvent(e);ruler.setPointerCapture(e.pointerId);const move=e=>seekEvent(e);ruler.addEventListener('pointermove',move);ruler.onpointerup=()=>ruler.removeEventListener('pointermove',move);};
    for(const g of geometry(p)){
      const s=p.shots[g.index],card=el('div','ez-shot'+(selected===s.id&&!selectedAudio&&selectionKind==='shot'?' active':''));card.dataset.shotId=s.id;card.style.left=`${g.start*scale}px`;card.style.width=`${Math.max(20,g.seconds*scale-5)}px`;card.draggable=true;
      const image=s.first_image || (g.index===0?p.first_image:null) || p.reference_slots[(refsFor(p,s)[0]||0)-1];if(image)card.append(img(image));
      card.append(el('strong','',s.label),el('small','ez-shot-duration',t('shotCard',g.seconds.toFixed(2),t(g.index===0||s.transition==='cut'?'cut':'continued'))),el('small','ez-shot-prompt',resolveText(p,{field:'prompt',shot_id:s.id},externalConnected?lastExternal:null,assistState().outputSize).text.trim().slice(0,45)||t('usingCommon')));
      card.onclick=()=>{if(suppressShotClick)return;selected=s.id;selectedAudio=null;selectionKind='shot';seek(g.start);renderInspector();renderTimeline();};
      const state=runMatches()?generation.states[s.id]:samePlan()?{phase:'complete',done:[],total:0}:null;
      if(state){const badge=el('span','ez-shot-status '+state.phase,t('status_'+state.phase));badge.title=state.total?t('partsDone',state.done.length,state.total):t('status_complete');card.append(badge);}
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
      bindDrop(card,async e=>{const source=e.dataTransfer.getData('application/x-h3ez-shot'),aid=dropAsset(e);if(source)mutate(()=>moveShot(p,source,g.index));else if(aid&&mediaAsset(aid)?.kind==='image')mutate(()=>assignImage(aid,s));else if(e.dataTransfer.files.length){selected=s.id;await addFiles(e.dataTransfer.files,'shot');}});
      shots.append(card);
    }
    bindDrop(shots,async e=>{const id=dropAsset(e);if(id&&mediaAsset(id)?.kind==='image')mutate(()=>{const s=insertShot(p);assignImage(id,s);selected=s.id;});else if(e.dataTransfer.files.length)await addFiles(e.dataTransfer.files,'newshot');});
    if(!p.audio.length)audioLane.append(el('div','ez-audio-empty',t('emptyAudio')));
    bindDrop(audioLane,async e=>{const at=Math.max(0,(e.clientX-track.getBoundingClientRect().left)/scale),id=dropAsset(e);if(id)placeExistingAudio(id,at,true);else await addFiles(e.dataTransfer.files,'audio',at);});
    for(const c of p.audio){
      const a=mediaAsset(c.asset_id),card=el('div','ez-audio-clip'+(selectedAudio===c.id?' active':''));card.dataset.audioId=c.id;card.tabIndex=0;card.setAttribute('role','option');card.setAttribute('aria-label',t('audioClip',a?.label||''));card.setAttribute('aria-selected',String(selectedAudio===c.id));card.style.left=`${c.start*scale}px`;card.style.width=`${Math.max(10,c.duration*scale)}px`;
      const cv=el('canvas');cv.width=Math.max(20,Math.round(c.duration*scale));cv.height=42;card.append(cv,el('span','ez-audio-name',a?.label||t('audio')));
      const left=el('span','ez-trim left'),right=el('span','ez-trim right');card.append(left,right);
      bindAudioDrag(card,c,scale,'move');bindAudioDrag(left,c,scale,'left');bindAudioDrag(right,c,scale,'right');
      drawWave(cv,c);audioLane.append(card);ensureWave(a);
    }
    head=el('div','ez-playhead');track.append(ruler,shots,audioLane,head);scroll.scrollLeft=scrollBefore;updatePlayhead();
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
          const resized=resizeShot(before,s.id,edge,boundary+(event.clientX-x)/scale,{snapTimes,scale,disableSnap:event.altKey,allowAudioOverhang:true});p=resized.plan;failure=null;
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
      const total=previous?video.duration:duration(p);
      clockLabel.textContent=`${stamp(position)} / ${Number.isFinite(total)?stamp(total):'—'}`;
    }
    const {asset,fallback}=previewAsset();
    if(resultLabel){
      const mode=showingResult?(stale?'previousVideoUnsynced':'resultPreview'):
        asset&&fallback?'libraryPreview':stale?'staleResult':resultVideo?'layoutPreview':'previewNotGenerated';
      resultLabel.textContent=showingResult&&activeVideo?.end!=null?t('partialPreview',stamp(activeVideo.start),stamp(activeVideo.end)):t(mode);
      if(showingResult&&videoSize?.width)resultLabel.textContent+=` · ${videoSize.width} × ${videoSize.height}`;
      resultLabel.title=stale?t('previousVideoUnsynced'):'';
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
    refreshRunNotice();
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
      updatePlayhead();syncAudio();
      if(playhead>=duration(p)){pause();return;}
    }
    frame=requestAnimationFrame(tick);
  }
  function playback(){
    if(resultActive()){
      if(resultMatches)video.currentTime=Math.max(0,(playhead>=duration(p)?videoOffset():playhead)-videoOffset());
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
    updateResultState();
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
    if(applying)return;submissionError='';queueAcknowledged=false;applying=true;updateApplyControls();clearTimeout(editCheckTimer);
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
      if(doQueue&&duration(draft)>videoDuration(draft)+.001)throw new Error(t('videoShortfall',(duration(draft)-videoDuration(draft)).toFixed(3)));
      if(doQueue&&assist){
        const checked=await assist.preflight(draft);
        if(closed)return;
        if(draft.audio.some(c=>(c.volume??1)!==1)&&checked.audio_clip_volume!==true)throw new Error(t('restartForVolume'));
        if(editAtStart!==JSON.stringify(p))throw new Error(locale==='ja'?'確認中に編集されました。もう一度実行してください。':'Edits occurred during preflight. Run again.');
        if(!checked.ok)throw new Error(checked.video_shortfall>.001?t('videoShortfall',checked.video_shortfall.toFixed(3)):checked.errors.map(x=>x.message).join(' | '));
      }
      await onApply(draft);
      if(closed)return;
      if(!p.resolution)p.resolution={...studioResolutionDefaults};
      if(!p.chunking)p.chunking={enabled:true,seconds:DEFAULT_CHUNK_SECONDS};
      saved=JSON.stringify(draft);
      if(mediaError===previousMediaError)mediaError=null;
      checks();
      if(doQueue){if(!onQueue)throw new Error(t('queueUnavailable'));submitting=true;queue.disabled=true;setQueue({phase:'submitting'});await onQueue();queueAcknowledged=true;message(t('queued'));}
    }catch(e){submissionError=errorText(e,t);if(doQueue&&submitting)setQueue({phase:'failed',detail:submissionError});message(submissionError,true);}finally{applying=false;submitting=false;if(!closed)updateApplyControls();}
  }
  function requestClose(){if((dirty()||assistPanel?.hasPendingEdits())&&!confirm(t('discardConfirm')))return;close();}
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
    if(!text&&e.code==='Space'){e.preventDefault();playing?pause():playback();}
  });
  // Prevent image drops over this dialog from being interpreted as workflow imports.
  dialog.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();});
  dialog.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();});
  document.body.append(dialog);dialog.showModal();render();
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
    pause();
    resultVideo=result;resultPlanText=JSON.stringify(read(result.plan));
    generation=null;generationPlanText=null;
    video.src=result.url;
    if(!restored)previewMode='auto';
    updateResultState();
    if(resultActive()&&resultMatches)seek(playhead);
    renderTimeline();
  }
  function setProgress(value){generation=value;generationPlanText=value?JSON.stringify(value.plan):null;if(shotDragCancel)return;updateResultState();renderTimeline();if(value.warning)message(t('partialPreviewUnavailable'),true);}
  setQueue(queueState);
  return {setResult,setProgress,setQueue,setExternal:(linked,text)=>{externalConnected=linked;lastExternal=text;renderInspector();checks();},focus:()=>dialog.focus(),close:()=>{observer.disconnect();originalClose();},getDraft:()=>clone(p),element:dialog};
}

