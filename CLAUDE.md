# CLAUDE.md

This file provides guidance for working in `C:\Users\szk\Work\EvidenceShot`.

## プロジェクト概要

EvidenceShot は、現在のタブを証跡向けに撮影して保存する Chrome 拡張機能です。  
撮影開始はポップアップまたは Chrome commands のショートカットキーから行い、保存先は Chrome の既定ダウンロード先です。

## 主要仕様

- 表示領域撮影
- 現在のスクロール範囲の末尾までの縦連結撮影
- PNG / JPEG / WEBP 保存
- タイムスタンプ、左下固定テキスト、直近カーソル位置の任意付与
- 撮影後のクリップボードコピー
- 文字サイズはタイムスタンプと左下固定テキストに連動し、極小が旧標準相当
- ブラウザテーマに合わせたポップアップのライト / ダーク自動切り替え
- ショートカットキー撮影
- フローティングボタンなし
- 常時 `<all_urls>` 権限なし

## 主要ファイル

- `manifest.json`
  - 拡張機能の権限とエントリポイント定義
- `src/popup/popup.html`
  - 設定 UI
- `src/popup/popup.js`
  - 設定保存と撮影開始
- `src/background/background.js`
  - 撮影オーケストレーション
  - 拡張機能全体で 1 件に制限する同時撮影の排他制御
  - offscreen との連携
  - `chrome.downloads.download()` による保存開始
- `src/content/capture.js`
  - スクロール制御
  - 固定要素の一時退避
  - 撮影計画生成
  - 直近カーソル位置の取得
- `src/offscreen/offscreen.js`
  - 画像の逐次合成
  - タイムスタンプ / 左下固定テキスト / カーソル描画
  - クリップボード向け PNG コピー
  - 合成結果を background に返却
- `src/shared/constants.js`
  - メッセージ種別や既定設定
- `src/shared/utils.js`
  - 設定正規化と保存ユーティリティ

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

## リリース注意点

- `manifest.json` と `package.json` のバージョンは必ず一致させる
- `release/x.y.z` ブランチ名と manifest バージョンも一致させる

## 補足

- スクロール連結撮影は、撮影開始時点のスクロール範囲の末尾までを対象にする
- 長いページでは offscreen 合成に逐次転送する構成を使い、メモリ使用量を抑える
