import {clone,uid,duration,MAX_TIMELINE_SECONDS,MAX_SHOT_SECONDS,DEFAULT_CHUNK_SECONDS} from './state.js';
import {StudioError} from './i18n.js';

export const editorDuration=p=>Math.max(duration(p),0,...p.audio.map(c=>c.start+c.duration));
export function placeAudio(p,assetId,at){
 const a=p.assets.find(x=>x.id===assetId);
 if(a?.kind!=='audio'||!Number.isFinite(a.duration)||a.duration<=0)throw new StudioError('selectAudioAsset');
 if(p.audio.length>=128)throw new StudioError('audioClipLimit');
 let start=Math.max(0,Number(at)||0);
 for(const c of [...p.audio].sort((a,b)=>a.start-b.start))if(start<c.start+c.duration&&start+a.duration>c.start)start=c.start+c.duration;
 if(start+a.duration>MAX_TIMELINE_SECONDS)throw new StudioError('timelineLimit');
 const c={id:uid('audio'),asset_id:assetId,start,source_in:0,duration:a.duration};p.audio.push(c);return c;
}
export function duplicateAudio(p,id){
 const source=p.audio.find(c=>c.id===id);if(!source)throw new StudioError('selectAudioAsset');
 if(p.audio.length>=128)throw new StudioError('audioClipLimit');
 let start=source.start+source.duration;
 for(const c of [...p.audio].sort((a,b)=>a.start-b.start))if(start<c.start+c.duration&&start+source.duration>c.start)start=c.start+c.duration;
 if(start+source.duration>MAX_TIMELINE_SECONDS)throw new StudioError('timelineLimit');
 const copy={...clone(source),id:uid('audio'),start};p.audio.push(copy);return copy;
}
export function fitVideoToAudio(p){
 const next=clone(p),end=editorDuration(p);if(end<=duration(p)+.001)return p;
 const last=next.shots.at(-1);last.seconds+=end-duration(p);
 for(let n=0;duration(next)+.001<end&&n<20;n++)last.seconds+=1/24;
 if(last.seconds>MAX_SHOT_SECONDS)throw new StudioError('invalidShotDuration',last.label);
 if(last.seconds>15)next.chunking={enabled:true,seconds:next.chunking?.seconds??DEFAULT_CHUNK_SECONDS};
 return next;
}
