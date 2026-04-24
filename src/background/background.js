importScripts(
  '../shared/constants.js',
  '../shared/utils.js'
);

const {
  CONTENT_SCRIPT_FILES,
  OFFSCREEN_DOCUMENT_PATH,
  OFFSCREEN_INTERFACE_VERSION,
  CAPTURE_INTERVAL_MS,
} = globalThis.WebTestShotConstants;
const Shared = globalThis.WebTestShotShared;
const t = Shared.t;
const normalizeUserMessage = Shared.normalizeUserMessage;
const activeCaptureTabs = new Set();
const activeCaptureWindows = new Set();
let creatingOffscreenDocumentPromise = null;
const OFFSCREEN_READY_RETRY_COUNT = 20;
const OFFSCREEN_READY_RETRY_DELAY_MS = 50;
const OFFSCREEN_CHANNEL_TOKEN = generateSecureToken();

const CAPTURE_HISTORY_KEY = 'captureHistory';
const CAPTURE_HISTORY_MAX = 50;

const POPUP_PAGE_URL = chrome.runtime.getURL('src/popup/popup.html');

function isTrustedPopupSender(sender) {
  // popup (chrome-extension://{id}/src/popup/popup.html) のみ許可。
  // content script (sender.tab あり) や外部拡張機能 (sender.id 不一致) は拒否。
  if (!sender || sender.id !== chrome.runtime.id) {
    return false;
  }
  if (sender.tab) {
    return false;
  }
  if (typeof sender.url !== 'string' || !sender.url.startsWith(POPUP_PAGE_URL)) {
    return false;
  }
  return true;
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message?.type) {
    return undefined;
  }

  if (!isTrustedPopupSender(sender)) {
    return undefined;
  }

  switch (message.type) {
    case 'WTS_CAPTURE_FROM_POPUP':
      return runCaptureWorkflowWithHistory(message.tabId);
    default:
      return undefined;
  }
});

// 証跡ツールなので「撮影が失敗した事実」も永続ログに残す。
// popup を閉じるとエラーメッセージが失われる問題を補完し、後から監査できるようにする。
async function runCaptureWorkflowWithHistory(tabId) {
  const startedAt = Date.now();
  let result;
  try {
    result = await runCaptureWorkflow(tabId);
  } catch (error) {
    result = {
      ok: false,
      error: normalizeUserMessage(error?.message, 'errCaptureFailed', '撮影に失敗しました。'),
    };
  }
  try {
    await appendCaptureHistory({
      at: startedAt,
      ok: Boolean(result?.ok),
      fileName: result?.fileName || null,
      savedAsFormat: result?.savedAsFormat || null,
      partCount: result?.partCount || null,
      error: result?.ok ? null : String(result?.error || ''),
    });
  } catch {
    // ログの書き込み失敗は撮影結果に影響させない
  }
  return result;
}

async function appendCaptureHistory(entry) {
  const stored = await chrome.storage.local.get(CAPTURE_HISTORY_KEY);
  const history = Array.isArray(stored[CAPTURE_HISTORY_KEY]) ? stored[CAPTURE_HISTORY_KEY].slice() : [];
  history.push(entry);
  if (history.length > CAPTURE_HISTORY_MAX) {
    history.splice(0, history.length - CAPTURE_HISTORY_MAX);
  }
  await chrome.storage.local.set({ [CAPTURE_HISTORY_KEY]: history });
}

