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
      UPDATE_CAPTURE_HISTORY_FROM_POPUP: 'WTS_UPDATE_CAPTURE_HISTORY_FROM_POPUP',
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
      // 表示言語の共通モジュール。t() が選択言語の文言を引くため、他のスクリプトより先に読む。
      'src/shared/ui-localizer.js',
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
    // Chrome は 65535px まで扱えるが、strict_min_version で許容している旧 Firefox は
    // 32767px 超で 2D context を失う。大きい出力は tile 分割するため共通安全上限を使う。
    MAX_CANVAS_EDGE: 32767,
    MAX_TILE_CANVAS_AREA: 67108864,
    MAX_CAPTURE_DATA_URL_LENGTH: 60 * 1024 * 1024,
    MAX_HTML_CLIPBOARD_BYTES: 8 * 1024 * 1024,
    TIMESTAMP_STYLES: [
      { value: 'manuscript', labelKey: 'optionTimestampStyleManuscript', label: 'Evidence: Official Document' },
      { value: 'seal', labelKey: 'optionTimestampStyleSeal', label: 'Evidence: Vermillion Seal' },
      { value: 'ledger', labelKey: 'optionTimestampStyleLedger', label: 'Evidence: Accounting Ledger' },
      { value: 'blueprint', labelKey: 'optionTimestampStyleBlueprint', label: 'Evidence: Blueprint' },
      { value: 'terminal', labelKey: 'optionTimestampStyleTerminal', label: 'Evidence: Terminal CLI' },
      { value: 'receipt', labelKey: 'optionTimestampStyleReceipt', label: 'Evidence: Thermal Receipt' },
      { value: 'kraft', labelKey: 'optionTimestampStyleKraft', label: 'Evidence: Kraft Paper Tag' },
      { value: 'carbon', labelKey: 'optionTimestampStyleCarbon', label: 'Evidence: Carbon Copy' },
      { value: 'stencil', labelKey: 'optionTimestampStyleStencil', label: 'Evidence: Stencil' },
      { value: 'wax-seal', labelKey: 'optionTimestampStyleWaxSeal', label: 'Evidence: Wax Seal' },
      { value: 'microfiche', labelKey: 'optionTimestampStyleMicrofiche', label: 'Evidence: Microfiche' },
      { value: 'postit', labelKey: 'optionTimestampStylePostit', label: 'Personal: Sticky Note' },
      { value: 'chalk', labelKey: 'optionTimestampStyleChalk', label: 'Personal: Blackboard Chalk' },
      { value: 'typewriter', labelKey: 'optionTimestampStyleTypewriter', label: 'Personal: Typewriter' },
      { value: 'neon', labelKey: 'optionTimestampStyleNeon', label: 'Personal: Neon Sign' },
    ],
    TIMESTAMP_SIZE_OPTIONS: [
      { value: 'xs', labelKey: 'optionTimestampSizeXs', label: 'Extra Small' },
      { value: 'sm', labelKey: 'optionTimestampSizeSm', label: 'Small' },
      { value: 'md', labelKey: 'optionTimestampSizeMd', label: 'Medium' },
      { value: 'lg', labelKey: 'optionTimestampSizeLg', label: 'Large' },
      { value: 'xl', labelKey: 'optionTimestampSizeXl', label: 'Extra Large' },
    ],
    CAPTURE_MODE_OPTIONS: [
      { value: 'viewport', labelKey: 'optionCaptureModeViewport', label: 'Visible area only (1 screen)' },
      { value: 'fullPage', labelKey: 'optionCaptureModeFullPage', label: 'Full page (with layout)' },
      { value: 'mainColumn', labelKey: 'optionCaptureModeMainColumn', label: 'Main content only' },
    ],
    FORMAT_OPTIONS: [
      { value: 'png', labelKey: 'optionFormatPng', label: 'PNG' },
      { value: 'jpg', labelKey: 'optionFormatJpg', label: 'JPG' },
      { value: 'webp', labelKey: 'optionFormatWebp', label: 'WEBP' },
    ],
  });
})();
