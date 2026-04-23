(function initializeCaptureController() {
  const CONTROLLER_KEY = '__evidenceShotCaptureControllerV2';
  const CONTROLLER_VERSION = 2;

  if (globalThis[CONTROLLER_KEY]?.version === CONTROLLER_VERSION) {
    return;
  }

  const previousController = globalThis[CONTROLLER_KEY];
  previousController?.dispose?.();

  const Shared = globalThis.WebTestShotShared;
  const t = Shared.t;
  const normalizeUserMessage = Shared.normalizeUserMessage;
  const Constants = globalThis.WebTestShotConstants;
  const state = {
    captureSession: null,
  };
  const MAX_MAIN_COLUMN_SCAN_NODES = 1800;
  const MAX_FIXED_SCAN_NODES = 2200;
  const MAX_FIXED_ELEMENTS = 120;

  const messageHandler = (message) => {
    if (!message?.type) {
      return undefined;
    }

    switch (message.type) {
      case 'WTS_CAPTURE_PREPARE_V2':
        return prepareCapture(message.payload?.sessionId, message.payload?.settings);
      case 'WTS_CAPTURE_STEP_V2':
        return moveToCaptureStep(message.payload?.sessionId, message.payload?.index);
      case 'WTS_CAPTURE_RESTORE_V2':
        restoreCaptureState(message.payload?.sessionId);
        return { ok: true };
      default:
        return undefined;
    }
  };

  chrome.runtime.onMessage.addListener(messageHandler);

  globalThis[CONTROLLER_KEY] = {
    version: CONTROLLER_VERSION,
    dispose() {
      chrome.runtime.onMessage.removeListener(messageHandler);
      restoreCaptureState(state.captureSession?.sessionId);
    },
  };

  async function prepareCapture(sessionId, settings) {
    if (!sessionId) {
      return { ok: false, error: t('errCaptureSessionIdMissing', '撮影セッションIDがありません。') };
    }

    if (state.captureSession) {
      return { ok: false, error: t('errTabAlreadyCapturing', 'このページではすでに撮影中です。') };
    }

    const normalizedSettings = Shared.normalizeSettings(settings || {});

    try {
      const plan = buildCapturePlan(normalizedSettings.captureMode);
      state.captureSession = {
        sessionId,
        settings: normalizedSettings,
        initialScrollX: window.scrollX,
        initialScrollY: window.scrollY,
        plan,
        positions: plan.positions,
        fixedElements: plan.scrollingMode ? collectFixedElements() : [],
        styleElement: installCaptureStyle(),
        lastCapturedScrollY: null,
      };

      await Shared.waitFrames(2);
      return { ok: true, plan };
    } catch (error) {
      restoreCaptureState(sessionId);
      return {
        ok: false,
        error: normalizeUserMessage(
          error?.message,
          'errCapturePrepareFailed',
          '撮影の準備に失敗しました。'
        ),
      };
    }
  }

  async function moveToCaptureStep(sessionId, index) {
    if (!state.captureSession || state.captureSession.sessionId !== sessionId) {
      return { ok: false, error: t('errCaptureSessionMismatch', '撮影セッションが一致しません。') };
    }

    const targetY = state.captureSession.positions[index];
    if (typeof targetY !== 'number') {
      return { ok: false, error: t('errCaptureStepInvalid', '無効な撮影位置です。') };
    }

    toggleFixedElements(index > 0);
    window.scrollTo({
      top: targetY,
      left: 0,
      behavior: 'auto',
    });

    await Shared.waitFrames(2);
    await Shared.sleep(Constants.CAPTURE_SETTLE_MS);
    await Shared.waitFrames(1);

    const currentScrollY = Math.round(window.scrollY);
    if (
      state.captureSession.plan.scrollingMode &&
      index > 0 &&
      state.captureSession.lastCapturedScrollY !== null &&
      currentScrollY <= state.captureSession.lastCapturedScrollY + 2
    ) {
      return {
        ok: true,
        done: true,
      };
    }

    state.captureSession.lastCapturedScrollY = currentScrollY;
    return {
      ok: true,
      scrollY: currentScrollY,
    };
  }

  function restoreCaptureState(sessionId) {
    if (!state.captureSession) {
      return;
    }

    if (sessionId && state.captureSession.sessionId !== sessionId) {
      return;
    }

    toggleFixedElements(false);
    state.captureSession.styleElement?.remove();
    window.scrollTo({
      top: state.captureSession.initialScrollY,
      left: state.captureSession.initialScrollX,
      behavior: 'auto',
    });
    state.captureSession = null;
  }

  function buildCapturePlan(captureMode) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const pageHeight = getDocumentHeight();
    const maxScrollY = Math.max(0, pageHeight - viewportHeight);
    const dpr = window.devicePixelRatio || 1;
    const scrollingMode = captureMode !== 'viewport';
    const overlap = scrollingMode ? Math.min(200, Math.max(96, Math.round(viewportHeight * 0.12))) : 0;
    const stride = Math.max(1, viewportHeight - overlap);
    const maxCanvasCssEdge = Math.max(1, Math.floor(Constants.MAX_CANVAS_EDGE / Math.max(dpr, 1)));
    const cropRect = captureMode === 'mainColumn'
      ? detectMainColumnCropRect(viewportWidth, viewportHeight)
      : {
          x: 0,
          y: 0,
          width: viewportWidth,
          height: viewportHeight,
          resolvedMode: captureMode,
        };
    const positions = [];

    if (scrollingMode && pageHeight > maxCanvasCssEdge) {
      throw new Error(t('errPageTooLongSingleImage', 'ページが長すぎるため、1枚の画像として保存できませんでした。'));
    }

    if (scrollingMode) {
      for (let scrollY = 0; scrollY < maxScrollY; scrollY += stride) {
        positions.push(scrollY);
      }

      if (positions.length === 0 || positions[positions.length - 1] !== maxScrollY) {
        positions.push(maxScrollY);
      }
    } else {
      positions.push(window.scrollY);
    }

    const uniquePositions = positions.filter(
      (value, positionIndex) => positionIndex === 0 || value !== positions[positionIndex - 1]
    );

    return {
      captureMode: cropRect.resolvedMode,
      scrollingMode,
      positions: uniquePositions,
      viewportWidth,
      viewportHeight,
      canvasWidth: cropRect.width,
      canvasHeight: scrollingMode ? pageHeight : cropRect.height,
      devicePixelRatio: dpr,
      pageHeight: scrollingMode ? pageHeight : cropRect.height,
      cropX: cropRect.x,
      cropY: cropRect.y,
      cropWidth: cropRect.width,
      cropHeight: cropRect.height,
      url: location.href,
      title: document.title,
    };
  }

  function detectMainColumnCropRect(viewportWidth, viewportHeight) {
    const candidates = [];
    const seenElements = new Set();
    const selectorCandidates = [
      'main',
      '[role="main"]',
      '#main-content',
      '[data-testid="main-content"]',
      '[data-testid="main"]',
      'article',
      '[role="feed"]',
    ];

    selectorCandidates.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        pushCandidate(element);
      });
    });

    let bestCandidate = getBestCandidate();
    if (!bestCandidate) {
      const walker = document.createTreeWalker(
        document.body || document.documentElement,
        window.NodeFilter.SHOW_ELEMENT
      );
      let currentNode = walker.currentNode;
      let scannedNodes = 0;

      while (currentNode && scannedNodes < MAX_MAIN_COLUMN_SCAN_NODES) {
        pushCandidate(currentNode);
        currentNode = walker.nextNode();
        scannedNodes += 1;
      }

      bestCandidate = getBestCandidate();
    }

    if (!bestCandidate) {
      return {
        x: 0,
        y: 0,
        width: viewportWidth,
        height: viewportHeight,
        resolvedMode: 'fullPage',
      };
    }

    const left = clamp(Math.round(bestCandidate.rect.left), 0, Math.max(0, viewportWidth - 1));
    const right = clamp(Math.round(bestCandidate.rect.right), left + 1, viewportWidth);
    return {
      x: left,
      y: 0,
      width: Math.max(1, right - left),
      height: viewportHeight,
      resolvedMode: 'mainColumn',
    };

    function getBestCandidate() {
      return candidates.sort((left, right) => right.score - left.score)[0];
    }

    function pushCandidate(element) {
      if (!(element instanceof Element) || seenElements.has(element)) {
        return;
      }
      seenElements.add(element);

      const rect = element.getBoundingClientRect();
      if (rect.width < 280 || rect.height < 120) {
        return;
      }
      if (rect.bottom < 0 || rect.top > viewportHeight) {
        return;
      }

      const style = window.getComputedStyle(element);
      if (!style || style.display === 'none' || style.visibility === 'hidden') {
        return;
      }

      const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
      if (visibleHeight < Math.min(160, viewportHeight * 0.3)) {
        return;
      }

      const visibleWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
      if (visibleWidth < Math.min(280, viewportWidth * 0.35)) {
        return;
      }

      const centerOffset = Math.abs((rect.left + rect.right) / 2 - viewportWidth / 2);
      const widthScore = Math.min(rect.width, viewportWidth * 0.92);
      const heightScore = Math.min(element.scrollHeight || rect.height, viewportHeight * 8);
      const semanticBoost = getSemanticBoost(element);
      const score =
        widthScore * 1.2 +
        visibleHeight * 1.5 +
        heightScore * 0.15 +
        semanticBoost -
        centerOffset * 1.35;

      if (score > 0) {
        candidates.push({ rect, score });
      }
    }
  }

  function getDocumentHeight() {
    const body = document.body;
    const doc = document.documentElement;
    return Math.max(
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
      doc?.clientHeight || 0,
      doc?.scrollHeight || 0,
      doc?.offsetHeight || 0
    );
  }

  function collectFixedElements() {
    const fixedElements = [];
    if (!document.body) {
      return fixedElements;
    }

    const walker = document.createTreeWalker(document.body, window.NodeFilter.SHOW_ELEMENT);
    let currentNode = walker.nextNode();
    let scannedNodes = 0;

    while (currentNode && scannedNodes < MAX_FIXED_SCAN_NODES && fixedElements.length < MAX_FIXED_ELEMENTS) {
      const style = window.getComputedStyle(currentNode);
      if (style && (style.position === 'fixed' || style.position === 'sticky')) {
        const rect = currentNode.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top < window.innerHeight &&
          rect.bottom > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        ) {
          fixedElements.push(currentNode);
        }
      }

      currentNode = walker.nextNode();
      scannedNodes += 1;
    }

    return fixedElements;
  }

  function installCaptureStyle() {
    const styleElement = document.createElement('style');
    styleElement.dataset.evidenceShotCapture = 'true';
    styleElement.textContent = `
      html {
        scroll-behavior: auto !important;
      }

      *,
      *::before,
      *::after {
        animation-play-state: paused !important;
        transition: none !important;
        caret-color: transparent !important;
      }

      [data-evidence-shot-hide-fixed="true"] {
        visibility: hidden !important;
      }
    `;
    document.documentElement.appendChild(styleElement);
    return styleElement;
  }

  function toggleFixedElements(hidden) {
    if (!state.captureSession?.fixedElements) {
      return;
    }

    state.captureSession.fixedElements.forEach((element) => {
      if (hidden) {
        element.dataset.evidenceShotHideFixed = 'true';
      } else {
        delete element.dataset.evidenceShotHideFixed;
      }
    });
  }

  function getSemanticBoost(element) {
    const tagName = element.tagName.toLowerCase();
    let boost = 0;

    if (tagName === 'main') {
      boost += 420;
    }
    if (tagName === 'article') {
      boost += 180;
    }
    if (element.getAttribute('role') === 'main') {
      boost += 360;
    }
    if (element.getAttribute('role') === 'feed') {
      boost += 220;
    }
    if (element.id && /main|content|feed/i.test(element.id)) {
      boost += 140;
    }
    if (element.className && typeof element.className === 'string' && /main|content|feed|post/i.test(element.className)) {
      boost += 110;
    }

    return boost;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