async function runCaptureWorkflow(tabId) {
  if (!tabId) {
    return { ok: false, error: t('errTargetTabNotFound', '撮影対象のタブを見つけられませんでした。') };
  }

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, error: t('errTargetTabNotFound', '撮影対象のタブを見つけられませんでした。') };
  }

  if (!Shared.isCapturableUrl(tab.url)) {
    return {
      ok: false,
      error: t(
        'errPageNotCapturable',
        'このページでは撮影できません。http / https のページで試してください。'
      ),
    };
  }

  if (activeCaptureTabs.has(tabId)) {
    return {
      ok: false,
      error: t('errTabAlreadyCapturing', 'このページではすでに撮影中です。完了してからもう一度お試しください。'),
    };
  }

  if (activeCaptureWindows.has(tab.windowId)) {
    return {
      ok: false,
      error: t(
        'errWindowAlreadyCapturing',
        'このウィンドウでは別の撮影が進行中です。完了してからもう一度お試しください。'
      ),
    };
  }

  activeCaptureTabs.add(tabId);
  activeCaptureWindows.add(tab.windowId);

  const settings = await Shared.loadSettings();
  // sessionId の予測可能性を避けるため Math.random ではなく CSPRNG を用いる。
  const sessionId = `capture-${Date.now()}-${generateSecureToken(8)}`;
  const sessionSecret = generateSecureToken();
  let offscreenSessionStarted = false;

  try {
    await ensureContentScriptOnTab(tabId);

    const prepareResult = await chrome.tabs.sendMessage(tabId, {
      type: 'WTS_CAPTURE_PREPARE_V2',
      payload: {
        sessionId,
        settings,
      },
    });

    if (!prepareResult?.ok) {
      return {
        ok: false,
        error: normalizeUserMessage(
          prepareResult?.error,
          'errCapturePrepareFailed',
          '撮影の準備に失敗しました。'
        ),
      };
    }

    const plan = prepareResult.plan;
    const tiles = Array.isArray(plan.tiles) && plan.tiles.length > 0
      ? plan.tiles
      : [{ index: 0, startIndex: 0, endIndex: plan.positions.length - 1, startY: 0, cssHeight: plan.canvasHeight }];

    const downloadedFiles = [];
    let lastCapturedAt = 0;
    let lastCapture = null;
    let captureDone = false;

    for (const tile of tiles) {
      if (captureDone && (!lastCapture || lastCapture.index !== tile.startIndex)) {
        break;
      }

      const tilePlan = {
        ...plan,
        canvasHeight: tile.cssHeight,
        pageHeight: tile.cssHeight,
      };
      const beginResult = await beginOffscreenCaptureSession(
        sessionId,
        sessionSecret,
        tilePlan,
        tab,
        settings,
        { index: tile.index, count: tiles.length }
      );
      if (!beginResult.ok) {
        return beginResult;
      }
      offscreenSessionStarted = true;

      let slicesAdded = 0;

      for (let idx = tile.startIndex; idx <= tile.endIndex; idx += 1) {
        let activeCapture;

        if (lastCapture && lastCapture.index === idx) {
          activeCapture = lastCapture;
        } else {
          if (captureDone) {
            break;
          }

          const stepResult = await chrome.tabs.sendMessage(tabId, {
            type: 'WTS_CAPTURE_STEP_V2',
            payload: { sessionId, index: idx },
          });

          if (!stepResult?.ok) {
            throw new Error(
              normalizeUserMessage(
                stepResult?.error,
                'errCaptureStepAdjustFailed',
                'スクロール位置の調整に失敗しました。'
              )
            );
          }

          if (stepResult.done) {
            captureDone = true;
            break;
          }

          await ensureTargetTabStillActive(tabId, tab.windowId);

          const waitForRateLimit = lastCapturedAt
            ? Math.max(0, CAPTURE_INTERVAL_MS - (Date.now() - lastCapturedAt))
            : 0;
          if (waitForRateLimit > 0) {
            await Shared.sleep(waitForRateLimit);
          }

          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'png',
          });
          lastCapturedAt = Date.now();
          await ensureTargetTabStillActive(tabId, tab.windowId);

          activeCapture = {
            index: idx,
            scrollY: stepResult.scrollY,
            dataUrl,
          };
          lastCapture = activeCapture;
        }

        const pushResult = await sendOffscreenMessageWithTimeout(buildOffscreenMessage({
          type: 'WTS_ADD_CAPTURE_SLICE',
          sessionId,
          sessionSecret,
          capture: {
            index: idx,
            scrollY: activeCapture.scrollY - tile.startY,
            dataUrl: activeCapture.dataUrl,
          },
        }));

        if (!pushResult?.ok) {
          throw new Error(
            normalizeUserMessage(
              pushResult?.error,
              'errCaptureSliceTransferFailed',
              '撮影データの受け渡しに失敗しました。'
            )
          );
        }
        slicesAdded += 1;
      }

      if (slicesAdded === 0) {
        await abortOffscreenCaptureSession(sessionId, sessionSecret);
        offscreenSessionStarted = false;
        continue;
      }

      const finalizeResult = await finalizeOffscreenCaptureSession(sessionId, sessionSecret);
      offscreenSessionStarted = false;
      if (!finalizeResult.ok) {
        return finalizeResult;
      }
      downloadedFiles.push(finalizeResult.fileName);
    }

    if (downloadedFiles.length === 0) {
      return {
        ok: false,
        error: t('errCaptureFailed', '撮影に失敗しました。'),
      };
    }

    return {
      ok: true,
      fileName: downloadedFiles[0],
      savedAsFormat: settings.format,
      partCount: downloadedFiles.length,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeUserMessage(error?.message, 'errCaptureFailed', '撮影に失敗しました。'),
    };
  } finally {
    if (offscreenSessionStarted) {
      await abortOffscreenCaptureSession(sessionId, sessionSecret);
    }

    await chrome.tabs
      .sendMessage(tabId, {
        type: 'WTS_CAPTURE_RESTORE_V2',
        payload: { sessionId },
      })
      .catch(() => undefined);

    activeCaptureTabs.delete(tabId);
    activeCaptureWindows.delete(tab.windowId);
  }
}

