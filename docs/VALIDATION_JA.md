# H3 Continuum EZ Studio 2.0.0 — 実装・検証記録

> 開発版2.0.0の記録です。公開版の検証は [v0.9の検証記録](RELEASE_VALIDATION_JA.md) を参照してください。

確認日: 2026-11-05。独立配布用の実装版。**GPU受入済みの製品版という意味ではありません。**

## 1. 完了した作業
実装前に `IMPLEMENTATION_SPEC_JA.md` を固定し、そのSHA-256を `SPEC_LOCK.json` に保存した。
その後、TimelineとEngineの2ノード、大型HTML Studio、編集計画、素材入力、継続／場面転換、長文Prompt、原音Audio、付属Workflowを実装した。
既存EZ 1.0.0を上書きするための新パッケージであり、旧ノードIDを自動変換しない。
通常版Continuum、既存Workflow／Run／Take、ユーザーPCには変更していない。

## 2. 元ContinuumのCoreと新規部分
`vendor/continuum` の15個の原ファイルは、通常Continuum 3.10.2配布物とバイト単位で一致する。
Reference Context (`reference_context_v1`)、映像／音声の時刻整合、state抽出・選択、MODEL clone wrapper、PackedLayout配置処理、Core Sampling、Auto context選択、Seed派生を同梱して呼んでいる。
`continuation.py` のGit blob SHA-1は `a67266408107037834d76d96529d5726a29bf985`。公開main `bf488aac81f1d377dee311a14f3828ee9b3c036c` から取得した内容とも一致した。
別途、元decoderから `decode_video` / `decode_audio` の関数本体を変更せず取り出し、不要な管理層への依存を避けた。
元ファイルの一部には未使用の高度機能向け遅延importがあるが、EZはその入口を呼ばない。元ファイルを「全部の機能が利用可能なAPI」として公開しない。

**新規実装**は可変長ショットの実行制御、Timelineコンパイル、素材安全読込、Audio配置編集、最終組立とUIである。
旧EZ 1.0.0の独立22フレームMasked AV方式へ置き換えていない。一方、通常版の全実行部をそのまま移植したわけでもない。
したがって、Core由来の一致は長尺画質・全Workflow・全wrapperとの互換性を保証しない。

## 3. 実行した検証
| 区分 | 結果 | 試験境界 |
|---|---:|---|
| Python CPU pytest | 100 passed / 0 failed / 0 skipped | 計画・素材・PCM・元Core・新規Engineの呼出し。ComfyUI／Sampler／VAE境界の一部は模擬 |
| JavaScript state tests | 16 passed / 0 failed / 0 skipped | 編集状態、Prompt、時間、参照、音声範囲、Undo |
| Chromium editor checks | 25項目成功、page error 0 | 実HTML／CSS／イベント処理、ComfyUI連携はfixtureで模擬 |
| 元Core照合 | 15ファイルのSHA-256一致 | 原ファイルに今回の変更なし |
| Workflow | 通常2個＋API2個のJSONと配線を確認 | 実ComfyUIでロードした結果ではない |

Python: 3.13.5 / torch 2.10.0+cpu / Node.js v22.16.0。詳細は `TEST_ENVIRONMENT.json`。
CUDAは未初期化。H3学習済みモデル・実GPUは使用していない。

### Python試験の内容
- Original temporal、state、layout、packed layout、seed/motionの既存テストを最小namespace調整で再利用。
- 目標尺と実際のH3 frame grid、継続とcut、各ショットの開始時刻。
- 共通文・区間文・外部STRING、@Rの番号解決とinactive参照の事前拒否。
- input配下に限定した相対パス。親方向参照・外部symlink拒否。
- Audioのsource-in、配置、隙間無音、非重複、分割。PCM WAVのサンプル値保持。
- 元の継続関数を使った3ショット実行、cutでstateをリセット、元MODEL/入力tensorの不変。
- 画像／音声／text encodeをSampling前に完了、DecodeはSampling終了後。
- 原音採用時に捨てる生成音声をDecodeしない。
- NaN／Inf・キャンセル時の停止。

