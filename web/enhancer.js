// Pure, bounded prompt selection. Keep dependency_payload/resolve_prompt_text parity
// with enhancer.py. No fetch, model work or image preprocessing in this module.
import {VISUAL_CONTRACT,MAX_AI_IMAGES,visualTiming,visualOutput} from './assist_context.js';
export const PROFILE='ez-shot-v1';
export const DEFAULT_MODEL='p-h3-image_prompt_upsampler_w4a8.safetensors';
const CONTRACT='h3ez-assist-v1';
export const SHOT_ONLY_CONTRACT='h3ez-assist-shot-v2';
const HEX=/^[0-9a-f]{64}$/;
const IDs=/^[A-Za-z0-9_-]{1,96}$/;
export const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const K=Uint32Array.from([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const hashCache=new Map();let hashBytes=0;
export function sha256(text){
  if(hashCache.has(text)){const out=hashCache.get(text);hashCache.delete(text);hashCache.set(text,out);return out;}
  const src=new TextEncoder().encode(text),length=Math.ceil((src.length+9)/64)*64,bytes=new Uint8Array(length);
  bytes.set(src);bytes[src.length]=128;
  const view=new DataView(bytes.buffer);view.setUint32(length-8,Math.floor(src.length/0x20000000));view.setUint32(length-4,(src.length*8)>>>0);
  const h=Uint32Array.from([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),w=new Uint32Array(64),r=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let offset=0;offset<length;offset+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(r(a,7)^r(a,18)^(a>>>3))+w[i-7]+(r(b,17)^r(b,19)^(b>>>10)))>>>0;}
    let [a,b,c,d,e,f,g,z]=h;
    for(let i=0;i<64;i++){const t1=(z+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    [a,b,c,d,e,f,g,z].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
  }
  const out=Array.from(h,v=>v.toString(16).padStart(8,'0')).join('');
  if(text.length<128000){hashCache.set(text,out);hashBytes+=text.length*2;while(hashCache.size>32||hashBytes>1024*1024){const key=hashCache.keys().next().value;hashBytes-=key.length*2;hashCache.delete(key);}}
  return out;
}
export function targetKey(target){
  if(!target||typeof target!=='object'||Array.isArray(target))throw new Error('Invalid prompt target');
  const keys=Object.keys(target).sort().join(',');
  if(keys==='field'&&target.field==='global_prompt')return 'global';
  if(keys==='field,shot_id'&&target.field==='prompt'&&typeof target.shot_id==='string'&&IDs.test(target.shot_id))return 'shot:'+target.shot_id;
  throw new Error('Invalid prompt target');
}
export function originalText(p,target,external=null){
  if(targetKey(target)==='global')return p.prompt_source==='studio'||external===null?p.global_prompt:external;
  const shot=p.shots.find(s=>s.id===target.shot_id);if(!shot)throw new Error('The target shot no longer exists');return shot.prompt;
}
function first(p,index){let f=p.shots[0]?.first_image||p.first_image;for(let i=1;i<=index;i++)if(p.shots[i].transition==='cut')f=p.shots[i].first_image;return f||null;}
export function dependencyPayload(p,target,external=null,contract=CONTRACT,includeCommon=null,outputSize=null){
  const key=targetKey(target),index=p.shots.findIndex(s=>s.id===target.shot_id);
  if(![CONTRACT,SHOT_ONLY_CONTRACT,VISUAL_CONTRACT].includes(contract)||(key==='global'&&contract===SHOT_ONLY_CONTRACT))throw new Error('Invalid AI prompt scope');
  if(key!=='global'&&index<0)throw new Error('The target shot no longer exists');
  const visual=contract===VISUAL_CONTRACT,indices=key==='global'?(visual?[]:p.shots.map((_,i)=>i)):[index],scope=[],imageIds=[];
  if(visual&&key==='global')for(const r of [...p.global_refs].sort((a,b)=>a-b)){const id=p.reference_slots[r-1];if(!imageIds.includes(id))imageIds.push(id);}
  for(const i of indices){
    const s=p.shots[i],ids=[...(s.refs==null?p.global_refs:s.refs)].sort((a,b)=>a-b).map(r=>p.reference_slots[r-1]),f=first(p,i),last=s.last_image||null;
    for(const aid of [f,last,...ids])if(aid&&!imageIds.includes(aid))imageIds.push(aid);
    scope.push({id:s.id,first:f,last,refs:ids,camera:s.camera||null,
      roles:(s.reference_roles||[]).map(r=>({asset_id:r.asset_id,role:r.role,description:r.description||''})),
      actions:(s.actions||[]).map(a=>({id:a.id,kind:a.kind,text:a.text}))});
    if(visual)scope.at(-1).timing=visualTiming(p,i);
  }
  const images=imageIds.map(id=>{const a=p.assets.find(a=>a.id===id);if(!a)throw new Error('Assigned image is missing');return {id,file:{name:a.file.name,subfolder:(a.file.subfolder||'').replaceAll('\\','/').replace(/^\/+|\/+$/g,''),type:a.file.type||'input'},subject_name:a.subject_name||''};});
  const useContext=key!=='global'&&contract===CONTRACT&&(includeCommon??(p.shots[index].prompt_mode!=='replace'));
  const common=useContext?originalText(p,{field:'global_prompt'},external):'';
  return {contract,target:{...target},text:originalText(p,target,external),common,images,scope,...(visual?{output:visualOutput(p,outputSize)}:{})};
}
export function validateCandidate(text){
  if(typeof text==='string' && /^\s*(?:edit|modify|alter)\s+(?:the|this|input|reference|source)\s+(?:image|picture|photo)\b/i.test(text))throw new Error('AI returned a still-image edit instruction');
  if(typeof text!=='string'||!text.trim())throw new Error('AI returned no text');
  if([...text].length>32000)throw new Error('AI candidate is too long');
  if(/<\s*\/?think\b|<\s*Picture\s+\d|@R\d|```/i.test(text)||/^\s*(subject_definitions|integrated_multimodal_description|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:/m.test(text)||/^[\[{]/.test(text.trimStart()))throw new Error('Plain video description required');
  return text.trim();
}
export function validateEnhancer(p){
  if(p.schema===1){if('prompt_enhancer'in p)throw new Error('Prompt enhancer requires schema 2');return;}
  const e=p.prompt_enhancer||{enabled:false,texts:[]};
  if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(k=>!['enabled','texts','model','profile','instruction'].includes(k))||('enabled'in e&&typeof e.enabled!=='boolean')||!Array.isArray(e.texts||[])||(e.texts||[]).length>17)throw new Error('Invalid prompt enhancer settings');
  if('instruction'in e&&(typeof e.instruction!=='string'||[...e.instruction].length>8000||e.instruction.includes('\0')))throw new Error('AI instruction must be text of at most 8000 characters');
  if('model'in e&&(typeof e.model!=='string'||e.model.length>512||e.model.includes('\0')))throw new Error('Invalid AI model');
  if('profile'in e&&e.profile!==PROFILE)throw new Error('Unsupported AI profile');
  const seen=new Set();
  for(const x of e.texts||[]){
    if(!x||typeof x!=='object'||Object.keys(x).some(k=>!['target','text','base_text_hash','dependency_hash','dependencies','images','model_identity','profile_version','inactive'].includes(k))||('inactive'in x&&typeof x.inactive!=='boolean'))throw new Error('Invalid enhanced prompt record');
    const key=targetKey(x.target);if(seen.has(key))throw new Error('Duplicate enhanced prompt target');seen.add(key);originalText(p,x.target);validateCandidate(x.text);
    if(!x.dependencies||typeof x.dependencies!=='object'||Array.isArray(x.dependencies)||canonical(x.dependencies).length>1000000||!HEX.test(x.base_text_hash)||!HEX.test(x.dependency_hash)||sha256(canonical(x.dependencies))!==x.dependency_hash||sha256(x.dependencies.text||'')!==x.base_text_hash)throw new Error('Corrupt enhanced prompt binding');
    if(!Array.isArray(x.images||[])||(x.images||[]).length>MAX_AI_IMAGES||new Set((x.images||[]).map(i=>i?.id)).size!==(x.images||[]).length||(x.images||[]).some(i=>!i||Object.keys(i).sort().join(',')!=='id,sha256'||typeof i.id!=='string'||!IDs.test(i.id)||!HEX.test(i.sha256)))throw new Error('Invalid AI image binding');
    for(const k of ['model_identity','profile_version'])if(k in x&&(typeof x[k]!=='string'||x[k].length>1024))throw new Error('Invalid AI receipt');
  }
}
export function resolveText(p,target,external=null,outputSize=undefined){
  const original=originalText(p,target,external),e=p.prompt_enhancer;
  if(e?.enabled!==true)return {text:original,status:'off'};
  const key=targetKey(target),x=e.texts?.find(x=>targetKey(x.target)===key);
  if(!x)return {text:original,status:'unadopted'};
  if(x.inactive)return {text:original,status:'off'};
  if(!entryIsCurrent(p,x,external,outputSize))return {text:original,status:'stale'};
  return {text:x.text,status:'enhanced'};
}
export function compatibleDependencies(saved,current){
  if(saved.contract===VISUAL_CONTRACT&&current.contract===VISUAL_CONTRACT){
    // Timing and output geometry guide new AI requests. An existing text
    // choice survives these edits, and its receipt still records both values.
    saved=JSON.parse(JSON.stringify(saved));
    current=JSON.parse(JSON.stringify(current));
    for(const dep of [saved,current]){
      delete dep.output;
      if(!Array.isArray(dep.scope))continue;
      for(const shot of dep.scope){
        if(shot&&typeof shot==='object')delete shot.timing;
      }
    }
  }
  return canonical(saved)===canonical(current);
}
export function entryIsCurrent(p,entry,external=null,outputSize=undefined){
  try{
    const saved=entry.dependencies.output;
    const size=outputSize===undefined?(saved?.source==='engine'&&saved.width?saved:null):outputSize;
    const dep=dependencyPayload(p,entry.target,external,entry.dependencies.contract,Boolean(entry.dependencies.common),size);
    return sha256(dep.text)===entry.base_text_hash&&sha256(canonical(entry.dependencies))===entry.dependency_hash&&compatibleDependencies(entry.dependencies,dep);
  }catch{return false;}
}
export function setEnhancer(p,enabled){
  if(typeof enabled!=='boolean')throw new Error('Boolean enhancer state required');
  // Do not migrate an old untouched workflow just because the panel was opened.
  if(p.schema===1&&!enabled&&!p.prompt_enhancer)return;
  p.schema=2;p.prompt_enhancer??={enabled:false,texts:[],model:DEFAULT_MODEL,profile:PROFILE};p.prompt_enhancer.enabled=enabled;
}
export function adoptEntry(p,entry){
  if(p.prompt_enhancer?.enabled!==true)throw new Error('Prompt enhancer is OFF');
  const key=targetKey(entry.target);p.prompt_enhancer.texts=p.prompt_enhancer.texts.filter(x=>targetKey(x.target)!==key);
  p.prompt_enhancer.texts.push(JSON.parse(JSON.stringify(entry)));validateEnhancer(p);
}
export function pruneTargets(p){
  if(p.prompt_enhancer)p.prompt_enhancer.texts=p.prompt_enhancer.texts.filter(x=>x.target.field==='global_prompt'||p.shots.some(s=>s.id===x.target.shot_id));
}

// Explicit adoption enables only this field. Old OFF records remain stored.
export function activateEntry(p,entry){
  if(p.prompt_enhancer?.enabled!==true){
    for(const saved of p.prompt_enhancer?.texts||[])saved.inactive=true;
    setEnhancer(p,true);
  }
  adoptEntry(p,{...entry,inactive:false});
}
export function restoreOriginal(p,target){
  const entry=p.prompt_enhancer?.texts?.find(e=>targetKey(e.target)===targetKey(target));
  if(entry)entry.inactive=true;
}
