import {initial,read,clone,validate} from './state.js';
import {StudioError} from './i18n.js';
import {sha256} from './enhancer.js';

export const MAX_PROJECT_BYTES=32*1024*1024;
const FORMAT='h3-continuum-ez-project';
export function newProject(){const p=initial();p.prompt_source='studio';return p;}
function checked(plan){
  const p=read(plan);
  validate(p);
  for(const asset of p.assets){
    const f=asset.file;
    for(const value of [f.name,f.subfolder||'']){
      if(typeof value!=='string'||/[\x00-\x1f]/.test(value)||/^(?:[a-z]:|\/|\\)/i.test(value)||value.replaceAll('\\','/').split('/').includes('..'))throw new Error('Invalid media path');
    }
  }
  return p;
}
export function saveProject(plan){
  const data={format:FORMAT,version:1,plan:checked(clone(plan))};
  const text=JSON.stringify(data,null,2);
  if(new TextEncoder().encode(text).length>MAX_PROJECT_BYTES)throw new StudioError('projectTooLarge');
  return text;
}
export function loadProject(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_PROJECT_BYTES)throw new StudioError('projectTooLarge');
  try{
    const d=JSON.parse(text.replace(/^\uFEFF/,''));
    if(d?.format!==FORMAT||d.version!==1)throw new Error('Unsupported project');
    return checked(d.plan);
  }catch{throw new StudioError('projectInvalid');}
}

const sessionDrafts=new WeakMap();

// A draft belongs to one Timeline in one workflow, and only applies to the node state it was edited from.
export function createDraftStore({workflowId,nodePaths,node}){
  const key=workflowId&&nodePaths.length?JSON.stringify([workflowId,[...nodePaths].sort()]):null;
  async function access(mode,operation){
    if(!key)return operation({get:()=>({result:sessionDrafts.get(node)}),put:value=>sessionDrafts.set(node,value),delete:()=>sessionDrafts.delete(node)});
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('h3-continuum-ez-drafts',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts',mode);
      tx.onabort=()=>reject(tx.error);
      const result=operation(tx.objectStore('drafts'));
      tx.oncomplete=()=>resolve(result);
    });}finally{db.close();}
  }
  return {
    async load(base){
      const value=(await access('readonly',s=>s.get(key))).result;
      return value?.base===sha256(base)?value.draft:null;
    },
    save(base,draft){return access('readwrite',s=>{s.put({base:sha256(base),draft},key);});},
    clear(){return access('readwrite',s=>{s.delete(key);});},
  };
}
