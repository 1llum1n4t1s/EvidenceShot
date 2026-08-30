const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function runSource(context, relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  return vm.runInContext(source, context, { filename: relativePath });
}

function quietConsole() {
  return {
    debug() {},
    error() {},
    log() {},
    warn() {},
  };
}

function createMockEvent() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    emit(...args) {
      const results = [];
      for (const listener of listeners) {
        results.push(listener(...args));
      }
      return results;
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    get size() {
      return listeners.size;
    },
  };
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    clearTimeout(id) {
      timers.delete(id);
    },
    runNext() {
      const next = timers.entries().next();
      assert.equal(next.done, false, 'expected a pending timer');
      const [id, timer] = next.value;
      timers.delete(id);
      timer.callback();
    },
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    get size() {
      return timers.size;
    },
  };
}

function createBackgroundHarness() {
  const commandEvent = createMockEvent();
  const downloadsChanged = createMockEvent();
  const state = {
    composerResult: null,
    download(_options, callback) {
      callback(1);
      queueMicrotask(() => downloadsChanged.emit({ id: 1, state: { current: 'complete' } }));
    },
    downloadOptions: [],
    downloadStates: new Map(),
    history: [],
    messageListener: null,
    revokedUrls: [],
    commandEvent,
    downloadsChanged,
  };
  const chrome = {
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
    },
    downloads: {
      download(options, callback) {
        state.downloadOptions.push(options);
        state.download(options, callback);
      },
      onChanged: downloadsChanged,
      search(query, callback) {
        callback([{
          id: query.id,
          state: state.downloadStates.get(query.id) || 'in_progress',
        }]);
      },
    },
    commands: { onCommand: commandEvent },
    runtime: {
      getURL: (relativePath) => `chrome-extension://evidenceshot/${relativePath}`,
      id: 'evidenceshot',
      lastError: null,
      onMessage: {
        addListener(listener) {
          state.messageListener = listener;
        },
      },
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: structuredClone(state.history) };
        },
        async set(values) {
          if (Array.isArray(values.captureHistory)) {
            state.history = structuredClone(values.captureHistory);
          }
        },
      },
      session: {
        async remove() {},
      },
    },
  };
  const context = vm.createContext({
    Blob,
    URL,
    chrome,
    console: quietConsole(),
    crypto: webcrypto,
    importScripts() {},
    navigator: {},
    setTimeout,
    clearTimeout,
    structuredClone,
  });
  runSource(context, 'src/shared/constants.js');
  context.EvidenceShotShared = {
    normalizeUserMessage: (message, _key, fallback) => message || fallback,
    respondAsync(promise, sendResponse) {
      Promise.resolve(promise).then(sendResponse, (error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    },
    t: (_key, fallback) => fallback,
  };
  context.EvidenceShotComposer = {
    abort: async () => ({ ok: true }),
    addSlice: async () => ({ ok: true }),
    begin: async () => ({ ok: true }),
    finalize: async () => state.composerResult,
    purgeAllSessions: async () => {},
    async revokeDownloadUrl(url) {
      state.revokedUrls.push(url);
    },
  };
  runSource(context, 'src/background/background.js');
  return { chrome, context, state };
}

test('download completion is part of the capture success contract', async () => {
  const { chrome, context, state } = createBackgroundHarness();
  state.composerResult = {
    ok: true,
    downloadUrl: 'blob:download',
    clipboardObjectUrl: 'blob:clipboard',
    clipboardStatus: 'pending_in_content',
    fileName: 'evidence.png',
    savedAsFormat: 'png',
  };
  state.download = (_options, callback) => {
    chrome.runtime.lastError = { message: 'download rejected' };
    callback(undefined);
    chrome.runtime.lastError = null;
  };

  const failed = await vm.runInContext(
    "finalizeComposerCaptureSession('session', 'secret')",
    context
  );
  assert.equal(failed.ok, false);
  assert.match(failed.error, /download rejected/);
  assert.deepEqual(state.revokedUrls.sort(), ['blob:clipboard', 'blob:download']);

  state.revokedUrls.length = 0;
  state.download = (_options, callback) => {
    callback(42);
    queueMicrotask(() => state.downloadsChanged.emit({ id: 42, state: { current: 'complete' } }));
  };
  const succeeded = await vm.runInContext(
    "finalizeComposerCaptureSession('session', 'secret')",
    context
  );
  assert.equal(succeeded.ok, true);
  assert.equal(succeeded.downloadId, 42);
  assert.equal(state.downloadOptions.at(-1).filename, 'evidence.png');
  assert.deepEqual(state.revokedUrls, ['blob:download']);

  state.revokedUrls.length = 0;
  state.download = (_options, callback) => {
    callback(43);
    queueMicrotask(() => state.downloadsChanged.emit({ id: 43, state: { current: 'interrupted' } }));
  };
  const interrupted = await vm.runInContext(
    "finalizeComposerCaptureSession('session', 'secret')",
    context
  );
  assert.equal(interrupted.ok, false);
  assert.match(interrupted.error, /中断/);
  assert.deepEqual(state.revokedUrls.sort(), ['blob:clipboard', 'blob:download']);

  state.revokedUrls.length = 0;
  state.download = (_options, callback) => {
    state.downloadStates.set(44, 'complete');
    state.downloadsChanged.emit({ id: 44, state: { current: 'complete' } });
    callback(44);
  };
  const alreadyComplete = await vm.runInContext(
    "finalizeComposerCaptureSession('session', 'secret')",
    context
  );
  assert.equal(alreadyComplete.ok, true, alreadyComplete.error);
  assert.equal(alreadyComplete.downloadId, 44);
  assert.deepEqual(state.revokedUrls, ['blob:download']);
});

test('shortcut command listener returns the capture promise', async () => {
  const { context, state } = createBackgroundHarness();
  vm.runInContext(
    `let resolveTestCommand;
     const testCommandPromise = new Promise((resolve) => { resolveTestCommand = resolve; });
     captureActiveTabFromCommand = () => testCommandPromise;`,
    context
  );

  const [listenerResult] = state.commandEvent.emit('capture-active-tab', { id: 10 });
  assert.equal(typeof listenerResult?.then, 'function');
  let settled = false;
  listenerResult.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);

  vm.runInContext('resolveTestCommand()', context);
  await listenerResult;
  assert.equal(settled, true);
});

