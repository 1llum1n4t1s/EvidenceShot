importScripts(
  '../shared/constants.js',
  '../shared/utils.js'
);

const {
  CONTENT_SCRIPT_FILES,
  OFFSCREEN_DOCUMENT_PATH,
  OFFSCREEN_INTERFACE_VERSION,
  CAPTURE_INTERVAL_MS,
  CAPTURE_HISTORY_KEY,
  CAPTURE_HISTORY_MAX,
  CAPTURE_LOCK_KEY,
  MAX_CAPTURE_DATA_URL_LENGTH,
  MESSAGE_TYPES,
  CLIPBOARD_STATUS,
} = globalThis.EvidenceShotConstants;
const Shared = globalThis.EvidenceShotShared;
const t = Shared.t;
const normalizeUserMessage = Shared.normalizeUserMessage;
let creatingOffscreenDocumentPromise = null;
const OFFSCREEN_READY_RETRY_COUNT = 20;
const OFFSCREEN_READY_RETRY_DELAY_MS = 50;
const OFFSCREEN_CHANNEL_TOKEN = generateSecureToken();

const pendingDownloadUrls = new Map();

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta?.state) {
    return;
  }
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    revokePendingDownloadUrl(delta.id);
  }
});

// ===== 撮影排他制御 (Web Locks API) =====
// 旧実装は chrome.storage.session に「ロック中タブ ID 配列」を書いて TTL で
// 幽霊検知していたが、SW 再起動跨ぎで競合検知が複雑化していた。
// Web Locks API は SW 死亡で自動解放されるため、storage 経由の幽霊掃除が不要。
// ロック粒度は (a) タブ単位 (b) 拡張機能全体 の 2 段階。
const TAB_LOCK_PREFIX = 'evidenceshot-capture-tab-';
const GLOBAL_LOCK_NAME = 'evidenceshot-capture-global';

// 旧 chrome.storage.session 由来の幽霊データを起動時に一括クリア (旧実装からの migration)。
chrome.storage.session.remove(CAPTURE_LOCK_KEY).catch(() => undefined);

// navigator.locks.request の callback は「ロック保持中ずっと走る Promise」を返す形なので、
// 取得時点で外側に release 関数を渡し、release 呼び出しで内部 Promise を解決して callback を抜ける。
function acquireExclusiveLock(name) {
  return new Promise((resolveOuter) => {
    let releaseInternal = null;
    const heldPromise = new Promise((resolve) => {
      releaseInternal = resolve;
    });
    navigator.locks
      .request(name, { ifAvailable: true, mode: 'exclusive' }, async (lock) => {
        if (!lock) {
          // ifAvailable で他者が保持中なら lock=null。即座に null を返す。
          resolveOuter(null);
          return;
        }
        // 取得成功 → release function を外に渡し、release 呼び出しまで保持。
        resolveOuter(() => {
          if (releaseInternal) {
            const r = releaseInternal;
            releaseInternal = null;
            r();
          }
        });
        await heldPromise;
      })
      .catch((error) => {
        console.warn('EvidenceShot: navigator.locks.request failed', error);
        resolveOuter(null);
      });
  });
}

