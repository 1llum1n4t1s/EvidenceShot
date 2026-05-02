(function initializeCaptureController() {
  const CONTROLLER_KEY = '__evidenceShotCaptureControllerV2';
  // CONTROLLER_VERSION: 旧 inject 済みインスタンスとの不整合検知用。
  // collectFixedElements の Shadow DOM 走査追加 / グローバル名前空間リネーム /
  // moveToCaptureStep の動的ロード警告で挙動変化があったため 3 → 4 にインクリメント。
  // CLIPBOARD_COPY_FROM_URL ハンドラ追加 (ショートカット経由のクリップボードコピー
  // を active tab の content script で実行するため) で 4 → 5。
  // HTTP ページ向け execCommand fallback 追加で 5 → 6。
  // fallback のサイズ上限と状態分離で 6 → 7。
  const CONTROLLER_VERSION = 7;

  if (globalThis[CONTROLLER_KEY]?.version === CONTROLLER_VERSION) {
    return;
  }

  const previousController = globalThis[CONTROLLER_KEY];
  previousController?.dispose?.();

  const Shared = globalThis.EvidenceShotShared;
  const t = Shared.t;
  const normalizeUserMessage = Shared.normalizeUserMessage;
  const Constants = globalThis.EvidenceShotConstants;
  const { MESSAGE_TYPES, CLIPBOARD_STATUS, CAPTURE_SESSION_TTL_MS, MAX_HTML_CLIPBOARD_BYTES, MAX_TILE_CANVAS_AREA } = Constants;
  const state = {
    captureSession: null,
  };
  const MAX_MAIN_COLUMN_SCAN_NODES = 1800;
  const MAX_FIXED_SCAN_NODES = 2200;
  const MAX_FIXED_ELEMENTS = 120;
  const POINTER_POSITION_MAX_AGE_MS = 30_000;
  const pointerPositionEvents = ['pointermove', 'pointerdown', 'mousemove', 'mousedown'];
  let lastPointerPosition = null;

  const messageHandler = (message, sender, sendResponse) => {
    if (!message?.type) {
      return undefined;
    }

    // 正当な送信元は background SW のみ（sender.id は同一拡張機能、sender.tab は無い）。
    // 他の content script（XSS されたページ等）からの runtime.sendMessage は拒否。
    if (!sender || sender.id !== chrome.runtime.id || sender.tab) {
      return undefined;
    }

    switch (message.type) {
      case MESSAGE_TYPES.CAPTURE_PREPARE_V2:
        respondAsync(prepareCapture(message.payload?.sessionId, message.payload?.settings), sendResponse);
        return true;
      case MESSAGE_TYPES.CAPTURE_STEP_V2:
        respondAsync(moveToCaptureStep(message.payload?.sessionId, message.payload?.index), sendResponse);
        return true;
      case MESSAGE_TYPES.CAPTURE_RESTORE_V2:
        restoreCaptureState(message.payload?.sessionId);
        sendResponse({ ok: true });
        return undefined;
      case MESSAGE_TYPES.CLIPBOARD_COPY_FROM_URL:
        respondAsync(copyClipboardFromUrl(message.payload?.url), sendResponse);
        return true;
      default:
        return undefined;
    }
  };

  // respondAsync は Shared に集約済み (background と重複していたため統合)
  const respondAsync = Shared.respondAsync;

  chrome.runtime.onMessage.addListener(messageHandler);
  pointerPositionEvents.forEach((eventName) => {
    document.addEventListener(eventName, updatePointerPosition, {
      capture: true,
      passive: true,
    });
  });

  globalThis[CONTROLLER_KEY] = {
    version: CONTROLLER_VERSION,
    dispose() {
      chrome.runtime.onMessage.removeListener(messageHandler);
      pointerPositionEvents.forEach((eventName) => {
        document.removeEventListener(eventName, updatePointerPosition, {
          capture: true,
        });
      });
      restoreCaptureState(state.captureSession?.sessionId);
    },
  };

  async function prepareCapture(sessionId, settings) {
    if (!sessionId) {
      return { ok: false, error: t('errCaptureSessionIdMissing', '撮影セッションIDがありません。') };
    }

    if (state.captureSession && Date.now() > state.captureSession.expiresAt) {
      restoreCaptureState();
    }

    if (state.captureSession) {
      return { ok: false, error: t('errTabAlreadyCapturing', 'このページではすでに撮影中です。完了してからもう一度お試しください。') };
    }

    const normalizedSettings = Shared.normalizeSettings(settings || {});

    try {
      const plan = buildCapturePlan(normalizedSettings.captureMode);
      plan.cursor = normalizedSettings.includeCursor ? resolveCursorPosition() : null;
      state.captureSession = {
        sessionId,
        settings: normalizedSettings,
        startedAt: Date.now(),
        expiresAt: Date.now() + CAPTURE_SESSION_TTL_MS,
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

    // DPR が撮影計画時と変わっていないか確認（マルチモニタ間ウィンドウ移動検知）。
    // プラン固定の devicePixelRatio で cropX/cropY を device pixel 換算しているため、
    // 途中で DPR が変わると合成画像が左右/上下にズレる。
    const planDpr = state.captureSession.plan?.devicePixelRatio;
    const currentDpr = window.devicePixelRatio || 1;
    if (
      typeof planDpr === 'number' &&
      Math.abs(planDpr - currentDpr) > 0.01
    ) {
      return {
        ok: false,
        error: t(
          'errDevicePixelRatioChanged',
          'ウィンドウ移動によりズーム倍率が変わったため撮影を中止しました。ウィンドウを動かさずにもう一度お試しください。'
        ),
      };
    }

    // 動的ロード (無限スクロール / 遅延レンダリング SPA) の検知:
    // 撮影開始時の plan.pageHeight より現在の document height が 20% 以上大きければ、
    // ロード追加コンテンツが計画範囲外にある可能性。**撮影は計画通り完走するが**、
    // 末尾コンテンツが画像に含まれない可能性があるため一度だけコンソールに警告。
    // (Canvas を再確保する完全動的拡張は offscreen 側のセッション再構築が必要で
    // 影響が大きいため、本実装では検知のみに留める。)
    if (
      state.captureSession.plan?.scrollingMode &&
      !state.captureSession.dynamicGrowthWarned
    ) {
      const planPageHeight = state.captureSession.plan.pageHeight;
      if (typeof planPageHeight === 'number' && planPageHeight > 0) {
        const currentHeight = getDocumentHeight();
        if (currentHeight > planPageHeight * 1.2) {
          state.captureSession.dynamicGrowthWarned = true;
          console.warn(
            `EvidenceShot: page height grew from ${planPageHeight}px to ${currentHeight}px after capture started. ` +
            'Late-loaded content (infinite scroll / lazy components) may not appear in the screenshot.'
          );
        }
      }
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

  // ショートカット経由の撮影完了後に SW から呼ばれる。popup を経由しないため
  // web page (= content script の document) は focus を保ったまま。
  // navigator.clipboard.write は document.hasFocus() が true ならば成功する。
  // ただし http:// ページでは secure context ではないため Async Clipboard が
  // 公開されない。そこで HTML 画像コピーの execCommand fallback も持つ。
  // url は offscreen が URL.createObjectURL した chrome-extension:// 配下の Blob URL で、
  // content script は同一拡張機能 origin で動作するため fetch でこの URL を読める。
  async function copyClipboardFromUrl(url) {
    if (typeof url !== 'string' || !url || !url.startsWith('blob:')) {
      return { ok: false, error: t('errClipboardWriteFailed', 'クリップボードへのコピーに失敗しました。') };
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return { ok: false, error: t('errClipboardWriteFailed', 'クリップボードへのコピーに失敗しました。') };
      }
      const blob = await response.blob();
      return await copyImageBlobToClipboard(blob);
    } catch (error) {
      // DOMException など Chrome ネイティブの英語メッセージは normalizeUserMessage で
      // fallback 文言へ畳み込まれるため、原文は console.error に残す。
      // (例: ユーザーがアドレスバーに focus を移していると "Document is not focused." で失敗)
      console.error('EvidenceShot: clipboard write failed in content', error?.name, error?.message);
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

  async function copyImageBlobToClipboard(blob) {
    if (navigator.clipboard?.write && typeof ClipboardItem === 'function') {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return { ok: true, clipboardStatus: Constants.CLIPBOARD_STATUS.COPIED };
      } catch (error) {
        // focus 喪失などで失敗した場合も、旧 API の HTML コピーを最後に試す。
        console.warn('EvidenceShot: async clipboard write failed in content', error?.name, error?.message);
      }
    }

    return await copyImageBlobAsHtml(blob);
  }

  async function copyImageBlobAsHtml(blob) {
    if (typeof document.execCommand !== 'function') {
      return { ok: false, error: t('errClipboardUnsupported', 'この環境ではクリップボードコピーを利用できません。') };
    }
    if (blob.size > MAX_HTML_CLIPBOARD_BYTES) {
      return {
        ok: false,
        error: t(
          'errClipboardHtmlFallbackTooLarge',
          'クリップボード互換コピーには画像が大きすぎます。'
        ),
      };
    }

    const dataUrl = await readBlobAsDataUrl(blob);
    if (!dataUrl) {
      return { ok: false, error: t('errClipboardWriteFailed', 'クリップボードへのコピーに失敗しました。') };
    }

    const editable = document.createElement('textarea');
    editable.value = ' ';
    editable.setAttribute('readonly', 'readonly');
    editable.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';

    const selection = window.getSelection?.();
    const ranges = [];
    if (selection) {
      for (let index = 0; index < selection.rangeCount; index += 1) {
        ranges.push(selection.getRangeAt(index).cloneRange());
      }
    }
    const activeElement = document.activeElement;
    let copied = false;

    const onCopy = (event) => {
      if (!event.clipboardData) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      event.clipboardData.setData('text/html', `<img src="${dataUrl}" alt="">`);
      event.clipboardData.setData('text/plain', '');
      copied = true;
    };

    try {
      document.addEventListener('copy', onCopy, true);
      (document.body || document.documentElement).appendChild(editable);
      editable.focus({ preventScroll: true });
      editable.select();
      const commandSucceeded = document.execCommand('copy');
      return commandSucceeded && copied
        ? { ok: true, clipboardStatus: Constants.CLIPBOARD_STATUS.COPIED_HTML_FALLBACK }
        : { ok: false, error: t('errClipboardWriteFailed', 'クリップボードへのコピーに失敗しました。') };
    } finally {
      document.removeEventListener('copy', onCopy, true);
      editable.remove();
      if (selection) {
        selection.removeAllRanges();
        ranges.forEach((range) => selection.addRange(range));
      }
      if (activeElement && typeof activeElement.focus === 'function') {
        try {
          activeElement.focus({ preventScroll: true });
        } catch {
          // 元の要素が消えている場合でもコピー結果は維持する。
        }
      }
    }
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('Failed to read clipboard image.'));
      reader.readAsDataURL(blob);
    });
  }


  // body または html が overflow: hidden/clip になっているとウィンドウスクロールが
  // 効かず、スクロール連結撮影が同一位置の繰り返し撮影になる（モーダル開放中の
  // Gmail / Linear 等で発生）。ここで検知し、scrollingMode を viewport にフォールバック。
  function isDocumentScrollLocked() {
    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) {
      return false;
    }
    const rootStyle = window.getComputedStyle(root);
    const bodyStyle = window.getComputedStyle(body);
    const lockedValues = new Set(['hidden', 'clip']);
    const rootY = rootStyle.overflowY || rootStyle.overflow;
    const bodyY = bodyStyle.overflowY || bodyStyle.overflow;
    return lockedValues.has(rootY) || lockedValues.has(bodyY);
  }

  function buildCapturePlan(captureMode) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const pageHeight = getDocumentHeight();
    const maxScrollY = Math.max(0, pageHeight - viewportHeight);
    const dpr = window.devicePixelRatio || 1;
    let scrollingMode = captureMode !== 'viewport';
    // スクロールロック中は自前で viewport に降格（重複撮影と無限ループを防ぐ）。
    if (scrollingMode && isDocumentScrollLocked()) {
      scrollingMode = false;
    }
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
    const cropWidthDevice = Math.max(1, Math.round(cropRect.width * dpr));
    const maxCanvasCssHeightByArea = Math.max(
      1,
      Math.floor(MAX_TILE_CANVAS_AREA / cropWidthDevice / Math.max(dpr, 1))
    );
    const maxTileCssHeight = Math.min(maxCanvasCssEdge, maxCanvasCssHeightByArea);
    const positions = [];

    if (scrollingMode && viewportHeight > maxTileCssHeight) {
      throw new Error(t('errViewportTooTall', 'ビューポートが大きすぎるため撮影できません。ウィンドウを小さくして再度お試しください。'));
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

    const tiles = scrollingMode
      ? buildTilePartition(uniquePositions, stride, viewportHeight, pageHeight, maxTileCssHeight)
      : [{ index: 0, startIndex: 0, endIndex: 0, startY: 0, cssHeight: cropRect.height }];

    return {
      captureMode: cropRect.resolvedMode,
      scrollingMode,
      positions: uniquePositions,
      tiles,
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

  function buildTilePartition(positions, stride, viewportHeight, pageHeight, maxTileCssHeight) {
    if (positions.length === 0) {
      return [];
    }

    const maxPositionsPerTile = Math.max(
      2,
      Math.floor((maxTileCssHeight - viewportHeight) / stride) + 1
    );

    const tiles = [];
    let startIndex = 0;

    while (startIndex < positions.length) {
      const endIndex = Math.min(positions.length - 1, startIndex + maxPositionsPerTile - 1);
      const startY = positions[startIndex];
      const lastPositionY = positions[endIndex];
      const cssHeight = Math.min(pageHeight - startY, lastPositionY + viewportHeight - startY);

      tiles.push({
        index: tiles.length,
        startIndex,
        endIndex,
        startY,
        cssHeight,
      });

      if (endIndex >= positions.length - 1) {
        break;
      }
      startIndex = endIndex;
    }

    return tiles;
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

    let semanticCandidateCount = 0;
    for (const element of document.querySelectorAll(selectorCandidates.join(','))) {
      if (semanticCandidateCount >= MAX_MAIN_COLUMN_SCAN_NODES) {
        break;
      }
      pushCandidate(element);
      semanticCandidateCount += 1;
    }

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

    const left = Shared.clampNumber(Math.round(bestCandidate.rect.left), 0, Math.max(0, viewportWidth - 1), 0);
    const right = Shared.clampNumber(Math.round(bestCandidate.rect.right), left + 1, viewportWidth, viewportWidth);
    return {
      x: left,
      y: 0,
      width: Math.max(1, right - left),
      height: viewportHeight,
      resolvedMode: 'mainColumn',
    };

    function getBestCandidate() {
      // 最高スコアの 1 件だけ必要。破壊的 sort (O(n log n)) ではなく
      // reduce で線形 (O(n)) に探す。
      let best = null;
      for (const candidate of candidates) {
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      }
      return best;
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

    const seenShadowRoots = new WeakSet();
    const scanState = { count: 0 };
    walkRootForFixedElements(document.body, fixedElements, seenShadowRoots, scanState);
    return fixedElements;
  }

  // open mode の Shadow Root も走査するための再帰ヘルパー。
  // closed mode の Shadow Root は element.shadowRoot が null なので透過 (退避不能 = 既知の制約)。
  function walkRootForFixedElements(root, fixedElements, seenShadowRoots, scanState) {
    if (!root) {
      return;
    }
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_ELEMENT);
    let currentNode = walker.nextNode();
    while (
      currentNode &&
      scanState.count < MAX_FIXED_SCAN_NODES &&
      fixedElements.length < MAX_FIXED_ELEMENTS
    ) {
      const style = window.getComputedStyle(currentNode);
      // `position: fixed` のみ非表示対象とする。sticky はスクロール位置に応じて
      // 自然な場所に現れるべきなので、一律に隠すと Notion / GitHub の sticky
      // テーブルヘッダー等が全スライスで消える事故になる（証跡用途で致命的）。
      // トップナビ等の「画面全体で固定」は fixed で実装されるため実害は少ない。
      if (style && style.position === 'fixed') {
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

      // open Shadow Root に入っていく (Web Components / LWC / Stencil 対応)。
      // shadowRoot が null = closed mode または非カスタム要素 → スキップ。
      const shadow = currentNode.shadowRoot;
      if (shadow && !seenShadowRoots.has(shadow)) {
        seenShadowRoots.add(shadow);
        walkRootForFixedElements(shadow, fixedElements, seenShadowRoots, scanState);
        if (
          scanState.count >= MAX_FIXED_SCAN_NODES ||
          fixedElements.length >= MAX_FIXED_ELEMENTS
        ) {
          return;
        }
      }

      currentNode = walker.nextNode();
      scanState.count += 1;
    }
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

  function updatePointerPosition(event) {
    const cursor = buildCursorPosition(event.clientX, event.clientY, 'event');
    if (cursor) {
      lastPointerPosition = {
        ...cursor,
        capturedAt: Date.now(),
      };
    }
  }

  function resolveCursorPosition() {
    if (
      !lastPointerPosition ||
      Date.now() - lastPointerPosition.capturedAt > POINTER_POSITION_MAX_AGE_MS
    ) {
      return null;
    }

    return buildCursorPosition(
      lastPointerPosition.viewportX,
      lastPointerPosition.viewportY,
      lastPointerPosition.source
    );
  }

  function buildCursorPosition(clientX, clientY, source) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }
    if (
      clientX < 0 ||
      clientY < 0 ||
      clientX > window.innerWidth ||
      clientY > window.innerHeight
    ) {
      return null;
    }

    return {
      viewportX: Math.round(clientX),
      viewportY: Math.round(clientY),
      pageX: Math.round(clientX + window.scrollX),
      pageY: Math.round(clientY + window.scrollY),
      source,
    };
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

})();