async function beginOffscreenCaptureSession(sessionId, sessionSecret, plan, tab, settings, part) {
  await ensureOffscreenDocument();

  const request = buildOffscreenMessage({
    type: 'WTS_BEGIN_CAPTURE_SESSION',
    sessionId,
    sessionSecret,
    meta: {
      plan,
      settings,
      url: tab.url,
      title: tab.title || '',
      part: part || null,
    },
  });

  let result = await sendOffscreenMessageWithTimeout(request).catch(() => undefined);
  if (!result?.ok) {
    await recreateOffscreenDocument();
    result = await sendOffscreenMessageWithTimeout(request).catch(() => undefined);
  }

  return result?.ok
    ? { ok: true }
    : {
        ok: false,
        error: normalizeUserMessage(
          result?.error,
          'errSavePrepareFailed',
          '保存処理の準備に失敗しました。'
        ),
      };
}

async function finalizeOffscreenCaptureSession(sessionId, sessionSecret) {
  const result = await sendOffscreenMessageWithTimeout(buildOffscreenMessage({
    type: 'WTS_FINALIZE_CAPTURE_SESSION',
    sessionId,
    sessionSecret,
  })).catch(() => undefined);

  if (!result?.ok) {
    return {
      ok: false,
      error: normalizeUserMessage(
        result?.error,
        'errSaveProcessFailed',
        '保存処理に失敗しました。'
      ),
    };
  }

  const downloadUrl = result.downloadUrl;
  if (typeof downloadUrl !== 'string' || downloadUrl.length === 0 || !result.fileName) {
    return {
      ok: false,
      error: t('errSaveDataMissing', '保存データの受け取りに失敗しました。'),
    };
  }

  try {
    await downloadCapture(downloadUrl, result.fileName);
    return {
      ok: true,
      fileName: result.fileName,
      savedAsFormat: result.savedAsFormat,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeUserMessage(
        error?.message,
        'errDownloadStartFailed',
        'ダウンロードの開始に失敗しました。'
      ),
    };
  }
  // Blob URL の revoke は offscreen 側が 60 秒タイマーで自己管理する。
}

async function abortOffscreenCaptureSession(sessionId, sessionSecret) {
  await sendOffscreenMessageWithTimeout(buildOffscreenMessage({
    type: 'WTS_ABORT_CAPTURE_SESSION',
    sessionId,
    sessionSecret,
  })).catch(() => undefined);
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  if (await isOffscreenDocumentCompatible(offscreenUrl)) {
    return;
  }

  if (!creatingOffscreenDocumentPromise) {
    creatingOffscreenDocumentPromise = (async () => {
      if (await isOffscreenDocumentCompatible(offscreenUrl)) {
        return;
      }

      if ('closeDocument' in chrome.offscreen) {
        try {
          await chrome.offscreen.closeDocument();
        } catch (error) {
          if (!String(error?.message || '').includes('No document')) {
            console.warn('EvidenceShot: failed to close offscreen document:', error.message);
          }
        }
      }

      await createOffscreenDocument(offscreenUrl);
    })();
  }

  try {
    await creatingOffscreenDocumentPromise;
  } finally {
    creatingOffscreenDocumentPromise = null;
  }
}

async function isOffscreenDocumentCompatible(offscreenUrl) {
  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });

    if (contexts.length === 0) {
      return false;
    }
  } else {
    const clientsList = await clients.matchAll();
    const hasDocument = clientsList.some((client) => client.url === offscreenUrl);
    if (!hasDocument) {
      return false;
    }
  }

  return isCurrentOffscreenCompatible();
}

async function recreateOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (!creatingOffscreenDocumentPromise) {
    creatingOffscreenDocumentPromise = (async () => {
      if ('closeDocument' in chrome.offscreen) {
        try {
          await chrome.offscreen.closeDocument();
        } catch (error) {
          if (!String(error?.message || '').includes('No document')) {
            console.warn('EvidenceShot: failed to recreate offscreen document:', error.message);
          }
        }
      }

      await createOffscreenDocument(offscreenUrl);
    })();
  }

  try {
    await creatingOffscreenDocumentPromise;
  } finally {
    creatingOffscreenDocumentPromise = null;
  }
}

