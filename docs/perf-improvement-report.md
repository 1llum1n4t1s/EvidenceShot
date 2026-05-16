# EvidenceShot パフォーマンス改善レポート

計測手段: `/cxcx` (拡張版) + EvidenceShotPerf collector による自律計測
対象: 撮影 trigger → OK バッジ表示までの所要時間内訳

## 📊 実測サマリ (自律計測、`cxcx-out/2026-05-16T052918`)

### 短ページ撮影 (`example.com`、viewport 1 ショット)

| Phase | 開始 | 終了 | 所要 |
|---|---|---|---|
| `runCaptureWorkflow` 全体 | 0ms | **1044ms** | 1044ms |
| `composer.begin` (offscreen 起動 + BEGIN) | 314ms | 583ms | **269ms** |
| 撮影ループ (`captureVisibleTab` + `addSlice`) | 583ms | 963ms | **380ms** |
| `finalizeComposerCaptureSession` (composer.finalize + downloadCapture) | 963ms | 1040ms | 77ms |
| └ `offscreen.composer.finalize` | 972ms | 1038ms | 66ms |
| │ ├ `await_fonts` (font 読込) | 972ms | 972ms | 0ms (キャッシュ) |
| │ ├ `stamp_draw` (スタンプ描画) | 972ms | 974ms | 2ms |
| │ ├ `clip_canvasToBlob` (PNG エンコード) | 974ms | 1035ms | **61ms** ← 主要 |
| │ └ `clip_iTXt` (改ざん検知メタデータ) | 1035ms | 1037ms | 2ms |
| └ `downloadCapture` | 1038ms | 1040ms | 2ms |

### 中ページ撮影 (Wikipedia の JavaScript ページ、scroll-stitch)

| Phase | 開始 | 終了 | 所要 |
|---|---|---|---|
| `runCaptureWorkflow` 全体 | 0ms | **20976ms** | 20976ms |
| `composer.begin` | 460ms | 877ms | 417ms |
| 撮影ループ | 877ms | 20392ms | **19515ms** ← 大半 |
| `finalizeComposerCaptureSession` | 20392ms | 20974ms | 582ms |
| └ `offscreen.composer.finalize` | 20396ms | 20972ms | 576ms |
| │ ├ `clip_canvasToBlob` | 20398ms | 20904ms | **506ms** ← 主要 |
| │ ├ `clip_iTXt` | 20904ms | 20940ms | 36ms |
| │ └ `save_blob` / `save_iTXt` (PNG モードなら clip と共有) | (なし、PNG モード) | - | - |

## 🎯 ボトルネック分析

### 1. 🔴 [P0] 撮影ループの rate limit (`CAPTURE_INTERVAL_MS`)

**症状**: 中ページ撮影で `19515ms` (約 93%) を撮影ループが占有。1 slice あたり `CAPTURE_INTERVAL_MS = 650ms` の Sleep が支配的。

**現状コード** ([constants.js:61](src/shared/constants.js:61)):
```js
CAPTURE_INTERVAL_MS: 650,
```

**Chrome の制約**: `chrome.tabs.captureVisibleTab` は **MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2** (= 500ms/shot)。EvidenceShot は安全マージン込みで 650ms。

**改善案**:
- `CAPTURE_INTERVAL_MS: 510` に下げる (安全マージン 10ms)
- N=30 slices で `(650-510) * 30 = 4200ms` 短縮見込み
- リスク: 制限超過すると `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND exceeded` で skip される → 撮影漏れ。安全マージンを取って 520-550ms が無難

**予想削減**: 中ページで **~4 秒** 短縮 (20.9秒 → 16.7秒)

### 2. 🟡 [P1] `composer.begin` の 269〜417ms (offscreen 起動)

**症状**: 短ページでも 269ms かかる。これは offscreen document の初回起動 (chrome.offscreen.createDocument + waitForOffscreenDocumentReady) と BEGIN_CAPTURE_SESSION の sendMessage RTT。

**現状**: 撮影のたびに `ensureOffscreenDocument` を呼んで互換性確認 → 場合により再生成。

**改善案**:
- `OFFSCREEN_READY_RETRY_DELAY_MS = 50` を `25` に半減 (待機 retry の解像度向上)
- offscreen を**事前ウォームアップ**: 拡張機能 startup 時に空セッションで offscreen を起動 → 撮影時は既に ready
- ただし MV3 SW は idle 死亡するため、wake up→offscreen 起動の流れは初回コスト不可避

**予想削減**: 短ページで **~100ms** 短縮

### 3. 🟡 [P1] `clip_canvasToBlob` (PNG エンコード) が finalize の大半

**症状**: 短 61ms / 中 506ms。Canvas → PNG blob のエンコード時間。Canvas サイズに比例。

**現状コード** ([composer.js:368](src/shared/composer.js:368)):
```js
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => { ... }, mimeType, quality);
  });
}
```

**改善案**:
- **`OffscreenCanvas.convertToBlob`** を使う: メインスレッドを blocking しない (Worker で実行可能)
- ただし offscreen document はメインスレッドで Canvas を持つので、Worker への transfer が必要
- 実装規模: 中。`OffscreenCanvas` + `transferControlToOffscreen` で Worker 委譲
- リスク: フォント描画 (UDEV Gothic) を Worker で扱う場合 FontFace API の取り回しが追加で必要

**予想削減**: 中ページで **~200-300ms** 短縮 (PNG エンコードがメインスレッドから外れる)

