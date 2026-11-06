// Display names are separate from filenames and from prompt/reference numbering.
export function mediaLabel(plan,asset,locale='en'){
  if(asset.subject_name?.trim())return asset.subject_name.trim();
  const index=plan.assets.filter(a=>a.kind===asset.kind).findIndex(a=>a.id===asset.id)+1;
  return `${locale==='ja'?(asset.kind==='audio'?'音声':'画像'):(asset.kind==='audio'?'Audio ':'Image ')}${index}`;
}
export function mediaHelp(plan,asset,locale='en'){
  return `${mediaLabel(plan,asset,locale)}\n${asset.label||asset.file?.name||''}`;
}
