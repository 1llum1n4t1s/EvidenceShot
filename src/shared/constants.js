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
    CAPTURE_LOCK_TTL_MS: 10 * 60 * 1000,
    // popup ↔ background ↔ content ↔ offscreen 間で交わすメッセージ種別。
    // 文字列リテラルの揺れを避け、リネーム時の Grep を確実にするため一元管理する。
    // OFFSCREEN_INTERFACE_VERSION と組で「offscreen 側プロトコル変更時にインクリメント」運用。
    MESSAGE_TYPES: Object.freeze({
      CAPTURE_FROM_POPUP: 'WTS_CAPTURE_FROM_POPUP',
      CAPTURE_PREPARE_V2: 'WTS_CAPTURE_PREPARE_V2',
      CAPTURE_STEP_V2: 'WTS_CAPTURE_STEP_V2',
      CAPTURE_RESTORE_V2: 'WTS_CAPTURE_RESTORE_V2',
      BEGIN_CAPTURE_SESSION: 'WTS_BEGIN_CAPTURE_SESSION',
      ADD_CAPTURE_SLICE: 'WTS_ADD_CAPTURE_SLICE',
      FINALIZE_CAPTURE_SESSION: 'WTS_FINALIZE_CAPTURE_SESSION',
      ABORT_CAPTURE_SESSION: 'WTS_ABORT_CAPTURE_SESSION',
      OFFSCREEN_PING: 'WTS_OFFSCREEN_PING',
      REVOKE_DOWNLOAD_URL: 'WTS_REVOKE_DOWNLOAD_URL',
    }),
    CONTENT_SCRIPT_FILES: [
      'src/shared/constants.js',
      'src/shared/utils.js',
      'src/content/capture.js',
    ],
    OFFSCREEN_DOCUMENT_PATH: 'src/offscreen/offscreen.html',
    OFFSCREEN_INTERFACE_VERSION: 14,
    DEFAULT_SETTINGS: {
      format: 'png',
      timestampEnabled: true,
      timestampStyle: 'japanese',
      timestampSize: 'xs',
      footerText: '',
      captureMode: 'fullPage',
      fileNamePrefix: '',
      includeCursor: false,
      copyToClipboard: true,
    },
    CAPTURE_INTERVAL_MS: 650,
    CAPTURE_SETTLE_MS: 180,
    MAX_CANVAS_EDGE: 65535,
    MAX_CANVAS_AREA: 268435456,
    TIMESTAMP_STYLES: [
      { value: 'japanese', labelKey: 'optionTimestampStyleJapanese', label: '業務: 和風標準' },
      { value: 'audit', labelKey: 'optionTimestampStyleAudit', label: '業務: 監査プレート' },
      { value: 'document', labelKey: 'optionTimestampStyleDocument', label: '業務: ドキュメント札' },
      { value: 'ledger', labelKey: 'optionTimestampStyleLedger', label: '業務: 台帳ライン' },
      { value: 'blueprint', labelKey: 'optionTimestampStyleBlueprint', label: '業務: ブループリント' },
      { value: 'monochrome', labelKey: 'optionTimestampStyleMonochrome', label: '業務: モノクロ帯' },
      { value: 'compact', labelKey: 'optionTimestampStyleCompact', label: '業務: コンパクト票' },
      { value: 'film', labelKey: 'optionTimestampStyleFilm', label: '私用: フィルム橙' },
      { value: 'minimal', labelKey: 'optionTimestampStyleMinimal', label: '私用: ミニマルバッジ' },
      { value: 'polaroid', labelKey: 'optionTimestampStylePolaroid', label: '私用: ポラロイド' },
      { value: 'diary', labelKey: 'optionTimestampStyleDiary', label: '私用: ダイアリー' },
      { value: 'pastel', labelKey: 'optionTimestampStylePastel', label: '私用: パステルラベル' },
      { value: 'night', labelKey: 'optionTimestampStyleNight', label: '私用: ナイトグロー' },
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
    FORMAT_OPTIONS: ['png', 'jpg', 'webp'],
  });
})();