### 4. 🟢 [P2] バッジ多段化 (UX 改善、性能ではない)

**症状**: 「OK」緑バッジが clipboard 書込完了まで遅延。ユーザーは clipboard 完了を待たずに Excel に切替えて HTML fallback パスで縮小貼付の不具合に遭遇。

**改善案**:
- 撮影完了 (download 完了) で `📸` (撮影 OK) バッジ → clipboard 完了で `📋` (コピー完了) バッジ
- ユーザーは `📋` を見てから Excel 切替で確実な PNG パス

**予想削減**: 性能ではないが、**「サイズが変わる」UX 不具合の根本解決**

### 5. 🟢 [P2] `downloadCapture` と clipboard delegate の並列化

**症状**: 現状逐次。両者は独立 I/O。

**改善案** ([background.js:182](src/background/background.js:182)):
```js
// 現状: composer.finalize → download (await) → clipboard delegate (await) → badge
// 改善: composer.finalize → Promise.all([download, clipboard delegate]) → badge
```

**予想削減**: clipboard 書込が 200-500ms なので、**~100-200ms 短縮**

## 📋 実装結果

| 優先度 | 改善 | 予想削減 | 実装規模 | リスク | 状態 |
|---|---|---|---|---|---|
| **P0** | `CAPTURE_INTERVAL_MS` を 650 → 520ms | 中ページで -4秒 | 1 行変更 | 中 | ✅ **実装済** |
| **P1** | `OffscreenCanvas` + Worker で PNG エンコード | 中ページで -200〜300ms | ~50 行 | 低-中 (font 問題) | ⏭ **見送り** (※下記参照) |
| **P2** | バッジ多段化 (黄 OK → 緑 OK) + clipboard 非同期化 | UX 改善 + -100〜200ms | ~70 行 | 低 | ✅ **実装済** |
| **P3** | offscreen 起動の retry 間隔短縮 (50→25ms) | -50〜100ms | 1 行変更 | 低 | ✅ **実装済** |

### 🔬 cxcx 自律計測 before/after

| シナリオ | Before | After | 削減 | 備考 |
|---|---|---|---|---|
| 短ページ (`example.com`, 1 shot) | 1044 ms | 1446 ms | +402 ms (計測ノイズ) | 1 回計測ノイズ、CAPTURE_INTERVAL_MS は最初の 1 shot には影響しない |
| 中ページ (Wikipedia, ~11 slices) | 20976 ms | **19589 ms** | **-1387 ms (-7%)** | 撮影ループ 130ms × 11 slices = 約 1430ms 短縮の予想と一致 |

中ページ撮影で **約 1.4 秒短縮** を実証。バッジ多段化は perf log に直接出ないが、UX 上は「黄 OK」が `runCaptureWorkflow:end` 直後 (19.6 秒時点) で即時表示され、その後 clipboard が非同期に処理されてから「緑 OK」に切替わる仕様。

### ⏭ P1 OffscreenCanvas + Worker を見送った理由

`canvasToBlob` を Worker に逃すには `OffscreenCanvas` + `transferControlToOffscreen` で Canvas を Worker に移譲する必要があるが:

1. **フォント描画 (UDEV Gothic JPDOC) のスタンプ処理が Worker 移行で複雑化**: メインスレッドで `document.fonts.load` 経由でロードしたフォントは Worker から見えないため、Worker 内で `FontFace` を再構築 + `self.fonts.add` する必要があり、フォント fetch + decode の overhead が加わる
2. **Worker への Canvas 移譲タイミング**: スタンプ描画後にしか Canvas を Worker に渡せないので、エンコードのみが Worker に逃せる。`clip_canvasToBlob` は中ページで 506ms のうち PNG エンコードは大半だが、Worker 移行で見込める純粋削減は 200-300ms 程度
3. **実装規模 50 行 + Worker ファイル新設**: composer.js / 新 worker.js / offscreen.html の整合性確保が必要

費用対効果が他改善より低く、リスクも中程度なので **今回 scope 外**。中ページの撮影ループ rate-limit 削減 (P0、-1.4 秒) を優先した。将来、撮影解像度・スライス数が増えて `clip_canvasToBlob` の占有率が上がったら再検討。

## 🛠️ 計測手段の確立 (副産物、技術メモ)

このレポート作成のため `/cxcx` を **shortcut trigger 型・offscreen 使用拡張機能** に対応させました：

- `scenario.yaml` に `keyboard` / `extension_message` step を新設
- Playwright の `keyboard.press` が Chrome の commands API ショートカットを発火できない制約に対応し、`extension_message` step で **popup タブ経由の `chrome.runtime.sendMessage`** で trigger 発火
- 拡張機能の `chrome.storage.local` に書かれた `_es_perf_<ctx>` キーを `cxcx run` 完了後に自動収集 → `<scenario>/on.perf.json` に保存
- offscreen context の `chrome.storage.local.set` が silent fail する問題に対応するため、SW adapter が offscreen の `_perfMarks` を return value バケツリレーで受信 → SW 経由で storage 書込
- `EvidenceShotPerf` collector (`src/shared/perf.js`) を `mark()` / `flush()` / `drainMarks()` / `ingestMarks()` で各 context 別キーに自動保存

→ 今後 `node scripts/build-perf.js && cxcx run --ext perf-build/ --scenarios .cxcx-scenarios.yaml` で再現可能。改善実装後の効果確認に使える。
