(function initializePopup() {
  const {
    TIMESTAMP_STYLES,
    TIMESTAMP_SIZE_OPTIONS,
    CAPTURE_MODE_OPTIONS,
    MESSAGE_TYPES,
  } = globalThis.EvidenceShotConstants;
  const Shared = globalThis.EvidenceShotShared;
  const t = Shared.t;
  const normalizeUserMessage = Shared.normalizeUserMessage;

  const elements = {
    format: document.getElementById('format'),
    fileNamePrefix: document.getElementById('file-name-prefix'),
    copyToClipboard: document.getElementById('copy-to-clipboard'),
    timestampEnabled: document.getElementById('timestamp-enabled'),
    includeCursor: document.getElementById('include-cursor'),
    timestampStyle: document.getElementById('timestamp-style'),
    timestampSize: document.getElementById('timestamp-size'),
    footerText: document.getElementById('footer-text'),
    captureMode: document.getElementById('capture-mode'),
    captureNow: document.getElementById('capture-now'),
    statusText: document.getElementById('status-text'),
    shortcutNote: document.getElementById('shortcut-note'),
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
    await renderShortcutInfo();
  }

  function bindEvents() {
    elements.format.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.fileNamePrefix.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.copyToClipboard.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.timestampEnabled.addEventListener('change', async () => {
      settings = await persistPopupSettings();
    });

    elements.includeCursor.addEventListener('change', async () => {
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
    elements.copyToClipboard.checked = settings.copyToClipboard;
    elements.timestampEnabled.checked = settings.timestampEnabled;
    elements.includeCursor.checked = settings.includeCursor;
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

      if (!tab?.id) {
        // DevTools ウィンドウや新規ウィンドウで active タブが取れないケース。
        // background に undefined を丸投げすると診断情報が乏しくなるので、
        // popup の文脈でエラーを出す。
        setStatus(t('errTargetTabNotFound', '撮影対象のタブを見つけられませんでした。'), 'error');
        return;
      }

      const result = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.CAPTURE_FROM_POPUP,
        tabId: tab.id,
      });

      if (!result?.ok) {
        setStatus(
          normalizeUserMessage(result?.error, 'popupStatusCaptureFailed', '撮影に失敗しました。'),
          'error'
        );
        return;
      }

      const successStatus = buildSuccessStatus(result);
      setStatus(successStatus.message, successStatus.tone);
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
      copyToClipboard: elements.copyToClipboard.checked,
      timestampEnabled: elements.timestampEnabled.checked,
      includeCursor: elements.includeCursor.checked,
      timestampStyle: elements.timestampStyle.value,
      timestampSize: elements.timestampSize.value,
      footerText: elements.footerText.value,
      captureMode: elements.captureMode.value,
    };
  }

  async function persistPopupSettings({ renderAfterSave = true } = {}) {
    // popup は現在の設定 (settings) をモジュールスコープで保持しているため、
    // Shared.saveSettings 内での loadSettings 再読み込み (storage.local.get) を省ける。
    settings = await Shared.saveSettings(collectSettingsFromForm(), settings);
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

  function buildSuccessStatus(result) {
    if (result?.clipboardStatus === 'copied') {
      return {
        message: t(
          'popupStatusSavedAndCopied',
          `保存を開始し、クリップボードにもコピーしました: ${result.fileName}`,
          [result.fileName]
        ),
        tone: 'success',
      };
    }

    if (result?.clipboardStatus === 'failed') {
      return {
        message: t(
          'popupStatusSavedCopyFailed',
          `保存を開始しましたが、クリップボードコピーに失敗しました: ${result.fileName}`,
          [result.fileName]
        ),
        tone: 'warning',
      };
    }

    if (result?.clipboardStatus === 'skipped_multipart') {
      return {
        message: t(
          'popupStatusSavedCopySkippedMultipart',
          `保存を開始しました。画像が分割されたためクリップボードコピーはスキップしました: ${result.fileName}`,
          [result.fileName]
        ),
        tone: 'warning',
      };
    }

    return {
      message: t('popupStatusSaved', `保存を開始しました: ${result.fileName}`, [result.fileName]),
      tone: 'success',
    };
  }

  async function renderShortcutInfo() {
    if (!elements.shortcutNote || !chrome.commands?.getAll) {
      return;
    }

    try {
      const commands = await chrome.commands.getAll();
      const captureCommand = commands.find(({ name }) => name === 'capture-active-tab');
      const shortcut = captureCommand?.shortcut;
      elements.shortcutNote.textContent = shortcut
        ? t('popupNoteShortcutCurrent', `ショートカット: ${shortcut}`, [shortcut])
        : t(
            'popupNoteShortcutUnassigned',
            'ショートカットは未設定です。Chrome の拡張機能ショートカット設定で割り当てできます。'
          );
    } catch {
      elements.shortcutNote.textContent = t(
        'popupNoteShortcutDefault',
        'ショートカット候補: Ctrl+Shift+Y'
      );
    }
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
