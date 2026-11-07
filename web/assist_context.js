// Integer-only receipt data, shared by UI validation and AI requests.
export const VISUAL_CONTRACT='h3ez-assist-visual-v3';
export const MAX_AI_IMAGES=11;
const even=n=>{const f=Math.floor(n),d=n-f;return Math.abs(d-.5)<1e-10?(f%2?f+1:f):Math.round(n);};
export function visualTiming(p,i){
 const s=p.shots[i],n=even(Number(s.seconds)*24);
 const frames=i===0||s.transition==='cut'?n+((5-n)%17+17)%17:Math.max(17,Math.floor((n+8)/17)*17);
 return {requested_ms:Math.floor(Number(s.seconds)*1000+.5),frames,fps:24};
}
export function visualOutput(p,size=null){
 const r=p.resolution;
 if(r?.source==='studio'){
  const [a,b]=r.aspect.split(':').map(Number);
  return {source:'studio',aspect:r.aspect,width:Math.max(32,even(Math.sqrt(r.megapixels*1e6*a/b)/32)*32),height:Math.max(32,even(Math.sqrt(r.megapixels*1e6*b/a)/32)*32)};
 }
 const result={source:'engine',aspect:null,width:null,height:null};
 if(size?.width&&size?.height){
  const {width:w,height:h}=size;
  if(![w,h].every(n=>Number.isInteger(n)&&n>=32&&n<=16384&&n%32===0))throw new Error('Invalid output size');
  let a=w,b=h;while(b){[a,b]=[b,a%b];}
  Object.assign(result,{aspect:`${w/a}:${h/a}`,width:w,height:h});
 }
 return result;
}