// 撮影スロット取得: タブロック → 拡張機能全体ロック の 2 段。
// 競合時は { ok: false, conflict: 'tab' | 'window' } を返す。
// 取得成功時の release() は両方を解放する idempotent な関数。
async function tryAcquireCaptureSlot(tabId, windowId) {
  void windowId; // 設計上は windowId 単位ではなく拡張機能全体で 1 件 (旧実装と同等)
  const tabRelease = await acquireExclusiveLock(`${TAB_LOCK_PREFIX}${tabId}`);
  if (!tabRelease) {
    return { ok: false, conflict: 'tab' };
  }
  const globalRelease = await acquireExclusiveLock(GLOBAL_LOCK_NAME);
  if (!globalRelease) {
    tabRelease();
    return { ok: false, conflict: 'window' };
  }
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      try { globalRelease(); } catch { /* no-op */ }
      try { tabRelease(); } catch { /* no-op */ }
    },
  };
}

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
  if (typeof sender.url !== 'string' || sender.url !== POPUP_PAGE_URL) {
    return false;
  }
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return undefined;
  }

  if (!isTrustedPopupSender(sender)) {
    return undefined;
  }

  switch (message.type) {
    case MESSAGE_TYPES.CAPTURE_FROM_POPUP:
      respondAsync(runCaptureWorkflowWithHistory(message.tabId), sendResponse);
      return true;
    case MESSAGE_TYPES.REVOKE_OBJECT_URL_FROM_POPUP:
      respondAsync(
        revokeOffscreenDownloadUrl(message.downloadUrl).then(() => ({ ok: true })),
        sendResponse
      );
      return true;
    default:
      return undefined;
  }
});

// respondAsync は Shared に移管 (capture.js と重複定義していたため統合)
const respondAsync = Shared.respondAsync;

if (chrome.commands?.onCommand) {
  // Chrome 117+ では onCommand コールバックの第二引数に「ショートカット押下時点の
  // アクティブタブ」が渡る。chrome.tabs.query で取り直す経路は数ミリ秒の async ギャップで
  // 別タブが返る競合があるため、tab 引数を最優先で使う。レガシー Chrome 用のフォールバックとして
  // captureActiveTabFromCommand 内で query も残す。
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== 'capture-active-tab') {
      return;
    }

    captureActiveTabFromCommand(tab).catch((error) => {
      console.warn('EvidenceShot: shortcut capture failed', error);
    });
  });
}

async function captureActiveTabFromCommand(tabFromCommand) {
  let tab = tabFromCommand && tabFromCommand.id ? tabFromCommand : null;
  if (!tab) {
    [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
  }

  const result = tab?.id
    ? await runCaptureWorkflowWithHistory(tab.id)
    : { ok: false, error: t('errTargetTabNotFound', '撮影対象のタブを見つけられませんでした。') };

  // ショートカット経由は popup を開かないため web page が focus を保ったままになる。
  // この条件下では active タブの content script で navigator.clipboard.write が成功するため、
  // SW から content script へクリップボード書込を委譲する。
  // (popup 経由では popup 自身が書込を担当し、このパスは通らない)
  if (result?.clipboardObjectUrl && tab?.id) {
    const clipResult = await delegateClipboardCopyToContent(tab.id, result.clipboardObjectUrl);
    result.clipboardStatus = clipResult.ok ? (clipResult.clipboardStatus || CLIPBOARD_STATUS.COPIED) : CLIPBOARD_STATUS.FAILED;
    result.clipboardError = clipResult.ok ? null : (clipResult.error || null);
    await revokeOffscreenDownloadUrl(result.clipboardObjectUrl).catch(() => undefined);
    result.clipboardObjectUrl = null;
  }

  await showCommandCaptureBadge(result);
  if (!result?.ok) {
    console.warn('EvidenceShot: shortcut capture failed', result?.error);
  }
}

async function showCommandCaptureBadge(result) {
  const ok = Boolean(result?.ok);
  await chrome.action.setBadgeBackgroundColor({
    color: ok ? '#166534' : '#b91c1c',
  });
  await chrome.action.setBadgeText({
    text: ok ? 'OK' : 'ERR',
  });

  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
  }, 2500);
}

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
      downloadStatus: result?.downloadStatus || null,
      clipboardStatus: result?.clipboardStatus || null,
      clipboardError: result?.clipboardError || null,
      downloadId: result?.downloadId || null,
      downloadIds: Array.isArray(result?.downloadIds) ? result.downloadIds : [],
      error: result?.ok ? null : String(result?.error || ''),
    });
  } catch {
    // ログの書き込み失敗は撮影結果に影響させない
  }
  return result;
}

