import {translator} from './i18n.js';

// Shared help for controls that are rebuilt after every timeline edit.
export function applyUIHelp(root,locale='en'){
 const ja=locale==='ja',t=translator(locale),pick=(en,jp)=>ja?jp:en;
 const rows=[
  ['timelineTab','Show the timeline and preview.','タイムラインとプレビューを表示します。'],
  ['widePrompt','Expand the prompt editor. Return with Timeline.','文章の編集領域を広げます。タイムラインで戻ります。'],
  ['expandEditor','Expand the editor; click again to return.','文章の編集領域を広げます。もう一度押すと戻ります。'],
  ['returnToTimeline','Show the timeline and preview.','タイムラインとプレビューを表示します。'],
  ['applyToNode','Save the Studio draft to the Timeline node without running it.','Studioの編集内容をTimelineノードへ保存します。生成は開始しません。'],
  ['applyAndQueue','Save the draft and add the video job to the ComfyUI queue.','編集内容を保存し、動画生成をComfyUIのキューへ追加します。'],
  ['exportVideo','Save and queue a video export. Decode and write in parts to limit RAM use.','編集内容を保存して動画生成をキューへ追加。区間ごとにデコード・書き出しします。'],
  ['exportFrames','Save and queue generation with IMAGE output for downstream processing.','編集内容を保存して生成をキューへ追加。下流で加工できるIMAGEも出力します。'],
  ['importText','Import shot text using [Shot 1] headings. Images and timing stay unchanged.','[Shot 1]形式の文章を取り込みます。画像と秒数は変更しません。'],
  ['importApply','Replace only the shot text shown in the import preview.','取り込み結果に表示されたショット本文だけを変更します。'],
  ['checkImport','Check shot headings and show which prompts will be replaced.','見出しを解析し、変更するショットと文字数を確認します。'],
  ['cancel','Close without applying this operation.','この操作を反映せず閉じます。'],
  ['advancedOutput','Choose video or image output and automatic splitting for long shots.','出力形式と長いショットの自動分割を設定します。'],
  ['storageManager','Inspect and manage server temporary storage.','サーバーの一時保存先と使用量を確認・管理します。'],
  ['addMedia','Add images or audio to the media library.','画像・音声を素材一覧へ追加します。'],
  ['shotPromptTab','Edit or enhance only this shot’s text.','このショットの本文を編集・AI生成します。'],
  ['commonPrompt','Edit the shared situation for all shots using common text.','共通文を使う全ショットの状況を編集します。'],
  ['effectivePrompt','Preview the selected shot’s final video prompt.','選択ショットの動画モデルへの送信文を確認します。'],
  ['referenceSource','Choose shared references or references selected for this shot.','全体の共通参照か、このショット専用の参照かを選びます。'],
  ['targetSeconds','Requested shot duration; the displayed Time includes H3 frame rounding.','目標の秒数を指定します。タイムにはH3のフレーム調整後の時間を表示します。'],
  ['shotName','Name used to identify this shot on the timeline.','タイムラインに表示するショット名です。'],
  ['addShot','Insert a shot after the selected shot.','選択ショットの後ろにショットを追加します。'],
  ['duplicate','Copy the selected shot, including its text and references.','選択ショットの本文と参照を複製します。'],
  ['delete','Remove the selected shot or audio clip. Source files are retained.','選択したショットまたは音声配置を削除します。元ファイルは保持します。'],
  ['splitHere','Split the selected shot at the playhead. Each part must be at least two seconds.','再生位置でショットを分割します。分割後は各2秒以上が必要です。'],
  ['seekStart','Seek to the start of the selected shot.','選択ショットの先頭へ移動します。'],
  ['playPause','Play or pause the preview.','プレビューを再生・一時停止します。'],
  ['layoutMode','Preview assigned images and audio without generating video.','生成前の画像配置と音声を確認します。'],
  ['resultPreview','Play the generated video with its audio. Available after generation.','生成結果の動画を音声付きで再生します。生成後に使用できます。'],
 ];
 const labels=new Map(rows.map(([k,en,jp])=>[t(k),pick(en,jp)]));
 for(const [label,en,jp] of [
  [pick('Check Inputs','入力確認'),'Validate the timeline and media; this does not load or run models.','タイムラインと素材を検証します。モデルのロード・生成は行いません。'],
  ['←','Move the shot earlier.','ショットを1つ前へ移動します。'],['→','Move the shot later.','ショットを1つ後ろへ移動します。'],
  ['−','Zoom out on the timeline.','タイムラインを縮小表示します。'],['＋','Zoom in on the timeline.','タイムラインを拡大表示します。'],
  ['×','Remove this assignment. The source file is retained.','この割り当てを外します。元ファイルは保持します。']
 ])labels.set(label,pick(en,jp));
 for(const e of root.querySelectorAll('button,summary,input,select,textarea,[role=button]')){
  if(e.title||e.type==='hidden')continue;
  const label=e.getAttribute('aria-label')||e.closest('label')?.querySelector('span')?.textContent||e.textContent.trim();
  e.title=labels.get(label)||label||pick('Edit value','値を編集');
  if(!e.getAttribute('aria-label')&&['INPUT','SELECT','TEXTAREA'].includes(e.tagName))e.setAttribute('aria-label',label||e.title);
 }
}
