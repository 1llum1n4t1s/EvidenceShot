# AGENTS.md

This file provides guidance to coding agents working in `C:\Users\szk\Work\EvidenceShot`.

## プロジェクト概要

EvidenceShot は、現在のタブを証跡向けに撮影する Chrome 拡張機能です。  
ユーザーはポップアップまたはショートカットキーから撮影を開始し、生成された画像は Chrome の既定ダウンロード先へ保存されます。

## 実装方針

- 撮影開始はポップアップまたは Chrome commands のショートカットキーから行う
- フローティングボタンは存在しない
- 常時広域サイト権限は使わない
- スクロール連結撮影は、撮影開始時点のスクロール範囲の末尾までを対象にする
- 画像は offscreen document で逐次合成する
- クリップボードコピーは保存とは独立した補助機能で、失敗してもダウンロード保存は継続する

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
│   │   ├── offscreen.js
│   │   └── stamp-renderer.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── shared/
│       ├── constants.js
│       └── utils.js
├── scripts/
├── webstore/
└── docs/
```

## アーキテクチャ

- `src/popup/popup.js`
  - 設定値を `chrome.storage.local` に保存
  - `WTS_CAPTURE_FROM_POPUP` を background に送信
- `src/background/background.js`
  - Chrome commands のショートカットキーによる撮影開始
  - offscreen singleton を前提にした拡張機能全体 1 件の排他制御
  - content script 注入
  - 各 slice の取得
  - offscreen への逐次転送
  - `chrome.downloads.download()` による保存
- `src/content/capture.js`
  - キャプチャ計画の生成
  - スクロール位置制御
  - 固定要素の退避 / 復元
  - 直近カーソル位置の取得
- `src/offscreen/offscreen.js`
  - セッション単位の canvas 合成
  - タイムスタンプ / 左下固定テキスト / カーソル描画
  - クリップボード向け PNG コピー
  - 合成結果を background に返却（実際のダウンロードは background 側）
- `src/offscreen/stamp-renderer.js`
  - タイムスタンプ／フッターラベルのスタイル定義と描画本体
  - `globalThis.EvidenceShotStampRenderer` に `drawTimestamp` / `drawFooterLabel` を export

## 権限

- `activeTab`
- `storage`
- `scripting`
- `offscreen`
- `downloads`
- `clipboardWrite`

## 開発コマンド

```bash
npm install
npm run generate-icons
npm run generate-screenshots
npm run build
```

## リリース

- `manifest.json` と `package.json` のバージョンを一致させること
- `release/x.y.z` ブランチ名は manifest バージョンと一致させること

## 注意点

- multi-slice 撮影中は、対象タブがそのウィンドウの active tab であることを維持する前提
- 同時撮影は offscreen singleton との整合性のため background 側で拡張機能全体 1 件に制限する
- 画像断片は background に全保持せず、offscreen へ逐次送る
