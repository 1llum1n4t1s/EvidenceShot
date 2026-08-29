# AGENTS.md

このファイルは EvidenceShot で作業する coding agent 向けの規約です。システム構造、責務境界、データフロー、設計判断は [DESIGN.md](DESIGN.md) を正本とし、本書は変更時の制約と検証手順を扱います。

## プロジェクト概要

EvidenceShot は、現在のタブを証跡向けに撮影して保存する Chrome / Firefox 拡張機能 (Manifest V3)。
撮影はポップアップ または `chrome.commands` のショートカット (`Ctrl+Shift+Y` / mac は `Cmd+Shift+Y`) から開始し、保存先はブラウザ既定のダウンロードフォルダ。

## 主要仕様

- 表示領域撮影 / スクロール連結撮影 (撮影開始時点のスクロール範囲の末尾まで) / 中央本文のみ抽出
- PNG / JPEG / WEBP 保存
- タイムスタンプ、左下固定テキストの任意付与
- 撮影後の任意クリップボードコピー (PNG)
- ブラウザテーマに連動するポップアップのライト / ダーク自動切替
- 撮影開始はポップアップ または `chrome.commands` ショートカットのみ（フローティングボタンは持たない）
- 権限は最小に保ち、常時 `<all_urls>` 権限は持たない（撮影は `activeTab` で都度取得する）
- **PNG 出力には改ざん検知メタデータ (`iTXt`) を埋め込み**: クエリとハッシュを除いた URL / タイムスタンプ / タイトル / 拡張機能バージョン / IDAT-SHA256
- 文字サイズはタイムスタンプと左下固定テキストに連動し、極小が旧標準相当

## アーキテクチャ概観 (4 context)

```
popup.js ── chrome.runtime.sendMessage ──▶ background.js (Chrome SW / Firefox event page)
                                              │
                                              ├── chrome.scripting.executeScript
                                              │       ▼
                                              │   capture.js (content) ── DOM 制御 / スクロール / 固定要素退避
                                              │
                                              ├── chrome.tabs.captureVisibleTab  (各スライス)
                                              │
                                              └── composer (createComposer() で実行時選択)
                                                    ├ Chrome: offscreen.html 内の composer.js (background SW から sendMessage 経由)
                                                    └ Firefox: background.html 内の composer.js (background event page が直接呼ぶ)
                                                       │
                                                       └─ stamp-renderer.js
                                                          Canvas 合成 → PNG メタデータ埋込
                                                          → Blob URL を background に返却
                                                          → chrome.downloads.download
```

重要な共通プロトコル:

- **メッセージ種別 (`MESSAGE_TYPES`)** は `src/shared/constants.js` に一元定義する。文字列リテラルは散在させず `MESSAGE_TYPES` を参照する。
- **`OFFSCREEN_INTERFACE_VERSION`** は offscreen ↔ background のプロトコル変更時にインクリメントする。SW 再起動時の世代不一致検出に使う。
- **`OFFSCREEN_CHANNEL_TOKEN`** は SW 起動時に CSPRNG で生成し offscreen URL のクエリに埋込み、世代管理を兼ねる (セキュリティ境界の効果は限定的、`sender.id` + `sender.tab` チェックが主防御)。
- **撮影排他制御は `navigator.locks` (Web Locks API)** を使用する。`evidenceshot-capture-tab-<tabId>` (タブ単位) と `evidenceshot-capture-global` (拡張機能全体) の 2 段ロック。SW 死亡で自動解放されるため幽霊ロック判定は不要。
- **`CONTROLLER_VERSION` (capture.js)** は content script のバージョン。挙動を変えたらインクリメントして旧 inject の dispose を強制する。
- 画像断片は background に全保持せず、offscreen へ逐次送る（メモリピーク抑制）。

## クリップボード書込パス (PNG コピー) — 二経路ハイブリッド

`navigator.clipboard.write` は **`document.hasFocus()` が true な context** でしか成功しない (DOMException: `Document is not focused.`)。`offscreen` は常に hidden で書けず、`content script` も popup を開いている間は focus を奪われて書けない。よって以下の二経路で **書込 context を起動経路ごとに切り替える**:

| 起動経路 | 書込 context | 理由 |
|---|---|---|
| ポップアップから撮影 | **popup 自身** | popup が user activation を保持。content script は popup に focus を奪われて書込不可 |
| ショートカット (`Ctrl+Shift+Y`) | **active タブの content script** | popup が無いので web page が focus を保つ |

`offscreen.js` は書込を試みず **PNG blob URL (`URL.createObjectURL`) を返すだけ**。実装対応:

- popup 経由: `popup.js` の `writeClipboardFromUrl` が `result.clipboardObjectUrl` を fetch + `clipboard.write`
- ショートカット経由: `background.js` の `delegateClipboardCopyToContent` が `MESSAGE_TYPES.CLIPBOARD_COPY_FROM_URL` を content script へ送る。content script の `copyClipboardFromUrl` が fetch + `clipboard.write` を優先し、`http://` など secure context でないページでは `document.execCommand('copy')` による HTML `<img>` コピーへ fallback する。
- Chrome は `blob:chrome-extension://...`、Firefox は `blob:moz-extension://...` を fetch するが、いずれも**同一拡張機能 origin** なので `web_accessible_resources` 不要
- 書込終了後の URL 解放は二段保証: (1) popup / SW (`captureActiveTabFromCommand`) が `MESSAGE_TYPES.REVOKE_OBJECT_URL_FROM_POPUP` 経由で **即時 revoke 依頼**、(2) offscreen 側の `scheduleDownloadUrlRevoke` が **60 秒タイマー** で保険 revoke。popup が閉じる等で (1) が届かなくても (2) で確実に解放される

## 主要ファイル

- `manifest.json` — Chrome 用 (権限・コマンド・CSP)。Firefox 用は `scripts/build-firefox.js` が `firefox-build/manifest.json` を生成
- `src/popup/popup.{html,js,css}` — 設定 UI と撮影開始
- `src/background/background.js` — 撮影オーケストレーション、Web Locks 制御、`chrome.downloads.download` による保存。`createComposer()` で Chrome (offscreen 経由 adapter) / Firefox (composer.js 直接) を実行時切替
- `src/background/background.html` — **Firefox 専用** event page。`composer.js` を `<script>` タグで読み込み、`chrome.offscreen` の代わりに event page 自身の DOM を使う
- `src/content/capture.js` — スクロール制御、固定要素 (Shadow DOM 含む) の一時退避、撮影計画生成
- `src/offscreen/offscreen.html` — Chrome 専用 offscreen document の HTML エントリ
- `src/offscreen/offscreen.js` — Chrome 専用 offscreen の thin adapter。SW からの sendMessage を `globalThis.EvidenceShotComposer` に転送するだけ
- `src/offscreen/stamp-renderer.js` — タイムスタンプ / 左下固定テキストのスタイル定義と描画 (`globalThis.EvidenceShotStampRenderer` に `drawTimestamp` / `drawFooterLabel` を export)
- `src/shared/composer.js` — **Canvas 合成・PNG iTXt 埋込・クリップボード PNG 生成の本体**。`globalThis.EvidenceShotComposer` として export。Chrome (offscreen.html) と Firefox (background.html) の両方で読み込まれ、両ブラウザで同じロジックが動く
- `src/shared/constants.js` — 既定設定・メッセージ種別・スタイル定義 (`globalThis.EvidenceShotConstants`)
- `src/shared/utils.js` — 設定正規化・保存・i18n・`respondAsync` 等の共通ヘルパ (`globalThis.EvidenceShotShared`)
- `src/shared/kagayoi-support-{popup,footer}.{js,css}`, `src/shared/kagayoi-support-form.css` — exact 固定した `kagayoi-support-extension` から同期する問い合わせ UI の同梱コピー。直接編集せず、正本側を更新して同期する
- `scripts/build-firefox.js` — Chrome 用 `manifest.json` をベースに Firefox 用 `firefox-build/` を生成。`background.service_worker` → `background.page` 切替、`offscreen` permission 除去、`browser_specific_settings.gecko` 付与
- `docs/verify-evidence.js` — 撮影 PNG の改ざん検知用 Node スクリプト
- `_locales/{en,ja}/messages.json` — i18n メッセージ

## 権限

`activeTab` / `storage` / `scripting` / `offscreen` / `downloads` / `clipboardWrite`。問い合わせ API に限り `https://support.kagayoi.com/*` の host permission を使う。Firefox 生成 manifest は `personallyIdentifyingInfo` / `authenticationInfo` / `personalCommunications` を required で申告する。

## 開発コマンド

```bash
pnpm install
pnpm run sync:support            # 共通問い合わせ UI の5ファイルを正本から同期
pnpm exec kagayoi-support-sync --check # 同梱コピーと正本の一致だけを検証
pnpm run generate-icons          # icons/ を生成
pnpm run generate-screenshots    # webstore/ プロモ画像 (puppeteer 使用)
pnpm run build                   # 問い合わせ UI 同期後、上記 2 つを連続実行
pnpm run build:firefox           # Firefox AMO 用に firefox-build/ ディレクトリを生成
```

開発ループ:

1. `chrome://extensions` を開く
2. 「デベロッパーモード」ON → 「パッケージ化されていない拡張機能を読み込む」でリポジトリルートを選択
3. ソース変更後は同画面の更新ボタンで再読込
4. 手動確認用フィクスチャは `docs/manual-fixture.html`

テストフレームワーク・lint は導入していない。挙動確認は手動で行う。

## 改ざん検知の検証

PNG 出力には `iTXt` チャンクが埋め込まれている:

```bash
node docs/verify-evidence.js path/to/screenshot.png
```

`IdatHashSha256` と再計算したハッシュの一致 / 不一致で判定する。Photoshop で再保存すると IDAT が再エンコードされるため不一致になり「素人改変」を検知できる。完全な改ざん耐性ではない (TSA 連携は今後の課題)。

## 証跡改ざん回避ポリシー (恒久遵守) ⚠️

**ブラウザがレンダリングしていないピクセルを Canvas で合成して画像へ焼き込む行為は禁止する**。本拡張機能が PNG iTXt で売りにしている「改ざん検知」の存在意義と矛盾するため、いかなる理由でも追加せず、撮影された実ピクセルだけを保存する。

具体的に **禁止** する追加機能:

- マウスカーソル / ポインタの独自描画 (`chrome.tabs.captureVisibleTab` は OS カーソルを撮影しないが、Canvas 描画でそれを補完するのは合成画像であり証跡ではない)
- 撮影後に「ハイライト枠」「丸囲み」「矢印」等を Canvas に追加する注釈機能
- ブラー処理・モザイク処理 (元ピクセルの可逆性を失わせるため証跡として無効化)
- 任意 SVG / PNG オーバーレイ

**例外として許可**するもの (= 撮影者が「これを足した」と自己申告する性質のもの):

- タイムスタンプ (撮影者の選択で上書きする旨が iTXt に Timestamp として記録される)
- 左下固定テキスト (撮影者が任意で挿入したと明示できる)

これらの境界は v1.0.13 でカーソル描画機能を全削除した際に明文化された。過去 (v1.0.3〜v1.0.12) はカーソル描画機能を持っていたが、Canvas 合成 = 改ざん相当という整理で撤去。**未来の自分・LLM へ**: 「カーソルがあると便利だから戻そう」「ここだけ Canvas で足そう」は禁断の坂道。提案された場合は本セクションを根拠に断ること。

## リリースフロー

`/vava` スキルでバージョンアップ〜リリースまで一括処理する。手動でやる場合の必須手順:

1. **バージョン同期 (3 ファイル)**: `manifest.json` / `package.json` / `README.md` を必ず揃える。これを揃え忘れると CI の検証ステップで `package.json` と `manifest.json` の不一致で弾かれる (v1.0.10 で踏んだ罠)。依存の lockfile は pnpm 化済み (`pnpm-lock.yaml`)。CI は `pnpm install --frozen-lockfile --ignore-scripts` でインストールするため、`package.json` を変更したら `pnpm install` で `pnpm-lock.yaml` を更新してコミットする (lockfile 不整合だと frozen install が落ちる)
2. **`release/x.y.z` ブランチ名 = manifest バージョン**: CI (`.github/workflows/publish.yml`) の検証ステップで一致を確認する
3. main にコミット → push → `release/x.y.z` ブランチを作成して push
4. **`release/**` への push が CI トリガー**: ZIP ビルド → Chrome Web Store API 経由で auto-publish
5. **新権限を追加した版は CWS Developer Dashboard の「Privacy practices」タブを再記入する**: 記入し忘れると `400 Publish condition not met` で公開拒否される

CI で必要な GitHub Secrets:

- Chrome Web Store: `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` / `CWS_EXTENSION_ID`
- Firefox AMO: `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` (AMO の `addons.mozilla.org/developers/addon/api/key/` から発行した JWT credentials)

## リリース前 smoke test (必須)

`/vava` も CI 自動公開もコードを実機で動かす検証は含まれない。リリースタグを切る前に必ず以下 2 経路で撮影成功を確認する:

1. **ポップアップ経由**: アクションアイコン → ポップアップ → 「このタブを撮影する」→ ダウンロード保存を目視
2. **ショートカット経由**: `Ctrl+Shift+Y` (mac: `Cmd+Shift+Y`) → ダウンロード保存を目視

両方確認する理由: popup.js の `onCaptureNow` は丸ごと `try-catch` で囲まれ、内部の `ReferenceError` 等を fallback 文言「撮影に失敗しました。」に握りつぶす。**ショートカットだけテストすると popup-only バグを必ず見逃す**。実例として v1.0.4〜v1.0.7 まで `MESSAGE_TYPES` の分割代入漏れでポップアップ経由撮影が完全にコケていたが 5 日間検出されなかった。