test('capture history keeps the download id and receives the final clipboard result', async () => {
  const { chrome, context, state } = createBackgroundHarness();
  vm.runInContext(
    `runCaptureWorkflow = async () => ({
      ok: true,
      fileName: 'evidence.png',
      savedAsFormat: 'png',
      partCount: 1,
      downloadStatus: 'complete',
      clipboardStatus: CLIPBOARD_STATUS.PENDING_IN_CONTENT,
      clipboardError: null,
      downloadId: 73,
      downloadIds: [73]
    });`,
    context
  );

  const result = await vm.runInContext('runCaptureWorkflowWithHistory(10)', context);
  assert.match(result.historyId, /^[0-9a-f]{24}$/);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].downloadId, 73);
  assert.deepEqual(state.history[0].downloadIds, [73]);
  assert.equal(state.history[0].clipboardStatus, 'pending_in_content');

  const response = await new Promise((resolve) => {
    const keepChannelOpen = state.messageListener(
      {
        type: context.EvidenceShotConstants.MESSAGE_TYPES.UPDATE_CAPTURE_HISTORY_FROM_POPUP,
        payload: {
          historyId: result.historyId,
          clipboardStatus: 'copied',
          clipboardError: null,
        },
      },
      {
        id: chrome.runtime.id,
        url: chrome.runtime.getURL('src/popup/popup.html'),
      },
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.updated, true);
  assert.equal(state.history[0].clipboardStatus, 'copied');
  assert.equal(state.history[0].clipboardError, null);
});

test('history append and asynchronous clipboard patch are serialized', async () => {
  const { context, state } = createBackgroundHarness();
  const updated = await vm.runInContext(
    `Promise.all([
      appendCaptureHistory({
        historyId: '1234567890abcdef12345678',
        at: 100,
        clipboardStatus: CLIPBOARD_STATUS.PENDING_IN_CONTENT
      }),
      updateCaptureHistoryClipboardResult(
        '1234567890abcdef12345678',
        CLIPBOARD_STATUS.FAILED,
        'clipboard denied'
      )
    ]).then((results) => results[1])`,
    context
  );
  assert.equal(updated, true);
  assert.equal(state.history[0].clipboardStatus, 'failed');
  assert.equal(state.history[0].clipboardError, 'clipboard denied');
});

