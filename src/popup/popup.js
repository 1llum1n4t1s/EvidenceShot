(function initializePopup() {
  const {
    TIMESTAMP_STYLES,
    TIMESTAMP_SIZE_OPTIONS,
    CAPTURE_MODE_OPTIONS,
    FORMAT_OPTIONS,
    MESSAGE_TYPES,
    CLIPBOARD_STATUS,
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
    shortcutSetup: document.getElementById('shortcut-setup'),
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
    populateSelectOptions(elements.format, FORMAT_OPTIONS);
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

    if (elements.shortcutSetup) {
      elements.shortcutSetup.addEventListener('click', onOpenShortcutSettings);
    }
  }

  // Chrome の拡張機能ショートカット設定画面を新規タブで開く。
  // 一般ユーザーは chrome://extensions/shortcuts のパスを知らないため、
  // popup から 1 クリックで誘導できるようにする。
  // (Chromium の既知挙動: unpacked 拡張機能のリロードで suggested_key が
  // 一時的に reset されるケースがあり、ユーザーがこの画面で再設定する必要がある)
  async function onOpenShortcutSettings() {
    try {
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      // 設定画面を開いたら popup 自身は閉じる (Chrome はフォーカス遷移時に
      // popup を自動で閉じる挙動だが、明示的に閉じる)。
      window.close();
    } catch (error) {
      // chrome.tabs.create が拒否される稀なケース (権限・状況依存) は
      // 静的にエラーを popup へ表示するに留める。
      setStatus(
        normalizeUserMessage(error?.message, 'errOpenShortcutSettingsFailed', 'ショートカット設定画面を開けませんでした。'),
        'error'
      );
    }
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

      // クリップボード書込は popup 自身で行う。offscreen / content script では
      // document.hasFocus() が常に false で navigator.clipboard.write が
      // 「Document is not focused.」で必ず失敗するため、user activation を保持する
      // popup context へ書込を一本化している。
      if (result.clipboardObjectUrl) {
        const clipboardObjectUrl = result.clipboardObjectUrl;
        try {
          const writeResult = await writeClipboardFromUrl(clipboardObjectUrl);
          result.clipboardStatus = writeResult.ok ? CLIPBOARD_STATUS.COPIED : CLIPBOARD_STATUS.FAILED;
          result.clipboardError = writeResult.error || null;
        } finally {
          // 成否に関わらず blob URL は不要。offscreen 側の 60 秒タイマーは保険にする。
          result.clipboardObjectUrl = null;
          await revokeOffscreenObjectUrl(clipboardObjectUrl);
        }
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

  async function writeClipboardFromUrl(url) {
    if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') {
      return { ok: false, error: t('errClipboardUnsupported', 'この環境ではクリップボードコピーを利用できません。') };
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return { ok: false, error: t('errClipboardWriteFailed', 'クリップボードへのコピーに失敗しました。') };
      }
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return { ok: true };
    } catch (error) {
      // DOMException 等の英語メッセージは normalizeUserMessage で fallback に丸められるため原文を console に残す。
      console.error('EvidenceShot: clipboard write failed in popup', error?.name, error?.message);
      return {
        ok: false,
        error: normalizeUserMessage(
          error?.message,
          'errClipboardWriteFailed',
          'クリップボードへのコピーに失敗しました。'
        ),
      };
    }
  }

  async function revokeOffscreenObjectUrl(url) {
    if (typeof url !== 'string' || !url) {
      return;
    }
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.REVOKE_OBJECT_URL_FROM_POPUP,
      downloadUrl: url,
    }).catch(() => undefined);
  }

  function buildSuccessStatus(result) {
    if (result?.clipboardStatus === CLIPBOARD_STATUS.COPIED || result?.clipboardStatus === CLIPBOARD_STATUS.COPIED_HTML_FALLBACK) {
      return {
        message: t(
          'popupStatusSavedAndCopied',
          `保存を開始し、クリップボードにもコピーしました: ${result.fileName}`,
          [result.fileName]
        ),
        tone: 'success',
      };
    }

    if (result?.clipboardStatus === CLIPBOARD_STATUS.FAILED) {
      return {
        message: t(
          'popupStatusSavedCopyFailed',
          `保存を開始しましたが、クリップボードコピーに失敗しました: ${result.fileName}`,
          [result.fileName]
        ),
        tone: 'warning',
      };
    }

    if (result?.clipboardStatus === CLIPBOARD_STATUS.SKIPPED_MULTIPART) {
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
            'ショートカットは未設定です。下のボタンから設定画面を開けます。'
          );
      // 未設定 (= 空文字 / undefined) のときだけ設定誘導ボタンを出す。
      // Chromium の挙動で unpacked 拡張機能のリロード時に suggested_key が
      // reset されるケースがあり、一般ユーザーは復旧経路を知らないため。
      if (elements.shortcutSetup) {
        elements.shortcutSetup.hidden = Boolean(shortcut);
      }
    } catch {
      elements.shortcutNote.textContent = t(
        'popupNoteShortcutDefault',
        'ショートカット候補: Ctrl+Shift+Y'
      );
      // 取得失敗時はボタン状態を変えない (hidden のまま)。
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