async function appendCaptureHistory(entry) {
  const stored = await chrome.storage.local.get(CAPTURE_HISTORY_KEY);
  const existing = Array.isArray(stored[CAPTURE_HISTORY_KEY]) ? stored[CAPTURE_HISTORY_KEY] : [];
  // slice(-N) で末尾 N 件を取り出す。push + splice(0, N) より中間配列が 1 つ少ない。
  const history = [...existing, entry].slice(-CAPTURE_HISTORY_MAX);
  await chrome.storage.local.set({ [CAPTURE_HISTORY_KEY]: history });
}

async function runCaptureWorkflow(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
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

  const acquireResult = await tryAcquireCaptureSlot(tabId, tab.windowId);
  if (!acquireResult.ok) {
    if (acquireResult.conflict === 'tab') {
      return {
        ok: false,
        error: t('errTabAlreadyCapturing', 'このページではすでに撮影中です。完了してからもう一度お試しください。'),
      };
    }
    return {
      ok: false,
      error: t(
        'errWindowAlreadyCapturing',
        '別の撮影が進行中です。完了してからもう一度お試しください。'
      ),
    };
  }

  let sessionId = null;
  let sessionSecret = null;
  let offscreenSessionStarted = false;

  try {
    const settings = await Shared.loadSettings();
    // sessionId の予測可能性を避けるため Math.random ではなく CSPRNG を用いる。
    sessionId = `capture-${Date.now()}-${generateSecureToken(8)}`;
    sessionSecret = generateSecureToken();

    await ensureContentScriptOnTab(tabId);

    const prepareResult = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.CAPTURE_PREPARE_V2,
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
    const downloadIds = [];
    let clipboardStatus = settings.copyToClipboard
      ? (tiles.length === 1 ? CLIPBOARD_STATUS.PENDING : CLIPBOARD_STATUS.SKIPPED_MULTIPART)
      : CLIPBOARD_STATUS.DISABLED;
    let clipboardError = null;
    // popup へ伝搬する PNG blob URL。popup 側で fetch + clipboard.write する。
    // offscreen / content script では document.hasFocus() が常に false で書込失敗するため、
    // user activation を保持する popup context に書込を一本化している。
    let clipboardObjectUrl = null;
    let lastCapturedAt = 0;
    let lastCapture = null;
    let captureDone = false;
    let cursorAssignedToTile = false;

    for (const tile of tiles) {
      if (captureDone && (!lastCapture || lastCapture.index !== tile.startIndex)) {
        break;
      }

      const tileCursor = resolveCursorForTile(
        plan.cursor,
        tile,
        plan.scrollingMode,
        cursorAssignedToTile
      );
      if (tileCursor) {
        cursorAssignedToTile = true;
      }

      const tilePlan = {
        ...plan,
        canvasHeight: tile.cssHeight,
        pageHeight: tile.cssHeight,
        tileStartY: tile.startY,
        cursor: tileCursor,
      };
      const tileSettings = {
        ...settings,
        copyToClipboard: Boolean(settings.copyToClipboard && tiles.length === 1),
      };
      const beginResult = await beginOffscreenCaptureSession(
        sessionId,
        sessionSecret,
        tilePlan,
        tab,
        tileSettings,
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
            type: MESSAGE_TYPES.CAPTURE_STEP_V2,
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

          // captureVisibleTab はスロットリング待機後に1回呼ぶだけにし、
          // 直前チェックは省く (待機中の切替を見抜けないため安全寄与が薄い)。
          // 切替検知は captureVisibleTab 直後の事後チェックで行い、
          // 例外が出れば finally の abort でセッション破棄 → ダウンロード/クリップボード書き込みは行われない。
          const waitForRateLimit = lastCapturedAt
            ? Math.max(0, CAPTURE_INTERVAL_MS - (Date.now() - lastCapturedAt))
            : 0;
          if (waitForRateLimit > 0) {
            await Shared.sleep(waitForRateLimit);
          }

          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'png',
          });
          if (typeof dataUrl === 'string' && dataUrl.length > MAX_CAPTURE_DATA_URL_LENGTH) {
            throw new Error(t(
              'errCaptureSliceTooLarge',
              '撮影データが大きすぎます。ウィンドウを小さくして再度お試しください。'
            ));
          }
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
          type: MESSAGE_TYPES.ADD_CAPTURE_SLICE,
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
      if (!finalizeResult.ok) {
        return finalizeResult;
      }
      offscreenSessionStarted = false;
      downloadedFiles.push(finalizeResult.fileName);
      if (finalizeResult.clipboardStatus) {
        clipboardStatus = finalizeResult.clipboardStatus;
        clipboardError = finalizeResult.clipboardError || null;
      }
      // pending_in_content の場合は popup で書込みする。clipboardObjectUrl は popup へそのまま伝搬。
      if (finalizeResult.clipboardObjectUrl) {
        clipboardObjectUrl = finalizeResult.clipboardObjectUrl;
      }
      if (Number.isInteger(finalizeResult.downloadId)) {
        downloadIds.push(finalizeResult.downloadId);
      }
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
      downloadStatus: 'started',
      clipboardStatus,
      clipboardError,
      // pending_in_content のときに popup が fetch + clipboard.write する。null のときは書込なし。
      clipboardObjectUrl,
      downloadId: downloadIds[0] || null,
      downloadIds,
    };
  } catch (error) {
    // 失敗の真因を SW コンソールに必ず残す。normalizeUserMessage が英語エラーを
    // 「撮影に失敗しました。」へ畳み込むため、ここで握りつぶすと UI から原因追跡できなくなる。
    console.error('EvidenceShot: capture workflow failed', error);
    return {
      ok: false,
      error: normalizeUserMessage(error?.message, 'errCaptureFailed', '撮影に失敗しました。'),
    };
  } finally {
    if (offscreenSessionStarted && sessionId && sessionSecret) {
      await abortOffscreenCaptureSession(sessionId, sessionSecret);
    }

    if (sessionId) {
      await chrome.tabs
        .sendMessage(tabId, {
          type: MESSAGE_TYPES.CAPTURE_RESTORE_V2,
          payload: { sessionId },
        })
        .catch(() => undefined);
    }

    // Web Locks ベースのロック解放。release は idempotent。
    try { acquireResult.release(); } catch { /* no-op */ }
  }
}