### Chromium試験の内容
- 実extensionのOpenボタンからStudioを表示。
- 28,600文字のPromptをショット選択・反映・再読込で欠落なく保持。
- Prompt拡大モード、画像ドラッグ、安定したRスロット、ショット順序変更。
- Importの解析だけでは保存内容を変えず、確認後に本文だけ適用。
- 実WAV File入力をブラウザーでdecodeし波形用データを取得。
- Audio配置とsource-inを別に変更、非破壊分割、重複拒否、マウス端トリム。
- 外部Prompt接続中のreadonlyと最終実行値表示、解除時に内部文を保持。
- 画像差替え時のasset ID／R割当維持。
- 実widget値へ反映、再openによる状態復元、未反映closeの確認。
- Queueは模擬APIへの1回呼出しを確認。
- 1366×768で主要操作が表示されること。

この環境のChromiumはURLナビゲーションが管理ポリシーで制限されていたため、ポリシーは変更せず、`page.set_content` で独立fixtureを表示した。
製品のstate／studio／extensionソースを検査用にinline結合し、import/exportを検査scopeへ結線し、CSSを埋め込んだ。API・ノード・graphだけは代替した。
使用ソースhashと変換内容は `docs/browser/source_bundle.json`、項目一覧は `results.json`。
**これは実ComfyUI Classic／Nodes 2.0の受入試験ではない。** 画像は実装したHTMLの画面であり、画像生成によるモックアップではない。ただし素材はテスト用の架空画像である。

## 4. 未実施の確認
- 実ComfyUI Core、実H3 MODEL／CLIP／Video VAE／Audio VAEでのQueueと生成。
- 実GPUでの継続画質、人物一致、音声同期、lip-sync、速度、VRAM。
- Windows、Stability Matrix、実ブラウザーでのClassic／Nodes 2.0、他拡張との共存。
- PyAVでのMP3／FLAC／M4A／OGGの実読込。本検証環境にはPyAVがなく、CPU音声検証はPCM WAV。実環境ではComfyUIが持つPyAVを使う。
- H3のすべての量子化、LoRA、Attention wrapperの組合せ。
- 1〜16ショットの全最大長・最大画素量における実機負荷。

## 5. 現仕様の制約
- 目標秒数と出力秒数は同一ではない。H3のnative gridに合わせた**実尺をUIに表示**する。例: 目標5秒×3ショット継続は通常362frames / 24fps ≈15.083秒。
- 全フレームをRAMへ置く。RGBだけのメモリ推定を実施するがピーク全体は保証しない。
- Audioは1本の非重複トラック。原音clip間の隙間は無音。速度変化・mix・pitch変更なし。
- ブラウザーが再生できないAudio形式はPCM WAVを使用する。UIは未生成の構成プレビューであり、生成映像のライブプレビューではない。
- Image ReferenceにはREF2VAまたは対応hybridが必要。FL2VAの例に画像Referenceを追加しただけで互換になるとは限らない。
- 文字数上限25万はUI安全上の制約であり、モデルtoken容量の保証ではない。
- 元ContinuumのRun／Take／Review／Resume／Project Managerは含まない。保存済み履歴を変更しない。

## 6. 配布検査
配布ZIPは作成後に再展開し、同梱manifest、凍結仕様、CPU／JSテストを再確認する。
最終結果はZIP外の `ComfyUI-H3-Continuum-EZ-Studio-v2.0.0-RELEASE_CHECK.json` に記録する。テスト件数は上表と別に合算しない。

## 7. 安全な初回実機確認手順
旧EZフォルダーだけをcustom_nodes外へ退避し、新ZIPの同名フォルダーを配置。通常Continuumはそのまま残す。
最初は1shot／目標5秒／0.3MP、音声・参照なしでQueue。次に2shot継続、cut、Reference、Audioの順に独立して確認する。
これは実機検証済みという報告ではなく、未実施の受入手順である。

GitHub Issue更新・commit・push・Release・Registry公開は行っていない。ユーザーPCや起動中ComfyUIへの反映も行っていない。
