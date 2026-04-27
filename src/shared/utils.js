(function initializeWebTestShotShared() {
  if (globalThis.WebTestShotShared) {
    return;
  }

  const {
    DEFAULT_SETTINGS,
    SETTINGS_KEY,
    FORMAT_OPTIONS,
    TIMESTAMP_STYLES,
    TIMESTAMP_SIZE_OPTIONS,
    CAPTURE_MODE_OPTIONS,
  } = globalThis.WebTestShotConstants;
  let saveSettingsChain = Promise.resolve();

  // 定数由来なので呼び出しごとに再構築する必要なし。初期化時に 1 回だけ生成。
  const VALID_TIMESTAMP_STYLES = new Set(TIMESTAMP_STYLES.map(({ value }) => value));
  const VALID_TIMESTAMP_SIZES = new Set(TIMESTAMP_SIZE_OPTIONS.map(({ value }) => value));
  const VALID_CAPTURE_MODES = new Set(CAPTURE_MODE_OPTIONS.map(({ value }) => value));

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
      format: FORMAT_OPTIONS.includes(candidate.format) ? candidate.format : base.format,
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
          ? candidate.footerText.trim().slice(0, 80)
          : base.footerText,
      captureMode: VALID_CAPTURE_MODES.has(candidate.captureMode)
        ? candidate.captureMode
        : legacyCaptureMode || base.captureMode,
      fileNamePrefix: sanitizeFileNamePrefix(candidate.fileNamePrefix),
      includeCursor:
        typeof candidate.includeCursor === 'boolean'
          ? candidate.includeCursor
          : base.includeCursor,
      copyToClipboard:
        typeof candidate.copyToClipboard === 'boolean'
          ? candidate.copyToClipboard
          : base.copyToClipboard,
    };
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

  function saveSettings(partialSettings) {
    saveSettingsChain = saveSettingsChain
      .catch(() => undefined)
      .then(async () => {
        const current = await loadSettings();
        const next = normalizeSettings({
          ...current,
          ...partialSettings,
        });
        await chrome.storage.local.set({ [SETTINGS_KEY]: next });
        return next;
      });

    return saveSettingsChain;
  }

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
    return {
      year: date.getFullYear(),
      shortYear: String(date.getFullYear()).slice(-2),
      month: pad2(date.getMonth() + 1),
      day: pad2(date.getDate()),
      hours: pad2(date.getHours()),
      minutes: pad2(date.getMinutes()),
      seconds: pad2(date.getSeconds()),
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

  function buildTimestampText(style, date = new Date()) {
    const stamp = buildTimestamp(date);
    switch (style) {
      case 'film':
        return `${stamp.shortYear} ${stamp.month} ${stamp.day}  ${stamp.hours}:${stamp.minutes}:${stamp.seconds}`;
      case 'minimal':
        return `${stamp.year}.${stamp.month}.${stamp.day}  ${stamp.hours}:${stamp.minutes}`;
      case 'japanese':
      default:
        return `${stamp.year}/${stamp.month}/${stamp.day} ${stamp.hours}:${stamp.minutes}:${stamp.seconds}`;
    }
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

  globalThis.WebTestShotShared = {
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
    buildTimestamp,
    buildTimestampText,
    buildFileName,
    isCapturableUrl,
    t,
    normalizeUserMessage,
  };
})();
