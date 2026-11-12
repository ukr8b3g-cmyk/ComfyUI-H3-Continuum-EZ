[English](README.md) · [v0.13.4 リリース](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/tag/v0.13.4) · [配布ZIP](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.13.4/ComfyUI-H3-Continuum-EZ-v0.13.4.zip) · [FastH3 OmniRef JSON](https://raw.githubusercontent.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/refs/heads/main/examples/H3_Continuum_EZ_Studio_FastH3_OmniRef.json) · [REF2VA JSON](https://raw.githubusercontent.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/refs/heads/main/examples/H3_Continuum_EZ_Studio_REF2VA.json)

# H3 Continuum EZ Studio

[H3 Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum) の継続生成エンジンを使う、ComfyUI用のタイムラインです。素材を置き、ショットごとに動きと尺を決め、音声付き動画に書き出せます。長いショットの区間分割と継続は内部で処理します。

## はじめに

1. [配布ZIP](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.13.4/ComfyUI-H3-Continuum-EZ-v0.13.4.zip) を展開し、`ComfyUI-H3-Continuum-EZ` フォルダーを `ComfyUI/custom_nodes/` に置きます。Gitから入れる場合は `custom_nodes` で `git clone https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ.git` を実行します。既存のGit導入版は `git pull --ff-only` で更新できます。導入・更新後はComfyUIを再起動し、ブラウザーを更新します。
2. [FastH3 OmniRef版のワークフローJSON](https://raw.githubusercontent.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/refs/heads/main/examples/H3_Continuum_EZ_Studio_FastH3_OmniRef.json) を保存して、ComfyUIへドラッグします。リンクを右クリックして **名前を付けてリンク先を保存** を選び、拡張子は `.json` のままにします。
3. 下のモデル表に沿ってモデルを入れ、サブグラフ上のファイル名を確認します。「H3 Continuum EZ Timeline」の **タイムラインStudio** を開きます。テンプレートには1:1・0.5 MPで歌う10秒のショットが入っています。参照画像を使う場合は、手持ちの素材やComfyUIの `example.png` を追加します。

## 画面と操作順

![Studio画面。番号1〜8は下の手順に対応します。](docs/studio-guide-ja.svg)

| 番号 | 操作 |
| --- | --- |
| ① 素材 | **素材追加** または画像・音声のドロップで素材一覧へ登録します。画像を選択ショットの参照へ追加して使います。画面内の素材はユーザー提供の操作例です。 |
| ② タイムライン・音声 | ショットの選択・追加・複製・削除・並べ替え・分割。端のドラッグで秒数を調整できます。音声は素材一覧から下段へドラッグし、配置したクリップを選んで編集・削除します。 |
| ③ ショット・参照・サイズ | 選択ショットの **目標秒数** と **場面転換／継続** を設定。共通参照か個別参照を選び、使う画像をクリックします。**最終画像** もこの行で指定。比率・MPは動画全体の出力サイズ、**タイム** はH3のフレーム単位に合わせた時間です。 |
| ④ プロンプト | **ショット本文** は選択場面、**共通プロンプト** は全体で使う設定です。**共通文 ON／OFF** で選択ショットへの合成を切り替えます。**生成プロンプト** で動画モデルへ送る合成後の文章を確認できます。 |
| ⑤ AI文章 | 本文のすぐ下にある **AI生成** で文章を作成。**原文／AI文** で動画生成に使う文章を選び、両方の文章は保持します。ショットAIには画像・秒数・サイズを自動入力し、共通文は分離。上部の **全ショットAI生成** はショット本文だけを処理します。 |
| ⑥ セリフ・演出 | **セリフ追加** で話者・内容・任意の開始秒を指定します。その下で **カメラ**、動作追加、参照画像の役割を設定。モデルへの文章による指示であり、動きや発話時刻の厳密な制御ではありません。 |
| ⑦ プレビュー | 生成前は **構成確認**、書き出し後は **生成結果の動画** で確認します。再生・シークはタイムラインと連動。ミュートと音量はプレビュー専用です。下部で **開始画像** と **共通参照** を設定し、ショット側を共通参照にすると継承します。 |
| ⑧ 反映・生成 | **ノード反映** は編集をワークフローへ戻す操作で、生成は開始しません。**反映・キュー追加** で動画生成を開始。編集を残すにはComfyUI側でワークフローを保存します。**出力設定** は出力と自動分割、**一時ストレージ** はサーバーの作業用保存先を管理します。 |

P-H3アップサンプラーはAI文章生成用の任意モデルです。未導入でも、配線を変えずに **原文** で動画を生成できます。**AI生成** は文章を作成してAI文へ切り替える操作です。動画の実行前に内容を編集したり、**原文** に戻したりできます。

ショットのAI生成には、そのショットで有効な参照画像・開始画像・最終画像と、秒数・アスペクト比を自動で渡します。共通文は混ぜません。共通プロンプトのAI生成には共通文と共通参照だけを使います。**AI生成** の横に送信する画像の枚数を表示し、詳細はマウスオーバーで確認できます。画像の選択操作や追加設定は不要です。AI解析用の画像は総画素数に上限を設けて縮小し、元画像は変更しません。原文・参照画像・秒数・アスペクト比を変更すると、保存済みAI文は再生成が必要になります。StudioのMPだけを変更した場合は、AI文と原文／AI文の選択を維持します。

## AI指示

Studio上部の **AI指示** から、次回の **AI生成** に使うシステム指示を編集できます。通常は動画向けの標準指示のまま使えます。**標準に戻す** で初期状態へ戻し、**保存** でStudio指示を保存します。既存のAI文・原文は書き換えません。プロジェクト保存・読込にも含まれます。

素材欄に画像があり、参照が未設定なら、**AI文生成** の前に画像を参照へ追加するか、文章だけで生成するかを選べます。Studioで縦横比・MPを変えても、選択中のAI文はそのまま使えます。

任意の **Engine → ai_instruction** STRING入力を接続すると、Studio指示より外部入力を優先します。接続元の文章処理は **AI生成** を押した時だけ実行します。指示画面には外部入力を使用中であることを表示し、Studio内の指示は保持します。外部入力が空欄の場合は動画向け標準を使います。通常の動画生成はこの入力を実行しないため、AIモデルや指示ノードに依存せず **原文** で生成できます。テンプレートのモデル配線やシードを変える必要はありません。

ショットAIは **共通文 ON** のとき、共通プロンプトを背景情報として参照しますが、書き換えるのはショット本文だけです。共通プロンプトのAI生成ではショット本文を変更しません。画像番号と区間形式はEZが組み立てます。システム指示は画像向けP-H3アップサンプラーの出力方針を調整するもので、動画専用モデルへの変更ではありません。

## テンプレートのモデル

**最初はFastH3 OmniRefの8ステップ版を使ってください。** [H3_Continuum_EZ_Studio_FastH3_OmniRef.json をダウンロード](https://raw.githubusercontent.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/refs/heads/main/examples/H3_Continuum_EZ_Studio_FastH3_OmniRef.json)。モデルと素材画像は含みません。

**REF2VA＋Pika Flex版** は [H3_Continuum_EZ_Studio_REF2VA.json をダウンロード](https://raw.githubusercontent.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/refs/heads/main/examples/H3_Continuum_EZ_Studio_REF2VA.json)。このワークフローには [minimax_h3_ref2va_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors) を `models/diffusion_models/`、[pika_h3_flex_ref2va_v1_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/pika_h3_flex_ref2va_v1_bf16.safetensors) を `models/loras/` に配置します。H3テキストエンコーダー・映像／音声VAE・任意のAI文章モデルは下表と共通です。Pika LoRAはREF2VA用です。

### 必要環境

| 項目 | 必要条件・動作確認した構成 |
| --- | --- |
| ComfyUI | このサブグラフ全体は **v0.44.0以降を推奨**。確認環境はv0.44.0。PDD内蔵モデルの読込対応は **v0.42.0から** で、それ以前ではこのモデルを正しく読み込めません。 |
| フロントエンド | ComfyUIに付属する対応版を使用。保存・確認した版は **1.57.6**。 |
| Python | **3.13推奨**、確認済みは **3.13.12**。モデル自体がPython 3.13専用という意味ではありません。他のPython構成ではこのテンプレートを検証していません。 |
| NVIDIA用PyTorch | **CUDA 13.0以上のビルド（`cu130`以上）** を使用。確認済みは **2.14.1+cu130**。CUDA Toolkitだけを入れてもPyTorchのCUDAは切り替わりません。 |
| Comfy Kitchen | ComfyUIの依存関係で指定された版を使用。確認済みは **0.2.40**。配布CUDA wheelにはCUDA Runtime 13.0以上・NVIDIAドライバー **r580以上** が必要です。 |
| 既定のテキストエンコーダー | 配布元の[Comfy-Org](https://huggingface.co/Comfy-Org/MiniMax-H3)は、この **NVFP4 AWQエンコーダー自体はBlackwell専用ではない** と明記しています。ネイティブNVFP4演算の高速化には対応GPU・カーネルが必要です。代替として [BF16](https://huggingface.co/FastVideo/FastH3-Omni-Comfy/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_bf16.safetensors) または [INT8 ConvRot](https://huggingface.co/FastVideo/FastH3-Omni-Comfy/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors) のテキストエンコーダーをサブグラフで選択します。 |
| 動画・音声出力 | ComfyUIの依存関係に含まれる **PyAV 17以上**。確認済みは **19.0.2**。 |

モデル読込の対応時期は[ComfyUI v0.42.0のPDD対応](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.42.0)、Python・CUDAは[ComfyUIの導入説明](https://github.com/Comfy-Org/ComfyUI#manual-install-windows-linux)と[Comfy Kitchenの必要条件](https://github.com/Comfy-Org/comfy-kitchen#requirements)、モデル構成・NVFP4は[FastH3公式モデルカード](https://huggingface.co/FastVideo/FastH3-Omni-Comfy)を確認しています。旧版のComfyUIや別GPUでの動作確認はしていません。


| 用途 | サブグラフの欄 | ダウンロード | `ComfyUI/models/` 以下 |
| --- | --- | --- | --- |
| FastH3 OmniRef 拡散モデル | `unet_name` | [fasth3_omniref_8step_pruned_int8_convrot.safetensors](https://huggingface.co/FastVideo/FastH3-Omni-Comfy/resolve/main/diffusion_models/fasth3_omniref_8step_pruned_int8_convrot.safetensors) | `diffusion_models/` |
| H3 テキストエンコーダー | `clip_name` | [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders/` |
| AI文章用 P-H3 アップサンプラー | `clip_name_1` | [p-h3-image_prompt_upsampler_w4a8.safetensors](https://huggingface.co/PrunaAI/p-h3-image-comfy/resolve/main/text_encoders/p-h3-image_prompt_upsampler_w4a8.safetensors) | `text_encoders/` |
| 映像VAE | `vae_name` | [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae/` |
| 音声VAE | `vae_name_1` | [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae/` |

Stability Matrixの共有フォルダーや `minimax/` などを使う場合は、サブグラフ上で実際のファイルを選び直します。FastH3テンプレートの設定は **Euler／simple／8ステップ、映像Shift 12／音声Shift 3、Comfy Kitchen attention、VSA 10%・全区間** です。両テンプレートの初期サイズは **1:1・0.5 MP（704 × 704）** です。AI文章生成には `clip_name_1` のモデルを使います。

長いショットの分割やメモリーを抑える動画出力は **出力設定** で選べます。配置した音声がある場合はその音声を使い、ない場合はH3の生成音声を使います。チャンクの再生成・途中再開・Second Passを使う制作には通常版 [H3 Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum) を利用してください。

出力形式は **自動／動画保存／動画＋画像** です。どちらの動画出力も音声付きで保存し、画像処理が必要な配線では画像データも自動で出力します。手動での配線切替は不要です。自動分割の初期値は **7.5秒**。例えば15秒のショットは2区間で生成します。入力した7.5は保持し、実際の区間時間だけをH3のフレーム単位に調整します。

継続区間のつなぎ目には、通常Continuumの評価・色補正を使った自動補正が働きます。前の末尾2フレームと次の先頭5フレームだけをCPUで比較し、先頭1フレームだけの明るさの跳ねも、前後が安定して安全判定を満たす場合に補正します。場面転換・フレーム数・シード・音声位置は維持し、改善しない候補は使いません。動画保存では補正のために全動画分のRGBをRAMへ展開しません。

Studioで縦横比・MPを指定すると、出力の幅×高さを確認できます。ワークフロー側のノードで幅・高さを指定する場合は、**ComfyUI設定 → H3 Continuum EZ → 出力設定 → 出力サイズの設定元** で切り替えます。初期値の **ワークフローに従う** は保存済みの設定を維持します。切り替え後はStudioを開き直してノードに反映してください。

縦横比の横にある **画像に合わせる** を押すと、素材画像の縦横比だけを取り込みます。素材が複数ある場合は画像を選びます。MPはそのまま調整でき、出力の幅×高さは32ピクセル単位で表示されます。画像の縦横比を使用中はボタンにチェックが付きます。別の縦横比に戻すときは一覧から選びます。

キューに受け付けられると **✓ キュー追加済み** と表示します。動画生成中は、上部の細いプログレスバーで処理段階と完了区間数を確認できます。

## プロジェクト

1. **プロジェクト → 新規プロジェクト** で空のタイムラインを作成。
2. **プロジェクト → プロジェクト保存** で現在の編集をPCへ保存。
3. **プロジェクト → プロジェクト読込** で復元後、**ノード反映** または **反映・キュー追加** で使用。

Studio上部の **プロジェクト** から **新規プロジェクト／プロジェクト読込／プロジェクト保存** を選べます。`.h3ez.json` にショット・原文／AI文・素材参照・音声編集・Studioの出力設定を保存。未保存の編集があれば置換前に確認し、置換後も「元に戻す」で復元できます。素材本体はComfyUIの入力フォルダーに置いたままで、ファイルには含みません。モデル配線・外部STRINGノード・生成済み動画はワークフロー／サーバー側の情報です。読込後は **ノード反映** または **反映・キュー追加** を使います。[プロジェクト操作の詳細](docs/PROJECT_FILES_JA.md)。

未反映の編集がある状態でStudioを閉じるときは、**下書き保存して閉じる／破棄して閉じる／キャンセル** を選べます。同じブラウザーで同じタイムラインを開くと下書きが復元されます。ノード反映やプロジェクトファイルの書き出しは行いません。

## 音声編集

音声ファイルを音声トラックに直接ドロップするか、素材一覧からドラッグします。クリップは元の長さで0秒に配置し、重なる場合は先頭から探して入る最初の空き位置に置きます。動画ファイルも音声だけ取り込めます。映像はタイムラインへ追加しません。

音声クリップを選択すると、移動・長さ指定・再生位置での分割・複製・削除ができます。**映像に合わせる** を押した場合だけ、そのクリップを映像の末尾でトリムします。**削除**（またはDelete／Backspace）で配置を外しても素材は残り、**元に戻す** で復元できます。動画の長さはショットの秒数で決まり、書き出しにはその範囲の音声が使われます。

プレーヤーのミュートと音量はプレビュー専用です。音声クリップの音量は、生成ガイドと書き出す音声に反映します。音声は重ね合わせのない1トラックです。

詳しい記入例は [プロンプトガイド](docs/EASY_PROMPTS_JA.md) を参照してください。AI文は動画向けに調整した実験機能です。内容を確認してから使ってください。

## 今回の検証

v0.13.4はStudio内のキュー操作の反応を明確にしました。ボタンを**確認中・送信中**へ切り替え、送信できない場合は赤色の**未送信**、受付後は緑色と**✓**を表示します。具体的な入力エラーをボタン付近へ表示し、実行・完了・中断の状態とは分離。取りこぼした終了状態は一致する履歴から復元します。普段のComfyUIで実際のマウスクリックから受付・緑✓・Runningを確認し、その後ユーザー自身が停止したと確認しました。生成完了や画質の検証ではありません。公開時の追加の実画面確認・GPU生成は行っていません。[v0.13.4検証記録](docs/RELEASE_v0.13.4_VALIDATION_JA.md)。

以下はv0.13.3の確認記録です。

v0.13.3は**反映・キュー追加**が入力エラーで押せなくなる問題を修正しました。エラー時もボタンを押して理由を確認でき、不正な入力は送信前検査で止めます。操作のそばに「入力を確認」、マウスオーバーに理由を表示。アップロード・反映・送信中の一時ロックは保持し、完了・例外時に同じ処理で復旧します。分離Chromeで入力不正、音声尺不足、反映/送信/事前確認の失敗、処理中とAI処理後の復旧を確認。普段のComfyUIで修正済みボタンが有効であることを観測し、それ以降の画面確認はユーザー指定で終了しました。アップロードのネイティブ選択試験は未完了、新たなGPU生成は未実施です。[v0.13.3検証記録](docs/RELEASE_v0.13.3_VALIDATION_JA.md)。

以下はv0.13.2の確認記録です。

v0.13.2は継続境界の動き・外観の段差を低減します。通常Continuumの原コードのcosineブレンドとAuto安全判定を利用し、改善する場合だけ先頭最大2枚を補正。前2枚・次5枚の固定窓で処理し、全動画RGBの追加確保は行いません。同じモデル配線・シードのFastH3 2チャンク実GPU比較では、境界5フレーム窓の最大変化を**約28.8%低減**し、379フレーム・表示時刻・入力音声AAC682パケットの内容と時刻を保持しました。局所的な柔らかさは残ります。1組のモデル/seed/入力音声での確認で、全条件の無劣化を保証しません。Python **346**・JavaScript **99**件成功。診断は引き続き**標準OFF**です。[実装と制約](docs/MOTION_SEAM_JA.md) ／ [v0.13.2検証記録](docs/RELEASE_v0.13.2_VALIDATION_JA.md)。

以下はv0.13.1の確認記録です。

v0.13.1は継続Context診断を追加し、**標準OFF**です。Python340・JavaScript99件成功。普段のComfyUIでFastH3の2チャンクを実GPU生成し、Context39f・映像12slots・音声65ticks、モデルwrapper実評価側の検証8回・失敗0を確認。モデル配線・シード・379フレーム・入力音声の内容と時刻を保持しました。映像の自然さとは別の検証です。[今回の検証記録](docs/RELEASE_v0.13.1_VALIDATION_JA.md)。

以下はv0.13.0の確認記録です。

開発用の継続Context診断については[診断手順とローカル検証](docs/CONTINUITY_AUDIT_JA.md)を参照してください。標準OFFで、通常の生成操作は変わりません。

Python309件・JavaScript99件成功。普段のWindows ComfyUIで実AI推論2件、共通／ショットの分離、MP変更後の保持、原文／AI文切替を確認。同じモデル配線・seedのFastH3 2チャンク実生成では境界の平均輝度差＋16.449%→−0.261%、379フレームとAAC内容・時刻を保持し、全尺RGB1.69GiBは未確保でした。[検証範囲と限界](docs/RELEASE_v0.13.0_VALIDATION_JA.md)を参照してください。
