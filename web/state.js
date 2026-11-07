import {StudioError} from './i18n.js';
import {assemblePrompt} from './prompting.js';
import {resolveText,validateEnhancer} from './enhancer.js';
import {validateStory,storyText,actionPositions} from './story_tools.js';
// Pure editor model. Numeric duration planning mirrors the original Continuum grid.
export const clone = v => JSON.parse(JSON.stringify(v));
export const uid = p => `${p}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
export const FPS = 24;
export const DEFAULT_CHUNK_SECONDS = 7.5;
export const MAX_SHOT_SECONDS=600,MAX_TIMELINE_SECONDS=3600;
export function initial() {
  return {schema:1, output_mode:'Long video', resolution:{source:'studio',aspect:'16:9',megapixels:.3}, assets:[], reference_slots:Array(9).fill(null), global_refs:[], first_image:null, global_prompt:'',
    shots:[{id:uid('shot'),label:'Shot 1',seconds:5,transition:'cut',prompt:'',prompt_mode:'append',refs:null,first_image:null}],audio:[],chunking:{enabled:true,seconds:DEFAULT_CHUNK_SECONDS}};
}
export function read(value) {
  const p = typeof value === 'string' ? JSON.parse(value) : clone(value);
  if (!p || ![1,2].includes(p.schema) || !Array.isArray(p.shots)) throw new StudioError('unsupportedSchema');
  return p;
}
export function roundEven(n) { const f=Math.floor(n), d=n-f; return Math.abs(d-.5)<1e-10 ? (f%2 ? f+1 : f) : Math.round(n); }
export const ASPECT_RATIOS=['1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9'];
export function resolutionSize(value){
  if(!value||!['studio','engine'].includes(value.source)||!ASPECT_RATIOS.includes(value.aspect)||typeof value.megapixels!=='number'||!Number.isFinite(value.megapixels)||value.megapixels<.01||value.megapixels>16)throw new StudioError('invalidResolution');
  const [a,b]=value.aspect.split(':').map(Number),mp=value.megapixels;
  return {width:Math.max(32,roundEven(Math.sqrt(mp*1e6*a/b)/32)*32),height:Math.max(32,roundEven(Math.sqrt(mp*1e6*b/a)/32)*32)};
}
export function geometry(p) {
  let cursor=0;
  return p.shots.map((s,i)=>{
    const req=roundEven(Number(s.seconds)*24);
    const frames=(i===0 || s.transition==='cut') ? req+((5-req)%17+17)%17 : Math.max(17,Math.floor((req+8)/17)*17);
    const g={id:s.id,index:i,start:cursor/24,end:(cursor+frames)/24,frames,seconds:frames/24};cursor+=frames;return g;
  });
}
export const duration = p => geometry(p).at(-1)?.end || 0;
export function executionPlan(p){
  const out=[];
  const options=p.chunking||{enabled:true,seconds:DEFAULT_CHUNK_SECONDS},unitLimit=Math.max(3,roundEven(options.seconds*FPS/17));
  for(const g of geometry(p)){
    const s=p.shots[g.index],cut=g.index===0||s.transition==='cut',phase=cut?5:0;
    const units=(g.frames-phase)/17,count=options.enabled?Math.ceil(units/unitLimit):1,base=Math.floor(units/count),extra=units%count;
    let start=roundEven(g.start*FPS);
    for(let i=0;i<count;i++){
      const frames=17*(base+(i<extra?1:0))+(i===0?phase:0);
      out.push({id:`${s.id}-part-${i+1}`,index:out.length,shot_id:s.id,shot_index:g.index,part_index:i,part_count:count,
        shot_start_frame:roundEven(g.start*FPS),start_frame:start,frames,start:start/FPS,end:(start+frames)/FPS,seconds:frames/FPS,
        transition:cut&&i===0?'cut':'continue',first_image:firstFor(p,g.index)||null,last_image:i===count-1?(s.last_image||null):null});
      start+=frames;
    }
  }
  return out;
}
export function dialogueForPart(p,s,part){
  const lines=s.dialogue||[],g=geometry(p)[part.shot_index],out=[];
  lines.forEach((line,i)=>{
    const frame=Math.min(g.frames-1,line.at==null?Math.floor(i*g.frames/Math.max(1,lines.length)):roundEven(line.at*FPS));
    const absolute=roundEven(g.start*FPS)+frame;
    if(absolute>=part.start_frame&&absolute<part.start_frame+part.frames)out.push({...line,offset:(absolute-part.start_frame)/FPS});
  });return out;
}
export const refsFor = (p,s) => [...(s.refs==null ? p.global_refs : s.refs)].sort((a,b)=>a-b);
export function firstFor(p,index) {let f=p.shots[0]?.first_image || p.first_image;for(let i=1;i<=index;i++) if(p.shots[i].transition==='cut')f=p.shots[i].first_image;return f;}
export const commonPrompt = (p,external=null) => p.prompt_source==='studio'||external===null ? p.global_prompt : external;
export function editPrompt(p,index,part,text){
  if(part==='global'){p.global_prompt=text;p.prompt_source='studio';}
  else if(part==='shot')p.shots[index].prompt=text;
  else throw new Error('Unknown prompt part');
}
export function effective(p,index,external=null,partIndex=0,outputSize=undefined) {
  const s=p.shots[index], common=resolveText(p,{field:'global_prompt'},external,outputSize).text;
  const own=resolveText(p,{field:'prompt',shot_id:s.id},external,outputSize).text;
  let text=s.prompt_mode==='replace'?own:[common,own].filter(Boolean).join('\n\n');
  const part=executionPlan(p).find(x=>x.shot_index===index&&x.part_index===partIndex);
  if(!part)throw new Error('Unknown internal part');
  const extra=storyText(p,part,geometry(p)[index]);if(extra)text+='\n\n'+extra;
  const slots=refsFor(p,s),hasFirst=!!part.first_image,hasLast=!!part.last_image,shift=Number(hasFirst)+Number(hasLast);
  const map=Object.fromEntries(slots.map((r,i)=>[`@R${r}`,`<Picture ${i+1+shift}>`]));
  for(const t of text.match(/@R\d+/g)||[]) if(!(t in map)) throw new StudioError('inactiveRef',s.label,t);
  text=text.replace(/@R([1-9])(?![0-9A-Za-z_])/g,t=>map[t]);
  const subjects={};
  for(const slot of slots){
    const id=p.reference_slots[slot-1],a=p.assets.find(a=>a.id===id),picture=map[`@R${slot}`],name=a.subject_name||'';
    subjects[id]=name?JSON.stringify(name):`the subject in ${picture}`;
    if(name)text+=`\n\n${JSON.stringify(name)} refers to the subject shown in ${picture}.`;
  }
  for(const line of dialogueForPart(p,s,part)){
    if(!line.text)continue;
    const speaker=line.speaker?subjects[line.speaker]:'An off-screen narrator';
    text+=`\n\nAbout ${line.offset.toFixed(3)} seconds into the new action, ${speaker} says: ${JSON.stringify(line.text)}`;
  }
  return {text:assemblePrompt(text,Object.values(map),{hasFirst,continuing:part.transition==='continue',lastPicture:hasLast?`<Picture ${1+Number(hasFirst)}>`:null}),map};
}
export function validate(p,{allowAudioOverhang=false}={}) {
  if(p.chunking!==undefined&&(!p.chunking||typeof p.chunking.enabled!=='boolean'||!Number.isFinite(p.chunking.seconds)||p.chunking.seconds<2||p.chunking.seconds>15))throw new StudioError('invalidChunking');
  if(p.chunking?.enabled===false&&p.shots.some(s=>s.seconds>15))throw new StudioError('splitDisabledLongShot');
  if('prompt_source' in p&&!['studio','external'].includes(p.prompt_source))throw new StudioError('invalidPromptSource');
  if ('output_mode' in p && !['Long video', 'Images'].includes(p.output_mode)) throw new StudioError('invalidOutputMode');
  if(p.resolution!==undefined)resolutionSize(p.resolution);
  if(![1,2].includes(p.schema))throw new StudioError('invalidSchema');
  if(!p.shots.length||p.shots.length>16)throw new StudioError('shotRange');
  const assets=new Map(p.assets.map(a=>[a.id,a]));
  if(assets.size!==p.assets.length)throw new StudioError('duplicateAsset');
  for(const a of p.assets){if(!a.file?.name||a.file.type!=='input')throw new StudioError('assetNotUploaded');if('subject_name' in a&&(a.kind!=='image'||typeof a.subject_name!=='string'||a.subject_name.length>80||/[\r\n]/.test(a.subject_name)))throw new StudioError('invalidSubjectName');}
  const image=id=>{if(id && assets.get(id)?.kind!=='image')throw new StudioError('imageMissing');};
  image(p.first_image);p.reference_slots.forEach(image);
  const checkRefs=rs=>{if(!Array.isArray(rs)||new Set(rs).size!==rs.length||rs.some(r=>!Number.isInteger(r)||r<1||r>9||!p.reference_slots[r-1]))throw new StudioError('invalidRefs');};
  checkRefs(p.global_refs);
  for(const [i,s] of p.shots.entries()){
    if(!Number.isFinite(+s.seconds)||+s.seconds<2||+s.seconds>MAX_SHOT_SECONDS)throw new StudioError('invalidShotDuration',s.label);
    image(s.first_image);
    image(s.last_image);
    if(i>0&&s.transition==='continue'&&s.first_image)throw new StudioError('startNeedsCut',s.label);
    if(s.refs!==null)checkRefs(s.refs);
    if(s.prompt.length>250000||p.global_prompt.length>250000)throw new StudioError('promptLimit');
    if(s.dialogue!==undefined){
      if(!Array.isArray(s.dialogue)||s.dialogue.length>32)throw new StudioError('dialogueLimit');
      const active=refsFor(p,s).map(r=>p.reference_slots[r-1]);
      for(const d of s.dialogue){
        if(!d||typeof d.text!=='string'||d.text.length>5000)throw new StudioError('invalidDialogue');
        image(d.speaker);if(d.speaker&&!active.includes(d.speaker))throw new StudioError('speakerReferenceRequired');
        if(d.at!=null&&(!Number.isFinite(d.at)||d.at<0||d.at>=geometry(p)[i].seconds))throw new StudioError('dialoguePastEnd');
      }
    }
  }
  const total=duration(p), clips=[...p.audio].sort((a,b)=>a.start-b.start);
  if(total>MAX_TIMELINE_SECONDS)throw new StudioError('timelineLimit');
  for(const [i,c] of clips.entries()){
    const a=assets.get(c.asset_id);
    if(a?.kind!=='audio')throw new StudioError('audioMissing');
    if(![c.start,c.source_in,c.duration].every(Number.isFinite)||c.start<0||c.source_in<0||c.duration<=0)throw new StudioError('invalidTrim');
    if(c.volume!==undefined&&(!Number.isFinite(c.volume)||c.volume<0||c.volume>1))throw new StudioError('invalidVolume');
    if(!allowAudioOverhang&&c.start+c.duration>total+.001)throw new StudioError('audioPastEnd');
    if(c.start+c.duration>MAX_TIMELINE_SECONDS)throw new StudioError('timelineLimit');
    if(c.source_in+c.duration>a.duration+.01)throw new StudioError('trimPastEnd');
    if(i&&clips[i-1].start+clips[i-1].duration>c.start+.000001)throw new StudioError('overlap');
  }
  validateStory(p,geometry(p));validateEnhancer(p);
  return p;
}
export function registerReference(p,assetId) {
  let i=p.reference_slots.indexOf(assetId);if(i>=0)return i+1;
  i=p.reference_slots.indexOf(null);if(i<0)throw new StudioError('refLimit');
  p.reference_slots[i]=assetId;return i+1;
}
export function removeAsset(p,id) {
  if(p.shots.some(s=>s.dialogue?.some(d=>d.speaker===id)))throw new StudioError('speakerReferenceRequired');
  p.assets=p.assets.filter(a=>a.id!==id);p.audio=p.audio.filter(c=>c.asset_id!==id);
  if(p.first_image===id)p.first_image=null;
  const slot=p.reference_slots.indexOf(id)+1;if(slot){p.reference_slots[slot-1]=null;p.global_refs=p.global_refs.filter(r=>r!==slot);}
  for(const s of p.shots){if(s.reference_roles)s.reference_roles=s.reference_roles.filter(r=>r.asset_id!==id);if(s.first_image===id)s.first_image=null;if(s.last_image===id)s.last_image=null;if(s.refs!==null)s.refs=s.refs.filter(r=>r!==slot);}
}
export function insertShot(p,after=-1) {
  if(p.shots.length>=16)throw new StudioError('maxShots');
  const s={id:uid('shot'),label:`Shot ${p.shots.length+1}`,seconds:5,transition:'continue',prompt:'',prompt_mode:'append',refs:null,first_image:null};
  p.shots.splice(after<0?p.shots.length:after+1,0,s);p.shots[0].transition='cut';return s;
}
export function moveShot(p,id,index) {const from=p.shots.findIndex(s=>s.id===id);if(from<0)return;const [s]=p.shots.splice(from,1);p.shots.splice(Math.max(0,Math.min(index,p.shots.length)),0,s);p.shots[0].transition='cut';}
export function splitShot(p,id,localSeconds) {
  const i=p.shots.findIndex(s=>s.id===id);const s=p.shots[i];
  const total=geometry(p)[i]?.frames,phase=i===0||s?.transition==='cut'?5:0;
  const frames=phase+17*roundEven((localSeconds*FPS-phase)/17);
  if(!s||!Number.isFinite(localSeconds)||localSeconds<2||frames<48||total-frames<48)throw new StudioError('splitShotLimit');
  if(p.shots.length>=16)throw new StudioError('maxShots');
  const splitAt=frames/FPS;
  const right={...clone(s),id:uid('shot'),label:`${s.label} B`,seconds:(total-frames)/FPS,transition:'continue',first_image:null};
  if(s.last_image)s.last_image=null;
  if(s.actions){
    const positions=actionPositions(s,{frames:total}),left=[],rightActions=[];let ongoing=null;
    for(const {frame,action} of positions){
      if(frame<frames){left.push({...action,at:frame/FPS});if(action.kind==='state')ongoing=action;}
      else rightActions.push({...action,id:uid('action'),at:(frame-frames)/FPS});
    }
    if(ongoing&&!rightActions.some(a=>a.kind==='state'&&a.at===0))rightActions.unshift({...ongoing,id:uid('action'),at:0});
    s.actions=left;right.actions=rightActions;
  }
  if(s.dialogue){
    const lines=s.dialogue.map((d,n)=>({...d,at:d.at??Math.floor(n*total/Math.max(1,s.dialogue.length))/FPS}));
    s.dialogue=lines.filter(d=>d.at<splitAt);
    right.dialogue=lines.filter(d=>d.at>=splitAt).map(d=>({...d,at:d.at-splitAt}));
  }
  s.seconds=splitAt;p.shots.splice(i+1,0,right);return right;
}
export function resizeShot(p,id,edge,at,{snapTimes=[],scale=1,disableSnap=false,allowAudioOverhang=false}={}){
  const next=clone(p),gs=geometry(p),i=p.shots.findIndex(s=>s.id===id);
  if(i<0||!Number.isFinite(at)||!['left','right'].includes(edge)||(edge==='left'&&i===0))throw new StudioError('invalidResize');
  let snapped=false;
  if(!disableSnap){const candidates=snapTimes.filter(Number.isFinite).filter(t=>Math.abs(at-t)*scale<=8).sort((a,b)=>Math.abs(at-a)-Math.abs(at-b));if(candidates.length){at=candidates[0];snapped=true;}}
  const phase=j=>j===0||p.shots[j].transition==='cut'?5:0;
  const bounds=j=>{const q=phase(j);return {min:q+17*Math.ceil((48-q)/17),max:q+17*(q?Math.ceil((600*FPS-q)/17):Math.floor((600*FPS+8)/17))};};
  const j=edge==='left'?i-1:i,q=phase(j),b=bounds(j);
  let lo=b.min,hi=b.max,total=0;
  if(edge==='left'){total=gs[j].frames+gs[i].frames;const c=bounds(i);lo=Math.max(lo,total-c.max);hi=Math.min(hi,total-c.min);}
  const wanted=roundEven((at-gs[j].start)*FPS),frames=Math.max(lo,Math.min(hi,q+17*roundEven((wanted-q)/17)));
  next.shots[j].seconds=Math.min(MAX_SHOT_SECONDS,frames/FPS);
  if(edge==='left')next.shots[i].seconds=Math.min(MAX_SHOT_SECONDS,(total-frames)/FPS);
  validate(next,{allowAudioOverhang});
  const actual=geometry(next)[j].end;
  return {plan:next,at:actual,snapped:snapped&&Math.abs(actual-at)*scale<=8};
}
export function splitAudio(p,id,at) {
  const i=p.audio.findIndex(c=>c.id===id),c=p.audio[i];if(!c)throw new StudioError('selectAudioClip');
  const n=at-c.start;if(n<.001||c.duration-n<.001)throw new StudioError('audioSplitPosition');
  const right={...c,id:uid('audio'),start:at,source_in:c.source_in+n,duration:c.duration-n};c.duration=n;p.audio.splice(i+1,0,right);return right;
}
export function parseScript(text,count) {
  const header=/^\[Shot ([1-9]\d*)\][ \t]*$/gm;
  const matches=[...text.matchAll(header)];if(!matches.length)throw new StudioError('shotHeaderRequired');
  if(text.slice(0,matches[0].index).trim())throw new StudioError('textBeforeHeader');
  const seen=new Set();return matches.map((m,i)=>{
    const index=Number(m[1])-1;if(index>=count||seen.has(index))throw new StudioError('invalidShotNumber');seen.add(index);
    const body=text.slice(m.index+m[0].length,matches[i+1]?.index??text.length).replace(/^\r?\n/,'').replace(/\r?\n$/,'');
    return {index,text:body};
  });
}
export class History {
  constructor(){this.back=[];this.forward=[];}
  record(before){this.back.push(clone(before));if(this.back.length>60)this.back.shift();this.forward=[];}
  undo(current){if(!this.back.length)return current;this.forward.push(clone(current));return this.back.pop();}
  redo(current){if(!this.forward.length)return current;this.back.push(clone(current));return this.forward.pop();}
}
