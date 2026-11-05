# H3 Continuum EZ Studio 2.0.0 — 実装確定仕様

固定日: 2026-11-05。今回のZIP実装の正本。既存EZ 1.0.0とは非互換の新しいノードIDを使用する。

## 1. 製品境界
独立パッケージ `ComfyUI-H3-Continuum-EZ`。登録は `H3ContinuumEZTimeline` と `H3ContinuumEZEngine` の2個。
ノード内はサムネイル／総尺／Studioを開くボタンだけ。詳細編集は同じComfyUIページ上の大型HTML/CSS/JavaScriptダイアログ。別サーバー、CDN、APIキー、LLM、npm実行時依存を持たない。
旧EZだけを置き換える。通常版H3 Continuum、既存Workflow、Run、Takeは一切変更しない。自動移行／自動削除なし。

## 2. 継続生成の正本
同梱する通常Continuum 3.10.2の `reference_context_v1` の下位処理を利用する。具体的には prepare_conditioning、capture_state/select_context、clone_model_for_chunk、PackedLayoutの配置検査と時刻補正、sample_chunk、derive_chunk_seed、choose_context_frames。
原ソースをvendor/continuumへ同梱し、EZから呼ぶ。依存する通常版Continuumのインストールは不要。独立22f masked AVエンジンへの置換は禁止。
新規なのは可変長ショットのループ、編集計画の変換、素材の読込と最終組立。通常版と同一の全ワークフロー／全画質を保証するものではない。
デフォルト継続は通常版Auto（動きに応じ5/22/39f）。各ショット先頭の「継続」はAV contextを引き継ぐ。「場面転換」は前stateを使用しない。先頭は常に初期生成。
Sampling中のVAE Decodeは行わない。事前に画像／音声／テキストの条件を作成し、Sampling終了後に全映像をDecodeする。latentはCPU保持。

## 3. UI構成
Studio上部: Timeline / Prompt の2つの編集モード、Undo/Redo、反映、反映してQueue、閉じる。
左: 素材ブラウザー（画像・音声、追加、参照解除）。中央: 構成プレビュー。右: 選択中ショットの秒数・境界・参照・プロンプト。下: ショットトラック＋オーディオトラック＋再生位置。
Promptモードは大きな全文textarea。共通／選択ショット／実効送信文の3切替。分割バーでテキスト領域を拡大。自動要約、自動翻訳、自動短縮なし。文字数は表示するがモデルのトークン上限を保証しない。
プレビューは素材を並べた構成確認であり未生成の映像ではない。HTML Audioと波形を使った素材音声の試聴を提供する。完成映像は下流の標準Save Videoで確認する。

## 4. ショット
1〜16ショット。1ショット＝1回の物理Sampling、Terminal Merge／自動分割なし。
秒数2〜15秒を数字で指定。並べ替えはドラッグ、左右ボタンを併設。追加／複製／削除／再生位置での分割を提供。分割は生成計画を分ける操作であり生成済み映像を切る機能ではない。
各ショットの秒数は目標値。初期ショットは元エンジンと同じ上方17k+5整列、継続ショットは元のmake_extension_shapeによる近傍整列。UIに実際の出力区間／実尺／差を表示し、表示タイムラインと音声位置は実尺を使う。端数を黙って引き伸ばしたり静止画で埋めたりしない。
切替の後のFirst Imageはそのショットのみ（継続時は指定不可）。全体開始画像は最初のショットだけに固定、同一シーン内の後続ショットには原Continuumと同じ視覚identity tokensを残し先頭keyframeを外す。

## 5. 画像
標準アップロードでComfyUI input内へ保存、Workflowにはファイル参照だけを保存。
素材の削除は参照解除でありファイル削除しない。参照中の場合は確認して割当を外す。
開始画像の領域とReference画像の領域を分離。Referenceは安定したR1〜R9スロット。画像の差替えはslotを維持。
共通参照を全ショットに継承。ショットは「共通参照」または「個別指定（空＝使わない）」を選択できる。画像を毎ショット入れる必要はない。
@R1〜@R9は各実効画像順序の<Picture N>へ一度だけ変換。inactive/不明タグは生成前エラー。元テキストは変更しない。最終送信文と番号対応を確認可能。
参照はReference対応H3モデルを外部Loaderで選ぶ。モデル自動切替はしない。