test('tab activity guard latches a transient switch even after returning to the target tab', async () => {
  const { chrome, context } = createBackgroundHarness();
  const onActivated = createMockEvent();
  const onDetached = createMockEvent();
  const onRemoved = createMockEvent();
  const targetTab = {
    active: true,
    id: 10,
    url: 'https://example.com/evidence?first=1#top',
    windowId: 20,
  };
  chrome.tabs = {
    get: async () => ({ ...targetTab }),
    onActivated,
    onDetached,
    onRemoved,
    query: async () => [{ ...targetTab }],
  };

  context.testActivityGuard = vm.runInContext(
    'createTargetTabActivityGuard(10, 20)',
    context
  );
  await vm.runInContext(
    "ensureTargetTabStillActive(10, 20, testActivityGuard, 'https://example.com/evidence')",
    context
  );

  targetTab.url = 'https://example.com/evidence?second=2#details';
  await vm.runInContext(
    "ensureTargetTabStillActive(10, 20, testActivityGuard, 'https://example.com/evidence')",
    context
  );

  targetTab.url = 'https://example.com/other';
  await assert.rejects(
    vm.runInContext(
      "ensureTargetTabStillActive(10, 20, testActivityGuard, 'https://example.com/evidence')",
      context
    ),
    /ページ/
  );
  targetTab.url = 'https://example.com/evidence?returned=1';

  onActivated.emit({ tabId: 11, windowId: 20 });
  onActivated.emit({ tabId: 10, windowId: 20 });
  await assert.rejects(
    vm.runInContext(
      "ensureTargetTabStillActive(10, 20, testActivityGuard, 'https://example.com/evidence')",
      context
    ),
    /別タブ/
  );

  context.testActivityGuard.dispose();
  context.testActivityGuard.dispose();
  assert.equal(onActivated.size, 0);
  assert.equal(onDetached.size, 0);
  assert.equal(onRemoved.size, 0);
});

test('capture rate-limit wait happens before the next capture step settles', async () => {
  const { chrome, context } = createBackgroundHarness();
  /** @type {string[]} */
  const events = [];
  let now = 1_000;
  context.Date = class extends Date {
    static now() {
      return now;
    }
  };
  context.EvidenceShotShared.isCapturableUrl = () => true;
  context.EvidenceShotShared.loadSettings = async () => ({
    copyToClipboard: false,
    format: 'png',
  });
  context.EvidenceShotShared.sleep = async (milliseconds) => {
    events.push(`sleep:${milliseconds}`);
    now += milliseconds;
  };
  Object.assign(chrome.runtime, {
    getManifest: () => ({ version: '1.0.0' }),
  });
  Object.assign(chrome, { tabs: {
    async captureVisibleTab() {
      events.push('capture');
      return 'data:image/png;base64,AA==';
    },
    async get() {
      return {
        active: true,
        id: 10,
        title: 'fixture',
        url: 'https://example.com/evidence',
        windowId: 20,
      };
    },
    async sendMessage(_tabId, message) {
      const types = context.EvidenceShotConstants.MESSAGE_TYPES;
      if (message.type === types.CAPTURE_PREPARE_V2) {
        return {
          ok: true,
          plan: {
            canvasHeight: 1_000,
            positions: [0, 400],
            url: 'https://example.com/evidence',
          },
        };
      }
      if (message.type === types.CAPTURE_STEP_V2) {
        events.push(`step:${message.payload.index}`);
        return { ok: true, scrollY: message.payload.index * 400 };
      }
      if (message.type === types.CAPTURE_RESTORE_V2) {
        events.push('restore');
        return { ok: true };
      }
      throw new Error(`unexpected message: ${message.type}`);
    },
  } });
  vm.runInContext(
    `tryAcquireCaptureSlot = async () => ({ ok: true, release() {} });
     createTargetTabActivityGuard = () => ({ dispose() {} });
     ensureContentScriptOnTab = async () => {};
     ensureTargetTabStillActive = async () => {};
     finalizeComposerCaptureSession = async () => ({
       ok: true,
       fileName: 'evidence.png',
       clipboardStatus: CLIPBOARD_STATUS.DISABLED,
       downloadId: 1
     });`,
    context
  );

  const result = await vm.runInContext('runCaptureWorkflow(10)', context);

  assert.equal(result.ok, true, result.error);
  assert.deepEqual(events, [
    'step:0',
    'capture',
    'sleep:520',
    'step:1',
    'capture',
    'restore',
  ]);
});

