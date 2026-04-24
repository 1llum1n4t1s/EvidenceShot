(function initializePopup() {
  const {
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

  let settings = Shared.cloneDefaultSettings();

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
    settings = await Shared.loadSettings();
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
    settings = await Shared.saveSettings(collectSettingsFromForm());
    if (renderAfterSave) {
      render();
    }
    return settings;
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
    // Keep textContent here: message may embed user-supplied fileNamePrefix.
    elements.statusText.textContent = message;
    elements.statusText.dataset.tone = tone;
  }
})();
