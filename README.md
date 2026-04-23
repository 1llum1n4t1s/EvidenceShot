# EvidenceShot

Chrome 拡張機能 `EvidenceShot` は、ポップアップから現在のタブを証跡向けに撮影して、Chrome の既定ダウンロード先へ保存するためのツールです。

## 主な機能

- 現在の表示領域を撮影
- 現在のスクロール範囲の末尾までの縦連結撮影
- PNG / JPEG 保存
- タイムスタンプの付与

## 使い方

1. Chrome で拡張機能アイコンを押す
2. ポップアップで保存形式や撮影設定を選ぶ
3. `このタブを撮影する` を押す
4. 画像は Chrome の既定ダウンロード先へ保存される

## 撮影仕様

- 撮影開始はポップアップからのみ行う
- スクロール連結撮影を ON にすると、撮影開始時点のスクロール範囲の末尾まで連結する
- 撮影中に追加で読み込まれて増えたぶんは連結対象に含めない

## 権限

- `activeTab`: 現在のタブの撮影実行に使用
- `storage`: ポップアップ設定の保存に使用
- `scripting`: 撮影用コンテンツスクリプトの注入に使用
- `offscreen`: 画像の合成と保存準備に使用
- `downloads`: Chrome のダウンロード機能で保存するために使用

常時の `<all_urls>` 権限やフローティングボタンは使用しません。

## 開発

### 依存関係のインストール

```bash
npm install
```

### アイコン生成

```bash
npm run generate-icons
```

### ストア用画像生成

```bash
npm run generate-screenshots
```

### ビルド

```bash
npm run build
```

## Chrome への読み込み

1. `npm install`
2. `npm run generate-icons`
3. `chrome://extensions/` を開く
4. デベロッパーモードを有効化する
5. `パッケージ化されていない拡張機能を読み込む` からこのフォルダを選ぶ

## ディレクトリ構成

```text
EvidenceShot/
├── manifest.json
├── package.json
├── icons/
├── src/
│   ├── background/
│   │   └── background.js
│   ├── content/
│   │   └── capture.js
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── offscreen.js
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.js
│   └── shared/
│       ├── constants.js
│       └── utils.js
├── scripts/
├── webstore/
└── docs/
```

## アーキテクチャ概要

- `src/popup/popup.js`
  - 設定の読み書きと撮影開始
- `src/background/background.js`
  - 撮影ワークフロー全体の制御
  - タブ単位 / ウィンドウ単位の多重起動防止
  - 各キャプチャ断片の取得と offscreen への逐次転送
- `src/content/capture.js`
  - ページのスクロール制御
  - 固定要素の一時退避
  - 撮影計画の生成
- `src/offscreen/offscreen.js`
  - 画像の逐次合成
  - タイムスタンプ描画
  - ダウンロード保存

## リリース

`manifest.json` と `package.json` のバージョンを揃えたうえで、`release/x.y.z` ブランチを push すると、`.github/workflows/publish.yml` から公開フローが動きます。