async function createOffscreenDocument(offscreenUrl) {
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['BLOBS'],
    justification: 'スクリーンショット画像を合成して既定ダウンロード先へ保存するため',
  });

  await waitForOffscreenDocumentReady(offscreenUrl);
}

async function waitForOffscreenDocumentReady(offscreenUrl) {
  for (let attempt = 0; attempt < OFFSCREEN_READY_RETRY_COUNT; attempt += 1) {
    if (await isOffscreenDocumentCompatible(offscreenUrl)) {
      return;
    }

    await Shared.sleep(OFFSCREEN_READY_RETRY_DELAY_MS);
  }

  throw new Error(
    t('errOffscreenNotReady', '保存処理の準備に失敗しました。offscreen の起動が完了しませんでした。')
  );
}

async function isCurrentOffscreenCompatible() {
  try {
    // PING は応答が早い想定なので短めのタイムアウトで判定（ハング検出）。
    const response = await sendOffscreenMessageWithTimeout(buildOffscreenMessage({
      type: 'WTS_OFFSCREEN_PING',
    }), 3_000);

    return response?.ok && response.interfaceVersion === OFFSCREEN_INTERFACE_VERSION;
  } catch (error) {
    return false;
  }
}

function buildOffscreenMessage(payload) {
  return {
    ...payload,
    target: 'offscreen',
    channelToken: OFFSCREEN_CHANNEL_TOKEN,
  };
}

const OFFSCREEN_MESSAGE_TIMEOUT_MS = 30_000;

// offscreen が応答しないケース（ハング）での無限 await を防ぐためのタイムアウトラッパ。
// 呼び出し元は従来通り `.catch(() => undefined)` を付ければ同じ挙動になる。
function sendOffscreenMessageWithTimeout(payload, timeoutMs = OFFSCREEN_MESSAGE_TIMEOUT_MS) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(t('errOffscreenNotReady', '保存処理の準備に失敗しました。offscreen の起動が完了しませんでした。')));
    }, timeoutMs);
  });
  return Promise.race([
    chrome.runtime.sendMessage(payload),
    timeoutPromise,
  ]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

function generateSecureToken(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function ensureContentScriptOnTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES,
  });
}

async function ensureTargetTabStillActive(tabId, windowId) {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId,
  });

  if (activeTab?.id !== tabId) {
    throw new Error(
      t(
        'errCaptureTabSwitched',
        '撮影中に別タブへ切り替わったため中止しました。対象タブを開いたまま再度お試しください。'
      )
    );
  }
}

const DOWNLOAD_COMPLETION_TIMEOUT_MS = 5 * 60 * 1000;

function downloadCapture(downloadUrl, fileName) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: downloadUrl,
        filename: fileName,
        saveAs: false,
        conflictAction: 'uniquify',
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(
              normalizeUserMessage(
                chrome.runtime.lastError.message,
                'errDownloadStartFailed',
                'ダウンロードの開始に失敗しました。'
              )
            )
          );
          return;
        }

        if (typeof downloadId !== 'number' || Number.isNaN(downloadId)) {
          reject(new Error(t('errDownloadIdMissing', 'ダウンロードIDを取得できませんでした。')));
          return;
        }

        // ダウンロード開始だけでなく「ファイル書き込み完了」まで待つ。
        // ディスク満杯・権限拒否などで interrupted になるケースを検知できる。
        let settled = false;
        const cleanup = () => {
          if (settled) return;
          settled = true;
          chrome.downloads.onChanged.removeListener(listener);
          clearTimeout(timeoutHandle);
        };
        const listener = (delta) => {
          if (delta.id !== downloadId || !delta.state) {
            return;
          }
          if (delta.state.current === 'complete') {
            cleanup();
            resolve(downloadId);
          } else if (delta.state.current === 'interrupted') {
            cleanup();
            const reason = delta.error?.current || '';
            reject(new Error(
              normalizeUserMessage(
                reason,
                'errDownloadStartFailed',
                'ダウンロードの開始に失敗しました。'
              )
            ));
          }
        };
        const timeoutHandle = setTimeout(() => {
          cleanup();
          // タイムアウト時は成功扱いでログに残す（Chrome のダウンロードマネージャが
          // バックグラウンドで継続する可能性もあるため）。ただし確証はないので警告ログを残す。
          console.warn('EvidenceShot: download completion check timed out', { downloadId, fileName });
          resolve(downloadId);
        }, DOWNLOAD_COMPLETION_TIMEOUT_MS);
        chrome.downloads.onChanged.addListener(listener);
      }
    );
  });
}

