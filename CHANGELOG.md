# 変更履歴

Git のバージョン記録・コミット差分と既存の変更履歴をもとに、確認できた版ごとの変更点をまとめています。「Git 記録日」は公開日ではありません。番号の欠番だけから未確認のリリースは補っていません。

## 未リリース

## [1.0.21] — Git 記録日: 2026-08-30

- 問い合わせUIと撮影処理を改善する
- 依存関係を最新化
- プライバシーポリシーにお問い合わせフォームの取り扱いを追記
- 設定画面に Kagayoi Support のお問い合わせフォームを追加
- Node依存関係を更新 (#29)

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/3a6c1b3cd80dc493337c770c37cae1b1d7381021) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/e0672de18a888da56c1b6c936c08c5b0518bf9a3...3a6c1b3cd80dc493337c770c37cae1b1d7381021)。

## [1.0.20] — Git 記録日: 2026-08-08

- 製品紹介ページを追加し、撮影・配布に使う依存関係の既知の脆弱性へ対応。

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/e0672de18a888da56c1b6c936c08c5b0518bf9a3) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/8253c618d8b708e5409e3dc2dec0d90a88e80978...e0672de18a888da56c1b6c936c08c5b0518bf9a3)。

## [1.0.19] — Git 記録日: 2026-07-27

- 公開ワークフローを pnpm 化し chrome-webstore-upload-cli v4 へ対応

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/8253c618d8b708e5409e3dc2dec0d90a88e80978) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/23773530e2ba99d1b3e43af23b9dd4187a543903...8253c618d8b708e5409e3dc2dec0d90a88e80978)。

## [1.0.18] — Git 記録日: 2026-05-16

- 撮影から完了表示までの待ち時間を短縮し、撮影対象タブがフォーカスを失った際の再試行を改善。

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/23773530e2ba99d1b3e43af23b9dd4187a543903) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/fdc00d7ab656a45159e741c0baef892814ed6e55...23773530e2ba99d1b3e43af23b9dd4187a543903)。

## [1.0.17] — Git 記録日: 2026-05-16

- Firefox AMO 公開対応 (offscreen を event page で書き換え)

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/fdc00d7ab656a45159e741c0baef892814ed6e55) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/fbd7cf9a9237f3beabac0291bf15860b8542c885...fdc00d7ab656a45159e741c0baef892814ed6e55)。

## [1.0.16] — Git 記録日: 2026-05-14

- ページ全体/中央本文モードのスクロール撮影バグ修正

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/fbd7cf9a9237f3beabac0291bf15860b8542c885) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/eee95f3eb30eca729670c2e880de6ec1e8916e29...fbd7cf9a9237f3beabac0291bf15860b8542c885)。

## [1.0.15] — Git 記録日: 2026-05-14

- 日付スタンプ 15 種に刷新 + popup Liquid Glass 化 + UDEV Gothic バンドル

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/eee95f3eb30eca729670c2e880de6ec1e8916e29) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/832923ae6959424bb6cd0f6ff03cd998b7f41d15...eee95f3eb30eca729670c2e880de6ec1e8916e29)。

## [1.0.14] — Git 記録日: 2026-05-10

- タイムゾーン ON/OFF オプション追加と popup UI の全面刷新

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/832923ae6959424bb6cd0f6ff03cd998b7f41d15) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/abac423bb3132bedcd7d122d65113852b3dd5e9c...832923ae6959424bb6cd0f6ff03cd998b7f41d15)。

## [1.0.13] — Git 記録日: 2026-05-05

- マウスカーソル独自描画機能を全削除 (証跡改ざん相当のため)

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/abac423bb3132bedcd7d122d65113852b3dd5e9c) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/a9bc7a1fa14f0bdb0202a4bd674acb72ba2eabfb...abac423bb3132bedcd7d122d65113852b3dd5e9c)。

## [1.0.12] — Git 記録日: 2026-05-05

- blob URL origin 検証を popup/content 両経路に追加 (セキュリティ強化)
- acquireResult の optional chaining で SW 例外防止
- タイムスタンプにタイムゾーン (+09:00 等) を表示・PNG メタデータにも埋込
- カーソル描画で CSS cursor:pointer 時に指カーソルを再現
- ポップアップ横幅拡張 (380→480px) と撮影モード配置移動で縦スクロール削減
- 孤立 i18n キー (popupNoteCaptureModeDiff) を削除

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/a9bc7a1fa14f0bdb0202a4bd674acb72ba2eabfb) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/f64a72c1bd64490580bd75c750c084b8eddc1249...a9bc7a1fa14f0bdb0202a4bd674acb72ba2eabfb)。

## [1.0.11] — Git 記録日: 2026-05-02

