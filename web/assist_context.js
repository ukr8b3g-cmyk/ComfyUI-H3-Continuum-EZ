// Integer-only receipt data, shared by UI validation and AI requests.
import {dimensionAspect,resolutionAspect,resolutionSize,roundEven,validDimension} from './resolution.js';
export const VISUAL_CONTRACT='h3ez-assist-visual-v3';
export const MAX_AI_IMAGES=11;
export function visualTiming(p,i){
 const s=p.shots[i],n=roundEven(Number(s.seconds)*24);
 const frames=i===0||s.transition==='cut'?n+((5-n)%17+17)%17:Math.max(17,Math.floor((n+8)/17)*17);
 return {requested_ms:Math.floor(Number(s.seconds)*1000+.5),frames,fps:24};
}
export function visualOutput(p,size=null){
 const r=p.resolution;
 if(r?.source==='studio'){
  const {width,height}=resolutionSize(r);
  const aspect=resolutionAspect(r);
  return {source:'studio',aspect,width,height};
 }
 const result={source:'engine',aspect:null,width:null,height:null};
 if(size?.width&&size?.height){
  const {width:w,height:h}=size;
  if(![w,h].every(validDimension))throw new Error('Invalid output size');
  Object.assign(result,{aspect:dimensionAspect(w,h),width:w,height:h});
 }
 return result;
}
