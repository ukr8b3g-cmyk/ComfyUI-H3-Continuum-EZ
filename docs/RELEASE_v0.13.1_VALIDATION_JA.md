# v0.13.1 継続Context診断の検証

2026-11-08。診断は環境変数H3EZ_CONTINUITY_AUDITでoff/report/assertを指定し、未設定はoff。UI・入力・Workflow・モデル配線・シードは変更しません。

Python340成功、JavaScript99成功。offの新旧engineをImages/Long video×生成音声/入力音声の4条件でCPU比較し、出力・REPORT・Sampler入力・処理順が一致。実wrapperのCPU試験は予測側だけの検証をPASSにしません。通常Continuum由来22モジュールを保持。

普段のComfyUI_Wへ反映し、ユーザー再起動後reportでFastH3 OmniRef8stepの2区間を実GPU生成。832×480/24fps、192+187=379フレーム、約373.46秒。後続Context39f、映像12slots、音声65ticks、metadata_ok=true。wrapper呼出8・完全検証8・実評価側8（baseline_created1、baseline_matched7）、失敗0、ok=true。開始区間はcut/context0として区別。

入力音声のAAC682パケットの内容・PTS/DTS/長さは以前の同条件出力と一致。モデル配線・seedを保持。起動設定用一時スクリプトは起動後に除去し、現在の検証プロセスだけreport、次回通常起動はoff。

継続Contextがモデル実行時のLayout検証経路へ届いた証跡です。映像の自然さ・生成音声の品質や、今回のoff/report全映像のGPU比較は別の未確認Gateです。版番号・文書更新後のGPU再生成は行っていません。

[診断の使い方・CPU検証](CONTINUITY_AUDIT_JA.md) ／ [実GPU数値](RELEASE_v0.13.1_EVIDENCE.json) ／ [最終Pythonログ](RELEASE_v0.13.1_CPU.txt) ／ [最終JSログ](RELEASE_v0.13.1_JS.txt)