function resolveCursorForTile(cursor, tile, scrollingMode, cursorAlreadyAssigned) {
  if (!cursor || cursorAlreadyAssigned) {
    return null;
  }
  if (!scrollingMode) {
    return cursor;
  }
  if (typeof cursor.pageY !== 'number') {
    return null;
  }

  const tileTop = Number(tile.startY) || 0;
  const tileHeight = Number(tile.cssHeight) || 0;
  const tileBottom = tileTop + tileHeight;
  return cursor.pageY >= tileTop && cursor.pageY <= tileBottom ? cursor : null;
}

async function beginOffscreenCaptureSession(sessionId, sessionSecret, plan, tab, settings, part) {
  await ensureOffscreenDocument();

  const request = buildOffscreenMessage({
    type: MESSAGE_TYPES.BEGIN_CAPTURE_SESSION,
    sessionId,
    sessionSecret,
    meta: {
      plan,
      settings,
      url: tab.url,
      title: tab.title || '',
      part: part || null,
      // chrome.runtime.getManifest() は offscreen document では提供されない
      // (TypeError: not a function) ため、SW 側で解決して meta に積む。
      extensionVersion: chrome.runtime.getManifest().version,
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
    type: MESSAGE_TYPES.FINALIZE_CAPTURE_SESSION,
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
    const downloadId = await downloadCapture(downloadUrl, result.fileName);
    if (result.clipboardStatus === CLIPBOARD_STATUS.FAILED) {
      // offscreen 側で blob 生成段階のみで失敗したケース (clipboard.write は試行していない)。
      console.warn('EvidenceShot: clipboard prepare failed in offscreen', result.clipboardError);
    }
    return {
      ok: true,
      fileName: result.fileName,
      savedAsFormat: result.savedAsFormat,
      downloadStatus: 'started',
      clipboardStatus: result.clipboardStatus || CLIPBOARD_STATUS.DISABLED,
      clipboardError: result.clipboardError || null,
      // 'pending_in_content' のとき、SW (runCaptureWorkflow) が content script にコピー依頼するための URL。
      clipboardObjectUrl: result.clipboardObjectUrl || null,
      downloadId,
    };
  } catch (error) {
    await revokeOffscreenDownloadUrl(downloadUrl).catch(() => undefined);
    return {
      ok: false,
      error: normalizeUserMessage(
        error?.message,
        'errDownloadStartFailed',
        'ダウンロードの開始に失敗しました。'
      ),
    };
  }
  // Blob URL の revoke は downloads.onChanged で早期通知し、offscreen 側の 60 秒 timer を保険にする。
}

async function abortOffscreenCaptureSession(sessionId, sessionSecret) {
  await sendOffscreenMessageWithTimeout(buildOffscreenMessage({
    type: MESSAGE_TYPES.ABORT_CAPTURE_SESSION,
    sessionId,
    sessionSecret,
  })).catch(() => undefined);
}

async function revokeOffscreenDownloadUrl(downloadUrl) {
  if (typeof downloadUrl !== 'string' || !downloadUrl) {
    return;
  }
  await sendOffscreenMessageWithTimeout(buildOffscreenMessage({
    type: MESSAGE_TYPES.REVOKE_DOWNLOAD_URL,
    downloadUrl,
  }), 3_000).catch(() => undefined);
}

// offscreen のドキュメント URL に channelToken をクエリで埋め込み、
// offscreen 側は URL から直接 expectedChannelToken を読む（TOFU 廃止）。
function buildOffscreenDocumentUrl() {
  return `${OFFSCREEN_DOCUMENT_PATH}?token=${OFFSCREEN_CHANNEL_TOKEN}`;
}

function buildFullOffscreenDocumentUrl() {
  return chrome.runtime.getURL(buildOffscreenDocumentUrl());
}

async function ensureOffscreenDocument() {
  // 同時呼び出しの二重生成を防ぐため、最初に creatingOffscreenDocumentPromise を
  // **同期的に** チェック→セットする。await を挟むと両 awaiter が null チェックを
  // 通過して chrome.offscreen.createDocument が 2 回呼ばれるレースになる。
  if (!creatingOffscreenDocumentPromise) {
    creatingOffscreenDocumentPromise = (async () => {
      try {
        if (await isOffscreenDocumentCompatible()) {
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

        await createOffscreenDocument();
      } finally {
        // 完了後に null に戻すことで次回呼び出しが新規作成できるようにする。
        // await している awaiter は Promise の参照を持っているため、null 化しても解決は受け取れる。
        creatingOffscreenDocumentPromise = null;
      }
    })();
  }

  await creatingOffscreenDocumentPromise;
}

async function isOffscreenDocumentCompatible() {
  const fullUrl = buildFullOffscreenDocumentUrl();
  if ('getContexts' in chrome.runtime) {
    // documentUrls フィルタは完全一致なので、違うトークンで立ち上がった古い
    // offscreen は match しない → false → 作り直しに進む。
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [fullUrl],
    });

    if (contexts.length === 0) {
      return false;
    }
  } else {
    const clientsList = await clients.matchAll();
    const hasDocument = clientsList.some((client) => client.url === fullUrl);
    if (!hasDocument) {
      return false;
    }
  }

  return isCurrentOffscreenCompatible();
}

async function recreateOffscreenDocument() {
  if (!creatingOffscreenDocumentPromise) {
    creatingOffscreenDocumentPromise = (async () => {
      try {
        if ('closeDocument' in chrome.offscreen) {
          try {
            await chrome.offscreen.closeDocument();
          } catch (error) {
            if (!String(error?.message || '').includes('No document')) {
              console.warn('EvidenceShot: failed to recreate offscreen document:', error.message);
            }
          }
        }

        await createOffscreenDocument();
      } finally {
        creatingOffscreenDocumentPromise = null;
      }
    })();
  }

  await creatingOffscreenDocumentPromise;
}

async function createOffscreenDocument() {
  await chrome.offscreen.createDocument({
    url: buildOffscreenDocumentUrl(),
    reasons: ['BLOBS', 'CLIPBOARD'],
    justification: 'スクリーンショット画像を合成し、保存とクリップボードコピーを行うため',
  });

  await waitForOffscreenDocumentReady();
}

async function waitForOffscreenDocumentReady() {
  for (let attempt = 0; attempt < OFFSCREEN_READY_RETRY_COUNT; attempt += 1) {
    if (await isOffscreenDocumentCompatible()) {
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
      type: MESSAGE_TYPES.OFFSCREEN_PING,
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
  // hex 化は中間配列なしで連結 (Array.from + join より allocation が 1 つ少ない)。
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function ensureContentScriptOnTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES,
    });
  } catch (error) {
    // Chrome Web Store / chrome:// / view-source: などの特殊ページは scripting API で
    // inject 不可。代表的な英語メッセージ:
    //   "The extensions gallery cannot be scripted."
    //   "Cannot access contents of url ..."
    //   "Cannot access a chrome-extension:// URL"
    //   "Cannot access a chrome:// URL"
    //   "Missing host permission for the tab"
    // これらを normalizeUserMessage に通すと「撮影に失敗しました。」に丸められて
    // 真因が伝わらないため、ここで http/https 制限文言に統一して投げ直す。
    const msg = String(error?.message || '');
    if (
      msg.includes('cannot be scripted') ||
      msg.includes('Cannot access') ||
      msg.includes('Missing host permission')
    ) {
      throw new Error(t(
        'errPageNotCapturable',
        'このページでは撮影できません。http / https のページで試してください。'
      ));
    }
    throw error;
  }
}

