// Chrome 専用 offscreen document のメッセージハンドラ。
// 実体の Canvas 合成・iTXt 埋込ロジックは src/shared/composer.js に集約され、
// このファイルは SW (background.js) からの sendMessage を Composer API に転送する
// 薄いアダプタに留める。Firefox は background.html (event page) 内で Composer を
// 直接呼ぶため offscreen を経由しない。
(function initializeOffscreenProcessor() {
  const Shared = globalThis.EvidenceShotShared;
  const Composer = globalThis.EvidenceShotComposer;
  const { OFFSCREEN_INTERFACE_VERSION, MESSAGE_TYPES } = globalThis.EvidenceShotConstants;
  const t = Shared.t;
  const normalizeUserMessage = Shared.normalizeUserMessage;
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
      return Composer.begin(message.sessionId, message.sessionSecret, message.meta);
    }
    if (message.type === MESSAGE_TYPES.ADD_CAPTURE_SLICE) {
      return Composer.addSlice(message.sessionId, message.sessionSecret, message.capture);
    }
    if (message.type === MESSAGE_TYPES.FINALIZE_CAPTURE_SESSION) {
      return Composer.finalize(message.sessionId, message.sessionSecret);
    }
    if (message.type === MESSAGE_TYPES.ABORT_CAPTURE_SESSION) {
      return Composer.abort(message.sessionId, message.sessionSecret);
    }
    if (message.type === MESSAGE_TYPES.REVOKE_DOWNLOAD_URL) {
      Composer.revokeDownloadUrl(message.downloadUrl);
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
})();
