(function initializeOffscreenProcessor() {
  const Shared = globalThis.EvidenceShotShared;
  const StampRenderer = globalThis.EvidenceShotStampRenderer;
  const t = Shared.t;
  const normalizeUserMessage = Shared.normalizeUserMessage;
  const { MAX_CANVAS_EDGE, MAX_TILE_CANVAS_AREA, OFFSCREEN_INTERFACE_VERSION, MESSAGE_TYPES } = globalThis.EvidenceShotConstants;
  const captureSessions = new Map();
  const downloadUrlRevokeTimers = new Map();
  const MIN_TOKEN_LENGTH = 24;
  // Chrome 拡張機能の SW (background) が offscreen を createDocument する際、
  // URL クエリ `?token=...` で channelToken を埋め込む。offscreen は起動直後に
  // URL から token を読み取り、以降の sendMessage は URL の token と完全一致
  // した場合のみ受け付ける。
  //
  // 注: 主目的は「SW 再起動後のバージョン整合 / 旧 offscreen 識別」であり、
  // セキュリティ境界としての効果は限定的 (sender.id + sender.tab チェックで
  // 既に外部 origin の侵入は塞がれている)。channelToken は SW 再起動で
  // 新トークンが発行されると、古い offscreen インスタンスは新 SW の通信に
  // 答えられなくなる → isOffscreenDocumentCompatible が false → 作り直し
  // という "暗黙的な世代管理" として機能している。
  const expectedChannelToken = (() => {
    try {
      const token = new URLSearchParams(globalThis.location?.search || '').get('token');
      if (typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH) {
        return token;
      }
    } catch {
      // no-op
    }
    return null;
  })();

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

    if (message.type === MESSAGE_TYPES.BEGIN_CAPTURE_SESSION) {
      return beginCaptureSession(message.sessionId, message.sessionSecret, message.meta);
    }
    if (message.type === MESSAGE_TYPES.ADD_CAPTURE_SLICE) {
      return addCaptureSlice(message.sessionId, message.sessionSecret, message.capture);
    }
    if (message.type === MESSAGE_TYPES.FINALIZE_CAPTURE_SESSION) {
      return finalizeCaptureSession(message.sessionId, message.sessionSecret);
    }
    if (message.type === MESSAGE_TYPES.ABORT_CAPTURE_SESSION) {
      return abortCaptureSession(message.sessionId, message.sessionSecret);
    }
    if (message.type === MESSAGE_TYPES.REVOKE_DOWNLOAD_URL) {
      revokeDownloadUrl(message.downloadUrl);
      return { ok: true };
    }
    if (message.type === MESSAGE_TYPES.OFFSCREEN_PING) {
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

    // URL クエリから取得した正規トークンと完全一致する場合のみ受け入れる。
    // token が URL に無い場合（設計ミスで起動された場合）はすべて拒否。
    if (!expectedChannelToken || expectedChannelToken !== channelToken) {
      return { ok: false, error: t('errCaptureSessionAuthInvalid', '撮影セッション認証が不正です。') };
    }

    return { ok: true };
  }

  // Canvas の GPU バッファを即時解放する（width=height=1 にして内部バッファを縮小）。
  // 参照を消しても GC タイミング次第で解放が遅延するため、明示的にサイズ縮小する。
  function releaseCanvas(canvas) {
    if (!canvas) return;
    try {
      canvas.width = 1;
      canvas.height = 1;
    } catch {
      // no-op
    }
  }

  // 新セッション開始時に残留セッション（SW 再起動で abort が届かなかったもの等）を掃除。
  function purgeAllSessions() {
    for (const [, session] of captureSessions) {
      releaseCanvas(session?.canvas);
    }
    captureSessions.clear();
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

    // 孤児セッション掃除: SW が途中で落ちると abort が届かず、古い巨大 Canvas が残り続ける。
    // 新セッション開始＝前セッションは確実に意味を失っているので、ここで一掃する。
    if (captureSessions.size > 0) {
      purgeAllSessions();
    }

    const canvasWidth = Math.round(meta.plan.canvasWidth * meta.plan.devicePixelRatio);
    const canvasHeight = Math.round(meta.plan.canvasHeight * meta.plan.devicePixelRatio);

    if (
      canvasWidth < 1 ||
      canvasHeight < 1 ||
      canvasWidth > MAX_CANVAS_EDGE ||
      canvasHeight > MAX_CANVAS_EDGE ||
      canvasWidth * canvasHeight > MAX_TILE_CANVAS_AREA
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
        // GPU メモリの 2 倍ピーク回避: 先に元 Canvas の必要領域を ImageBitmap (CPU 側) に
        // 抽出し、元 Canvas の GPU バッファを **drawImage 前に** 解放する。
        // その後、新 Canvas を確保して bitmap を draw する流れにすることで
        // 「元 Canvas + 新 Canvas が GPU 上で同時存在する」瞬間をなくす。
        const sourceBitmap = await createImageBitmap(canvas, 0, 0, canvas.width, usedCanvasHeight);
        releaseCanvas(session.canvas);

        const trimmedCanvas = document.createElement('canvas');
        trimmedCanvas.width = canvas.width;
        trimmedCanvas.height = usedCanvasHeight;

        const trimmedContext = trimmedCanvas.getContext('2d', { alpha: false });
        if (!trimmedContext) {
          sourceBitmap.close?.();
          throw new Error(t('errImageSaveFailed', '画像の保存に失敗しました。'));
        }

        trimmedContext.fillStyle = '#ffffff';
        trimmedContext.fillRect(0, 0, trimmedCanvas.width, trimmedCanvas.height);
        trimmedContext.drawImage(sourceBitmap, 0, 0);
        sourceBitmap.close?.();

        canvas = trimmedCanvas;
        context = trimmedContext;
      }

      if (settings.includeCursor) {
        drawMouseCursor(context, canvas, plan);
      }

      if (settings.timestampEnabled) {
        StampRenderer.drawTimestamp(context, canvas, settings.timestampStyle, settings.timestampSize);
      }

      if (settings.footerText) {
        StampRenderer.drawFooterLabel(context, canvas, settings.footerText, settings.timestampStyle, settings.timestampSize);
      }

      // クリップボード書き込みは offscreen document からは実施できない
      // (document.hasFocus() が常に false → navigator.clipboard.write は
      // 「Document is not focused.」で必ず失敗する)。本実装では PNG blob URL
      // を生成して content script に委譲する流れに統一した。ここでは
      // 「PNG blob を準備して URL を作る」だけで、書き込み成否は判定不能なので
      // status は 'pending_in_content' (content script で書込予定) を返す。
      let clipboardBlob = null;
      let clipboardObjectUrl = null;
      let clipboardResult = { status: settings.copyToClipboard ? 'pending_in_content' : 'disabled', error: null };
      if (settings.copyToClipboard) {
        try {
          const rawClip = await canvasToBlob(canvas, 'image/png');
          clipboardBlob = await embedEvidenceMetadataIntoPng(rawClip, meta);
          clipboardObjectUrl = URL.createObjectURL(clipboardBlob);
          // 書込側で fetch されないまま放置されるリスクに備えた保険 revoke。
          // SW 側は完了通知が来たら即 revoke を依頼する想定。
          scheduleDownloadUrlRevoke(clipboardObjectUrl);
        } catch (error) {
          clipboardBlob = null;
          clipboardObjectUrl = null;
          clipboardResult = {
            status: 'failed',
            error: normalizeUserMessage(
              error?.message,
              'errClipboardWriteFailed',
              'クリップボードへのコピーに失敗しました。'
            ),
          };
        }
      }

      let blob;
      let savedAsFormat;
      if (settings.format === 'png' && clipboardBlob) {
        // clipboardBlob は既に embed 済み → 再利用。
        blob = clipboardBlob;
        savedAsFormat = 'png';
      } else {
        const built = await buildOutputBlob(canvas, settings.format);
        // PNG なら保存ファイル側にも改ざん検知メタデータを埋める。JPEG/WEBP は対象外。
        blob = built.savedAsFormat === 'png'
          ? await embedEvidenceMetadataIntoPng(built.blob, meta)
          : built.blob;
        savedAsFormat = built.savedAsFormat;
      }
      // Blob 抽出後は Canvas は不要。Object URL 生成の前に GPU バッファを解放。
      releaseCanvas(canvas);

      const fileName = Shared.buildFileName({
        url: meta.url,
        format: savedAsFormat,
        part: meta.part,
        prefix: settings.fileNamePrefix,
      });

      // ---- Blob URL 経由で background に受け渡す ----
      // 旧実装は FileReader で dataURL (Base64) に変換し sendMessage で転送していた。
      // 長いページで 50MB+ の画像を Base64 化 (~1.37 倍) すると IPC ペイロードと
      // メモリピークが爆発するため、同一拡張機能内で共有できる Object URL に切替。
      // offscreen は chrome-extension:// オリジンで SW と同一パーティションのため、
      // SW 側の chrome.downloads.download({url: blobUrl}) からも解決できる。
      const downloadUrl = URL.createObjectURL(blob);
      // background から完了通知が来れば即 revoke。通知が届かない場合の保険として
      // 60 秒後にも自動 revoke する。
      scheduleDownloadUrlRevoke(downloadUrl);

      return {
        ok: true,
        fileName,
        downloadUrl,
        savedAsFormat,
        clipboardStatus: clipboardResult.status,
        clipboardError: clipboardResult.error,
        // pending_in_content の場合のみ意味のある URL。content script で fetch して clipboard.write に渡す。
        clipboardObjectUrl,
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

    releaseCanvas(session.canvas);
    captureSessions.delete(sessionId);
    return { ok: true };
  }

  function scheduleDownloadUrlRevoke(downloadUrl) {
    const timer = setTimeout(() => {
      revokeDownloadUrl(downloadUrl);
    }, 60_000);
    downloadUrlRevokeTimers.set(downloadUrl, timer);
  }

  function revokeDownloadUrl(downloadUrl) {
    if (typeof downloadUrl !== 'string' || !downloadUrl) {
      return;
    }
    const timer = downloadUrlRevokeTimers.get(downloadUrl);
    if (timer) {
      clearTimeout(timer);
      downloadUrlRevokeTimers.delete(downloadUrl);
    }
    try {
      URL.revokeObjectURL(downloadUrl);
    } catch {
      // no-op
    }
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

  function drawMouseCursor(context, canvas, plan) {
    const position = resolveCursorCanvasPosition(canvas, plan);
    if (!position) {
      return;
    }

    const size = Math.max(18, Math.min(34, Math.round(24 * position.devicePixelRatio)));
    const scale = size / 24;

    context.save();
    context.translate(position.x, position.y);
    context.scale(scale, scale);
    context.shadowColor = 'rgba(0, 0, 0, 0.35)';
    context.shadowBlur = 3;
    context.shadowOffsetX = 1;
    context.shadowOffsetY = 2;
    context.beginPath();
    context.moveTo(1, 1);
    context.lineTo(1, 20);
    context.lineTo(6.4, 14.8);
    context.lineTo(9.9, 22.6);
    context.lineTo(14.2, 20.7);
    context.lineTo(10.7, 13);
    context.lineTo(18.2, 13);
    context.closePath();
    context.fillStyle = '#ffffff';
    context.fill();
    context.shadowColor = 'transparent';
    context.lineWidth = 1.6;
    context.strokeStyle = '#111827';
    context.stroke();
    context.restore();
  }

  function resolveCursorCanvasPosition(canvas, plan) {
    const cursor = plan?.cursor;
    if (
      !cursor ||
      typeof cursor.viewportX !== 'number' ||
      typeof cursor.viewportY !== 'number'
    ) {
      return null;
    }

    const devicePixelRatio = Math.max(1, Number(plan.devicePixelRatio) || 1);
    const cropX = Number(plan.cropX) || 0;
    const cropY = Number(plan.cropY) || 0;
    const cropWidth = Number(plan.cropWidth) || Number(plan.viewportWidth) || canvas.width / devicePixelRatio;
    const canvasHeightCss = Number(plan.canvasHeight) || canvas.height / devicePixelRatio;
    const xCss = cursor.viewportX - cropX;
    const yCss = plan.scrollingMode
      ? Number(cursor.pageY) - (Number(plan.tileStartY) || 0)
      : cursor.viewportY - cropY;

    if (
      !Number.isFinite(xCss) ||
      !Number.isFinite(yCss) ||
      xCss < 0 ||
      yCss < 0 ||
      xCss > cropWidth ||
      yCss > canvasHeightCss
    ) {
      return null;
    }

    return {
      x: Math.round(xCss * devicePixelRatio),
      y: Math.round(yCss * devicePixelRatio),
      devicePixelRatio,
    };
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

  // ===== 改ざん検知用 PNG メタデータ埋め込み =====
  // PNG iTXt チャンクとして以下を埋め込む:
  //   EvidenceShot:Version       拡張機能バージョン
  //   EvidenceShot:Timestamp     撮影時刻 (ISO 8601, UTC)
  //   EvidenceShot:URL           クエリとハッシュを除いたページ URL
  //   EvidenceShot:Title         ページタイトル
  //   EvidenceShot:IdatHashSha256  IDAT チャンクの結合バイト列の SHA-256
  // メタデータは IEND の前に挿入する。IDAT のハッシュを別フィールドに記録するため、
  // tEXt 追加でハッシュ自体は変動しない (検証スクリプトで再計算可能)。
  // 完全な改ざん耐性ではないが、Photoshop で再エンコードされれば IDAT が変わり
  // ハッシュ不一致になるため、素人改変の検知には十分。
  async function embedEvidenceMetadataIntoPng(blob, meta) {
    try {
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (bytes.length < 8 || sig.some((v, i) => bytes[i] !== v)) {
        return blob;
      }

      // チャンク走査: IDAT バイト列の収集 + IEND の位置検出
      const idatChunks = [];
      let iendStart = -1;
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const length =
          ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        if (type === 'IDAT') {
          idatChunks.push(bytes.subarray(offset + 8, offset + 8 + length));
        }
        if (type === 'IEND') {
          iendStart = offset;
          break;
        }
        offset += 12 + length;
      }
      if (iendStart < 0 || idatChunks.length === 0) {
        return blob;
      }

      // IDAT 結合 → SHA-256
      const idatTotalLen = idatChunks.reduce((sum, c) => sum + c.length, 0);
      const idatConcat = new Uint8Array(idatTotalLen);
      let writePos = 0;
      for (const c of idatChunks) {
        idatConcat.set(c, writePos);
        writePos += c.length;
      }
      const hashBuf = await crypto.subtle.digest('SHA-256', idatConcat);
      const hashHex = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // chrome.runtime.getManifest() は offscreen document では未提供 (TypeError)。
      // SW 側で解決した値を meta.extensionVersion 経由で受け取る。
      const fields = [
        ['EvidenceShot:Version', String(meta?.extensionVersion || '')],
        ['EvidenceShot:Timestamp', new Date().toISOString()],
        ['EvidenceShot:URL', redactEvidenceUrl(meta?.url)],
        ['EvidenceShot:Title', truncateMetadataField(meta?.title, 512)],
        ['EvidenceShot:IdatHashSha256', hashHex],
      ];

      const newChunks = fields.map(([key, value]) => buildPngITextChunk(key, value));

      return new Blob([
        bytes.subarray(0, iendStart),
        ...newChunks,
        bytes.subarray(iendStart),
      ], { type: 'image/png' });
    } catch (error) {
      // メタ埋め込みの失敗は撮影成功自体を妨げない (画像はそのまま返す)。
      console.warn('EvidenceShot: failed to embed PNG metadata', error);
      return blob;
    }
  }

  function redactEvidenceUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) {
      return '';
    }
    try {
      const parsed = new URL(rawUrl);
      return truncateMetadataField(`${parsed.origin}${parsed.pathname}`, 2048);
    } catch {
      return '';
    }
  }

  function truncateMetadataField(value, maxLength) {
    const text = typeof value === 'string' ? value : String(value || '');
    return text.slice(0, maxLength);
  }

  // PNG iTXt チャンク: keyword \0 [compFlag][compMethod] \0 \0 text(UTF-8)
  function buildPngITextChunk(keyword, text) {
    const encoder = new TextEncoder();
    const keywordBytes = encoder.encode(keyword);
    const textBytes = encoder.encode(text);
    const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
    let off = 0;
    data.set(keywordBytes, off); off += keywordBytes.length;
    data[off++] = 0; // keyword null separator
    data[off++] = 0; // compression flag = 0 (uncompressed)
    data[off++] = 0; // compression method
    data[off++] = 0; // language tag (empty) terminator
    data[off++] = 0; // translated keyword (empty) terminator
    data.set(textBytes, off);
    return buildPngChunk('iTXt', data);
  }

  function buildPngChunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const buf = new Uint8Array(8 + data.length + 4);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, data.length);
    buf.set(typeBytes, 4);
    buf.set(data, 8);
    const crcInput = new Uint8Array(typeBytes.length + data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(data, typeBytes.length);
    dv.setUint32(8 + data.length, pngCrc32(crcInput));
    return buf;
  }

  // PNG CRC は ITU-T V.42 (反転 CRC-32, 多項式 0xEDB88320) で計算。
  const PNG_CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function pngCrc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = (PNG_CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

})();
