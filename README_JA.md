[English](README.md) · [v0.10.0 リリース](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/tag/v0.10.0) · [配布ZIP](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.10.0/ComfyUI-H3-Continuum-EZ-v0.10.0.zip) · [ワークフロー](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.10.0/H3_Continuum_EZ_Studio.json)

# H3 Continuum EZ Studio

[H3 Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum) の継続生成エンジンを使う、ComfyUI用のタイムラインです。素材を置き、ショットごとに動きと尺を決め、音声付き動画に書き出せます。長いショットの区間分割と継続は内部で処理します。

## はじめに

1. [配布ZIP](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.10.0/ComfyUI-H3-Continuum-EZ-v0.10.0.zip) を展開し、`ComfyUI-H3-Continuum-EZ` フォルダーを `ComfyUI/custom_nodes/` に置きます。Gitから入れる場合は `custom_nodes` で `git clone https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ.git` を実行します。既存のGit導入版は `git pull --ff-only` で更新できます。導入・更新後はComfyUIを再起動し、ブラウザーを更新します。
2. [H3_Continuum_EZ_Studio.json](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum-EZ/releases/download/v0.10.0/H3_Continuum_EZ_Studio.json) をComfyUIへドラッグします。[同じテンプレートのソース](examples/H3_Continuum_EZ_Studio.json)もリポジトリ内にあります。
3. 下のモデル表に沿ってモデルを入れ、サブグラフ上のファイル名を確認します。「H3 Continuum EZ Timeline」の **タイムラインStudio** を開き、素材を追加します。テンプレートには庭を舞台にした2ショットの例文が入っています。

## 画面と操作順

![Studio画面。番号1〜8は下の手順に対応します。](docs/studio-guide.svg)

| 番号 | 操作 |
| --- | --- |
| ① 素材 | **素材追加**、または画像・音声をドロップ。全体に使う画像はプレビュー下の **共通参照** へ置きます。スクリーンショットの素材は操作例です。 |
| ② タイムライン | ショットを選び、追加・並べ替え・分割します。端をドラッグして尺を調整できます。音声は下のトラックに配置します。 |
| ③ ショット設定 | 目標秒数、場面転換、参照画像、縦横比とサイズを指定。右側のタイム表示はH3のフレーム単位に合わせた実際の長さです。 |
| ④ プロンプト | **ショット本文** にその場面の動作、**共通プロンプト** に人物や画風などを記入。**共通文 ON／OFF** で選択中のショットへの合成を切り替えます。**生成プロンプト** は動画モデルに送る文章です。 |
| ⑤ AI文章 | 編集中の欄の **AI生成** を押します。ショットのAI生成には共通文を渡しません。共通文も整えたい場合は共通プロンプトの画面で実行。**全ショットAI生成** はショット本文だけを処理します。**原文／AI文** で使う文章を切り替えられます。 |
| ⑥ セリフ・演出 | **セリフ追加** で話者・内容・開始秒を設定できます。カメラ、動作、参照の役割を設定し、必要に応じて最後に **最終画像** を指定します。 |
| ⑦ プレビュー | **構成確認** で素材の配置を見ます。書き出し後は **生成結果の動画** に切り替えて再生できます。 |
| ⑧ 反映・生成 | **ノード反映** で編集をワークフローへ戻し、ComfyUI側で保存します。**反映・キュー追加** で動画を生成します。テンプレートの出力先は `output/video/` です。 |

## テンプレートのモデル

ComfyUI 0.44.0で保存したサブグラフを使います。MiniMax H3に対応したComfyUIを用意してください。モデルと素材画像はZIPに同梱していません。

| 用途 | サブグラフの欄 | ダウンロード | `ComfyUI/models/` 以下 |
| --- | --- | --- | --- |
| H3 REF2VA 拡散モデル | `unet_name` | [minimax_h3_ref2va_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors) | `diffusion_models/` |
| H3 テキストエンコーダー | `clip_name` | [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders/` |
| AI文章用 P-H3 アップサンプラー | `clip_name_1` | [p-h3-image_prompt_upsampler_w4a8.safetensors](https://huggingface.co/PrunaAI/p-h3-image-comfy/resolve/main/text_encoders/p-h3-image_prompt_upsampler_w4a8.safetensors) | `text_encoders/` |
| 映像VAE | `vae_name` | [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae/` |
| Pika Flex REF2VA LoRA | `lora_name_1` | [pika_h3_flex_ref2va_v1_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/pika_h3_flex_ref2va_v1_bf16.safetensors) | `loras/` |
| 音声VAE | `vae_name_1` | [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae/` |

Stability Matrixの共有フォルダーや `minimax/` などを使う場合は、サブグラフ上で実際のファイルを選び直します。テンプレートはREF2VA、Pika Flex LoRA強度1.0、LCM・手動6ステップ、PyTorch Attention、縦長2:3・0.5 MPです。AI文章生成には `clip_name_1` のモデルを使います。

長いショットの分割やメモリーを抑える動画出力は **出力設定** で選べます。配置した音声がある場合はその音声を使い、ない場合はH3の生成音声を使います。チャンクの再生成・途中再開・Second Passを使う制作には通常版 [H3 Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum) を利用してください。

詳しい記入例は [プロンプトガイド](docs/EASY_PROMPTS_JA.md) を参照してください。AI文は動画向けに調整した実験機能です。内容を確認してから使ってください。
