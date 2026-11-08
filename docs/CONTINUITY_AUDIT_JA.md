# 継続Contextの診断（開発・検証用）

v0.13.0を基準に追加し、v0.13.1へ収録した診断です。標準はOFFで、普段の操作は変わりません。この機能は継続生成の接続経路を調べるもので、画質や音声の自然さを保証する機能ではありません。

## モード

ComfyUIを起動するプロセスの環境変数 `H3EZ_CONTINUITY_AUDIT` で指定します。Studio・Workflow・ノードの入力に設定は追加しません。

| 値 | 動作 |
| --- | --- |
| 未設定／`off` | 診断ProfilerやContext検査を作らず、従来のREPORTを維持 |
| `report` | 生成後のREPORTへ各内部区間につき1行の `H3EZ_CONTINUITY_AUDIT {JSON}` を追加。診断不一致は警告のみ |
| `assert` | 同じ診断が不合格ならSampling後に停止。短い受入試験用 |

まず `report` で確認します。環境変数を変えても起動済みのComfyUIには届きません。通常の管理ランチャーで次回起動するときに設定してください。`assert` は通常使用の既定にしません。不正なモード名は設定エラーとして拒否します。

`report` が止めないのは追加した診断の不一致です。Sampler・既存のCore検証・入力・VAE等の本来のエラーやキャンセルは、従来どおり停止します。

## 記録するもの

- Context 5／22／39フレームの映像slots、音声ticks、符号付き音声grid offset。
- 各conditioning行に映像・音声Context参照が1件あること、マーカー・寸法・時間情報、選択したTensorとの同一性。入力音声のガイドを付けた後、Samplerへ渡すconditioningを調べます。
- 通常Continuumの既存 `LayoutValidationProfiler` による呼出数・完全検証数・失敗数・status別件数。`baseline_created`／`baseline_matched` の実評価側検証を `wrapper_actual_validations` として数えます。`forecast_validated` だけでは合格にしません。
- 最初の区間や場面転換はContextなしとして区別し、Profilerを作りません。

文章、素材パス、画像・音声・潜在Tensorの値は診断JSONへ記録しません。追加した検査はTensorをコピー・CPU転送・ハッシュ化せず、保持するのもスカラーと件数だけです。通常Continuumが以前から行う検証や転送は変更しません。

継続区間は `metadata_ok=true`、wrapper呼出数・完全検証数・実評価側検証数がいずれも正、失敗数が0の場合に `ok=true` とします。これはモデルwrapperの検証経路の証跡です。完成映像の人物・動作・背景の連続性や、音声・同期の品質は別途確認が必要です。

## キットからの調整

2026-11-08の提供キットを確認し、第1段階の診断だけを実装しました。添付パッチは現行HEADへ適用できなかったため、現行の音声ガイド・境界補正処理を保った最小変更で組み込みました。

形状が同じ別Tensorや音声Context参照の重複を見逃さないよう補強し、予測用の検証だけでPASSにならない判定を追加しました。非有限値は厳密JSONで表現可能にし、診断内部の例外は型名だけを記録して `report` を継続します。

不要な開始画像Encodeの削減、Audio Seam、Adaptive Cut、Masked AV、長尺Terminal Mergeは今回の対象外です。生成アルゴリズム、Context選択、SIGMAS、Seed派生、VAE、映像Seam、音声は変更していません。

## 確認結果（2026-11-08）

- Python **340件成功・失敗0・スキップ0**、JavaScript **99件成功・失敗0・スキップ0**。新規診断テスト31件を含みます。
- 既存のCPU Sampler代替実装はモデルwrapperを実行しないため、`report` で `ok=false`、`assert` で停止することを確認。代替Samplerを実モデル成功とは扱いません。
- 実際のvendor wrapperとLayout検証をCPU上で動かし、実評価側の2回の検証と、予測側だけの2回の検証を区別。これは実H3推論ではありません。
- 修正前v0.13.0のengineと診断OFFのengineを3区間（開始→継続→場面転換）で比較。Images／Long video × 生成音声／入力音声の4条件で、出力Tensor・音声・fps・REPORT・Sampler入力・Seed・処理順が一致。Sampling/VAEはCPU代替で、Long videoの書き出しは実PyAVを使用。
- 同じ形状の別Tensor、Context重複、音声マーカー欠落、不正な位相、Tensor値を読まずに行う検査、診断例外時の継続とログへの文章非露出を確認。

通常Continuum由来22モジュール、凍結仕様、登録2ノード、公開ソケット、UI、Workflowとモデル配線・シードは保持します。上記は第1段階のCPU確認です。後続の普段のComfyUIへの反映と実GPU結果は次節に記録しています。


## 後続の実GPU確認（2026-11-08）

普段のComfyUI_Wへ反映し、ユーザー再起動後にreportでFastH3 OmniRef8stepの2区間を実生成。モデル配線・seedを維持し、832×480/24fps、379フレームを約373.46秒で完了。後続Context39f、映像12slots・音声65ticks、metadata_ok=true。モデルwrapperの呼出8・完全検証8・実評価側8（baseline_created1／baseline_matched7）・失敗0、ok=true。継続Contextがモデル実行時のLayout検証経路に到達した証跡を確認しました。

入力音声のAAC682パケットの内容・時刻を以前の同条件出力と一致確認。画質・音声の自然さと、off/report全映像の実GPU比較は別の未確認Gateです。一時起動スクリプトは起動後に除去し、次回通常起動は標準OFF。公開は行っていません。
