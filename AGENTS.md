# AGENTS.md

このファイルは EvidenceShot で作業する coding agent 向けの規約です。システム構造、責務境界、データフロー、設計判断は [DESIGN.md](DESIGN.md) を正本とし、本書は変更時の制約と検証手順を扱います。

## 変更時の制約

機能と使い方は [README.md](README.md)、実装ファイルの責務とブラウザ差は [DESIGN.md](DESIGN.md#実行コンテキストと責務) を参照する。

- メッセージは `src/shared/constants.js` の `MESSAGE_TYPES` に一元定義し、使用するコンテキストの分割代入にも追加する。
- offscreen ↔ background のプロトコル変更時は `OFFSCREEN_INTERFACE_VERSION` をインクリメントする。送信元検証と世代管理は [DESIGN.md](DESIGN.md#プロトコルと状態管理) の境界を維持する。
- `src/content/capture.js` の挙動変更時は `CONTROLLER_VERSION` をインクリメントし、注入済みの旧 controller を dispose して置き換える。
- 撮影処理の変更時は [撮影範囲とページ状態の不変条件](DESIGN.md#撮影範囲とページ状態の不変条件) と [撮影データフロー](DESIGN.md#撮影データフロー) を維持する。排他、対象タブ・ページ・DPR の照合、逐次転送、終了時復元と期限切れ回収を確認する。
- 起動経路はポップアップと `chrome.commands` に限定する。フローティングボタンや常時 `<all_urls>` 権限は追加せず、`activeTab` で都度注入する。
- 権限変更時は `manifest.json` と `scripts/build-firefox.js` を照合する。問い合わせ専用 host permission と Firefox の収集区分は [DESIGN.md](DESIGN.md#実行コンテキストと責務) の外部契約に合わせる。登録済みの `GECKO_ID` は維持する。
- 問い合わせ UI の `src/shared/kagayoi-support-{popup,footer}.{js,css}` と `src/shared/kagayoi-support-form.css` は、exact 固定した `@kagayoi/support-extension` の同梱コピーとして扱う。直接編集せず、正本側を更新して同期する。依存更新時は5ファイルを同期し、下記の一致検証を実行する。
- UI の文言は `_locales/{en,ja}/messages.json` へ反映する。タイムスタンプと左下固定テキストのデザイン・文字サイズは共通設定に連動させ、プレビューと保存画像の整合を確認する。

## 開発コマンド

CI と同じ Node.js 24 / pnpm 11 を使用する。Chrome はルートの `manifest.json`、Firefox は生成した `firefox-build/manifest.json` を使用する。

```bash
pnpm install
pnpm run sync:support            # 共通問い合わせ UI の5ファイルを正本から同期
pnpm exec kagayoi-support-sync --check # 同梱コピーと正本の一致だけを検証
node --test tests/capture-regressions.test.js # 撮影処理の回帰テスト
pnpm run generate-icons          # icons/ を生成
pnpm run generate-screenshots    # webstore/ プロモ画像 (puppeteer 使用)
pnpm run build                   # 問い合わせ UI 同期後、上記 2 つを連続実行
pnpm run build:firefox           # Firefox AMO 用に firefox-build/ ディレクトリを生成
pnpm exec web-ext lint --source-dir firefox-build # Firefox 成果物を検証
```

開発ループ:

1. `chrome://extensions` を開く
2. 「デベロッパーモード」ON → 「パッケージ化されていない拡張機能を読み込む」でリポジトリルートを選択
3. ソース変更後は同画面の更新ボタンで再読込
4. 手動確認用フィクスチャは `docs/manual-fixture.html`

`build:firefox` は既存の `firefox-build/` を削除して再生成する。問い合わせ UI の同期やアイコン生成は行わないため、必要な更新は生成前に済ませる。公開 CI も同梱 UI をそのまま梱包するため、同期済みファイルをコミット対象に含める。

撮影処理を変更したら Node.js 組み込みテストを実行する。Firefox 成果物を変更したら `build:firefox` 後に `web-ext lint` を実行する。ブラウザ実機の挙動確認は手動で行う。

## 証跡画像の制約と検証

撮影・合成の変更時は [証跡とピクセルの不変条件](DESIGN.md#証跡とピクセルの不変条件) を遵守する。独自カーソル、ハイライト枠・丸囲み・矢印等の注釈、任意 SVG / PNG オーバーレイ、ブラー・モザイクの追加は禁止する。代わりに撮影された実ピクセルを保存し、追加描画は利用者が選択するタイムスタンプと左下固定テキストに限る。この境界に反する機能が提案された場合は本節を根拠に断る。

PNG の検証は [README.md](README.md#撮影画像の改ざん検知) のコマンドで行い、`IdatHashSha256` と再計算値の一致を確認する。`Timestamp` はメタデータ生成時の時刻であり、スタンプの有効・無効を記録するフィールドではない。

## リリースフロー

`/vava` スキルでバージョンアップ〜リリースまで一括処理する。手動でやる場合の必須手順:

1. **バージョン同期 (3 ファイル)**: `manifest.json` / `package.json` / `README.md` を必ず揃える。これを揃え忘れると CI の検証ステップで `package.json` と `manifest.json` の不一致で弾かれる。依存の lockfile は pnpm 化済み (`pnpm-lock.yaml`)。CI は `pnpm install --frozen-lockfile --ignore-scripts` でインストールするため、`package.json` を変更したら `pnpm install` で `pnpm-lock.yaml` を更新してコミットする (lockfile 不整合だと frozen install が落ちる)
2. **`release/x.y.z` ブランチ名 = manifest バージョン**: CI (`.github/workflows/publish.yml`) の検証ステップで一致を確認する
3. main にコミット → push → `release/x.y.z` ブランチを作成して push
4. **`release/**` への push が CI トリガー**: ZIP ビルド → Chrome Web Store API 経由の公開要求と Firefox AMO listed submission。AMO は `--approval-timeout 0` で承認待ちを省くため、CI 成功とストア承認・公開を区別して確認する
5. **新権限を追加した版は CWS Developer Dashboard の「Privacy practices」タブを再記入する**: 記入し忘れると `400 Publish condition not met` で公開拒否される

CI で必要な GitHub Secrets:

- Chrome Web Store: `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` / `CWS_EXTENSION_ID` / `CWS_PUBLISHER_ID`
- Firefox AMO: `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` (AMO の `addons.mozilla.org/developers/addon/api/key/` から発行した JWT credentials)

## リリース時の手動 smoke test

`/vava` も CI 自動公開もコードを実機で動かす検証は含まれない。以下 2 経路はユーザーが Chrome 上で手動確認する。coding agent は、この確認のためにブラウザ連携、ブラウザ自動操作、Computer Use を起動・使用しない。確認結果が依頼内に示されていない場合もリリース作業を停止せず、最終報告で「手動 smoke test 未確認」と明記し、成功扱いにはしない。

1. **ポップアップ経由**: アクションアイコン → ポップアップ → 「このタブを撮影する」→ ダウンロード保存を目視
2. **ショートカット経由**: `Ctrl+Shift+Y` (mac: `Cmd+Shift+Y`) → ダウンロード保存を目視

両方確認する理由: `popup.js` の `onCaptureNow` は例外を利用者向けの fallback 文言へ正規化する。ショートカット経路の成功だけでは popup 固有の処理を検証できない。

## デバッグの足場

- **`Shared.normalizeUserMessage` の英語フィルタ**: 日本語 UI で英語のみのエラー (`Could not establish connection.` 等 Chrome ネイティブメッセージ) を fallback 文言「撮影に失敗しました。」に置換する。原文の真因を残すため、`runCaptureWorkflow` の catch では必ず `console.error` で原文も Service Worker コンソールへ出す (これを消すと SW コンソールに証拠が残らない)。
- **`isTrustedPopupSender` の URL 完全一致ゲート**: popup → background のメッセージは `sender.url === POPUP_PAGE_URL` (= `chrome.runtime.getURL('src/popup/popup.html')`) を要求。弾かれると `sendResponse` されず popup 側は `undefined` を受け取り fallback 「撮影に失敗しました」になる。リスナー側で sender を吐くと一発で見える。
- **撮影履歴ストレージ**: `chrome.storage.local` の `captureHistory` に直近 50 件、成功・失敗とも永続化される。SW Console から `chrome.storage.local.get('captureHistory', console.log)` で全件読める。失敗エントリの `error` は正規化後の文言なので、例外原文は Service Worker コンソールで確認する。
- **offscreen document の API 制約**:
  - `document.hasFocus()` が常に **false** → `navigator.clipboard.write` は永久に失敗する。書込みは popup または content script に委譲する ([DESIGN.md のクリップボード経路](DESIGN.md#クリップボード経路)参照)。
  - `chrome.runtime.getManifest()` は **`TypeError: chrome.runtime.getManifest is not a function`** で失敗する。拡張機能バージョンが必要なら SW 側で取得して `meta.extensionVersion` 経由で渡す。
- **`ensureContentScriptOnTab` の inject 拒否**: Chrome Web Store (`chromewebstore.google.com`) / `chrome://` / `view-source:` 等は `chrome.scripting.executeScript` が拒否し `cannot be scripted` 等の英語例外を投げる。`isCapturableUrl` は protocol しか見ないので `https` の Chrome Web Store は事前に弾けない。`ensureContentScriptOnTab` 内で例外メッセージを文字列パターンマッチして `errPageNotCapturable` (日本語) に正規化することで「撮影に失敗しました」(原因不明) を回避している。
- **ショートカット未割り当て**: `popup.js` の `onOpenShortcutSettings` とブラウザから取得した割り当てを確認する。利用者の再設定手順は [README.md](README.md#困ったとき) を参照する。
