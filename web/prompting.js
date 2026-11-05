// Deterministic EZ prompt assembly. Must match prompting.py (parity-tested).
// User text stays verbatim; image roles and subject count are not guessed here.
const baseFields=['integrated_multimodal_description','overall_soundscape','non_diegetic_music'];
const refFields=['subject_definitions','summary','retention_analysis','detailed_description','overall_soundscape','non_diegetic_music'];
const fieldPattern=new RegExp('^[ \\t]*('+[...new Set([...baseFields,...refFields])].join('|')+'):', 'gm');
const firstFrame='For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';

export function assemblePrompt(text,pictures,{hasFirst=false,continuing=false,lastPicture=null}={}){
  const fields=new Set([...text.matchAll(fieldPattern)].map(m=>m[1]));
  if(baseFields.every(f=>fields.has(f))||refFields.every(f=>fields.has(f))){
    const missing=pictures.filter(picture=>!text.includes(picture)),bindings=[];
    if(lastPicture)bindings.push(`At the end of this segment, converge to the composition in ${lastPicture}.`);
    if(missing.length)bindings.push('Additional visual reference sources: '+missing.join(', ')+'. Use the relevant content according to the description.');
    if(hasFirst&&!text.includes('<Picture 1>'))bindings.push(continuing?'Use <Picture 1> as the visual reference for the ongoing scene.':firstFrame);
    if(!bindings.length)return text;
    const binding=bindings.join('\n')+'\n\n',subjectField=/^[ \t]*subject_definitions:/m.exec(text);
    if(subjectField){const end=subjectField.index+subjectField[0].length;return text.slice(0,end)+'\n'+binding+text.slice(end);}
    return binding+text;
  }
  const sourceList=pictures.join(', ');
  let detail=text;
  if(lastPicture)detail+=`\n\nAt the end of this segment, converge to the composition in ${lastPicture}.`;
  if(continuing)detail='Continue the scene from the preceding video context.\n\n'+detail;
  detail='[Shot 1]\n'+detail;
  const sound='overall_soundscape: Follow the ambience and sound instructions in the description.';
  const music='non_diegetic_music: Follow the background music instructions in the description.';
  if(!pictures.length){
    const sections=['integrated_multimodal_description:\n'+detail,sound,music];
    if(hasFirst)sections.unshift(continuing?'Use <Picture 1> as the visual reference for the ongoing scene.':firstFrame);
    return sections.join('\n\n');
  }
  let definitions=`The reference sources are ${sourceList}. Match the subjects, setting and style described below to the relevant visual content in these images. The description determines which subjects and reference roles appear.`;
  let retention=`${sourceList}: Preserve the relevant visual features according to their roles in the description, including any requested changes.`;
  let task='reference generation';
  if(lastPicture){task='keyframe completion + reference generation';definitions+=`\n${lastPicture} is the ending frame of this segment.`;retention+=`\n${lastPicture}: Use its composition as the ending frame.`;}
  if(hasFirst){
    if(continuing){
      definitions+='\n<Picture 1> supplies the visual identity of the ongoing scene.';
      retention+='\n<Picture 1>: Maintain visual identity as the current action continues.';
    }else{
      task='keyframe completion + reference generation';
      definitions+='\n<Picture 1> is the opening frame of this scene.';
      retention+='\n<Picture 1>: fully_preserved - Use it as the opening frame.';
    }
  }
  return ['subject_definitions:\n'+definitions,
    `summary:\n[${task}] Create the described scene using the selected visual references.`,
    'retention_analysis:\n'+retention,'detailed_description:\n'+detail,sound,music].join('\n\n');
}
