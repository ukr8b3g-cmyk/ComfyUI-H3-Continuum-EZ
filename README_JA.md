[English](README.md)
<img width="1892" height="1008" alt="Clip_110" src="https://github.com/user-attachments/assets/5834c705-21c5-4c69-add4-5e10bd78cef4" />

# H3 Continuum EZ Studio 0.9

[ダウンロード・変更一覧](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/tag/v0.9) · [検証記録](docs/RELEASE_VALIDATION_JA.md)

**[H3 Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum)の継続生成エンジンをバックエンドに使った、ComfyUI用のグラフィカルなタイムラインノードです。** 画像や音声を画面で確認しながら、ショットを並べ、文章と尺を決めて、Studioから音声付き動画を書き出せます。画面を見てすぐに使い始められるよう、操作を素材の配置・編集・書き出しに絞っています。

長いショットの分割と継続はエンジンが内部で処理します。チャンク単位のやり直し、途中再開、Second Passなど、通常版Continuumの詳細な生成管理は搭載していません。

初回公開版です。CPU・JavaScriptテスト、分離ブラウザー、Windows上の実ComfyUI Classicでのシード設定を確認しました。実H3 GPUでの受入、Nodes 2.0、長尺時のピークメモリーは未検証です。

## インストールと更新

ComfyUIを終了し、**`ComfyUI` フォルダー**を起点にコマンドを実行します。ZIPで導入したEZからGitへ切り替える場合は、既存の `custom_nodes/ComfyUI-H3-Continuum-EZ` を先に `custom_nodes` の外へ退避してください。

### Gitでインストール

```sh
cd custom_nodes
git clone https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ.git
```

### Gitで導入した版を更新

`ComfyUI` フォルダーから次のコマンドを実行します。

```sh
git -C custom_nodes/ComfyUI-H3-Continuum-EZ pull --ff-only
```

### ZIPでインストール

[v0.9の配布ZIP](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.9/ComfyUI-H3-Continuum-EZ-v0.9.zip)を展開し、`ComfyUI-H3-Continuum-EZ` フォルダーを `custom_nodes/` に入れます。既存のEZがあれば先に `custom_nodes` の外へ退避してください。

インストールや更新後はComfyUIを再起動してブラウザーを更新します。[REF2VAテンプレート](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.9/H3_EZ_Studio_REF2VA_Template.json)を読み込み、下の表のモデルをサブグラフ上で選択します。「タイムラインStudioを開く」で編集し、「動画を書き出す」で生成します。旧EZ 1.0.0のワークフローは付属のテンプレートに切り替えてください。

モデルは同梱していません。実行にはMiniMax H3とサブグラフに対応したComfyUIが必要です。テンプレートはComfyUI 0.44.0で保存された構成を使い、EZ以外のカスタムノードや追加のpip依存はありません。音声の圧縮形式の読込はComfyUI環境のPyAV、リサンプリングはCoreの音声処理を使います。ブラウザーがプレビューできない形式はPCM WAVへ変換してください。

## REF2VAテンプレートとモデル

[テンプレートのソース](examples/H3_EZ_Studio_REF2VA_Template.json)は、参照画像を使った2ショットの例です。Studioの「共通参照」に自分の画像を入れ、共通プロンプトと各ショットの本文を編集してください。参照番号の手入力は不要です。初期設定は縦長2:3・0.5 MP、音声付きMP4の書き出しです。

