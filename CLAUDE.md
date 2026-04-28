# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

EvidenceShot は、現在のタブを証跡向けに撮影して保存する Chrome 拡張機能 (Manifest V3)。
撮影はポップアップ または `chrome.commands` のショートカット (`Ctrl+Shift+Y` / mac は `Cmd+Shift+Y`) から開始し、保存先は Chrome 既定のダウンロードフォルダ。

## 主要仕様

- 表示領域撮影 / スクロール連結撮影 (撮影開始時点のスクロール範囲の末尾まで) / 中央本文のみ抽出
- PNG / JPEG / WEBP 保存
- タイムスタンプ、左下固定テキスト、直近カーソル位置の任意付与
- 撮影後の任意クリップボードコピー (PNG)
- ブラウザテーマに連動するポップアップのライト / ダーク自動切替
- フローティングボタンなし、常時 `<all_urls>` 権限なし
- **PNG 出力には改ざん検知メタデータ (`iTXt`) を埋め込み**: URL / タイムスタンプ / タイトル / 拡張機能バージョン / IDAT-SHA256
- 文字サイズはタイムスタンプと左下固定テキストに連動し、極小が旧標準相当

## アーキテクチャ概観 (4 context)

```
popup.js ── chrome.runtime.sendMessage ──▶ background.js (SW)
                                              │
                                              ├── chrome.scripting.executeScript
                                              │       ▼
                                              │   capture.js (content) ── DOM 制御 / スクロール / 固定要素退避
                                              │
                                              ├── chrome.tabs.captureVisibleTab  (各スライス)
                                              │
                                              └── chrome.runtime.sendMessage ──▶ offscreen.js
                                                                                   └─ stamp-renderer.js
                                                                                   Canvas 合成 → PNG メタデータ埋込
                                                                                   → Blob URL を background に返却
                                                                                   → chrome.downloads.download
```

重要な共通プロトコル:

- **メッセージ種別 (`MESSAGE_TYPES`)** は `src/shared/constants.js` に一元定義。文字列リテラルを散在させない。
- **`OFFSCREEN_INTERFACE_VERSION`** は offscreen ↔ background のプロトコル変更時にインクリメント。SW 再起動時の世代不一致検出に使う。
- **`OFFSCREEN_CHANNEL_TOKEN`** は SW 起動時に CSPRNG で生成し offscreen URL のクエリに埋込み。世代管理を兼ねる (セキュリティ境界の効果は限定的、`sender.id` + `sender.tab` チェックが主防御)。
- **撮影排他制御は `navigator.locks` (Web Locks API)** を使用。`evidenceshot-capture-tab-<tabId>` (タブ単位) と `evidenceshot-capture-global` (拡張機能全体) の 2 段ロック。SW 死亡で自動解放されるため幽霊ロック判定は不要。
- **`CONTROLLER_VERSION` (capture.js)** は content script のバージョン。挙動を変えたらインクリメントして旧 inject の dispose を強制する。

## 主要ファイル

- `manifest.json` — 権限・コマンド・CSP
- `src/popup/popup.{html,js,css}` — 設定 UI と撮影開始
- `src/background/background.js` — 撮影オーケストレーション、Web Locks 制御、`chrome.downloads.download` による保存
- `src/content/capture.js` — スクロール制御、固定要素 (Shadow DOM 含む) の一時退避、撮影計画生成、カーソル位置取得
- `src/offscreen/offscreen.js` — Canvas 合成、カーソル描画、PNG `iTXt` メタデータ埋込、クリップボードコピー
- `src/offscreen/stamp-renderer.js` — タイムスタンプ / 左下固定テキストのスタイル定義と描画 (`globalThis.EvidenceShotStampRenderer` に export)
- `src/shared/constants.js` — 既定設定・メッセージ種別・スタイル定義 (`globalThis.EvidenceShotConstants`)
- `src/shared/utils.js` — 設定正規化・保存・i18n・`respondAsync` 等の共通ヘルパ (`globalThis.EvidenceShotShared`)
- `docs/verify-evidence.js` — 撮影 PNG の改ざん検知用 Node スクリプト
- `_locales/{en,ja}/messages.json` — i18n メッセージ

## 権限

`activeTab` / `storage` / `scripting` / `offscreen` / `downloads` / `clipboardWrite`

## 開発コマンド

```bash
npm install
npm run generate-icons          # icons/ を生成
npm run generate-screenshots    # webstore/ プロモ画像 (puppeteer 使用)
npm run build                   # 上記 2 つを連続実行
```

開発ループ:

1. `chrome://extensions` を開く
2. 「デベロッパーモード」ON → 「パッケージ化されていない拡張機能を読み込む」でリポジトリルートを選択
3. ソース変更後は同画面の更新ボタンで再読込
4. 手動確認用フィクスチャは `scripts/manual-fixture.html`

テストフレームワーク・lint は導入していない。挙動確認は手動。

## 改ざん検知の検証

PNG 出力には `iTXt` チャンクが埋め込まれている:

```bash
node docs/verify-evidence.js path/to/screenshot.png
```

`IdatHashSha256` と再計算したハッシュの一致 / 不一致で判定する。Photoshop で再保存すると IDAT が再エンコードされるため不一致になり「素人改変」を検知できる。完全な改ざん耐性ではない (TSA 連携は今後の課題)。

## リリースフロー

`/vava` スキルでバージョンアップ〜リリースまで一括処理する。手動でやる場合の必須手順:

1. **バージョン同期 (3 ファイル)**: `manifest.json` / `package.json` / `README.md` を必ず揃える
2. **`release/x.y.z` ブランチ名 = manifest バージョン**: CI (`.github/workflows/publish.yml`) の検証ステップで一致を確認
3. main にコミット → push → `release/x.y.z` ブランチを作成して push
4. **`release/**` への push が CI トリガー**: ZIP ビルド → Chrome Web Store API 経由で auto-publish
5. **新権限を追加した版は CWS Developer Dashboard の「Privacy practices」タブの再記入が必要**: これを忘れると `400 Publish condition not met` で公開拒否される

CI で必要な GitHub Secrets: `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` / `CWS_EXTENSION_ID`

## 補足

- スクロール連結撮影は、**撮影開始時点のスクロール範囲の末尾**までを対象にする (動的ロードでページが伸びても画像には含まれない)
- 動的ロード (無限スクロール / 遅延レンダリング SPA) は `moveToCaptureStep` で page height の事後拡大を検知し `console.warn` のみ (撮影は完走、欠落は警告で通知)
- 長いページでは offscreen 側 Canvas へスライス毎に `drawImage` する **逐次転送** で SW 側のメモリピークを抑える
- Canvas トリミング時の GPU メモリ 2 倍ピーク回避のため `createImageBitmap` 経由で元 Canvas を解放してから新 Canvas に転送する
- DPR (デバイスピクセル比) 変動 (マルチモニタ間移動など) を撮影中に検知してエラーで中止する
- Shadow DOM (open mode) の `position: fixed` 要素も退避対象 (closed mode は仕様上アクセス不能)
- `position: sticky` は退避しない (Notion / GitHub の sticky テーブルヘッダ等が全スライスで消える事故を回避)
