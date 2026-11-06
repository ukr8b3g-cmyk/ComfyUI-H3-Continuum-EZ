// Deterministic, optional schema-2 authoring. Mirrored by story_tools.py.
export const CAMERAS={
  static:'Keep the camera stationary.',follow:'The camera smoothly follows the subject.',
  dolly_in:'Move the camera slowly closer to the subject.',dolly_out:'Move the camera slowly away from the subject.',
  pan_left:'Pan the camera slowly to the left.',pan_right:'Pan the camera slowly to the right.',
  orbit:'Move the camera slowly around the subject.',close_up:'Use close-up framing without introducing a scene cut.'
};
export const ROLES=['character','outfit','background','object','style'];
const roundEven=n=>{const f=Math.floor(n),d=n-f;return Math.abs(d-.5)<1e-10?(f%2?f+1:f):Math.round(n);};
export function validateStory(p,geometry){
  for(const [i,s] of p.shots.entries()){
    if(p.schema===1){if('actions'in s||'camera'in s||'reference_roles'in s)throw new Error('Story tools require schema 2');continue;}
    if(s.camera!=null&&!Object.hasOwn(CAMERAS,s.camera))throw new Error('Unknown camera preset');
    const actions=s.actions||[];if(!Array.isArray(actions)||actions.length>32)throw new Error('At most 32 actions per shot');
    const seen=new Set();
    for(const a of actions){
      if(!a||typeof a!=='object'||Object.keys(a).some(k=>!['id','kind','text','at','weight'].includes(k))||typeof a.id!=='string'||!/^[A-Za-z0-9_-]{1,96}$/.test(a.id)||seen.has(a.id))throw new Error('Invalid action step');seen.add(a.id);
      if(!['event','state'].includes(a.kind)||typeof a.text!=='string'||[...a.text].length>5000)throw new Error('Invalid action text');
      const w=a.weight??1;if(typeof w!=='number'||!Number.isFinite(w)||w<.01||w>1000)throw new Error('Invalid action weight');
      if(a.at!=null&&(typeof a.at!=='number'||!Number.isFinite(a.at)||a.at<0||a.at>=geometry[i].seconds))throw new Error('Action time is outside its shot / 動作の時刻がショット外です');
    }
    const roles=s.reference_roles||[],active=(s.refs??p.global_refs).map(r=>p.reference_slots[r-1]),used=new Set();
    if(!Array.isArray(roles)||roles.length>9)throw new Error('At most nine reference roles');
    for(const r of roles){
      if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['asset_id','role','description'].includes(k))||!active.includes(r.asset_id)||used.has(r.asset_id)||!ROLES.includes(r.role)||typeof(r.description??'')!=='string'||[...(r.description??'')].length>2000)throw new Error('Invalid reference role / 役割を指定した画像を参照に残してください');used.add(r.asset_id);
    }
  }
}
export function actionPositions(s,g){
  const actions=s.actions||[],total=actions.reduce((sum,a)=>sum+(a.weight??1),0)||1;let cursor=0;
  return actions.map((a,i)=>{const f=a.at!=null?roundEven(a.at*24):Math.floor(cursor*g.frames/total);cursor+=a.weight??1;return {frame:Math.min(f,g.frames-1),index:i,action:a};}).sort((a,b)=>a.frame-b.frame||a.index-b.index);
}
export function storyText(p,part,g){
  if(p.schema!==2)return '';
  const s=p.shots[part.shot_index],sections=[];
  if(s.camera)sections.push(CAMERAS[s.camera]);
  for(const r of s.reference_roles||[]){const slot=p.reference_slots.indexOf(r.asset_id)+1;sections.push(`Use @R${slot} as the ${r.role} reference.`+(r.description?' '+r.description:''));}
  const lo=part.start_frame-roundEven(g.start*24),hi=lo+part.frames,positions=actionPositions(s,g);let state=null;
  for(const {frame,action} of positions){if(frame>=lo)break;if(action.kind==='state'&&action.text)state=action;}
  if(state&&!positions.some(x=>x.frame===lo&&x.action.kind==='state'))sections.push('Continue this ongoing action: '+state.text);
  for(const {frame,action} of positions)if(lo<=frame&&frame<hi&&action.text)sections.push(`About ${((frame-lo)/24).toFixed(3)} seconds into the new action: ${action.text}`);
  return sections.join('\n\n');
}
