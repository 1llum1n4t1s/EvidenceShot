# /rere レビュー設計提案メモ (2026-04-28)

このドキュメントは [/rere](#) (6 人分隊レビュー) で「**要設計判断**」と分類された
未着手 6 件について、後日のリファクタ議論用に残す**提案メモ**である。
本サイクル (Batch 1〜4) では実装せず、設計判断ミーティング議題として参照されること。

実装済みの修正は git log で `Batch 1`〜`Batch 4` のコミットを参照。

---

## 提案 1: Shadow DOM / CSS-in-JS の `position: fixed` 退避破綻 (D-03)

### 現状
`src/content/capture.js` の `collectFixedElements` は
`document.createTreeWalker(document.body, ...)` で DOM をスキャンする。
TreeWalker はデフォルトで Shadow Root に入らないため、**Shadow DOM 内の固定ヘッダ**
(Salesforce LWC, Stencil, Web Components 全般) が検出されない。
結果として連結画像にナビバーが繰り返し焼き込まれる。

### 提案する対応
1. **最小パッチ**: open mode の Shadow Root を再帰探索する追加ループを `collectFixedElements` に入れる。
   - `element.shadowRoot` が存在すれば、そこから再度 TreeWalker を生成して fixed 要素を収集。
   - closed mode (mode: 'closed') の Shadow Root はアクセス不能なため、ここはドキュメント明記でユーザーに伝える。
2. **UX フォールバック**: 撮影完了時、固定要素検出件数を popup の status に表示
   (例: 「固定要素 3 件を退避して撮影しました」)。Shadow DOM のうち closed mode が見つかったらその旨警告。

### 議題
- closed Shadow Root の存在を **どこまで保証するか**: 「Web Components ヘビーユーザのページでは保証しない」と割り切るか。
- 固定要素検出のパフォーマンス影響: 既に MAX_FIXED_SCAN_NODES=2200 を消費している。再帰展開で増える可能性。

---

## 提案 2: 無限スクロール / virtualized list の計画破綻 (D-06)

### 現状
`src/content/capture.js` の `buildCapturePlan` は `getDocumentHeight()` を**撮影開始時点**で
固定値として読み、`positions` 配列を一度だけ生成する。Twitter/X、Notion、react-virtual 等
動的 DOM ページでは、スクロール途中でロードされた追加コンテンツが計画範囲外となり、
**「成功」として欠落画像が返る** (証跡用途で最悪)。

### 提案する対応
1. **検知のみ (低リスク)**: `moveToCaptureStep` 内で現在の `document.scrollHeight` を都度確認。
   初期計画より 10% 以上増加していたら status 経由で警告 (画像合成は継続)。
2. **動的拡張 (中リスク)**: positions 配列を末尾で動的に伸長。上限は計画初期の 3 倍程度に設定。
3. **MutationObserver で事前警告 (高リスク・抜本)**: 撮影開始前にページの動的コンテンツ追加を検知し、
   ユーザーに「このページは動的ロードを使う可能性があります。最後までスクロールしてから撮影してください」と
   prompt する。

### 議題
- どこまでが「証跡」として許容できる動的取得か。最も保守的な対応は **動的 DOM 検知時に撮影自体を拒否** する設計。
- virtualized list (DOM 入れ替え) は別問題。これは検知方法すらない。要件レベルで対応外と明記する案も。

---

## 提案 3: Web Locks API への移行 (D-01)

### 現状
撮影中ロックを `chrome.storage.session` に置き、`startedAt` + 10 分 TTL で残留検知している。
SW 揮発時には in-memory Set もリセットされるため、
`tryAcquireCaptureSlot` で「TTL 内 && in-memory なし」を幽霊判定して掃除する設計。
ただし TTL 内エッジケースで誤検知の余地が残る (B1-E-2, B1-E-5 と関連)。

### 提案する対応
1. **`navigator.locks` API 移行**: SW スコープで `locks.request('capture-slot', { mode: 'exclusive', ... })` を取得。
   SW が死亡すれば Lock は自動解放される (storage.session の幽霊ロック問題が原理的に発生しない)。
2. **storage.session のロックを削除**: ただし「タブ別重複撮影禁止」「ウィンドウ別重複撮影禁止」の粒度は
   Lock キーの命名で表現する必要がある (`capture-tab-${tabId}`, `capture-window-${windowId}`)。
3. **migration 戦略**: 既存 storage.session のロックは初回起動時に一括クリア。

### 議題
- `navigator.locks` は Chrome 69+ でサポート、現在の `minimum_chrome_version: 117` で利用可能。
- SW スコープでの Locks の挙動 (SW 死亡時の解放タイミング) を実機で検証する必要あり。

---

## 提案 4: Canvas トリミング根本対応 (#2 根本案)

### 現状
本サイクル Batch 2 で **`createImageBitmap` 経由の最小パッチ** は適用済み。GPU メモリの 2 倍ピーク
は緩和されたが、**そもそもトリミングが発生する条件** は `buildTilePartition` の境界計算誤差。

### 提案する対応
1. **`buildTilePartition` の境界計算を精査**: `usedCanvasHeight === canvas.height` を保証する。
2. もし達成すれば `if (usedCanvasHeight !== canvas.height)` 分岐は dead path となり、トリミング自体が不要に。

### 議題
- 計算精度を完全に揃えるのは小数点誤差の関係で難しい場合がある。許容差 (1px 程度) を設けるかどうか。
- 「常にトリミングを発生させる前提」のまま、最小パッチで運用継続でも実害は小さい (Batch 2 で対応済み)。

---

## 提案 5: グローバル名前空間 `WebTestShot*` → `EvidenceShot*` リネーム (B2-I1)

### 現状
- `globalThis.WebTestShotConstants`
- `globalThis.WebTestShotShared`
- `globalThis.WebTestShotStampRenderer`
- `initializeWebTestShot*` 関数群

製品名 `EvidenceShot` と乖離している。`CONTROLLER_KEY = '__evidenceShotCaptureControllerV2'`
のように一部は既に `EvidenceShot` 命名になっており、同一プロジェクト内で命名が二分。

### 提案する対応
1. 全 `WebTestShot` → `EvidenceShot` に Grep ベースで置換。
2. **CONTROLLER_VERSION をインクリメント** (3 → 4)。これをやらないと旧バージョンの content script が
   inject されているタブで衝突する。
3. `chrome.storage.local` の `SETTINGS_KEY: 'evidence-shot-settings'` は既に正しいので変更不要。

### 議題
- リネームのタイミング: マイナーバージョンアップ (1.1.0) と合わせるのが分かりやすい。
- インストール済みユーザの影響: グローバル名前空間は同一拡張機能内のみで使うため、外部互換性は不要。

---

## 提案 6: 改ざん検知の追加 (D-07, #42)

### 現状
出力画像 (PNG/JPEG/WEBP) には URL・タイムスタンプ・ユーザー入力テキストが焼き込まれるが、
**画像ファイル自体の改ざん検知手段は無い**。「証跡」として法的・監査用途で使う場合、
撮影者自身でも後から Photoshop で改変可能で、原本性を主張できない。

### 提案する対応
1. **PNG tEXt チャンクへのメタデータ埋め込み**:
   - `URL`, `Timestamp`, `Title`, `EvidenceShotVersion`, `SHA256(image data)` を tEXt として PNG 末尾に追加。
   - JPEG なら EXIF / XMP、WEBP なら EXIF チャンク。
2. **検証スクリプト同梱**: 単体ファイルとして配布できる Node.js / Python スクリプトで、
   「ハッシュが一致するか」を検証できるようにする (`docs/verify.js`)。
3. **タイムスタンプサーバー連携 (オプション)**: RFC 3161 形式のタイムスタンプを取得して埋め込む案。
   これは外部送信を伴うため、プライバシーポリシーと整合させる必要あり。

### 議題
- 1〜2 はオフラインで完結するため、現状のプライバシーポリシー (外部送信なし) と整合する。
- 3 は **製品方針として外部送信を一部許容するか** という決断が必要。「証跡として使う場合のみオプトインで TSA 連携」という設計が現実的。
- 競合製品 (GoFullPage 等) との差別化要素として強い。

---

## 全体所見

実装難度が高いほど、得られる差別化も大きい順に並べると:

| 順位 | 提案 | 効果 |
|---|---|---|
| 🥇 | 提案 6 (改ざん検知) | "証跡" ブランドの根本価値毀損を解消、競合と決定的に差別化 |
| 🥈 | 提案 2 (無限スクロール) | 動的 SPA で「画像欠落」を防ぐ。証跡として致命的なバグを潰せる |
| 🥉 | 提案 1 (Shadow DOM) | 現代的 Web フレームワーク (LWC/Stencil) に対応 |
|  4 | 提案 3 (Web Locks) | コードベースの保守性向上、エッジバグ削減 |
|  5 | 提案 5 (リネーム) | コード可読性、命名統一 |
|  6 | 提案 4 (Canvas 根本) | 既に最小パッチ適用済みのため後回しで OK |

次バージョン以降のロードマップとして、まず提案 6 (改ざん検知) から着手するのが
製品価値の観点で最大効果。
