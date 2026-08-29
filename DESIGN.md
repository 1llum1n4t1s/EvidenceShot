# EvidenceShot 設計

この文書は現在の実装に基づくシステム設計の正本です。利用方法は [README.md](README.md)、変更時の規約と検証手順は [AGENTS.md](AGENTS.md) を参照してください。

## 目的と範囲

EvidenceShot は、利用者が明示的に開始したときだけ現在のタブを撮影し、証跡画像としてブラウザの既定ダウンロード先へ保存する Chrome / Firefox 向け Manifest V3 拡張機能です。表示領域、撮影開始時点のページ末尾までのスクロール連結、中央本文優先の3種類の撮影範囲を扱います。

出力形式は PNG / JPEG / WEBP です。PNG には撮影情報と IDAT の SHA-256 を iTXt として埋め込み、再エンコードを伴う改変を検出できるようにします。これは電子署名やタイムスタンプ局による完全な改ざん耐性ではありません。

## 実行コンテキストと責務

| コンテキスト | 主な実装 | 責務と境界 |
| --- | --- | --- |
| ポップアップ | `src/popup/` | 設定の表示・保存、撮影開始、プレビュー、ポップアップ起動時のクリップボード書き込みを担当する。撮影そのものは background へ依頼する。 |
| Background | `src/background/background.js` | Chrome の Service Worker / Firefox の event page で共通の撮影オーケストレーションを行う。対象タブ確認、排他制御、content script 注入、各スライスの撮影、Composer 呼び出し、ダウンロード、履歴を担当する。 |
| Content script | `src/content/capture.js` | 対象ページの寸法計測、撮影計画、スクロール、固定要素の一時退避、終了時のページ復元を担当する。ショートカット起動時のクリップボード書き込みもここで行う。 |
| Composer | `src/shared/composer.js` | Canvas セッション、スライスの逐次合成、切り抜き、タイムスタンプと左下固定テキスト、画像形式変換、PNG iTXt、Blob URL の生成・解放をブラウザ共通で担当する。 |
| Chrome offscreen | `src/offscreen/offscreen.html`, `src/offscreen/offscreen.js` | DOM を持たない Service Worker に代わって Composer を実行する。`offscreen.js` は background メッセージと共通 Composer API の薄いアダプタに留める。 |
| Firefox event page | `src/background/background.html` | `composer.js` と `background.js` を同じ DOM 文脈へ読み込み、offscreen API なしで共通 Composer を直接実行する。 |
| 共通基盤 | `src/shared/constants.js`, `src/shared/utils.js`, `src/shared/perf.js`, `src/offscreen/stamp-renderer.js` | メッセージ契約、既定設定、設定正規化、i18n、計測、スタンプ描画を各コンテキストへ提供する。 |
| 問い合わせ UI | `src/shared/kagayoi-support-popup.js`, `src/shared/kagayoi-support-footer.js` | ポップアップ内の問い合わせ導線、メール確認コードによる認証、チケット送信を担当する。撮影・画像保存のデータフローからは独立する。 |

Chrome の `manifest.json` は `background.service_worker` と `offscreen` permission を使います。`scripts/build-firefox.js` はこれを正本として Firefox 用成果物を生成し、background を非永続 event page へ切り替え、`offscreen` permission と `minimum_chrome_version` を除去して Gecko 固有設定を加えます。

問い合わせ UI だけが `https://support.kagayoi.com/*` の host permission を使い、利用者が入力したメールアドレス、確認コード、問い合わせ内容を API へ送ります。撮影画像、撮影履歴、証跡メタデータはこの問い合わせ経路へ渡しません。Firefox 用 manifest は、この問い合わせ機能に対応する個人識別情報、認証情報、個人間通信の収集区分を Gecko 設定へ明示します。

## 撮影データフロー

1. ポップアップまたは `chrome.commands` が background に撮影を要求する。
2. Background はタブ単位と拡張機能全体の Web Locks を取得し、対象タブへ対応版の capture controller を注入する。
3. Content script は開始時点のページ寸法、viewport、DPR、撮影範囲を測定し、スクロール位置と一時変更する表示状態を保持して撮影計画を返す。
4. Background は Composer セッションを開始し、各計画位置へ content script を移動させた後、`chrome.tabs.captureVisibleTab` で実際に表示されたピクセルを取得する。
5. 各スライスは background に蓄積せず Composer へ順次渡し、計画上の crop と配置で Canvas に合成する。
6. Composer は使用領域へ切り抜き、許可されたスタンプを描画し、指定形式の Blob とファイル名を生成する。PNG の場合だけ証跡メタデータを追加する。
7. Background は `chrome.downloads.download` へ Blob URL を渡して保存し、成功・失敗を `chrome.storage.local` の直近50件の履歴へ記録する。
8. `finally` 相当の復元経路で content script がスクロール位置と一時退避した固定要素を戻し、Composer セッションと不要な Blob URL を解放する。