- クリップボードの HTML フォールバック時の表示とエラー文言を修正し、撮影セッションの競合・タイマー残留を改善。

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/f64a72c1bd64490580bd75c750c084b8eddc1249) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/1a10908ef22cce657a7871f28e3f0e9d1dcbb56a...f64a72c1bd64490580bd75c750c084b8eddc1249)。

## [1.0.10] — Git 記録日: 2026-04-30

- 全テーマのタイムスタンプを秒粒度に統一
- ミニマルバッジのタイムスタンプにも秒を表示

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/1a10908ef22cce657a7871f28e3f0e9d1dcbb56a) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/dec86ed68ba7e8e4a4bd94d5acfc48b18f1163d7...1a10908ef22cce657a7871f28e3f0e9d1dcbb56a)。

## [1.0.9] — Git 記録日: 2026-04-29

- クリップボードコピー二経路ハイブリッド + PNG 改ざん検知メタデータ復活 + lifecycle 整理

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/dec86ed68ba7e8e4a4bd94d5acfc48b18f1163d7) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/727516d27c284671b744997f08021e86a7f9df9c...dec86ed68ba7e8e4a4bd94d5acfc48b18f1163d7)。

## [1.0.8] — Git 記録日: 2026-04-28

- ポップアップ経由撮影が常に失敗するバグを修正

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/727516d27c284671b744997f08021e86a7f9df9c) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/799fddae4cc2d7f36e1e1f2f6f0af86b18c47bba...727516d27c284671b744997f08021e86a7f9df9c)。

## [1.0.7] — Git 記録日: 2026-04-28

- ポップアップの空ステータスエリアの痕跡を非表示

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/799fddae4cc2d7f36e1e1f2f6f0af86b18c47bba) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/0f60fdbe47ad9395837eabb4feb5fe9c628f7187...799fddae4cc2d7f36e1e1f2f6f0af86b18c47bba)。

## [1.0.6] — Git 記録日: 2026-04-28

- ポップアップ初期ステータス削除 + CLAUDE.md 刷新

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/0f60fdbe47ad9395837eabb4feb5fe9c628f7187) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/25c775c31324c807fc4bfff66a29aefea545535c...0f60fdbe47ad9395837eabb4feb5fe9c628f7187)。

## [1.0.5] — Git 記録日: 2026-04-28

- PNG に URL・撮影日時・タイトル・画像ハッシュを埋め込み、画像の変更を検出する検証ツールを追加。
- 公開 Shadow DOM 内の固定ヘッダーと無限スクロールの検出を改善し、撮影ロックを Web Locks API へ変更。

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/25c775c31324c807fc4bfff66a29aefea545535c) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/fc48002d7497de17807790a21927ae2947c434ee...25c775c31324c807fc4bfff66a29aefea545535c)。

## [1.0.4] — Git 記録日: 2026-04-28

- 撮影用のオフスクリーンドキュメントの二重生成を防止し、画像切り抜き時のメモリ使用量を削減。
- クリップボードの失敗通知とショートカットからの対象タブ取得を改善。

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/fc48002d7497de17807790a21927ae2947c434ee) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/6f04f0521e10f8827bf074d01146716812927883...fc48002d7497de17807790a21927ae2947c434ee)。

## [1.0.3] — Git 記録日: 2026-04-28

- ショートカット撮影とクリップボードコピーを追加

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/6f04f0521e10f8827bf074d01146716812927883) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/022a97b0bd1c74b769f9a574bcc55db868f7d4fe...6f04f0521e10f8827bf074d01146716812927883)。

## [1.0.2] — Git 記録日: 2026-04-26

- ポップアップのテーマ対応

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/022a97b0bd1c74b769f9a574bcc55db868f7d4fe) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/c25b69ee0302e0dff6a189f0f11fb920d8e2b613...022a97b0bd1c74b769f9a574bcc55db868f7d4fe)。

## [1.0.1] — Git 記録日: 2026-04-25

- 撮影中の排他制御、画面倍率変更の検出、撮影用通信の認証を強化。スタンプ描画と配布設定を整理。

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/c25b69ee0302e0dff6a189f0f11fb920d8e2b613) / [変更差分](https://github.com/1llum1n4t1s/EvidenceShot/compare/24931d416dc2d06582df9206e9ec275485f9b668...c25b69ee0302e0dff6a189f0f11fb920d8e2b613)。

## [1.0.0] — Git 記録日: 2026-04-24

- 初回申請向けの機能調整と日英ローカライズを反映

出典: [版の記録](https://github.com/1llum1n4t1s/EvidenceShot/commit/24931d416dc2d06582df9206e9ec275485f9b668)。
