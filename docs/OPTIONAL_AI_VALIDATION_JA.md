# AIモデル未導入時の通常生成 — v0.10.1の修正

2026-11-07。v0.10.0（c1187b6）に対する修正。v0.10.1に収録。

## 変更

AI用のLoad CLIPからEngine.prompt_clipへの配線は、そのまま保存・表示する。
ComfyUIの標準 `add_on_prompt_handler` で、動画実行用のpromptからEZ Engineの
`prompt_clip` 入力だけを除く。Coreの検証前に処理するため、AIモデルが未導入でも
原文から動画を生成できる。保存用workflowと元のリクエストは変更しない。

AIモデルのノード自体と、他の入力・消費先は残す。動画用CLIPや別の実行ノードが
同じモデルを必要とする場合は通常どおり検証される。「AI生成」が作成する別の
文章生成ジョブも変更しない。原文／AI文の選択、生成直後のAI文選択、共通文と
ショット本文の分離は従来どおり。Core・Loader・Continuumの書き換えなし。

## 確認結果

- 関連Pythonテスト88件成功。導入先の関連19件も成功。
- 実ComfyUIの `execution.validate_prompt` で修正前の欠落モデルエラーを再現。
  修正後はImages／Long video、enhancer.enabledのtrue／false全組合せが通過。
  動画用CLIPに欠落モデルを指定する対照例と、AIモデル単体の検査は引き続き拒否。
  このCPU検証のテンソル供給ノードは代替。検証本体とEZノードは実物。
- 普段のWindows ComfyUI_WをStability Matrixから起動し、ClassicのStudioから
  「動画書き出し」「画像フレーム出力」をそれぞれクリックして実H3 GPU生成。
- 配布テンプレートの検証用コピーで、AIモデルに存在しない
  `__h3ez_missing_ai_model__.safetensors` を指定。実ファイルの移動・削除なし。
  外側の昇格ウィジェットと内側のLoad CLIPを同期し、実配線link 48は保持。
- 目標2秒、0.1 MP、参照・入力音声なし、H3 REF2VA＋Pika Flex、6 sampling steps。
  原文と共通文が実行履歴の送信文に残ることを確認。
- Long video: job `d2a099f8-3576-40a0-a2a4-9c7a06be7995` 成功、47.45秒。
  キャッシュ済みノードなし。416×224、24fps、56フレーム、約2.333秒。
- Images: job `050c15a2-5388-4f21-98fe-05b39ef9e8bb` 成功、21.71秒。
  Loader等は再利用、Engineは再実行。416×224、24fps、56フレーム。
- 両出力の動画とAAC 32kHz音声をPyAVで全デコードし、非無音の音声を確認。
  Long videoの音声peakは0.831、Imagesは0.776。
- Studioの再生ボタンとサムネイルからの途中再生を確認。動画はmuted=false。
  AI未導入状態の「AI生成」はモデル選択エラーを表示し、原文を保持。
  その直後の動画生成は成功。

Chrome自動操作がローカルURLで接続エラーになったため、実画面確認は同一サーバーへ
アプリ内Chromiumから接続した。Nodes 2.0、長尺、多ショット、AIモデルの再推論は
今回の確認範囲に含めない。既存のUI／ワークフローテンプレートは変更していない。

CPUで再現する場合は、ComfyUI環境のPythonから次を実行する（モデルロードなし）。

```text
python tools/check_comfy_prompt_validation.py <ComfyUIのルート>
```