| 用途 | ダウンロード | `ComfyUI/models/` からの配置先 |
| --- | --- | --- |
| 拡散モデル（REF2VA Pruned INT8） | [minimax_h3_ref2va_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors) | `diffusion_models/` |
| テキストエンコーダー（Qwen3-VL 32B NVFP4/AWQ） | [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders/` |
| 映像VAE | [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae/` |
| 音声VAE | [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae/` |
| Pika H3 Flex REF2VA LoRA | [pika_h3_flex_ref2va_v1_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/pika_h3_flex_ref2va_v1_bf16.safetensors) | `loras/` |

Stability Matrixの共有モデルフォルダーや `minimax/` などのサブフォルダーを使う場合は、サブグラフ上の選択欄で実際のファイルを選び直してください。テキストエンコーダー種別は `minimax` です。テンプレートは[Pika Flexの配布元](https://huggingface.co/Comfy-Org/MiniMax-H3/commit/8118df0eaf5e96acc56eed5daf5229ca81cc05cf)に合わせ、LoRA強度1.0・LCM・手動6ステップを使用します。Turbo LoRAは重ねないでください。INT8の実行条件や代替モデルは[モデルの配布ページ](https://huggingface.co/Comfy-Org/MiniMax-H3)を確認してください。

サブグラフのブロック疎Attentionは初期状態でバイパスしています。Comfy Kitchen Attentionが使えない環境では `pytorch attention` を選択できます。`SaveVideo` が標準の `output/video/` に保存します。

LoRAなしのFL2VAの構成は [Basic](examples/H3_EZ_Studio_Basic.json)、外部テキスト入力の配線例は [External Prompt](examples/H3_EZ_Studio_External_Prompt.json) を使ってください。それぞれ同名の `.api.json` も同梱しています。

## 最初の確認
初回はShot 1のみ、目標5秒、0.3 MPで通常のH3生成が通るか確認してください。その後2〜3ショットへ増やします。元Continuum由来の継続処理でも、この新しい実行経路の画質はGPU未確認です。

## 2つのノード
- **H3 Continuum EZ Timeline**: 素材とショット、プロンプト、オーディオ編集。出力はTIMELINE PLAN 1本。外部の長文STRINGは任意。
- **H3 Continuum EZ Engine**: MODEL / CLIP / Video VAE / Audio VAE / SAMPLER / SIGMAS / Timelineを接続。サイズはStudio内で設定可能。IMAGE / AUDIO / FPS / REPORT / VIDEO / output_imagesを出力。動画書き出し時のIMAGEは未出力です。

新規Studioは音声付きMP4を書き出します。画像フレームを必要とする場合は「出力の詳細設定」で切り替え、標準Create Video→Save Videoも利用できます。Sampler・Scheduler・LoRAは標準ノードで設定します。REF2VAテンプレートはPika Flexの6ステップ、BasicはLoRAなしの20ステップです。モデルやLoRAを変更した場合は、使用するモデルに適した設定を選んでください。

## 操作
### ショット
素材画像をショットへドラッグするとReferenceとして割り当てます。順序はドラッグか矢印。秒数は右上で入力。
右端のドラッグで秒数を変更し、後続ショットをずらします。左端では前後2ショットの合計尺を維持して境界を動かします。再生位置・ショット境界・音声端へ吸着し、Altで吸着を解除できます。1回のドラッグはUndo1回で戻せます。

1ショット2〜600秒、最大16ショット、合計実尺60分以内です。「出力の詳細設定」の「自動分割」をオンにすると、15秒を超えるショットを内部区間で継続生成します。「1区間の秒数」は2〜15秒、初期値5秒です。実際の区間長はH3の時間グリッドに合わせて調整します。15秒以下のショットは1区間のままです。オフでは各ショットを15秒以下にしてください。本文は内部区間で共通に使うため、長いショットには持続する動作を書き、異なる出来事は別ショットへ分けてください。
「前の映像を継続」は映像・音声のcontextを引き継ぎ、「場面転換」は前stateを使用しません。最初は必ず初期生成です。
「ここで分割」は**生成計画の分割**です。生成済み動画の編集や部分再生成ではありません。分割後は各ショット2秒以上が必要です。
秒数は目標値であり、H3の17k+5の時間グリッドへ整列します。UIの「実際」とタイムラインが生成尺です。例えば目標5秒の3ショット継続は通常124+119+119=362フレーム、約15.083秒です。音声の位置もこの実尺を基準にします。

### 画像
- 開始画像: 最初のフレーム。全体で1つ。場面転換のショットには別の開始画像を指定できます。
- 共通Reference: 全ショットに継承。最初に数枚入れるだけで、以降のショットは画像なしで使えます。
- 個別Reference: そのショットだけ選択を変更。空の選択はReferenceなし。
- 参照に使う画像をサムネイルで選ぶだけです。画像との対応は内部で自動設定するので、文章に参照番号を書く必要はありません。複数選択できます。人物・背景・同じ人物の別角度など、用途は文章で説明してください。
- 素材の↻で画像を差し替えても割当を維持します。×は参照解除で、元画像を削除しません。
- 素材の画像下で「男性」「女性」など任意の呼び名を入力できます。同じ呼び名を本文でも使えます。
- 「台詞・終了画像」を開き、話者・話す内容・任意の開始秒を指定できます。話者の参照画像は自動選択。開始秒が空欄なら順番に均等配置し、各台詞を対応区間へ1回だけ送ります。発話の正確な時刻・声の固定を保証する機能ではありません。
- 終了画像はショットごとに指定でき、最後の内部区間だけに適用します。開始画像・Referenceとは別用途です。

**画像ReferenceにはREF2VA対応モデル、または対応hybridが必要です。基本WorkflowのFL2VAを使っている場合は、Reference用途に合わせてLoader／LoRAを変更してください。名前だけで未知のモデルを拒否する処理は入れていませんが、全モデルの互換性を保証しません。**

### プロンプトは普通の文章で
**画像を選び、共通欄に状況、ショット欄に動作を書く。これがEZ Studioの基本操作です。** 外部テキストノード・参照番号・チャンク見出し・H3の項目名は不要です。

**2ショットの記入テンプレート**

| Studioの入力欄 | 書く内容 |
| --- | --- |
| 共通プロンプト | ［誰が］［どこにいるか］。［画風・光・環境音など、全体で保ちたいこと］。 |
| Shot 1 → このショット | ［最初の動作］。必要なら［話す人と台詞］［カメラ］。 |
| Shot 2 → このショット | ［前の動作に続いて起こること］。必要なら［表情・反応・カメラ］。 |

**記入例：庭で出会った二人**

共通プロンプト：
```text
二人の旅人が静かな庭で出会う。柔らかな午後の光とそよ風。二人の顔と服装を全ショットで保つ。字幕やロゴは表示しない。
```

Shot 1：
```text
二人が映る中距離の構図。一人が相手に顔を向けて「そろそろ行こうか」と話す。相手は耳を傾ける。
```

Shot 2：
```text
二人が映ったまま、聞いていた旅人がうなずく。二人は小道の方へ向き直り、カメラがゆっくりついていく。
```

参照画像は「共通参照」で選び、Shot 2は「前の映像を継続」にします。秒数や場面転換はタイムラインで指定します。画像との対応とH3向けの形式はStudioが組み立てます。共通文とショット本文は、どちらか一方だけでも使えます。

「生成に使うプロンプト」でも共通文とショット本文を編集できます。共通文は全ショットへ、本文はそのショットだけに反映します。「送信文を確認（自動生成）」でH3向けの文を確認できます。入力文は要約・翻訳・切捨てせず保持します。「プロンプトを広く」で全文編集できます。外部STRINGは任意。接続中でも共通文の編集でStudio入力に切り替わり、編集文を使います。必要なら「外部テキスト」へ戻せます。「ショット本文のみ」では共通文を加えません。

詳しい使い方と自動化の範囲は [EZ Studioのプロンプト](docs/EASY_PROMPTS_JA.md) を参照してください。生成品質、複数人物の区別や台詞の割当はモデルに依存し、今回の自動組立てでの実H3 GPU品質は未検証です。

### オーディオ
音声ファイルをドロップすると、空き範囲にクリップが追加されます。クリップ本体は移動、左右端はトリム。数値では配置秒・素材IN・長さを別々に指定します。再生位置で非破壊分割できます。
1本の非重複トラックです。重ねたmix、伸縮、ピッチ変更、歌の作り直しはしません。
音声を置いた場合、編集した原音を生成の音声ガイドへ渡し、**最終AUDIOもその原音**です。生成音声を混ぜたり再Decodeしたりしません。空き部分は無音です。サンプルレート変換・mono→stereoを除き自動正規化はしません。
音声が0個ならH3の生成音声を出します。歌や台詞と口の一致はモデル依存であり、このUIが保証するものではありません。

## 保存と安全性
Studio内はDraft。反映したtimeline_jsonがノードとWorkflowに保存される正本です。閉じる時の未反映内容は破棄確認します。Workflow JSONを保存する操作と、ノードに反映する操作は別です。
素材は標準ComfyUI inputへアップロードします。Workflow共有時には素材ファイルも別途渡してください。base64でWorkflowへ埋め込みません。
同名Runの管理、Take履歴、Resume、部分再生成、Decode Cacheはありません。生成失敗時の途中復旧は提供しません。
ComfyUIの通常の実行cacheは使いますが、EZ専用の永続キャッシュは作りません。動画出力は内部区間ごとに保存・解放し、全尺のIMAGEバッチを作りません。画像フレーム出力や後段の処理では、長尺・高解像度ほど多くのRAMが必要になる場合があります。

## 元のContinuumとの関係
vendor/continuum内の15ファイルは通常版3.10.2の原ファイルとバイト一致です。新規のengine.pyが、元のReference Context、動きに応じた5/22/39f選択、AV時刻整合、MODELラッパー、標準Sampling、Seed派生を直接呼びます。
**前回EZ 1.0.0の独立22f Masked AV方式ではありません。** ただし可変長ショット、音声編集、UIは新しいため、通常版全機能との出力一致や長尺画質が検証済みとは言いません。

## 制限と未搭載
音声Reference、動画素材import、マルチトラックmix、Take選択、Project Manager、途中再開、Second Pass、Spectrum、独自LLMはありません。
参照されるinput素材は実パスもinput配下に限定します。input外へ向くsymlinkは安全のため読めません。

## 開発者向け検証
```bash
python -m pytest -q
node --test tests/state.test.mjs tests/generation.test.mjs tests/queue_status.test.mjs tests/seed_controls.test.mjs
python tools/verify_package.py
```
ブラウザー試験は `tools/browser_check.py`。PlaywrightとChromiumがある開発環境用で、通常利用には不要です。fixtureは実エディターを使用しますがComfyUIのAPI接続は模擬します。

[v0.9の検証](docs/RELEASE_VALIDATION_JA.md) · [タイムライン機能](docs/TIMELINE_EVOLUTION_SPEC_JA.md) · [プレビュー・キュー・自動分割](docs/PREVIEW_QUEUE_OPTIONS_JA.md) · [原コードの由来](docs/CORE_PROVENANCE.json)。開発中の固定仕様と当時の検証は[履歴](docs/VALIDATION_JA.md)に収録しています。

### Studio内の出力サイズ

アスペクト比8種類とメガピクセルをStudioで設定できます。新規は16:9・0.3 MP、736×416。両辺32の倍数に自動調整し実寸を表示します。既存WorkflowはEngineサイズを維持し、設定元で切り替えます。詳細は[解像度設定](docs/LOW_MEMORY_JA.md#解像度)を参照してください。