/** @param {any} [options] */
function createCaptureHarness(options = {}) {
  const pageHeight = options.pageHeight ?? 600;
  const timers = createFakeTimers();
  const state = { messageListener: null, removedElements: 0 };
  class HarnessElement {}
  const mainColumnElement = options.mainColumnRect
    ? Object.assign(new HarnessElement(), {
        className: 'main-content',
        getAttribute: () => null,
        getBoundingClientRect: () => ({ ...options.mainColumnRect }),
        id: 'main-content',
        scrollHeight: options.mainColumnRect.height,
        tagName: 'MAIN',
      })
    : null;
  const runtime = {
    id: 'evidenceshot',
    onMessage: {
      addListener(listener) {
        state.messageListener = listener;
      },
      removeListener() {},
    },
  };
  const windowObject = {
    devicePixelRatio: 1,
    innerHeight: 600,
    innerWidth: 800,
    NodeFilter: { SHOW_ELEMENT: 1 },
    scrollX: options.initialScrollX ?? 0,
    scrollY: options.initialScrollY ?? 0,
    scrollTo({ left, top }) {
      this.scrollX = left;
      if (!options.preventScroll) {
        this.scrollY = top;
      }
    },
    getComputedStyle() {
      return { display: 'block', position: 'static', visibility: 'visible' };
    },
  };
  const documentElement = {
    appendChild() {},
    clientHeight: 600,
    offsetHeight: pageHeight,
    scrollHeight: pageHeight,
  };
  const body = {
    clientHeight: 600,
    offsetHeight: pageHeight,
    scrollHeight: pageHeight,
  };
  const context = vm.createContext({
    Blob,
    chrome: { runtime },
    console: quietConsole(),
    Element: HarnessElement,
    document: {
      body,
      createElement() {
        return {
          dataset: {},
          remove() { state.removedElements += 1; },
          textContent: '',
        };
      },
      createTreeWalker() {
        return { nextNode: () => null };
      },
      documentElement,
      querySelectorAll() {
        return mainColumnElement ? [mainColumnElement] : [];
      },
      title: 'fixture',
    },
    location: { href: 'https://example.com/' },
    navigator: {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    window: windowObject,
  });
  runSource(context, 'src/shared/constants.js');
  context.EvidenceShotShared = {
    clampNumber(value, min, max, fallback) {
      const numeric = Number(value);
      return Number.isFinite(numeric)
        ? Math.min(max, Math.max(min, numeric))
        : fallback;
    },
    normalizeSettings: (settings) => settings,
    normalizeUserMessage: (message, _key, fallback) => message || fallback,
    respondAsync(promise, sendResponse) {
      Promise.resolve(promise).then(sendResponse, (error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    },
    sleep: async () => {
      if (typeof options.onSleep === 'function') {
        await options.onSleep(windowObject);
      } else {
        windowObject.innerWidth += 1;
      }
    },
    t: (_key, fallback) => fallback,
    waitFrames: async () => {},
  };
  runSource(context, 'src/content/capture.js');
  /** @returns {Promise<any>} */
  async function sendMessage(message) {
    return new Promise((resolve) => {
      if (typeof state.messageListener !== 'function') {
        throw new Error('capture message listener is not installed');
      }
      const keepChannelOpen = state.messageListener(
        message,
        { id: runtime.id },
        resolve
      );
      assert.equal(keepChannelOpen, true);
    });
  }
  return { context, sendMessage, state, timers, windowObject };
}

test('viewport resize during settle aborts before a slice is captured', async () => {
  const { context, sendMessage } = createCaptureHarness();
  const prepared = await sendMessage({
    type: context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_PREPARE_V2,
    payload: { sessionId: 'session', settings: { captureMode: 'viewport' } },
  });
  assert.equal(prepared.ok, true, prepared.error);

  const moved = await sendMessage({
    type: context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_STEP_V2,
    payload: { sessionId: 'session', index: 0 },
  });
  assert.equal(moved.ok, false);
  assert.match(moved.error, /表示領域/);
  assert.equal(context.__evidenceShotCaptureControllerV2.version, 15);
});

test('capture modes keep the intended horizontal origin', async () => {
  const viewport = createCaptureHarness({
    initialScrollX: 125,
    initialScrollY: 80,
    onSleep: async () => {},
  });
  const viewportPrepared = await viewport.sendMessage({
    type: viewport.context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_PREPARE_V2,
    payload: { sessionId: 'viewport', settings: { captureMode: 'viewport' } },
  });
  assert.equal(viewportPrepared.ok, true, viewportPrepared.error);
  const viewportMoved = await viewport.sendMessage({
    type: viewport.context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_STEP_V2,
    payload: { sessionId: 'viewport', index: 0 },
  });
  assert.equal(viewportMoved.ok, true, viewportMoved.error);
  assert.equal(viewport.windowObject.scrollX, 125);

  const mainColumn = createCaptureHarness({
    initialScrollX: 75,
    mainColumnRect: {
      bottom: 600,
      height: 600,
      left: 100,
      right: 700,
      top: 0,
      width: 600,
    },
    onSleep: async () => {},
  });
  const mainColumnPrepared = await mainColumn.sendMessage({
    type: mainColumn.context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_PREPARE_V2,
    payload: { sessionId: 'main-column', settings: { captureMode: 'mainColumn' } },
  });
  assert.equal(mainColumnPrepared.ok, true, mainColumnPrepared.error);
  assert.equal(mainColumnPrepared.plan.captureMode, 'mainColumn');
  const mainColumnMoved = await mainColumn.sendMessage({
    type: mainColumn.context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_STEP_V2,
    payload: { sessionId: 'main-column', index: 0 },
  });
  assert.equal(mainColumnMoved.ok, true, mainColumnMoved.error);
  assert.equal(mainColumn.windowObject.scrollX, 75);

  const fullPage = createCaptureHarness({
    initialScrollX: 50,
    onSleep: async () => {},
    pageHeight: 1_200,
  });
  const fullPagePrepared = await fullPage.sendMessage({
    type: fullPage.context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_PREPARE_V2,
    payload: { sessionId: 'full-page', settings: { captureMode: 'fullPage' } },
  });
  assert.equal(fullPagePrepared.ok, true, fullPagePrepared.error);
  const fullPageMoved = await fullPage.sendMessage({
    type: fullPage.context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_STEP_V2,
    payload: { sessionId: 'full-page', index: 0 },
  });
  assert.equal(fullPageMoved.ok, true, fullPageMoved.error);
  assert.equal(fullPage.windowObject.scrollX, 0);
});

test('content capture watchdog restores page state and allows a new session', async () => {
  const { context, sendMessage, state, timers, windowObject } = createCaptureHarness({
    initialScrollX: 12,
    initialScrollY: 120,
    onSleep: async () => {},
  });
  const prepared = await sendMessage({
    type: context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_PREPARE_V2,
    payload: { sessionId: 'orphaned', settings: { captureMode: 'viewport' } },
  });
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(timers.size, 1);

  windowObject.scrollTo({ left: 0, top: 480 });
  timers.runNext();
  assert.equal(windowObject.scrollX, 12);
  assert.equal(windowObject.scrollY, 120);
  assert.equal(state.removedElements, 1);
  assert.equal(timers.size, 0);

  const preparedAgain = await sendMessage({
    type: context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_PREPARE_V2,
    payload: { sessionId: 'replacement', settings: { captureMode: 'viewport' } },
  });
  assert.equal(preparedAgain.ok, true, preparedAgain.error);
  assert.equal(timers.size, 1);

  context.__evidenceShotCaptureControllerV2.dispose();
  assert.equal(timers.size, 0);
  assert.equal(state.removedElements, 2);
});

test('a stalled full-page scroll fails instead of finalizing a truncated capture', async () => {
  const { context, sendMessage } = createCaptureHarness({
    onSleep: async () => {},
    pageHeight: 1800,
    preventScroll: true,
  });
  const prepared = await sendMessage({
    type: context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_PREPARE_V2,
    payload: { sessionId: 'session', settings: { captureMode: 'fullPage' } },
  });
  assert.equal(prepared.ok, true, prepared.error);
  assert.ok(prepared.plan.positions.length > 1);

  const firstStep = await sendMessage({
    type: context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_STEP_V2,
    payload: { sessionId: 'session', index: 0 },
  });
  assert.equal(firstStep.ok, true);

  const stalledStep = await sendMessage({
    type: context.EvidenceShotConstants.MESSAGE_TYPES.CAPTURE_STEP_V2,
    payload: { sessionId: 'session', index: 1 },
  });
  assert.equal(stalledStep.ok, false);
  assert.match(stalledStep.error, /スクロール/);
  assert.equal('done' in stalledStep, false);
});

function createComposerHarness() {
  const timers = createFakeTimers();
  const state = {
    bitmap: null,
    canvasCount: 0,
    canvases: [],
    contextLost: false,
    drawCount: 0,
    drawCalls: [],
    drawWidths: [],
    failTrimDraw: false,
    stampError: null,
    trimBitmap: null,
    trimBitmapError: null,
    revokedUrls: [],
  };
  class HarnessURL extends URL {}
  let nextObjectUrl = 1;
  HarnessURL.createObjectURL = () => `blob:harness-${nextObjectUrl++}`;
  HarnessURL.revokeObjectURL = (url) => { state.revokedUrls.push(url); };
  const context = vm.createContext({
    Blob,
    TextEncoder,
    URL: HarnessURL,
    console: quietConsole(),
    createImageBitmap: async (source) => {
      if (source instanceof Blob) {
        return state.bitmap;
      }
      if (state.trimBitmapError) {
        throw state.trimBitmapError;
      }
      return state.trimBitmap;
    },
    document: {
      createElement(tagName) {
        assert.equal(tagName, 'canvas');
        state.canvasCount += 1;
        const canvasNumber = state.canvasCount;
        const canvas = {
          height: 0,
          width: 0,
          getContext() {
            return {
              drawImage(...args) {
                state.drawCount += 1;
                state.drawCalls.push(args);
                state.drawWidths.push(canvas.width);
                if (state.failTrimDraw && canvasNumber > 1) {
                  throw new Error('trim draw failed');
                }
              },
              fillRect() {},
              fillStyle: '',
              isContextLost: () => state.contextLost,
            };
          },
          toBlob(callback, type) {
            callback(new Blob(['image'], { type: type || 'image/png' }));
          },
        };
        state.canvases.push(canvas);
        return canvas;
      },
      fonts: { load: async () => {} },
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  runSource(context, 'src/shared/constants.js');
  context.EvidenceShotShared = {
    buildFileName: () => 'evidence.jpg',
    normalizeUserMessage: (message, _key, fallback) => message || fallback,
    t: (_key, fallback) => fallback,
  };
  context.EvidenceShotStampRenderer = {
    drawFooterLabel() {
      if (state.stampError) throw state.stampError;
    },
    drawTimestamp() {
      if (state.stampError) throw state.stampError;
    },
  };
  runSource(context, 'src/shared/composer.js');
  return { context, state, timers };
}

test('canvas edge and captured bitmap dimensions are validated', async () => {
  const { context, state } = createComposerHarness();
  assert.equal(context.EvidenceShotConstants.MAX_CANVAS_EDGE, 32767);

  const oversized = await vm.runInContext(
    `EvidenceShotComposer.begin('oversized', '${'a'.repeat(24)}', {
      plan: {
        canvasWidth: 800,
        canvasHeight: 32768,
        devicePixelRatio: 1
      },
      settings: {}
    })`,
    context
  );
  assert.equal(oversized.ok, false);
  assert.equal(state.canvasCount, 0);

  const secret = 'b'.repeat(24);
  const begun = await vm.runInContext(
    `EvidenceShotComposer.begin('valid', '${secret}', {
      plan: {
        canvasWidth: 800,
        canvasHeight: 600,
        viewportWidth: 800,
        viewportHeight: 600,
        cropWidth: 800,
        cropHeight: 600,
        cropX: 0,
        cropY: 0,
        devicePixelRatio: 1,
        scrollingMode: false
      },
      settings: {}
    })`,
    context
  );
  assert.equal(begun.ok, true);

  let bitmapClosed = false;
  state.bitmap = {
    close() {
      bitmapClosed = true;
    },
    height: 600,
    width: 900,
  };
  context.testBlob = new Blob(['slice'], { type: 'image/png' });
  const added = await vm.runInContext(
    `EvidenceShotComposer.addSlice('valid', '${secret}', {
      blob: testBlob,
      scrollY: 0
    })`,
    context
  );
  assert.equal(added.ok, false);
  assert.match(added.error, /表示領域/);
  assert.equal(bitmapClosed, true);
  assert.equal(state.drawCount, 0);
});

test('fractional DPR crop uses the same edge-rounded width for canvas and draw', async () => {
  const { context, state } = createComposerHarness();
  const secret = 'e'.repeat(24);
  const begun = await vm.runInContext(
    `EvidenceShotComposer.begin('fractional-crop', '${secret}', {
      plan: {
        canvasWidth: 281,
        canvasHeight: 600,
        viewportWidth: 400,
        viewportHeight: 600,
        cropWidth: 281,
        cropHeight: 600,
        cropX: 1,
        cropY: 0,
        devicePixelRatio: 1.25,
        scrollingMode: false
      },
      settings: {}
    })`,
    context
  );
  assert.equal(begun.ok, true, begun.error);
  assert.equal(state.canvases[0].width, 352);

  state.bitmap = { close() {}, height: 750, width: 500 };
  context.testBlob = new Blob(['slice'], { type: 'image/png' });
  const added = await vm.runInContext(
    `EvidenceShotComposer.addSlice('fractional-crop', '${secret}', {
      blob: testBlob,
      scrollY: 0
    })`,
    context
  );
  assert.equal(added.ok, true, added.error);
  const draw = state.drawCalls.at(-1);
  assert.equal(draw[3], 352);
  assert.equal(draw[7], 352);
  assert.equal(draw[3], draw[7]);
  vm.runInContext(`EvidenceShotComposer.abort('fractional-crop', '${secret}')`, context);
});

test('composer watchdog releases an orphaned canvas session', async () => {
  const { context, state, timers } = createComposerHarness();
  const secret = 'f'.repeat(24);
  const begun = vm.runInContext(
    `EvidenceShotComposer.begin('orphaned-composer', '${secret}', {
      plan: {
        canvasWidth: 800,
        canvasHeight: 600,
        cropX: 0,
        devicePixelRatio: 1
      },
      settings: {}
    })`,
    context
  );
  assert.equal(begun.ok, true, begun.error);
  assert.equal(timers.size, 1);
  const sessionCanvas = state.canvases[0];

  timers.runNext();
  assert.equal(sessionCanvas.width, 1);
  assert.equal(sessionCanvas.height, 1);
  assert.equal(timers.size, 0);

  const missing = await vm.runInContext(
    `EvidenceShotComposer.addSlice('orphaned-composer', '${secret}', {
      blob: new Blob(['slice']),
      scrollY: 0
    })`,
    context
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /見つかりません/);
});

test('purging an orphaned session does not revoke finalized download URLs', async () => {
  const { context, state, timers } = createComposerHarness();
  const secret = 'g'.repeat(24);
  const beginSource = (sessionId) => `EvidenceShotComposer.begin('${sessionId}', '${secret}', {
    plan: {
      canvasWidth: 800,
      canvasHeight: 600,
      cropX: 0,
      devicePixelRatio: 1
    },
    settings: {
      copyToClipboard: false,
      footerText: '',
      format: 'jpeg',
      timestampEnabled: false
    }
  })`;

  assert.equal(vm.runInContext(beginSource('download-source'), context).ok, true);
  const finalized = await vm.runInContext(
    `EvidenceShotComposer.finalize('download-source', '${secret}')`,
    context
  );
  assert.equal(finalized.ok, true, finalized.error);
  assert.equal(timers.size, 1);

  assert.equal(vm.runInContext(beginSource('orphaned'), context).ok, true);
  const orphanedCanvas = state.canvases.at(-1);
  assert.equal(timers.size, 2);
  assert.equal(vm.runInContext(beginSource('replacement'), context).ok, true);
  assert.equal(orphanedCanvas.width, 1);
  assert.deepEqual(state.revokedUrls, []);
  assert.equal(timers.size, 2);

  vm.runInContext(`EvidenceShotComposer.abort('replacement', '${secret}')`, context);
  vm.runInContext(`EvidenceShotComposer.revokeDownloadUrl('${finalized.downloadUrl}')`, context);
  assert.deepEqual(state.revokedUrls, [finalized.downloadUrl]);
  assert.equal(timers.size, 0);
});

test('finalize releases the session canvas when stamp rendering fails', async () => {
  const { context, state } = createComposerHarness();
  const secret = 'c'.repeat(24);
  const begun = await vm.runInContext(
    `EvidenceShotComposer.begin('stamp-failure', '${secret}', {
      plan: {
        canvasWidth: 800,
        canvasHeight: 600,
        viewportWidth: 800,
        viewportHeight: 600,
        cropWidth: 800,
        cropHeight: 600,
        cropX: 0,
        cropY: 0,
        devicePixelRatio: 1,
        scrollingMode: false
      },
      settings: {
        copyToClipboard: false,
        footerText: '',
        format: 'png',
        timestampEnabled: true
      }
    })`,
    context
  );
  assert.equal(begun.ok, true);
  const sessionCanvas = state.canvases[0];
  assert.equal(sessionCanvas.width, 800);
  assert.equal(sessionCanvas.height, 600);

  state.stampError = new Error('stamp failed');
  const finalized = await vm.runInContext(
    `EvidenceShotComposer.finalize('stamp-failure', '${secret}')`,
    context
  );
  assert.equal(finalized.ok, false);
  assert.match(finalized.error, /stamp failed/);
  assert.equal(sessionCanvas.width, 1);
  assert.equal(sessionCanvas.height, 1);
});

test('trim failure preserves canvas width and releases both canvases and the source bitmap', async () => {
  const { context, state } = createComposerHarness();
  const secret = 'd'.repeat(24);
  const begun = await vm.runInContext(
    `EvidenceShotComposer.begin('trim-failure', '${secret}', {
      plan: {
        canvasWidth: 800,
        canvasHeight: 1000,
        viewportWidth: 800,
        viewportHeight: 600,
        cropWidth: 800,
        cropHeight: 600,
        cropX: 0,
        cropY: 0,
        devicePixelRatio: 1,
        scrollingMode: true
      },
      settings: {
        copyToClipboard: false,
        footerText: '',
        format: 'png',
        timestampEnabled: false
      }
    })`,
    context
  );
  assert.equal(begun.ok, true);

  state.bitmap = { close() {}, height: 600, width: 800 };
  context.testBlob = new Blob(['slice'], { type: 'image/png' });
  const added = await vm.runInContext(
    `EvidenceShotComposer.addSlice('trim-failure', '${secret}', {
      blob: testBlob,
      scrollY: 0
    })`,
    context
  );
  assert.equal(added.ok, true);

  let sourceBitmapClosed = false;
  state.trimBitmap = {
    close() {
      sourceBitmapClosed = true;
    },
  };
  state.failTrimDraw = true;
  const finalized = await vm.runInContext(
    `EvidenceShotComposer.finalize('trim-failure', '${secret}')`,
    context
  );
  assert.equal(finalized.ok, false);
  assert.match(finalized.error, /trim draw failed/);
  assert.equal(state.drawWidths.at(-1), 800);
  assert.equal(sourceBitmapClosed, true);
  assert.equal(state.canvases.length, 2);
  for (const canvas of state.canvases) {
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
  }
});