複数スライスでは、Composer の `addSlice` と次の `captureVisibleTab` を重ねられる構成にしつつ、各スライスの完了と順序はセッション内で保証します。対象タブが非アクティブになった場合や DPR が変化した場合は、誤った座標で連結せず撮影を中止します。

## クリップボード経路

Offscreen document は focus を持たないため、画像生成とクリップボード書き込みを分離します。

- ポップアップ起動では、Composer が返した PNG Blob URL を user activation を持つ popup が書き込む。
- ショートカット起動では、background が Blob URL を active tab の content script へ渡す。secure context では Clipboard API を使い、利用できないページでは HTML image のコピーへフォールバックする。
- 書き込み後は要求元から即時 revoke を依頼し、Composer 側の60秒タイマーも保険として残す。

クリップボード用画像は常に PNG です。ダウンロード形式が JPEG / WEBP でも、コピー経路は別の PNG Blob を使用します。

## 証跡とピクセルの不変条件

- 保存対象は `captureVisibleTab` が取得した実ピクセルとし、ブラウザが描画していないカーソル、注釈、矢印、任意画像を後から合成しない。
- ブラーやモザイクで元ピクセルを不可逆変換しない。
- 利用者が追加を選択したタイムスタンプと左下固定テキストだけを明示的な例外とする。
- PNG iTXt には拡張機能 version、UTC 撮影時刻、timezone offset、クエリとハッシュを除いた URL、ページ title、IDAT 結合バイト列の SHA-256 を記録する。
- `docs/verify-evidence.js` は埋め込み値と現在の IDAT を比較する。メタデータ自体を書き換えられる攻撃者への真正性保証は行わない。

## 撮影範囲とページ状態の不変条件

- ページ全体撮影の末尾は開始時点の scroll range で固定する。撮影中の動的拡張は警告するが、計画を伸ばさない。
- `position: fixed` は重複写り込みを避けるため一時退避し、open Shadow DOM 内も探索する。closed Shadow DOM はアクセス不能なため対象外とする。
- `position: sticky` は表や記事の見出しまで消す副作用を避けるため退避しない。
- Content controller の挙動変更時は `CONTROLLER_VERSION` を更新し、既に注入された旧 controller を dispose してから置き換える。
- 複数スライス中は対象タブが同じ window の active tab であり、DPR が計画時と一致することを要求する。

## プロトコルと状態管理

- コンテキスト間のメッセージ種別は `src/shared/constants.js` の `MESSAGE_TYPES` を唯一の文字列正本とする。
- Chrome の background と offscreen の契約は `OFFSCREEN_INTERFACE_VERSION` で世代を照合する。Background 起動ごとの CSPRNG token を offscreen URL とメッセージへ渡し、`sender.id` と `sender.tab` の検証を主な送信元境界とする。
- Composer の begin / addSlice / finalize / abort は session ID と session secret で対応付け、期限切れセッションを破棄する。
- 撮影排他は `navigator.locks` のタブ別ロックとグローバルロックで表現する。Service Worker 終了時にロックも解放されるため、永続的なロック状態を正本にしない。
- 利用者設定は共通の正規化処理を通して保存し、撮影履歴は成功・失敗とも `chrome.storage.local` に最大50件保持する。

## 採用済み設計判断

### 最小権限と都度注入

常時 `<all_urls>` を要求せず、`activeTab` と `scripting` で利用者が開始したタブへ capture controller を都度注入します。閲覧権限を狭くできる一方、ブラウザ内部ページや Chrome Web Store などスクリプト注入禁止ページは撮影できず、background で利用者向けエラーへ正規化します。

### ブラウザ共通 Composer

Canvas 合成と PNG メタデータ処理を `src/shared/composer.js` に集約し、Chrome は offscreen adapter、Firefox は event page から呼びます。ブラウザ差を実行場所の選択へ閉じ込めることで出力ロジックを共有する代わりに、HTML の script 読み込み順と interface version の同期が必要です。

### スライスの逐次転送

画像断片を Service Worker に全保持せず Composer へ逐次渡し、Background のメモリピークを抑えます。最終 Canvas 自体は出力寸法に比例するため、edge と面積の上限、タイル分割、切り抜き時の `createImageBitmap` を使って資源使用量を制御します。

### Web Locks による排他

撮影中だけ生存する Web Locks を使い、Service Worker の停止とともに解放される設計を選んでいます。永続ストレージによる幽霊ロック回復は不要になりますが、Web Locks を提供する対象ブラウザを前提とします。

### 基本的な改変検知

PNG の IDAT ハッシュは一般的な画像編集・再保存を検出する軽量な仕組みです。外部サービスや鍵を必要としない一方、署名ではないため、検証値を含むメタデータごと作り直す攻撃には耐えません。