// ショートカット経由限定。active タブの content script (focus 保有) に PNG blob URL を
// 渡してクリップボード書込を委譲する。popup 経由ではこの関数は呼ばれず、popup 自身が
// clipboard.write を実行する (popup が focus を奪うため content script では失敗するため)。
async function delegateClipboardCopyToContent(tabId, clipboardObjectUrl) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.CLIPBOARD_COPY_FROM_URL,
      payload: { url: clipboardObjectUrl },
    });
    if (response?.ok) {
      return { ok: true, clipboardStatus: response.clipboardStatus || CLIPBOARD_STATUS.COPIED };
    }
    return {
      ok: false,
      error: normalizeUserMessage(
        response?.error,
        'errClipboardWriteFailed',
        'クリップボードへのコピーに失敗しました。'
      ),
    };
  } catch (error) {
    // sendMessage 失敗 (タブ閉鎖、content script 不在 等) は SW コンソールへ原文を残す。
    console.warn('EvidenceShot: clipboard delegation failed', error?.message);
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

        trackDownloadUrl(downloadId, downloadUrl);
        resolve(downloadId);
      }
    );
  });
}

function trackDownloadUrl(downloadId, downloadUrl) {
  pendingDownloadUrls.set(downloadId, downloadUrl);
}

function revokePendingDownloadUrl(downloadId) {
  const downloadUrl = pendingDownloadUrls.get(downloadId);
  if (!downloadUrl) {
    return;
  }
  pendingDownloadUrls.delete(downloadId);
  revokeOffscreenDownloadUrl(downloadUrl).catch(() => undefined);
}
