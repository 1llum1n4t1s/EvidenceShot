(function initializePopup() {
  const {
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    FORMAT_OPTIONS,
    TIMESTAMP_STYLES,
    TIMESTAMP_SIZE_OPTIONS,
    CAPTURE_MODE_OPTIONS,
  } = globalThis.WebTestShotConstants;
  const Shared = globalThis.WebTestShotShared;
  const t = Shared.t;
  const normalizeUserMessage = Shared.normalizeUserMessage;

  const elements = {
    format: document.getElementById('format'),
    fileNamePrefix: document.getElementById('file-name-prefix'),
    timestampEnabled: document.getElementById('timestamp-enabled'),
    timestampStyle: document.getElementById('timestamp-style'),
    timestampSize: document.getElementById('timestamp-size'),
    footerText: document.getElementById('footer-text'),
    captureMode: document.getElementById('capture-mode'),
    captureNow: document.getElementById('capture-now'),
    statusText: document.getElementById('status-text'),
  };

  let settings = normalizePopupSettings(DEFAULT_SETTINGS);

  bootstrap().catch((error) => {
    setStatus(
      normalizeUserMessage(error?.message, 'popupStatusInitFailed', '初期化に失敗しました。'),
      'error'
    );
  });

  async function bootstrap() {
    applyStaticLocalization();
    populateSelectOptions(elements.timestampStyle, TIMESTAMP_STYLES);
    populateSelectOptions(elements.timestampSize, TIMESTAMP_SIZE_OPTIONS);
    populateSelectOptions(elements.captureMode, CAPTURE_MODE_OPTIONS);
    settings = await loadPopupSettings();
    bindEvents();
    render();
    setStatus(t('popupStatusReady', '準備OK。撮影できます。'));
  }

  function bindEvents() {
    elements.format.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.fileNamePrefix.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.timestampEnabled.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.timestampStyle.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.timestampSize.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.footerText.addEventListener('input', () => {
      updateLinkedControlAvailability();
    });

    elements.footerText.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.captureMode.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.captureNow.addEventListener('click', onCaptureNow);
  }

  function render() {
    if (!['png', 'jpg', 'webp'].includes(settings.format)) {
      settings.format = 'png';
    }

    elements.format.value = settings.format;
    elements.fileNamePrefix.value = settings.fileNamePrefix;
    elements.timestampEnabled.checked = settings.timestampEnabled;
    elements.timestampStyle.value = settings.timestampStyle;
    elements.timestampSize.value = settings.timestampSize;
    elements.footerText.value = settings.footerText;
    elements.captureMode.value = settings.captureMode;
    updateLinkedControlAvailability();
  }

  async function onCaptureNow() {
    elements.captureNow.disabled = true;
    setStatus(t('popupStatusCapturing', '撮影を開始しています…'));

    try {
      settings = await persistPopupSettings();

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      const result = await chrome.runtime.sendMessage({
        type: 'WTS_CAPTURE_FROM_POPUP',
        tabId: tab?.id,
      });

      if (!result?.ok) {
        setStatus(
          normalizeUserMessage(result?.error, 'popupStatusCaptureFailed', '撮影に失敗しました。'),
          'error'
        );
        return;
      }

      setStatus(
        t('popupStatusSaved', `保存しました: ${result.fileName}`, [result.fileName]),
        'success'
      );
    } catch (error) {
      setStatus(
        normalizeUserMessage(error?.message, 'popupStatusCaptureFailed', '撮影に失敗しました。'),
        'error'
      );
    } finally {
      elements.captureNow.disabled = false;
    }
  }

  function collectSettingsFromForm() {
    return {
      format: elements.format.value,
      fileNamePrefix: elements.fileNamePrefix.value,
      timestampEnabled: elements.timestampEnabled.checked,
      timestampStyle: elements.timestampStyle.value,
      timestampSize: elements.timestampSize.value,
      footerText: elements.footerText.value,
      captureMode: elements.captureMode.value,
    };
  }

  async function persistPopupSettings({ renderAfterSave = true } = {}) {
    const normalizedSettings = normalizePopupSettings(collectSettingsFromForm());
    await chrome.storage.local.set({
      [SETTINGS_KEY]: normalizedSettings,
    });
    settings = normalizedSettings;
    if (renderAfterSave) {
      render();
    }
    return settings;
  }

  async function loadPopupSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return normalizePopupSettings(stored?.[SETTINGS_KEY] || {});
  }

  function normalizePopupSettings(partialSettings = {}) {
    const validTimestampStyles = new Set(TIMESTAMP_STYLES.map(({ value }) => value));
    const validTimestampSizes = new Set(TIMESTAMP_SIZE_OPTIONS.map(({ value }) => value));
    const validCaptureModes = new Set(CAPTURE_MODE_OPTIONS.map(({ value }) => value));
    const legacyCaptureMode =
      typeof partialSettings.fullPage === 'boolean'
        ? (partialSettings.fullPage ? 'fullPage' : 'viewport')
        : null;

    return {
      ...DEFAULT_SETTINGS,
      format: FORMAT_OPTIONS.includes(partialSettings.format)
        ? partialSettings.format
        : DEFAULT_SETTINGS.format,
      timestampEnabled:
        typeof partialSettings.timestampEnabled === 'boolean'
          ? partialSettings.timestampEnabled
          : DEFAULT_SETTINGS.timestampEnabled,
      timestampStyle: validTimestampStyles.has(partialSettings.timestampStyle)
        ? partialSettings.timestampStyle
        : DEFAULT_SETTINGS.timestampStyle,
      timestampSize: validTimestampSizes.has(partialSettings.timestampSize)
        ? partialSettings.timestampSize
        : DEFAULT_SETTINGS.timestampSize,
      footerText:
        typeof partialSettings.footerText === 'string'
          ? partialSettings.footerText.trim().slice(0, 80)
          : DEFAULT_SETTINGS.footerText,
      captureMode: validCaptureModes.has(partialSettings.captureMode)
        ? partialSettings.captureMode
        : legacyCaptureMode || DEFAULT_SETTINGS.captureMode,
      fileNamePrefix: Shared.sanitizeFileNamePrefix(partialSettings.fileNamePrefix),
    };
  }

  function updateLinkedControlAvailability() {
    const hasFooterText = elements.footerText.value.trim().length > 0;
    const enableDecorations = elements.timestampEnabled.checked || hasFooterText;
    elements.timestampStyle.disabled = !enableDecorations;
    elements.timestampSize.disabled = !enableDecorations;
  }

  function populateSelectOptions(selectElement, options) {
    selectElement.textContent = '';
    options.forEach(({ value, label, labelKey }) => {
      const optionElement = document.createElement('option');
      optionElement.value = value;
      optionElement.textContent = labelKey ? t(labelKey, label || value) : (label || value);
      selectElement.appendChild(optionElement);
    });
  }

  function applyStaticLocalization() {
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.dataset.i18n;
      if (!key) {
        return;
      }
      element.textContent = t(key, element.textContent || key);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      const key = element.dataset.i18nPlaceholder;
      if (!key || !('placeholder' in element)) {
        return;
      }
      element.placeholder = t(key, element.placeholder || key);
    });
  }

  function setStatus(message, tone = 'neutral') {
    elements.statusText.textContent = message;
    elements.statusText.dataset.tone = tone;
  }
})();
