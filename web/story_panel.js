// Compact deterministic camera, action and role controls. No accordion or model work.
import {CAMERAS,ROLES} from './story_tools.js';
import {uid,clone} from './state.js';
import {mediaLabel,mediaHelp} from './media_labels.js';
const names={cameras:{static:['Fixed','固定'],follow:['Follow','追従'],dolly_in:['Dolly in','接近'],dolly_out:['Dolly out','引き'],pan_left:['Pan left','左パン'],pan_right:['Pan right','右パン'],orbit:['Orbit','回り込み'],close_up:['Close-up','クローズアップ']},roles:{character:['Character','人物'],outfit:['Outfit','衣装'],background:['Background','背景'],object:['Object','小道具'],style:['Style','画風']}};
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
export function storyPanel({plan,shot,mutate,locale='en',selectedRole=null,onRole=()=>{},mediaUrl=null,onEdit=()=>{},onCommit=()=>{}}){
 const ja=locale==='ja',text=(en,jp)=>ja?jp:en,root=el('section');root.className='ez-story-tools';root.setAttribute('aria-label',text('Shot direction','ショット演出'));
 const change=fn=>mutate(()=>{plan.schema=2;fn();},{strict:true});
 const liveInput=(control,write)=>{let before=null;control.onfocus=()=>{before=clone(plan);};control.oninput=()=>{before??=clone(plan);plan.schema=2;write();onEdit();};control.onblur=()=>{if(before&&JSON.stringify(before)!==JSON.stringify(plan))onCommit(before);before=null;};};
 const select=(options,value,fn,label,help)=>{const e=el('select');e.setAttribute('aria-label',label);e.title=help||label;for(const [key,title]of options){const o=el('option',title);o.value=key;e.append(o);}e.value=value;e.onchange=()=>fn(e.value);return e;};
 const label=(title,control)=>{const l=el('label',title);l.className='ez-story-field';l.append(control);return l;};
 const button=(title,fn,help)=>{const b=el('button',title);b.type='button';b.onclick=fn;b.title=help||title;return b;};
 const head=el('div');head.className='ez-story-head';
 const camera=select([['',text('None','指定なし')],...Object.keys(CAMERAS).map(k=>[k,names.cameras[k][ja?1:0]])],shot.camera||'',v=>change(()=>shot.camera=v||null),text('Camera preset','カメラプリセット'),text('Add a camera instruction to this shot. This does not guarantee precise camera motion or alter timing and seed.','このショットのカメラ演出を指定します。動きはモデルに依存します。時間とシードは変更しません。'));
 const add=button(text('+ Action','＋ 動作追加'),()=>change(()=>{shot.actions??=[];shot.actions.push({id:uid('action'),kind:'event',text:'',at:null,weight:1});}),text('Add an action. Blank time distributes actions by weight. Adding actions does not add sampling runs.','動作を追加します。秒を空欄にすると配分で自動配置します。動作追加で生成回数は増えません。'));add.disabled=(shot.actions?.length||0)>=32;
 head.append(label(text('Camera','カメラ'),camera),add);root.append(head);
 const ids=(shot.refs??plan.global_refs).map(n=>plan.reference_slots[n-1]).filter(Boolean);
 if(ids.length){
  const selected=ids.includes(selectedRole)?selectedRole:ids[0],row=el('div');row.className='ez-role-editor';
  const image=el('img');image.alt='';
  const assetSelect=select(ids.map(id=>{const a=plan.assets.find(a=>a.id===id);return[id,a?mediaLabel(plan,a,locale):id];}),selected,()=>{},text('Reference for role','役割を設定する参照'),text('Select an assigned image, then set its role. Every image retains its own role.','参照画像を選んで役割を設定します。画像ごとに設定を保持します。'));
  const roleSelect=select([['',text('No role','役割なし')],...ROLES.map(k=>[k,names.roles[k][ja?1:0]])],'',()=>{},text('Reference role','参照の役割'),text('Tell the model what to retain from this image: character, outfit, background, object or style.','画像から使いたい要素を指定します。人物・衣装・背景・小道具・画風から選べます。'));
  const detail=el('input');detail.maxLength=2000;detail.placeholder=text('Details (optional)','補足（任意）');detail.setAttribute('aria-label',text('Role details','役割の補足'));detail.title=text('Optional description for the selected image role.','選択した画像の役割を補足します。');
  function showRole(){const id=assetSelect.value,a=plan.assets.find(x=>x.id===id),role=shot.reference_roles?.find(x=>x.asset_id===id);roleSelect.value=role?.role||'';detail.value=role?.description||'';detail.disabled=!role;if(mediaUrl&&a){image.src=mediaUrl(a);image.hidden=false;}else image.hidden=true;assetSelect.title=(a?mediaHelp(plan,a,locale):'')+'\n'+text('Select an image to edit its role.','役割を設定する参照画像を選択します。');}
  assetSelect.onchange=()=>{onRole(assetSelect.value);showRole();};
  roleSelect.onchange=()=>{const id=assetSelect.value,previous=shot.reference_roles?.find(x=>x.asset_id===id);onRole(id);change(()=>{shot.reference_roles=(shot.reference_roles||[]).filter(x=>x.asset_id!==id);if(roleSelect.value)shot.reference_roles.push({asset_id:id,role:roleSelect.value,description:previous?.description||''});});};
  liveInput(detail,()=>{const role=shot.reference_roles?.find(x=>x.asset_id===assetSelect.value);if(role)role.description=detail.value;});
  row.append(el('span',text('Reference','参照')),image,assetSelect,roleSelect,detail);root.append(row);showRole();
 }
 if(shot.actions?.length){
  const list=el('div');list.className='ez-actions';
  const header=el('div');header.className='ez-action-row ez-action-heading';
  for(const [title,help] of [[text('Action','動作'),text('Describe this action. Use the Dialogue controls for speech.','動作を入力します。台詞は台詞欄へ入力してください。')],[text('Type','種類'),text('Once starts once. Ongoing carries into later internal parts.','一度はその時点で開始。継続は後続区間にも状態を引き継ぎます。')],[text('Seconds','秒'),text('Start time within this shot. Blank means automatic.','ショット内の開始秒。空欄なら自動配置します。')],[text('Weight','配分'),text('Relative duration for automatic placement.','自動配置時の相対的な長さを指定します。')],['','']]){const x=el('span',title);x.title=help;header.append(x);}list.append(header);
  for(const [i,a]of shot.actions.entries()){
   const row=el('div');row.className='ez-action-row';
   const area=el('textarea');area.rows=1;area.maxLength=5000;area.value=a.text;area.setAttribute('aria-label',text(`Action ${i+1}`,`動作 ${i+1}`));area.title=header.children[0].title;liveInput(area,()=>a.text=area.value);
   const kind=select([['event',text('Once','一度')],['state',text('Ongoing','継続')]],a.kind,v=>change(()=>a.kind=v),text(`Action ${i+1} kind`,`動作 ${i+1} の種類`),header.children[1].title);
   const at=el('input');at.type='number';at.min=0;at.step=.1;at.value=a.at??'';at.placeholder=text('Auto','自動');at.setAttribute('aria-label',text(`Action ${i+1} time`,`動作 ${i+1} の時刻`));at.title=header.children[2].title;liveInput(at,()=>a.at=at.value===''?null:at.valueAsNumber);
   const weight=el('input');weight.type='number';weight.min=.01;weight.max=1000;weight.step=.1;weight.value=a.weight??1;weight.setAttribute('aria-label',text(`Action ${i+1} weight`,`動作 ${i+1} の長さの比率`));weight.title=header.children[3].title;liveInput(weight,()=>a.weight=weight.valueAsNumber);
   const rm=button('×',()=>change(()=>shot.actions.splice(i,1)),text(`Remove action ${i+1}`,`動作 ${i+1} を削除`));rm.setAttribute('aria-label',rm.title);row.append(area,kind,at,weight,rm);list.append(row);
  }root.append(list);
 }
 return root;
}