## 6. プロンプト
Timelineの任意STRING `external_prompt` を接続すると共通Promptの実行時入力になる。保存した内部Promptは上書きしない。外部の実行時結果はQueue前に取得できると偽らず、最後の実行時共通文を参考表示する。
外部入力なしでは内部共通Prompt。各ショットは `append`（共通＋区間、空行で結合）/`replace`（区間文のみ）を選ぶ。無断書換えなし。共通欄は人物・画風など固定情報用、歩く等の動作は区間文へ。
明示的な[Shot N]文章の一括取込は解析→確認→適用。文章を解析しただけでは編集状態を変更しない。既存ショットへの本文置換のみ。秒数や画像は変更しない。
独立した複数テキストトラックは初版に増設しない。共通文＋ショット本文を編集しやすく見せる。

## 7. オーディオ
UI名称はAudio/オーディオ。音声Referenceや声生成ではなく原音ガイドと原音出力。
WAV/FLAC/MP3/M4A/OGGを受け付ける（実環境のComfyUI/PyAV対応形式に従う）。1本の非重複トラック、複数クリップ可能。
ファイルdrop→クリップ配置、マウス移動、両端トリム、再生位置で分割、削除、数値start/source-in/duration。速度変更／ピッチ変更／歌詞変換／クロスフェード／重ねmixはなし。
source-in/outとtimeline-startを区別、範囲外と重複は警告して確定を拒否。原音は不変。
音声クリップがある場合: 編集済みPCMを全体尺で構成。隙間は無音。このPCMを音声VAEに1回encodeし元Continuumのguide音声keyframeとして各生成へ渡す。生成された音声は最終出力に混ぜずDecodeもしない。最終AUDIOは編集済みPCM（必要なサンプルレート変換・mono→stereoを除き自動正規化しない）。lip-sync品質はモデル依存で保証しない。
音声クリップが0の場合: H3生成音声を通常の音声VAE経路でDecodeして出力。

## 8. Engine入力・出力
MODEL/CLIP/Video VAE/Audio VAE/SAMPLER/SIGMAS/TIMELINE PLAN、Seed、Megapixels、Aspect。
標準Loader/LoRA/Sampler/Schedulerは外部。Spectrumなし。専用Attention制御なし。
出力IMAGE/AUDIO/FPS(24)/REPORT。UIに長文を詰めない。全設定をTimelineのeditorに複製しない。
解像度は開始画像の比率優先、なければ選択Aspect。32倍数。Sequence中は固定。モデル／VAEの不適合やNaNは明示的に停止する。

## 9. データと安全性
version付きtimeline_jsonが編集計画の唯一の保存元。表示縮尺とパネル幅のみlocalStorage可。
Draftは反映までノードへ書かない。閉じる／Escは未反映時に破棄確認。2回目のOpenは同じeditorにfocus。別nodeの編集中値を上書きしない。
Upload中の確定を防止。失敗したuploadは既存素材を壊さない。文字列はtextContent/valueで表示しHTMLとして実行しない。
backendはinputルート下の相対パスのみを読込、絶対パス・..・外部URL不可。IS_CHANGEDで素材内容hashも確認。
ファイルサイズ、解像度、全体RAMは有限。動画全フレームをCPUに保持するため長時間出力ではRAM負荷あり。無制限長尺を保証しない。

## 10. 除外
Run/Take/Project管理、保存からResume、選択再生成、Decode Cache、永続生成cache、モデルdownload、自動pip install、独自LLM、音声mix、video素材import、Ref Audio/Video、Second Pass、全局patch。

## 11. 検証完了基準
CPU: 計画・参照・元Continuumのstate/temporal/layout・音声編集・呼出経路・入力不変・外部prompt・保存モデル。
Browser: 実際のHTML StudioをChromiumで開き、drop/入替/削除/長文/尺/音声/Undo/保存再読込をfixtureで試験。ComfyUI自体のClassic/Nodes2試験とは区別。
ZIP: 再展開・全manifest照合・pytest・JS syntax。GPU/実ComfyUI/実Windows未実施なら明記。未実施を合格扱いしない。
