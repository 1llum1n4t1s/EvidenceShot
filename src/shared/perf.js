// EvidenceShot Performance Collector
// 撮影フローの各 phase の所要時間を chrome.storage.local に蓄積する debug 用ロガー。
// cxcx などの自動計測ツールが拡張機能 storage から完了後に読み出せるよう、
// chrome.storage.local の `_es_perf` キーに最新 N 回分のセッションを保存する。
//
// 使い方:
//   const perf = globalThis.EvidenceShotPerf;
//   perf.mark('phase-start');           // 各 phase の開始/終了で呼ぶ
//   ...
//   perf.mark('phase-end');
//   await perf.flush('shortcut-capture'); // セッション完結時に storage へ書き出し
//
// 各 context (Service Worker / offscreen / content / popup) で独立して mark を打ち、
// 同じ session label で flush すれば context 別に分けて保存される。
(function initializeEvidenceShotPerf() {
  if (globalThis.EvidenceShotPerf) {
    return;
  }

  const MAX_SESSIONS = 10; // 最新 10 セッション分のみ保持 (容量保護)
  const marks = [];

  function contextLabel() {
    // 動作している context を表すラベル。MV3 service worker / offscreen / content / popup を区別。
    try {
      if (typeof window === 'undefined' && typeof self !== 'undefined' && self.constructor?.name === 'ServiceWorkerGlobalScope') {
        return 'sw';
      }
    } catch { /* no-op */ }
    try {
      const href = globalThis.location?.href || '';
      if (href.includes('/offscreen/')) return 'offscreen';
      if (href.includes('/popup/')) return 'popup';
      if (href.startsWith('chrome-extension://')) return 'background-page'; // Firefox event page
    } catch { /* no-op */ }
    // それ以外は content script (web page の document context)
    return 'content';
  }

  const ctx = contextLabel();
  // context ごとに別キーに書くことで複数 context が同時 flush しても race condition で
  // 失われないようにする。cxcx 等の collector 側は `_es_perf_` プレフィックスで全部読む。
  const STORAGE_KEY = '_es_perf_' + ctx;

  function mark(name) {
    // performance.now() は context ごとに origin が異なる (SW context と offscreen context が
    // 別 epoch) ため、複数 context を時系列で比較するには Date.now() (Unix epoch ms) を使う。
    // 高精度な時刻計測は不要 (撮影 phase はミリ秒オーダー = Date.now() の分解能で十分)。
    marks.push({ name, t: Date.now() });
  }

  async function flush(label) {
    if (marks.length === 0) return;
    const session = { ctx, label, at: Date.now(), marks: marks.slice() };
    marks.length = 0;
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const existing = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
      const next = [...existing, session].slice(-MAX_SESSIONS);
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
    } catch (error) {
      // storage 書き込み失敗は撮影本体に影響させない
      console.warn('EvidenceShotPerf.flush failed', error?.message);
    }
  }

  function reset() {
    marks.length = 0;
  }

  // 自身の marks を抜き出して空にする。storage を経由できない context (offscreen 等の
  // 一部 context で chrome.storage.local.set が silent fail するケース) で、return 値に
  // marks を載せて他 context にバケツリレーで届けるための補助 API。
  function drainMarks() {
    const snapshot = marks.slice();
    marks.length = 0;
    return snapshot;
  }

  // 外部から marks をマージする (他 context から渡された marks を自 context の perf log として
  // 取り込むため)。flush 時にまとめて storage に書く。
  function ingestMarks(externalMarks, prefix) {
    if (!Array.isArray(externalMarks)) return;
    const pfx = typeof prefix === 'string' && prefix ? prefix + '.' : '';
    for (const m of externalMarks) {
      if (m && typeof m.name === 'string' && typeof m.t === 'number') {
        marks.push({ name: pfx + m.name, t: m.t });
      }
    }
  }

  globalThis.EvidenceShotPerf = Object.freeze({
    mark,
    flush,
    reset,
    drainMarks,
    ingestMarks,
    context: ctx,
  });
})();
