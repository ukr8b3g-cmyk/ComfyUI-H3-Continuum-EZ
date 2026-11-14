// One row selects the actual prompt source. Originals are never overwritten by AI.
import {dependencyPayload,entryIsCurrent,targetKey,originalText,resolveText,validateCandidate} from './enhancer.js';
import {VISUAL_CONTRACT} from './assist_context.js';
import {errorText,translator} from './i18n.js';
const words={
 original:['Original','原文'],ai:['AI Text','AI文'],generate:['Generate AI Text','AI文生成'],stop:['Stop','中止'],image:['AI Image','AI画像'],none:['No assigned images · text only','参照なし · 文章のみ'],
 originalHelp:['Use this field’s original text for video generation. The AI text is kept.','この欄の原文を動画生成に使用します。AI文は保持します。'],aiHelp:['Use this field’s saved AI text for video generation. The original is kept.','この欄のAI文を動画生成に使用します。原文は保持します。'],
 generateHelp:['Generate and use AI text for this field. The original is retained. Review and edit the result.','この欄のAI文を生成して使用します。原文は保持します。結果を確認し、必要に応じて編集してください。'],
 imageHelp:['AI uses images assigned to this field. A library image shown only in the preview is not assigned.','AIにはこの欄に割り当てた画像が渡ります。素材プレビューだけに表示される画像は未割り当てです。'],
 stopHelp:['Cancel this text request; keep the previous text. A running job may finish on the server.','この文章生成を中止し、直前の文章を保ちます。実行中の処理はサーバー側で完了する場合があります。'],
 missing:['AI text model unavailable.','AI用の文章モデルが利用できません。'],
 empty:['Enter text first.','先に本文を入力してください。'],noAI:['Generate AI text first.','先にAI生成を実行してください。'],stale:['Input changed · AI text saved','入力変更 · AI文は保存済み'],
 staleHelp:['The saved AI text is still stored. The original is in use. Restore the previous input or generate AI text for the current input.','AI文は保存されています。現在は原文を使用します。元の入力に戻すか、現在の入力でAI文を生成してください。'],
 preparing:['Preparing','準備中'],submitting:['Submitting','送信中'],queued:['Queued','待機中'],running:['Generating','生成中'],saving:['Saving','保存中'],edited:['Unsaved edit','未保存'],
 error:['Failed','エラー'],cancelled:['Stopped','中止しました'],usedOriginal:['Original in use','原文使用'],usedAI:['AI text in use','AI文使用'],
 all:['Generate All AI Text','全ショットAI文生成'],allOriginal:['All Originals','全て原文'],allHelp:['Generate AI text for each nonempty shot prompt. The common prompt stays as selected.','本文のある各ショットのAI文を順に生成します。共通プロンプトの選択はそのままです。'],
 allOriginalHelp:['Use originals for every field. Keep all saved AI text. Undo is available.','全ての欄を原文へ戻します。AI文は保持します。「元に戻す」で取り消せます。'],
 uncertain:['Submission unconfirmed · check queue','受付不明 · キュー確認'],recheck:['Check Queue','受付確認'],done:['completed','完了'],
};
const el=(tag,cls='',text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const button=(text,run,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=run;return b;};
export function createAssistPanel({client,getState,onAdopt,onRestore,onRestoreAll,onMissingReferences,locale='en'}){
 const translate=translator(locale),t=k=>words[k]?.[locale==='ja'?1:0]||k,slots=new Map();let bindings=[],disposed=false,batch=null,globalMessage='';
 const entryFor=(p,target)=>p.prompt_enhancer?.texts?.find(x=>targetKey(x.target)===targetKey(target));
 const slot=target=>{const key=targetKey(target);if(!slots.has(key))slots.set(key,{target:{...target},edit:null,imageId:'',job:null,saving:null,running:false,attempt:0});return slots.get(key);};
 const savedCurrent=(p,target,external)=>{const e=entryFor(p,target);return !!e&&entryIsCurrent(p,e,external,getState().outputSize??null);};
 const generating=()=>!!client.active||[...slots.values()].some(s=>s.running);
 const busy=()=>generating()||[...slots.values()].some(s=>s.saving);
 const modelReady=()=>!!getState().identity?.canvasModel;
 function referenceImages(state,target){
  try{return dependencyPayload(state.plan,target,state.external??null,VISUAL_CONTRACT,null,state.outputSize??null).images;}
  catch{return [];}
 }
 async function prepareReferences(targets,batchMode=false){
  if(disposed)return false;
  const state=getState();
  if(!onMissingReferences||!modelReady()||!state.plan.assets.some(a=>a.kind==='image'))return true;
  const missing=targets.filter(target=>!referenceImages(state,target).length);
  return !missing.length||await onMissingReferences(missing,batchMode);
 }
 function update(){if(disposed)return;const live=new Set(['global',...getState().plan.shots.map(s=>'shot:'+s.id)]);for(const key of slots.keys())if(!live.has(key))slots.delete(key);for(const b of bindings)b();renderGlobal();}
 async function flushSlot(s){
  if(s.saving)return s.saving;
  const entry=entryFor(getState().plan,s.target);if(s.edit==null||s.edit===entry?.text)return;
  if(!entry)throw new Error(t('noAI'));
  const text=s.edit;try{validateCandidate(text);}catch(e){s.job={phase:'error',detail:errorText(e,translate)};update();throw e;}s.job={phase:'saving'};
  s.saving=(async()=>{try{const result=await client.editAdopted(entry,text);if(disposed)return;onAdopt(result);if(s.edit===text)s.edit=null;s.job=null;}catch(e){s.job={phase:'error',detail:errorText(e,translate)};throw e;}finally{s.saving=null;update();}})();update();return s.saving;
 }
 async function flush(){for(const s of slots.values())await flushSlot(s);}
 async function generate(target){
  if(!modelReady()){
   const error=new Error(t('missing'));
   slot(target).job={phase:'error',detail:error.message};update();throw error;
  }
  const s=slot(target),attempt=++s.attempt;s.running=true;s.job={phase:'preparing'};update();
  try{
   const result=await client.generate({target,refresh:true});
   if(disposed||attempt!==s.attempt)return false;
   s.job={phase:'saving'};update();const entry=await client.adopt(result);
   if(disposed||attempt!==s.attempt)return false;
   onAdopt(entry);s.edit=null;s.job=null;return true;
  }catch(e){if(!disposed&&attempt===s.attempt)s.job={phase:e.name==='AssistCancelled'?'cancelled':'error',detail:e.name==='AssistCancelled'?'':errorText(e,translate)};throw e;}
  finally{if(attempt===s.attempt)s.running=false;update();}
 }
 function stop(){
  if(batch)batch.cancelled=true;
  for(const s of slots.values())if(s.running){s.attempt++;s.running=false;s.job={phase:'cancelled'};}
  client.invalidate('cancelled');update();
 }
 const global=el('div','ez-top-group ez-ai-global');
 const all=button(t('all'),async()=>{
  if(batch){stop();return;}if(generating())return;
  if(!modelReady()){globalMessage=t('missing');update();return;}
  const currentBatch={cancelled:false,index:0,total:0};batch=currentBatch;globalMessage='';update();
  try{await flush();const p=getState().plan,targets=p.shots.filter(shot=>shot.prompt.trim()).map(shot=>({field:'prompt',shot_id:shot.id}));currentBatch.total=targets.length;
   if(currentBatch.cancelled||!await prepareReferences(targets,true))return;
   for(const target of targets){if(currentBatch.cancelled||disposed)break;currentBatch.index++;update();await generate(target);}
   globalMessage=currentBatch.cancelled?t('cancelled'):`${currentBatch.index}/${currentBatch.total} ${t('done')}`;
  }catch(e){globalMessage=currentBatch.cancelled?t('cancelled'):errorText(e,translate);}
  finally{batch=null;update();}
 },'ez-ai-generate');all.title=t('allHelp');
 const allOriginal=button(t('allOriginal'),async()=>{try{await flush();}catch{return;}for(const s of slots.values()){s.edit=null;s.job=null;}onRestoreAll();globalMessage='';update();});allOriginal.title=t('allOriginalHelp');
 const globalStatus=el('span','ez-ai-global-state');globalStatus.setAttribute('role','status');global.append(all,allOriginal,globalStatus);
 function renderGlobal(){const active=generating();all.textContent=batch?`${t('stop')} ${batch.index}/${batch.total||'…'}`:t('all');all.disabled=(!batch&&active)||!!client.uncertain;all.title=t(batch?'stopHelp':'allHelp');allOriginal.disabled=active||!!batch||!getState().plan.prompt_enhancer?.texts?.some(e=>!e.inactive&&getState().plan.prompt_enhancer.enabled);globalStatus.textContent=globalMessage;globalStatus.title=globalMessage;}
 function bind({target,area,wrap,counter=null,onDisplay=()=>{}}){
  const s=slot(target),key=targetKey(target),root=el('div','ez-ai-inline'),bar=el('div','ez-ai-toolbar'),choice=el('div','ez-ai-choice');choice.setAttribute('role','group');choice.setAttribute('aria-label',locale==='ja'?'生成に使う文章':'Text source');
  const original=button(t('original'),async()=>{if(generating()||batch)return;try{await flushSlot(s);s.edit=null;s.job=null;onRestore(target);}catch(e){s.job={phase:'error',detail:errorText(e,translate)};}update();});original.title=t('originalHelp');
  const ai=button(t('ai'),async()=>{if(generating()||batch)return;try{await flushSlot(s);const entry=entryFor(getState().plan,target);if(!entry)return;s.job={phase:'saving'};s.saving=client.editAdopted(entry,entry.text);update();const result=await s.saving;if(!disposed)onAdopt(result);s.job=null;}catch(e){s.job={phase:'error',detail:errorText(e,translate)};}finally{s.saving=null;update();}});ai.title=t('aiHelp');choice.append(original,ai);
  const run=button(t('generate'),async()=>{
   if(s.running){stop();return;}
   if(generating()||batch)return;
   try{await flush();if(await prepareReferences([target])&&!disposed)await generate(target);}
   catch{/* The field retains the error. */}
  },'ez-ai-generate');
  // A textarea blur may finish its save and rebuild this toolbar before the
  // pointer's click arrives. Keep focus until the chosen action owns the save.
  // Keyboard activation still uses the normal click handler.
  for(const control of [original,ai,run])control.onpointerdown=e=>{if(e.button===0)e.preventDefault();};
  const image=el('span','ez-ai-context');image.title=t('imageHelp');image.tabIndex=0;
  const status=el('span','ez-ai-state');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const retry=button(t('recheck'),async()=>{try{await client.confirmUnknownSubmission();}catch(e){s.job={phase:'error',detail:errorText(e,translate)};}update();});retry.title=t('uncertain');
  const job=el('div','ez-ai-error');job.setAttribute('role','alert');bar.append(choice,run,image,retry,status);root.append(bar,job);
  if(counter)bar.append(counter);
  const source={input:area.oninput,focus:area.onfocus,blur:area.onblur,label:area.getAttribute('aria-label'),title:area.title};let editingAI=false;
  area.onfocus=e=>{editingAI=resolveText(getState().plan,target,getState().external??null,getState().outputSize??null).status==='enhanced';if(!editingAI)source.focus?.(e);};
  area.oninput=e=>{if(editingAI)s.edit=area.value;else source.input?.(e);onDisplay();update();};
  area.onblur=e=>{if(editingAI){void flushSlot(s).catch(()=>{});}else source.blur?.(e);};
  function render(){
   if(disposed)return;const state=getState(),p=state.plan,entry=entryFor(p,target),resolved=resolveText(p,target,state.external??null,state.outputSize??null),usingAI=resolved.status==='enhanced';
   if(!entry)s.edit=null;
   const value=usingAI?(s.edit??entry.text):originalText(p,target,state.external??null);
   if(area.value!==value)area.value=value;
   area.readOnly=s.running||!!s.saving;area.setAttribute('aria-label',usingAI?`${t('ai')}：${source.label}`:source.label);area.title=source.title;area.setAttribute('aria-busy',String(s.running));onDisplay();
   wrap.dataset.aiState=s.running?'running':s.edit!=null?'edited':usingAI?'adopted':'original';
   original.classList.toggle('selected',!usingAI);ai.classList.toggle('selected',usingAI);original.setAttribute('aria-pressed',String(!usingAI));ai.setAttribute('aria-pressed',String(usingAI));
   original.disabled=generating()||!!batch;ai.disabled=generating()||!!batch||!entry||!savedCurrent(p,target,state.external??null);
   ai.title=!entry?t('noAI'):!savedCurrent(p,target,state.external??null)?t('staleHelp'):t('aiHelp');
   run.textContent=t(s.running&&!batch?'stop':'generate');run.disabled=(!s.running&&(generating()||!!batch))||!originalText(p,target,state.external??null).trim()||!!client.uncertain;
   run.title=s.running?t('stopHelp'):!originalText(p,target,state.external??null).trim()?t('empty'):t('generateHelp');
   const refs=referenceImages(state,target);
   image.textContent=refs.length?(locale==='ja'?`AIに渡す画像 ${refs.length}枚`:`${refs.length} images for AI`):t('none');
   image.setAttribute('aria-label',image.textContent);image.title=t('imageHelp');
   const phase=s.job?.phase;
   status.textContent=s.running||s.saving?t(phase||'running'):phase==='error'?t('error'):s.edit!=null?t('edited'):resolved.status==='stale'?t('stale'):t(usingAI?'usedAI':'usedOriginal');
   status.title=resolved.status==='stale'?t('staleHelp'):status.textContent;
   const error=client.uncertain?t('uncertain'):phase==='error'&&s.job.detail?errorText(s.job.detail,translate):'';job.hidden=!error;job.textContent=error;retry.hidden=!client.uncertain;retry.disabled=busy();
  }
  bindings.push(render);render();return root;
 }
 renderGlobal();
 const pendingEdits=()=>[...slots.values()].filter(s=>s.edit!=null&&s.edit!==entryFor(getState().plan,s.target)?.text);
 return {bind,global,beginRender(){bindings=[];},update,flush,isBusy:()=>busy()||!!batch,
  setStatus(value){if(value.target){slot(value.target).job=value;update();}},
  hasPendingEdits:()=>pendingEdits().length>0,
  draftEdits:()=>pendingEdits().map(s=>({target:s.target,text:s.edit})),
  restoreDraftEdits(edits){for(const {target,text} of edits||[])if(entryFor(getState().plan,target)&&typeof text==='string')slot(target).edit=text;},
  reset(){slots.clear();globalMessage='';},
  dispose(){disposed=true;if(batch)batch.cancelled=true;client.dispose();slots.clear();bindings=[];}};
}
