(function initializeOffscreenProcessor() {
  const Shared = globalThis.WebTestShotShared;
  const t = Shared.t;
  const normalizeUserMessage = Shared.normalizeUserMessage;
  const { MAX_CANVAS_EDGE, OFFSCREEN_INTERFACE_VERSION } = globalThis.WebTestShotConstants;
  const captureSessions = new Map();
  let expectedChannelToken = null;
  const MIN_TOKEN_LENGTH = 24;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'offscreen') {
      return undefined;
    }

    Promise.resolve(handleMessage(message, sender))
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: normalizeUserMessage(
            error?.message,
            'errSaveProcessFailed',
            '保存処理に失敗しました。'
          ),
        });
      });

    return true;
  });

  function handleMessage(message, sender) {
    const trustCheck = assertTrustedCaller(message, sender);
    if (!trustCheck.ok) {
      return trustCheck;
    }

    if (message.type === 'WTS_BEGIN_CAPTURE_SESSION') {
      return beginCaptureSession(message.sessionId, message.sessionSecret, message.meta);
    }
    if (message.type === 'WTS_ADD_CAPTURE_SLICE') {
      return addCaptureSlice(message.sessionId, message.sessionSecret, message.capture);
    }
    if (message.type === 'WTS_FINALIZE_CAPTURE_SESSION') {
      return finalizeCaptureSession(message.sessionId, message.sessionSecret);
    }
    if (message.type === 'WTS_ABORT_CAPTURE_SESSION') {
      return abortCaptureSession(message.sessionId, message.sessionSecret);
    }
    if (message.type === 'WTS_OFFSCREEN_PING') {
      return {
        ok: true,
        interfaceVersion: OFFSCREEN_INTERFACE_VERSION,
      };
    }

    return undefined;
  }

  function assertTrustedCaller(message, sender) {
    if (sender?.id !== chrome.runtime.id) {
      return { ok: false, error: t('errInvalidCaller', '不正な呼び出し元です。') };
    }
    if (sender?.tab?.id) {
      return { ok: false, error: t('errCallerNotAllowed', 'この呼び出し元からは実行できません。') };
    }
    if (sender?.url && !sender.url.startsWith(chrome.runtime.getURL(''))) {
      return { ok: false, error: t('errInvalidCallerUrl', '不正な呼び出し元URLです。') };
    }

    const channelToken = message?.channelToken;
    if (typeof channelToken !== 'string' || channelToken.length < MIN_TOKEN_LENGTH) {
      return { ok: false, error: t('errChannelTokenMissing', '認証トークンが不足しています。') };
    }

    if (expectedChannelToken !== channelToken) {
      expectedChannelToken = channelToken;
    }

    return { ok: true };
  }

  function beginCaptureSession(sessionId, sessionSecret, meta) {
    if (!sessionId) {
      return { ok: false, error: t('errCaptureSessionIdMissing', '撮影セッションIDがありません。') };
    }
    if (typeof sessionSecret !== 'string' || sessionSecret.length < MIN_TOKEN_LENGTH) {
      return { ok: false, error: t('errCaptureSessionAuthInvalid', '撮影セッション認証が不正です。') };
    }
    if (!meta?.plan || !meta?.settings) {
      return { ok: false, error: t('errCaptureMetaMissing', '撮影メタデータを受け取れませんでした。') };
    }

    const canvasWidth = Math.round(meta.plan.canvasWidth * meta.plan.devicePixelRatio);
    const canvasHeight = Math.round(meta.plan.canvasHeight * meta.plan.devicePixelRatio);

    if (
      canvasWidth < 1 ||
      canvasHeight < 1 ||
      canvasWidth > MAX_CANVAS_EDGE ||
      canvasHeight > MAX_CANVAS_EDGE
    ) {
      return {
        ok: false,
        error: t('errCaptureCanvasTooLarge', '撮影キャンバスの想定サイズが大きすぎます。'),
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      return { ok: false, error: t('errImageSaveFailed', '画像の保存に失敗しました。') };
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    captureSessions.set(sessionId, {
      meta,
      sessionSecret,
      canvas,
      context,
      usedCanvasHeight: 0,
    });
    return { ok: true };
  }

  async function addCaptureSlice(sessionId, sessionSecret, capture) {
    const session = captureSessions.get(sessionId);
    if (!session) {
      return { ok: false, error: t('errCaptureSessionNotFound', '撮影セッションが見つかりません。') };
    }
    if (session.sessionSecret !== sessionSecret) {
      return { ok: false, error: t('errCaptureSessionAuthFailed', '撮影セッション認証に失敗しました。') };
    }
    if (
      !capture ||
      typeof capture.scrollY !== 'number' ||
      (!(capture.blob instanceof Blob) && !capture.dataUrl)
    ) {
      return { ok: false, error: t('errCaptureDataInvalid', '撮影データが不正です。') };
    }

    const bitmap = await createImageBitmapFromCapture(capture);
    try {
      const cropX = Math.round((session.meta.plan.cropX || 0) * session.meta.plan.devicePixelRatio);
      const cropY = Math.round((session.meta.plan.cropY || 0) * session.meta.plan.devicePixelRatio);
      const cropWidth = Math.round((session.meta.plan.cropWidth || session.meta.plan.viewportWidth) * session.meta.plan.devicePixelRatio);
      const cropHeight = Math.round((session.meta.plan.cropHeight || session.meta.plan.viewportHeight) * session.meta.plan.devicePixelRatio);
      const drawY = session.meta.plan.scrollingMode
        ? Math.round((capture.scrollY + (session.meta.plan.cropY || 0)) * session.meta.plan.devicePixelRatio)
        : 0;

      session.context.drawImage(
        bitmap,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        drawY,
        session.canvas.width,
        cropHeight
      );
      session.usedCanvasHeight = Math.max(session.usedCanvasHeight, drawY + cropHeight);
      return { ok: true };
    } finally {
      bitmap.close?.();
    }
  }

  async function finalizeCaptureSession(sessionId, sessionSecret) {
    try {
      const session = captureSessions.get(sessionId);
      if (!session) {
        return {
          ok: false,
          error: t('errCaptureMetaLoadFailed', '撮影メタデータを取得できませんでした。'),
        };
      }
      if (session.sessionSecret !== sessionSecret) {
        return {
          ok: false,
          error: t('errCaptureSessionAuthFailed', '撮影セッション認証に失敗しました。'),
        };
      }

      const { meta } = session;
      const { plan, settings } = meta;
      let canvas = session.canvas;
      let context = session.context;

      const usedCanvasHeight = Math.max(1, Math.min(canvas.height, session.usedCanvasHeight || canvas.height));
      if (usedCanvasHeight !== canvas.height) {
        const trimmedCanvas = document.createElement('canvas');
        trimmedCanvas.width = canvas.width;
        trimmedCanvas.height = usedCanvasHeight;

        const trimmedContext = trimmedCanvas.getContext('2d', { alpha: false });
        if (!trimmedContext) {
          throw new Error(t('errImageSaveFailed', '画像の保存に失敗しました。'));
        }

        trimmedContext.fillStyle = '#ffffff';
        trimmedContext.fillRect(0, 0, trimmedCanvas.width, trimmedCanvas.height);
        trimmedContext.drawImage(
          canvas,
          0,
          0,
          canvas.width,
          usedCanvasHeight,
          0,
          0,
          trimmedCanvas.width,
          trimmedCanvas.height
        );

        canvas = trimmedCanvas;
        context = trimmedContext;
      }

      if (settings.timestampEnabled) {
        drawTimestamp(context, canvas, settings.timestampStyle, settings.timestampSize);
      }

      if (settings.footerText) {
        drawFooterLabel(context, canvas, settings.footerText, settings.timestampStyle, settings.timestampSize);
      }

      const { blob, savedAsFormat } = await buildOutputBlob(canvas, settings.format);
      const fileName = Shared.buildFileName({
        url: meta.url,
        format: savedAsFormat,
        part: meta.part,
        prefix: settings.fileNamePrefix,
      });
      const downloadUrl = await blobToDataUrl(blob);

      return {
        ok: true,
        fileName,
        downloadUrl,
        savedAsFormat,
      };
    } catch (error) {
      return {
        ok: false,
        error: normalizeUserMessage(
          error?.message,
          'errImageSaveFailed',
          '画像の保存に失敗しました。'
        ),
      };
    } finally {
      captureSessions.delete(sessionId);
    }
  }

  function abortCaptureSession(sessionId, sessionSecret) {
    const session = captureSessions.get(sessionId);
    if (!session) {
      return { ok: true };
    }
    if (session.sessionSecret !== sessionSecret) {
      return { ok: false, error: t('errCaptureSessionAuthFailed', '撮影セッション認証に失敗しました。') };
    }

    captureSessions.delete(sessionId);
    return { ok: true };
  }

  async function createImageBitmapFromDataUrl(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return createImageBitmap(blob);
  }

  async function createImageBitmapFromCapture(capture) {
    if (capture.blob instanceof Blob) {
      return createImageBitmap(capture.blob);
    }
    return createImageBitmapFromDataUrl(capture.dataUrl);
  }

  async function buildOutputBlob(canvas, requestedFormat) {
    switch (requestedFormat) {
      case 'jpg':
        return {
          blob: await canvasToBlob(canvas, 'image/jpeg', 0.94),
          savedAsFormat: 'jpg',
        };
      case 'webp':
        return {
          blob: await canvasToBlob(canvas, 'image/webp', 0.96),
          savedAsFormat: 'webp',
        };
      case 'png':
      default:
        return {
          blob: await canvasToBlob(canvas, 'image/png'),
          savedAsFormat: 'png',
        };
    }
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error(t('errImageConvertFailed', '画像の変換に失敗しました。')));
            return;
          }
          resolve(blob);
        },
        mimeType,
        quality
      );
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => {
        reject(new Error(t('errSaveDataBuildFailed', '保存用データの生成に失敗しました。')));
      };
      reader.onload = () => {
        if (typeof reader.result !== 'string' || !reader.result) {
          reject(new Error(t('errSaveDataBuildFailed', '保存用データの生成に失敗しました。')));
          return;
        }
        resolve(reader.result);
      };
      reader.readAsDataURL(blob);
    });
  }

  function drawTimestamp(context, canvas, style, size = 'md') {
    const timestamp = Shared.buildTimestampText(resolveTimestampTextStyle(style), new Date());
    const scale = getTimestampSizeScale(size);
    const baseFontSize = Math.max(18, Math.round(canvas.width * 0.017 * scale));
    const margin = Math.max(20, Math.round(canvas.width * 0.02 * Math.min(scale, 1.26)));

    context.save();
    context.textBaseline = 'middle';

    switch (style) {
      case 'audit':
        drawRoundedStamp(context, canvas, timestamp, {
          margin,
          font: `700 ${Math.round(baseFontSize * 0.9)}px "Aptos Mono", "Consolas", monospace`,
          textColor: '#f8fafc',
          background: 'rgba(15, 23, 42, 0.9)',
          borderColor: 'rgba(245, 158, 11, 0.7)',
          borderWidth: 2,
          accentColor: '#f59e0b',
          accentHeight: 6,
          radius: 18,
          paddingX: 0.95,
          paddingY: 0.68,
        });
        break;
      case 'document':
        drawRoundedStamp(context, canvas, timestamp, {
          margin,
          font: `700 ${Math.round(baseFontSize * 0.9)}px "Aptos", "Yu Gothic UI", sans-serif`,
          textColor: '#0f172a',
          background: 'rgba(255, 255, 255, 0.94)',
          borderColor: 'rgba(148, 163, 184, 0.55)',
          borderWidth: 2,
          shadowColor: 'rgba(15, 23, 42, 0.16)',
          shadowBlur: 18,
          shadowOffsetY: 8,
          radius: 16,
          paddingX: 0.9,
          paddingY: 0.62,
        });
        break;
      case 'ledger':
        drawRoundedStamp(context, canvas, timestamp, {
          margin,
          font: `700 ${Math.round(baseFontSize * 0.88)}px "Aptos Mono", "Consolas", monospace`,
          textColor: '#ecfdf5',
          background: 'rgba(6, 78, 59, 0.88)',
          borderColor: 'rgba(167, 243, 208, 0.4)',
          borderWidth: 1.5,
          accentColor: 'rgba(167, 243, 208, 0.95)',
          accentHeight: 3,
          radius: 12,
          paddingX: 0.88,
          paddingY: 0.56,
        });
        break;
      case 'blueprint':
        drawRoundedStamp(context, canvas, timestamp, {
          margin,
          font: `700 ${Math.round(baseFontSize * 0.9)}px "Aptos Mono", "Consolas", monospace`,
          textColor: '#bae6fd',
          background: 'rgba(8, 47, 73, 0.88)',
          borderColor: 'rgba(125, 211, 252, 0.85)',
          borderWidth: 2,
          shadowColor: 'rgba(14, 165, 233, 0.25)',
          shadowBlur: 14,
          radius: 14,
          paddingX: 0.92,
          paddingY: 0.62,
        });
        break;
      case 'monochrome':
        drawRoundedStamp(context, canvas, timestamp, {
          margin,
          font: `700 ${Math.round(baseFontSize * 0.9)}px "Aptos", "Yu Gothic UI", sans-serif`,
          textColor: '#f8fafc',
          background: 'rgba(15, 15, 15, 0.86)',
          borderColor: 'rgba(255, 255, 255, 0.22)',
          borderWidth: 1,
          radius: 999,
          paddingX: 0.9,
          paddingY: 0.55,
        });
        break;
      case 'compact':
        drawRoundedStamp(context, canvas, timestamp, {
          margin,
          font: `700 ${Math.round(baseFontSize * 0.74)}px "Aptos Mono", "Consolas", monospace`,
          textColor: '#0f172a',
          background: 'rgba(255, 255, 255, 0.9)',
          borderColor: 'rgba(148, 163, 184, 0.38)',
          borderWidth: 1,
          radius: 10,
          paddingX: 0.65,
          paddingY: 0.42,
        });
        break;
      case 'film':
        drawFilmStamp(context, canvas, timestamp, baseFontSize, margin);
        break;
      case 'minimal': {
        drawRoundedStamp(context, canvas, timestamp, {
          margin,
          font: `600 ${Math.round(baseFontSize * 0.92)}px "Aptos", "Yu Gothic UI", sans-serif`,
          textColor: '#f8fafc',
          background: 'rgba(15, 23, 42, 0.82)',
          radius: 999,
          paddingX: 0.82,
          paddingY: 0.5,
        });
        break;
      }
      case 'polaroid':
        drawPolaroidStamp(context, canvas, timestamp, baseFontSize, margin);
        break;
      case 'diary':
        drawRoundedStamp(context, canvas, timestamp, {
          margin,
          font: `700 ${Math.round(baseFontSize * 0.88)}px "Georgia", "Yu Mincho", serif`,
          textColor: '#5b4636',
          background: 'rgba(255, 248, 235, 0.96)',
          borderColor: 'rgba(180, 138, 92, 0.45)',
          borderWidth: 1.5,
          shadowColor: 'rgba(120, 53, 15, 0.12)',
          shadowBlur: 16,
          shadowOffsetY: 8,
          radius: 18,
          paddingX: 0.92,
          paddingY: 0.62,
        });
        break;
      case 'pastel':
        drawPastelStamp(context, canvas, timestamp, baseFontSize, margin);
        break;
      case 'night':
        drawNightStamp(context, canvas, timestamp, baseFontSize, margin);
        break;
      case 'japanese':
      default: {
        drawRoundedStamp(context, canvas, timestamp, {
          margin,
          font: `700 ${baseFontSize}px "Aptos", "Yu Gothic UI", sans-serif`,
          textColor: '#fef3c7',
          background: 'rgba(15, 23, 42, 0.7)',
          radius: 18,
          paddingX: 0.9,
          paddingY: 0.58,
        });
        break;
      }
    }

    context.restore();
  }

  function drawFooterLabel(context, canvas, footerText, style, size = 'md') {
    const scale = getTimestampSizeScale(size);
    const baseFontSize = Math.max(18, Math.round(canvas.width * 0.017 * scale));
    const margin = Math.max(20, Math.round(canvas.width * 0.02 * Math.min(scale, 1.26)));
    const safeText = String(footerText).trim().slice(0, 80);

    if (!safeText) {
      return;
    }

    context.save();
    context.textBaseline = 'middle';

    switch (style) {
      case 'audit':
        drawRoundedStamp(context, canvas, safeText, {
          margin,
          position: 'left',
          font: `700 ${Math.round(baseFontSize * 0.9)}px "Aptos Mono", "Consolas", monospace`,
          textColor: '#f8fafc',
          background: 'rgba(15, 23, 42, 0.9)',
          borderColor: 'rgba(245, 158, 11, 0.7)',
          borderWidth: 2,
          accentColor: '#f59e0b',
          accentHeight: 6,
          radius: 18,
          paddingX: 0.95,
          paddingY: 0.68,
        });
        break;
      case 'document':
        drawRoundedStamp(context, canvas, safeText, {
          margin,
          position: 'left',
          font: `700 ${Math.round(baseFontSize * 0.9)}px "Aptos", "Yu Gothic UI", sans-serif`,
          textColor: '#0f172a',
          background: 'rgba(255, 255, 255, 0.94)',
          borderColor: 'rgba(148, 163, 184, 0.55)',
          borderWidth: 2,
          shadowColor: 'rgba(15, 23, 42, 0.16)',
          shadowBlur: 18,
          shadowOffsetY: 8,
          radius: 16,
          paddingX: 0.9,
          paddingY: 0.62,
        });
        break;
      case 'ledger':
        drawRoundedStamp(context, canvas, safeText, {
          margin,
          position: 'left',
          font: `700 ${Math.round(baseFontSize * 0.88)}px "Aptos Mono", "Consolas", monospace`,
          textColor: '#ecfdf5',
          background: 'rgba(6, 78, 59, 0.88)',
          borderColor: 'rgba(167, 243, 208, 0.4)',
          borderWidth: 1.5,
          accentColor: 'rgba(167, 243, 208, 0.95)',
          accentHeight: 3,
          radius: 12,
          paddingX: 0.88,
          paddingY: 0.56,
        });
        break;
      case 'blueprint':
        drawRoundedStamp(context, canvas, safeText, {
          margin,
          position: 'left',
          font: `700 ${Math.round(baseFontSize * 0.9)}px "Aptos Mono", "Consolas", monospace`,
          textColor: '#bae6fd',
          background: 'rgba(8, 47, 73, 0.88)',
          borderColor: 'rgba(125, 211, 252, 0.85)',
          borderWidth: 2,
          shadowColor: 'rgba(14, 165, 233, 0.25)',
          shadowBlur: 14,
          radius: 14,
          paddingX: 0.92,
          paddingY: 0.62,
        });
        break;
      case 'monochrome':
        drawRoundedStamp(context, canvas, safeText, {
          margin,
          position: 'left',
          font: `700 ${Math.round(baseFontSize * 0.9)}px "Aptos", "Yu Gothic UI", sans-serif`,
          textColor: '#f8fafc',
          background: 'rgba(15, 15, 15, 0.86)',
          borderColor: 'rgba(255, 255, 255, 0.22)',
          borderWidth: 1,
          radius: 999,
          paddingX: 0.9,
          paddingY: 0.55,
        });
        break;
      case 'compact':
        drawRoundedStamp(context, canvas, safeText, {
          margin,
          position: 'left',
          font: `700 ${Math.round(baseFontSize * 0.74)}px "Aptos Mono", "Consolas", monospace`,
          textColor: '#0f172a',
          background: 'rgba(255, 255, 255, 0.9)',
          borderColor: 'rgba(148, 163, 184, 0.38)',
          borderWidth: 1,
          radius: 10,
          paddingX: 0.65,
          paddingY: 0.42,
        });
        break;
      case 'film':
        drawFilmStamp(context, canvas, safeText, baseFontSize, margin, 'left');
        break;
      case 'minimal':
        drawRoundedStamp(context, canvas, safeText, {
          margin,
          position: 'left',
          font: `600 ${Math.round(baseFontSize * 0.92)}px "Aptos", "Yu Gothic UI", sans-serif`,
          textColor: '#f8fafc',
          background: 'rgba(15, 23, 42, 0.82)',
          radius: 999,
          paddingX: 0.82,
          paddingY: 0.5,
        });
        break;
      case 'polaroid':
        drawPolaroidStamp(context, canvas, safeText, baseFontSize, margin, 'left');
        break;
      case 'diary':
        drawRoundedStamp(context, canvas, safeText, {
          margin,
          position: 'left',
          font: `700 ${Math.round(baseFontSize * 0.88)}px "Georgia", "Yu Mincho", serif`,
          textColor: '#5b4636',
          background: 'rgba(255, 248, 235, 0.96)',
          borderColor: 'rgba(180, 138, 92, 0.45)',
          borderWidth: 1.5,
          shadowColor: 'rgba(120, 53, 15, 0.12)',
          shadowBlur: 16,
          shadowOffsetY: 8,
          radius: 18,
          paddingX: 0.92,
          paddingY: 0.62,
        });
        break;
      case 'pastel':
        drawPastelStamp(context, canvas, safeText, baseFontSize, margin, 'left');
        break;
      case 'night':
        drawNightStamp(context, canvas, safeText, baseFontSize, margin, 'left');
        break;
      case 'japanese':
      default:
        drawRoundedStamp(context, canvas, safeText, {
          margin,
          position: 'left',
          font: `700 ${baseFontSize}px "Aptos", "Yu Gothic UI", sans-serif`,
          textColor: '#fef3c7',
          background: 'rgba(15, 23, 42, 0.7)',
          radius: 18,
          paddingX: 0.9,
          paddingY: 0.58,
        });
        break;
    }

    context.restore();
  }

  function resolveTimestampTextStyle(style) {
    switch (style) {
      case 'film':
      case 'polaroid':
      case 'night':
        return 'film';
      case 'minimal':
      case 'compact':
      case 'monochrome':
        return 'minimal';
      default:
        return 'japanese';
    }
  }

  function getTimestampSizeScale(size) {
    switch (size) {
      case 'xs':
        return 0.72;
      case 'sm':
        return 0.86;
      case 'lg':
        return 1.18;
      case 'xl':
        return 1.36;
      case 'md':
      default:
        return 1;
    }
  }

  function drawRoundedStamp(context, canvas, timestamp, options) {
    const {
      margin,
      font,
      textColor,
      background,
      borderColor = null,
      borderWidth = 0,
      shadowColor = 'transparent',
      shadowBlur = 0,
      shadowOffsetX = 0,
      shadowOffsetY = 0,
      radius = 18,
      paddingX = 0.9,
      paddingY = 0.58,
      accentColor = null,
      accentHeight = 0,
      position = 'right',
    } = options;

    context.font = font;
    const fontSize = extractFontSize(font);
    const metrics = context.measureText(timestamp);
    const width = metrics.width + fontSize * (paddingX * 2);
    const height = fontSize * (paddingY * 2 + 1);
    const left = position === 'left' ? margin : canvas.width - width - margin;
    const top = canvas.height - height - margin;

    context.save();
    context.shadowColor = shadowColor;
    context.shadowBlur = shadowBlur;
    context.shadowOffsetX = shadowOffsetX;
    context.shadowOffsetY = shadowOffsetY;
    roundRect(context, left, top, width, height, Math.min(radius, height / 2));
    context.fillStyle = background;
    context.fill();

    if (borderColor && borderWidth > 0) {
      context.shadowColor = 'transparent';
      context.lineWidth = borderWidth;
      context.strokeStyle = borderColor;
      context.stroke();
    }

    if (accentColor && accentHeight > 0) {
      context.shadowColor = 'transparent';
      const accentRadius = Math.min(radius, accentHeight * 1.6);
      roundRect(context, left, top, width, accentHeight, accentRadius);
      context.fillStyle = accentColor;
      context.fill();
    }

    context.shadowColor = 'transparent';
    context.fillStyle = textColor;
    context.fillText(timestamp, left + fontSize * paddingX, top + height / 2);
    context.restore();
  }

  function drawFilmStamp(context, canvas, timestamp, baseFontSize, margin, position = 'right') {
    context.font = `700 ${baseFontSize}px "Aptos Mono", "Consolas", monospace`;
    context.fillStyle = '#ffb347';
    context.shadowColor = 'rgba(0, 0, 0, 0.55)';
    context.shadowBlur = 10;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 4;
    const textWidth = context.measureText(timestamp).width;
    context.fillText(
      timestamp,
      position === 'left' ? margin : canvas.width - textWidth - margin,
      canvas.height - margin
    );
  }

  function drawPolaroidStamp(context, canvas, timestamp, baseFontSize, margin, position = 'right') {
    const font = `700 ${Math.round(baseFontSize * 0.82)}px "Aptos", "Yu Gothic UI", sans-serif`;
    context.font = font;
    const metrics = context.measureText(timestamp);
    const width = metrics.width + baseFontSize * 1.9;
    const height = baseFontSize * 2.1;
    const centerX = position === 'left' ? margin + width / 2 : canvas.width - width / 2 - margin;
    const centerY = canvas.height - height / 2 - margin;

    context.save();
    context.translate(centerX, centerY);
    context.rotate(-0.035);
    context.shadowColor = 'rgba(15, 23, 42, 0.18)';
    context.shadowBlur = 16;
    context.shadowOffsetY = 10;
    roundRect(context, -width / 2, -height / 2, width, height, 10);
    context.fillStyle = 'rgba(255, 255, 255, 0.98)';
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = '#1f2937';
    context.fillText(timestamp, -width / 2 + baseFontSize * 0.9, 0);
    context.restore();
  }

  function drawPastelStamp(context, canvas, timestamp, baseFontSize, margin, position = 'right') {
    const font = `700 ${Math.round(baseFontSize * 0.86)}px "Aptos", "Yu Gothic UI", sans-serif`;
    context.font = font;
    const metrics = context.measureText(timestamp);
    const width = metrics.width + baseFontSize * 1.9;
    const height = baseFontSize * 2.05;
    const left = position === 'left' ? margin : canvas.width - width - margin;
    const top = canvas.height - height - margin;
    const gradient = context.createLinearGradient(left, top, left + width, top + height);
    gradient.addColorStop(0, 'rgba(251, 207, 232, 0.96)');
    gradient.addColorStop(1, 'rgba(191, 219, 254, 0.96)');

    context.save();
    context.shadowColor = 'rgba(148, 163, 184, 0.2)';
    context.shadowBlur = 14;
    context.shadowOffsetY = 8;
    roundRect(context, left, top, width, height, height / 2);
    context.fillStyle = gradient;
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = '#3f3f46';
    context.fillText(timestamp, left + baseFontSize * 0.92, top + height / 2);
    context.restore();
  }

  function drawNightStamp(context, canvas, timestamp, baseFontSize, margin, position = 'right') {
    const font = `700 ${Math.round(baseFontSize * 0.88)}px "Aptos Mono", "Consolas", monospace`;
    context.font = font;
    const metrics = context.measureText(timestamp);
    const width = metrics.width + baseFontSize * 1.8;
    const height = baseFontSize * 1.95;
    const left = position === 'left' ? margin : canvas.width - width - margin;
    const top = canvas.height - height - margin;

    context.save();
    roundRect(context, left, top, width, height, 16);
    context.fillStyle = 'rgba(2, 6, 23, 0.82)';
    context.fill();
    context.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    context.lineWidth = 1.5;
    context.shadowColor = 'rgba(56, 189, 248, 0.45)';
    context.shadowBlur = 14;
    context.stroke();
    context.shadowColor = 'transparent';
    context.fillStyle = '#e0f2fe';
    context.fillText(timestamp, left + baseFontSize * 0.88, top + height / 2);
    context.restore();
  }

  function extractFontSize(font) {
    const match = /(\d+(?:\.\d+)?)px/.exec(font);
    return match ? Number(match[1]) : 24;
  }

  function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }
})();