## デバッグの足場

- **`Shared.normalizeUserMessage` の英語フィルタ**: 日本語 UI で英語のみのエラー (`Could not establish connection.` 等 Chrome ネイティブメッセージ) を fallback 文言「撮影に失敗しました。」に置換する。原文の真因を残すため、`runCaptureWorkflow` の catch では必ず `console.error` で原文も Service Worker コンソールへ出す (これを消すと SW コンソールに証拠が残らない)。
- **`isTrustedPopupSender` の URL 完全一致ゲート**: popup → background のメッセージは `sender.url === POPUP_PAGE_URL` (= `chrome.runtime.getURL('src/popup/popup.html')`) を要求。弾かれると `sendResponse` されず popup 側は `undefined` を受け取り fallback 「撮影に失敗しました」になる。リスナー側で sender を吐くと一発で見える。
- **撮影履歴ストレージ**: `chrome.storage.local` の `captureHistory` に直近 50 件、成功・失敗とも永続化される。SW Console から `chrome.storage.local.get('captureHistory', console.log)` で全件読める。失敗エントリの `error` フィールドが UI 表示前の真の文言。
- **MESSAGE_TYPES 文字列を参照置換するときの定石**: 各コンテキスト (popup / background / content / offscreen) は冒頭で `globalThis.EvidenceShotConstants` から `MESSAGE_TYPES` を分割代入している。リテラル `'WTS_FOO'` を `MESSAGE_TYPES.FOO` に置換するときは **使用箇所だけでなく該当ファイルの分割代入の `{ ... }` にも `MESSAGE_TYPES` を入れる**こと。動的言語のため分割代入漏れは実行時まで気づけない (これが v1.0.4 のバグ)。
- **offscreen document の API 制約**:
  - `document.hasFocus()` が常に **false** → `navigator.clipboard.write` は永久に失敗する。書込みは popup または content script に委譲する (上の「クリップボード書込パス」参照)。
  - `chrome.runtime.getManifest()` は **`TypeError: chrome.runtime.getManifest is not a function`** で失敗する。拡張機能バージョンが必要なら SW 側で取得して `meta.extensionVersion` 経由で渡す (渡し忘れると PNG `iTXt` メタデータが空フィールドで埋まる v1.0.4〜v1.0.8 のバグになる)。
- **`ensureContentScriptOnTab` の inject 拒否**: Chrome Web Store (`chromewebstore.google.com`) / `chrome://` / `view-source:` 等は `chrome.scripting.executeScript` が拒否し `cannot be scripted` 等の英語例外を投げる。`isCapturableUrl` は protocol しか見ないので `https` の Chrome Web Store は事前に弾けない。`ensureContentScriptOnTab` 内で例外メッセージを文字列パターンマッチして `errPageNotCapturable` (日本語) に正規化することで「撮影に失敗しました」(原因不明) を回避している。
- **ショートカットが Chrome 挙動で消える**: Chromium は unpacked 拡張機能のリロード時に `commands.suggested_key` を一時的にリセットすることがある (既知の Chromium 挙動)。一度外れると manifest 修正で自動復活しないため、popup の「ショートカットを設定する」ボタンから `chrome://extensions/shortcuts` へワンクリックでジャンプして再設定できる救済 UI を `popup.js` の `onOpenShortcutSettings` に置いている。

## 補足

- スクロール連結撮影は、**撮影開始時点のスクロール範囲の末尾**までを対象にする (動的ロードでページが伸びても画像には含まれない)
- 動的ロード (無限スクロール / 遅延レンダリング SPA) は `moveToCaptureStep` で page height の事後拡大を検知し `console.warn` のみ (撮影は完走、欠落は警告で通知)
- 長いページでは offscreen 側 Canvas へスライス毎に `drawImage` する **逐次転送** で SW 側のメモリピークを抑える
- Canvas トリミング時の GPU メモリ 2 倍ピーク回避のため `createImageBitmap` 経由で元 Canvas を解放してから新 Canvas に転送する
- DPR (デバイスピクセル比) 変動 (マルチモニタ間移動など) を撮影中に検知してエラーで中止する
- Shadow DOM (open mode) の `position: fixed` 要素も退避対象 (closed mode は仕様上アクセス不能)
- `position: sticky` は退避しない (Notion / GitHub の sticky テーブルヘッダ等が全スライスで消える事故を回避するため据え置く)
- multi-slice 撮影中は、対象タブがそのウィンドウの active tab であることを維持する前提
