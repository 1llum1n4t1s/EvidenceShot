(function initializeEvidenceShotShared() {
  if (globalThis.EvidenceShotShared) {
    return;
  }

  const {
    DEFAULT_SETTINGS,
    SETTINGS_KEY,
    FORMAT_OPTIONS,
    TIMESTAMP_STYLES,
    TIMESTAMP_SIZE_OPTIONS,
    CAPTURE_MODE_OPTIONS,
  } = globalThis.EvidenceShotConstants;

  // saveSettingsChain は popup コンテキスト専用の直列化キュー。
  // service worker (background.js) は importScripts で utils.js を読むが、
  // SW のモジュールスコープは MV3 の Idle 停止で揮発するため、SW からは
  // saveSettings を呼んではいけない (直列化保証が破れて並列 read-modify-write になる)。
  // 設定の永続化は常に popup 側でのみ実施すること。
  let saveSettingsChain = Promise.resolve();

  // 定数由来なので呼び出しごとに再構築する必要なし。初期化時に 1 回だけ生成。
  const VALID_TIMESTAMP_STYLES = new Set(TIMESTAMP_STYLES.map(({ value }) => value));
  const VALID_TIMESTAMP_SIZES = new Set(TIMESTAMP_SIZE_OPTIONS.map(({ value }) => value));
  const VALID_CAPTURE_MODES = new Set(CAPTURE_MODE_OPTIONS.map(({ value }) => value));
  const VALID_FORMATS = new Set(FORMAT_OPTIONS.map(({ value }) => value));

  function cloneDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  function normalizeSettings(candidate = {}) {
    const base = cloneDefaultSettings();
    const legacyCaptureMode =
      typeof candidate.fullPage === 'boolean'
        ? (candidate.fullPage ? 'fullPage' : 'viewport')
        : null;

    return {
      format: VALID_FORMATS.has(candidate.format) ? candidate.format : base.format,
      timestampEnabled:
        typeof candidate.timestampEnabled === 'boolean'
          ? candidate.timestampEnabled
          : base.timestampEnabled,
      timestampStyle: VALID_TIMESTAMP_STYLES.has(candidate.timestampStyle)
        ? candidate.timestampStyle
        : base.timestampStyle,
      timestampSize: VALID_TIMESTAMP_SIZES.has(candidate.timestampSize)
        ? candidate.timestampSize
        : base.timestampSize,
      footerText:
        typeof candidate.footerText === 'string'
          // 制御文字 (C0/DEL) と zero-width / RTL/LTR 制御 (U+200B-U+200F, U+202A-U+202E)
          // を除去。Canvas fillText は単一行描画だが、双方向制御文字は描画順を乱して
          // 視覚的偽装を許すため落とす。
          ? sanitizeFooterText(candidate.footerText)
          : base.footerText,
      captureMode: VALID_CAPTURE_MODES.has(candidate.captureMode)
        ? candidate.captureMode
        : legacyCaptureMode || base.captureMode,
      fileNamePrefix: sanitizeFileNamePrefix(candidate.fileNamePrefix),
      copyToClipboard:
        typeof candidate.copyToClipboard === 'boolean'
          ? candidate.copyToClipboard
          : base.copyToClipboard,
    };
  }

  function sanitizeFooterText(raw) {
    if (typeof raw !== 'string') {
      return '';
    }
    // C0/DEL + 双方向 / zero-width 制御文字を除去 (U+200B-U+200F, U+202A-U+202E)。
    // Canvas fillText は単一行描画なので改行は元から無視されるが、RLO 等は
    // 描画順序を逆転させ視覚的偽装を許すため落とす。
    return raw
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[\u200B-\u200F\u202A-\u202E]/g, '')
      .trim()
      .slice(0, 80);
  }

  function sanitizeFileNamePrefix(raw) {
    if (typeof raw !== 'string') {
      return '';
    }
    const stripped = raw
      .replace(/[\x00-\x1f\\\/:*?"<>|]/g, '')
      .trim()
      .slice(0, 60)
      .replace(/[.\s]+$/, '');
    if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\..+)?$/i.test(stripped)) {
      return `_${stripped}`;
    }
    return stripped;
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(result[SETTINGS_KEY] || {});
  }

  function saveSettings(partialSettings, currentSettings) {
    saveSettingsChain = saveSettingsChain
      .catch(() => undefined)
      .then(async () => {
        // currentSettings が渡されればそれを基に正規化する。popup は現在値を持っているので
        // storage.local からの再読込は不要 (read-modify-write の RTT 削減)。
        // 渡されない場合は安全側で読み直す。
        const current = currentSettings || await loadSettings();
        const next = normalizeSettings({
          ...current,
          ...partialSettings,
        });
        await chrome.storage.local.set({ [SETTINGS_KEY]: next });
        return next;
      });

    return saveSettingsChain;
  }

  // ⚠ DOM 依存ユーティリティ: requestAnimationFrame は Service Worker コンテキストには
  // 存在しないため、SW から waitAnimationFrame / waitFrames を呼ぶと ReferenceError になる。
  // content script / popup からのみ使用すること。SW では Shared.sleep を使う。
  function waitAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function waitFrames(count) {
    for (let index = 0; index < count; index += 1) {
      await waitAnimationFrame();
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, numeric));
  }

  function sanitizeHost(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '-').replace(/\.+/g, '.');
    } catch {
      return 'page';
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function buildTimestamp(date = new Date()) {
    const offsetMin = -date.getTimezoneOffset();
    const tzSign = offsetMin >= 0 ? '+' : '-';
    const tzAbs = Math.abs(offsetMin);
    return {
      year: date.getFullYear(),
      shortYear: String(date.getFullYear()).slice(-2),
      month: pad2(date.getMonth() + 1),
      day: pad2(date.getDate()),
      hours: pad2(date.getHours()),
      minutes: pad2(date.getMinutes()),
      seconds: pad2(date.getSeconds()),
      timezone: `${tzSign}${pad2(Math.floor(tzAbs / 60))}:${pad2(tzAbs % 60)}`,
    };
  }

  function buildFileName({ url, format, date = new Date(), part = null, prefix = '' } = {}) {
    const stamp = buildTimestamp(date);
    const extension = format;
    const customPrefix = sanitizeFileNamePrefix(prefix);
    const baseName = customPrefix || `screenshot-${sanitizeHost(url)}`;
    const partSuffix =
      part &&
      Number.isInteger(part.count) &&
      part.count > 1 &&
      Number.isInteger(part.index) &&
      part.index >= 0
        ? `-part${part.index + 1}-of${part.count}`
        : '';
    return `${baseName}-${stamp.year}${stamp.month}${stamp.day}-${stamp.hours}${stamp.minutes}${stamp.seconds}${partSuffix}.${extension}`;
  }

  function isCapturableUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return false;
    }

    try {
      const parsed = new URL(rawUrl);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function t(key, fallback = '', substitutions = undefined) {
    try {
      const message = chrome.i18n.getMessage(key, substitutions);
      if (message) {
        return message;
      }
    } catch {
      // Ignore i18n API failures and fallback.
    }

    return fallback || key;
  }

  function normalizeUserMessage(rawMessage, fallbackKey, fallbackText) {
    const fallback = t(fallbackKey, fallbackText);
    if (typeof rawMessage !== 'string') {
      return fallback;
    }

    const trimmed = rawMessage.trim();
    if (!trimmed) {
      return fallback;
    }

    const uiLanguage = getUiLanguage();
    const hasJapanese = /[ぁ-んァ-ン一-龯]/.test(trimmed);
    const hasLatin = /[A-Za-z]/.test(trimmed);

    if (uiLanguage.startsWith('ja') && !hasJapanese && hasLatin) {
      return fallback;
    }

    if (uiLanguage.startsWith('en') && hasJapanese) {
      return fallback;
    }

    return trimmed;
  }

  function getUiLanguage() {
    try {
      const lang = chrome.i18n.getUILanguage();
      return typeof lang === 'string' ? lang.toLowerCase() : '';
    } catch {
      return '';
    }
  }

  // chrome.runtime.onMessage の async ハンドラで使う共通レスポンサ。
  // background / content の両方で同じロジックが必要だったため shared に集約。
  function respondAsync(promise, sendResponse, fallbackKey = 'errCaptureFailed', fallbackText = '撮影に失敗しました。') {
    Promise.resolve(promise)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: normalizeUserMessage(error?.message, fallbackKey, fallbackText),
        });
      });
  }

  globalThis.EvidenceShotShared = {
    cloneDefaultSettings,
    normalizeSettings,
    loadSettings,
    saveSettings,
    waitAnimationFrame,
    waitFrames,
    sleep,
    clampNumber,
    sanitizeHost,
    sanitizeFileNamePrefix,
    sanitizeFooterText,
    buildTimestamp,
    buildFileName,
    isCapturableUrl,
    t,
    normalizeUserMessage,
    respondAsync,
  };
})();
