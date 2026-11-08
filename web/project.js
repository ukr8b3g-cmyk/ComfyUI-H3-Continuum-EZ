import {initial,read,clone,validate} from './state.js';
import {StudioError} from './i18n.js';

export const MAX_PROJECT_BYTES=32*1024*1024;
const FORMAT='h3-continuum-ez-project';
export function newProject(){const p=initial();p.prompt_source='studio';return p;}
function checked(plan){
  const p=read(plan);
  validate(p,{allowAudioOverhang:true});
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
