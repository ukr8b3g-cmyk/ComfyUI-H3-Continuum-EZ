import {applyUIHelp} from './ui_help.js';
// Local storage controls use only the existing server-owned storage API.
import {app} from '../../scripts/app.js';
import {api} from '../../scripts/api.js';
import {ensureStudioStyles} from './studio.js';
let opened=null;
const bytes=n=>Number.isFinite(n)?(n/1024**3).toFixed(2)+' GiB':'—';
const make=(tag,text,parent)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent?.append(e);return e;};
export function openStorageDialog(){
 if(opened?.isConnected){opened.focus();return;}
 ensureStudioStyles();
 const locale=app.extensionManager?.setting?.get?.('Comfy.Locale')??app.ui?.settings?.getSettingValue?.('Comfy.Locale')??navigator.language;
 const ja=String(locale).startsWith('ja'),t=(en,jp)=>ja?jp:en,d=make('dialog');d.className='h3ez-storage';d.setAttribute('aria-label',t('Temporary Storage','一時ストレージ'));opened=d;
 const header=make('header',undefined,d);make('h2',t('H3 EZ — Temporary Storage','H3 EZ — 一時ストレージ'),header);
 const close=make('button','×',header);close.className='ez-close';close.type='button';close.onclick=()=>d.close();close.setAttribute('aria-label',t('Close','閉じる'));
 d.title=t('Server-side scratch storage. Completed videos and unknown files are protected. Changing folders does not move existing data.','サーバー側の一時保存先です。完成動画と判定不能なファイルは保護されます。保存先を変えても既存データは移動しません。');
 const l=make('label',t('Absolute server folder (blank = default)','サーバーの絶対パス（空欄＝既定）'),d),input=make('input',undefined,l);input.type='text';
 const volumes=make('select',undefined,d);volumes.setAttribute('aria-label',t('Server volumes','サーバーの保存先候補'));volumes.onchange=()=>{if(volumes.value){input.value=volumes.value;dirty=true;}};
 const bar=make('div',undefined,d),buttons={};for(const [k,en,jp]of[['validate','Validate','検証'],['save','Save','保存'],['refresh','Refresh','更新'],['cleanup','Delete Unused Files','未使用ファイル削除']]){const b=make('button',t(en,jp),bar);b.type='button';if(k==='save')b.className='ez-apply';if(k==='cleanup')b.className='ez-delete';buttons[k]=b;b.onclick=()=>perform(k);}
 const status=make('p','',d);status.setAttribute('role','status');const roots=make('div',undefined,d);let state=null,pending=false,dirty=false,closed=false;
 input.oninput=()=>dirty=true;
 function controls(){for(const k of ['validate','save','cleanup'])buttons[k].disabled=pending||!state||state.busy||state.read_only;buttons.refresh.disabled=pending;input.disabled=pending||!!state?.read_only;volumes.disabled=input.disabled;}
 async function request(op,body){const r=await api.fetchApi('/h3-continuum-ez/storage/'+op,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let v;try{v=await r.json();}catch{throw new Error(`HTTP ${r.status}: `+t('Invalid storage response. Restart ComfyUI after updating.','不正な応答です。更新後はComfyUIを再起動してください。'));}if(!r.ok)throw new Error(v.error||`HTTP ${r.status}`);return v;}
 async function refresh(){const v=await request('status');if(closed)return;if(!Array.isArray(v.roots)||!Array.isArray(v.volumes))throw new Error('Invalid storage data');state=v;if(!dirty)input.value=v.path;volumes.replaceChildren();const empty=make('option',t('Choose storage…','保存先候補…'),volumes);empty.value='';for(const volume of v.volumes){const o=make('option',`${volume.path} (${bytes(volume.free_bytes)})`,volumes);o.value=volume.path;}
  roots.replaceChildren();make('p',t('Available CPU RAM: ','利用可能CPU RAM：')+bytes(v.memory?.available_bytes),roots);
  for(const r of v.roots.filter(x=>x.kind==='finalize')){const s=make('section',undefined,roots);make('strong',(r.current?t('Current: ','現在：'):t('Previous: ','以前：'))+r.path,s);make('p',t('Total / in use / deletable / protected: ','合計／使用中／削除可能／保護中：')+[r.bytes,r.in_use_bytes,r.deletable_bytes,r.unknown_bytes].map(bytes).join(' / '),s);for(const e of r.errors||[])make('p',e,s);}
  if(v.previews){const s=make('section',undefined,roots);make('strong',t('Playback proxies','途中再生用の動画'),s);make('p',`${v.previews.path} · ${bytes(v.previews.bytes)}`,s);s.title=t('Inactive proxies expire after 24 hours. Active runs are protected.','未使用の途中動画は24時間で清掃対象になります。生成中は保護します。');}
  status.textContent=v.read_only?t('Read-only in multi-user mode','マルチユーザー環境では閲覧のみです'):v.busy?t('Storage changes are disabled while the queue is busy.','キューの実行中・待機中は保存先の変更と削除はできません。'):'';
 }
 async function perform(op){if(pending)return;if(op==='cleanup'&&!confirm(t('Delete only verified unused temporary files?','所有確認できた未使用の一時ファイルだけを削除しますか？')))return;pending=true;controls();status.textContent=t('Working…','処理中…');try{
  if(op==='refresh')await refresh();
  if(op==='validate'){await request('validate',{path:input.value});status.textContent=t('Write and memory-map checks passed.','書込み・メモリマップ検証に成功しました。');}
  if(op==='save'){await request('settings',{path:input.value,revision:state.revision});dirty=false;await refresh();status.textContent=t('Saved. New allocations use this location.','保存しました。新しい一時ファイルから適用されます。');}
  if(op==='cleanup'){await request('cleanup',{});await refresh();status.textContent=t('Unused owned temporary files cleaned.','所有確認できた未使用の一時ファイルを整理しました。');}
 }catch(e){if(!closed)status.textContent=e.message;}finally{pending=false;if(!closed)controls();}}
 d.addEventListener('close',()=>{closed=true;d.remove();if(opened===d)opened=null;},{once:true});document.body.append(d);d.showModal();input.title=d.title;volumes.title=t('Choose a server folder; Save applies it to new temporary files.','サーバーの保存先候補を選択します。保存後の一時ファイルから使用します。');for(const [key,en,jp] of [['validate','Test write access and memory mapping.','書込みとメモリマップを検証します。'],['save','Use this folder for new temporary files.','新しい一時ファイルの保存先を変更します。'],['refresh','Reload capacity and usage.','容量と使用量を再取得します。'],['cleanup','Delete verified unused temporary files only. Completed videos are protected.','所有確認済みの未使用一時ファイルだけを削除します。完成動画は保持します。']])buttons[key].title=t(en,jp);applyUIHelp(d,ja?'ja':'en');void perform('refresh');
}
