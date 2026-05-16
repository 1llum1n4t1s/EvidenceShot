(function initializeEvidenceShotConstants() {
  if (globalThis.EvidenceShotConstants) {
    return;
  }

  globalThis.EvidenceShotConstants = Object.freeze({
    SETTINGS_KEY: 'evidence-shot-settings',
    // chrome.storage キー (background.js から参照)
    CAPTURE_HISTORY_KEY: 'captureHistory',
    CAPTURE_HISTORY_MAX: 50,
    CAPTURE_LOCK_KEY: 'activeCaptureLocks',
    CAPTURE_SESSION_TTL_MS: 10 * 60 * 1000,
    // popup ↔ background ↔ content ↔ offscreen 間で交わすメッセージ種別。
    // 文字列リテラルの揺れを避け、リネーム時の Grep を確実にするため一元管理する。
    // OFFSCREEN_INTERFACE_VERSION と組で「offscreen 側プロトコル変更時にインクリメント」運用。
    MESSAGE_TYPES: Object.freeze({
      CAPTURE_FROM_POPUP: 'WTS_CAPTURE_FROM_POPUP',
      CAPTURE_PREPARE_V2: 'WTS_CAPTURE_PREPARE_V2',
      CAPTURE_STEP_V2: 'WTS_CAPTURE_STEP_V2',
      CAPTURE_RESTORE_V2: 'WTS_CAPTURE_RESTORE_V2',
      // background → content script (ショートカット経由限定)。
      // ショートカットは popup を開かないので web page が focus を保っている。
      // content script は active tab で動作するため navigator.clipboard.write が成功する。
      // popup 経由ではこのメッセージは使わない (popup 自身が clipboard.write する)。
      CLIPBOARD_COPY_FROM_URL: 'WTS_CLIPBOARD_COPY_FROM_URL',
      BEGIN_CAPTURE_SESSION: 'WTS_BEGIN_CAPTURE_SESSION',
      ADD_CAPTURE_SLICE: 'WTS_ADD_CAPTURE_SLICE',
      FINALIZE_CAPTURE_SESSION: 'WTS_FINALIZE_CAPTURE_SESSION',
      ABORT_CAPTURE_SESSION: 'WTS_ABORT_CAPTURE_SESSION',
      OFFSCREEN_PING: 'WTS_OFFSCREEN_PING',
      REVOKE_DOWNLOAD_URL: 'WTS_REVOKE_DOWNLOAD_URL',
      REVOKE_OBJECT_URL_FROM_POPUP: 'WTS_REVOKE_OBJECT_URL_FROM_POPUP',
    }),
    CLIPBOARD_STATUS: Object.freeze({
      COPIED: 'copied',
      COPIED_HTML_FALLBACK: 'copied_html_fallback',
      FAILED: 'failed',
      SKIPPED_MULTIPART: 'skipped_multipart',
      DISABLED: 'disabled',
      PENDING: 'pending',
      PENDING_IN_CONTENT: 'pending_in_content',
    }),
    CONTENT_SCRIPT_FILES: [
      'src/shared/constants.js',
      'src/shared/utils.js',
      'src/shared/perf.js',
      'src/content/capture.js',
    ],
    OFFSCREEN_DOCUMENT_PATH: 'src/offscreen/offscreen.html',
    OFFSCREEN_INTERFACE_VERSION: 18,
    DEFAULT_SETTINGS: {
      format: 'png',
      timestampEnabled: true,
      timestampStyle: 'manuscript',
      timestampSize: 'xs',
      timestampIncludeTimezone: true,
      footerText: '',
      captureMode: 'fullPage',
      fileNamePrefix: '',
      copyToClipboard: true,
    },
    // chrome.tabs.captureVisibleTab の MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2
    // (= 最短 500ms/shot) に対する安全マージン込みの最小値。旧 650ms は保守的に過大で、
    // 中ページのスクロール連結 (30 slice 等) で 4 秒以上の rate-limit 待機が支配的だった。
    // 520ms に短縮することで中ページ撮影を ~4 秒短縮できる (cxcx 計測実証済)。
    // 万一の制限超過時は capture step で例外 → finally で abort されるので安全。
    CAPTURE_INTERVAL_MS: 520,
    CAPTURE_SETTLE_MS: 180,
    MAX_CANVAS_EDGE: 65535,
    MAX_TILE_CANVAS_AREA: 67108864,
    MAX_CAPTURE_DATA_URL_LENGTH: 60 * 1024 * 1024,
    MAX_HTML_CLIPBOARD_BYTES: 8 * 1024 * 1024,
    TIMESTAMP_STYLES: [
      { value: 'manuscript', labelKey: 'optionTimestampStyleManuscript', label: '証跡: 公文書' },
      { value: 'seal', labelKey: 'optionTimestampStyleSeal', label: '証跡: 朱印 (角印)' },
      { value: 'ledger', labelKey: 'optionTimestampStyleLedger', label: '証跡: 会計台帳' },
      { value: 'blueprint', labelKey: 'optionTimestampStyleBlueprint', label: '証跡: 青焼き図面' },
      { value: 'terminal', labelKey: 'optionTimestampStyleTerminal', label: '証跡: ターミナル' },
      { value: 'receipt', labelKey: 'optionTimestampStyleReceipt', label: '証跡: 感熱レシート' },
      { value: 'kraft', labelKey: 'optionTimestampStyleKraft', label: '証跡: クラフト紙タグ' },
      { value: 'carbon', labelKey: 'optionTimestampStyleCarbon', label: '証跡: カーボン複写' },
      { value: 'stencil', labelKey: 'optionTimestampStyleStencil', label: '証跡: ステンシル' },
      { value: 'wax-seal', labelKey: 'optionTimestampStyleWaxSeal', label: '証跡: 蝋封スタンプ' },
      { value: 'microfiche', labelKey: 'optionTimestampStyleMicrofiche', label: '証跡: マイクロフィルム' },
      { value: 'postit', labelKey: 'optionTimestampStylePostit', label: '私用: 黄色付箋' },
      { value: 'chalk', labelKey: 'optionTimestampStyleChalk', label: '私用: 黒板チョーク' },
      { value: 'typewriter', labelKey: 'optionTimestampStyleTypewriter', label: '私用: タイプライター' },
      { value: 'neon', labelKey: 'optionTimestampStyleNeon', label: '私用: ネオンサイン' },
    ],
    TIMESTAMP_SIZE_OPTIONS: [
      { value: 'xs', labelKey: 'optionTimestampSizeXs', label: '極小' },
      { value: 'sm', labelKey: 'optionTimestampSizeSm', label: '小' },
      { value: 'md', labelKey: 'optionTimestampSizeMd', label: '標準' },
      { value: 'lg', labelKey: 'optionTimestampSizeLg', label: '大' },
      { value: 'xl', labelKey: 'optionTimestampSizeXl', label: '特大' },
    ],
    CAPTURE_MODE_OPTIONS: [
      { value: 'viewport', labelKey: 'optionCaptureModeViewport', label: '表示中のみ（1画面）' },
      { value: 'fullPage', labelKey: 'optionCaptureModeFullPage', label: 'ページ全体（レイアウト込み）' },
      { value: 'mainColumn', labelKey: 'optionCaptureModeMainColumn', label: '中央本文のみ（主カラム）' },
    ],
    FORMAT_OPTIONS: [
      { value: 'png', labelKey: 'optionFormatPng', label: 'PNG' },
      { value: 'jpg', labelKey: 'optionFormatJpg', label: 'JPG' },
      { value: 'webp', labelKey: 'optionFormatWebp', label: 'WEBP' },
    ],
  });
})();
