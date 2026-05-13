(function initializeStampRenderer() {
  if (globalThis.EvidenceShotStampRenderer) {
    return;
  }

  const Shared = globalThis.EvidenceShotShared;

  // すべて UDEV Gothic JPDOC を主軸に。日本語・英数字とも単一ファミリーで描く。
  // Aptos / Yu Gothic UI は OS にバンドル webfont が無い (ロード失敗) ときの保険。
  const FONT_FAMILY = '"UDEVGothicJPDOC", "Aptos", "Yu Gothic UI", sans-serif';
  function fontDecl(weight, size) {
    return `${weight} ${size}px ${FONT_FAMILY}`;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function drawTimestamp(context, canvas, style, size = 'md', includeTimezone = true) {
    const text = buildTimestampText(resolveTimestampTextStyle(style), new Date(), includeTimezone);
    drawStampOverlay(context, canvas, text, style, size, 'right');
  }

  function drawFooterLabel(context, canvas, footerText, style, size = 'md') {
    const safeText = String(footerText).trim().slice(0, 80);
    drawStampOverlay(context, canvas, safeText, style, size, 'left');
  }

  function drawStampOverlay(context, canvas, text, style, size, position) {
    if (!text) return;
    const scale = getTimestampSizeScale(size);
    const baseFontSize = Math.max(18, Math.round(canvas.width * 0.017 * scale));
    const margin = Math.max(20, Math.round(canvas.width * 0.02 * Math.min(scale, 1.26)));
    const renderer = STAMP_STYLES[style] || STAMP_STYLES.manuscript;
    context.save();
    context.textBaseline = 'middle';
    renderer(context, canvas, text, baseFontSize, margin, position);
    context.restore();
  }

  // -------------------------------------------------------------------------
  // Text format dispatcher (style → text shape)
  // -------------------------------------------------------------------------

  function resolveTimestampTextStyle(style) {
    switch (style) {
      case 'microfiche':
      case 'neon':
        return 'film';
      case 'receipt':
      case 'blueprint':
      case 'terminal':
      case 'kraft':
      case 'carbon':
      case 'stencil':
      case 'typewriter':
        return 'minimal';
      default:
        return 'japanese';
    }
  }

  function buildTimestampText(format, date = new Date(), includeTimezone = true) {
    const stamp = Shared.buildTimestamp(date);
    const tz = includeTimezone ? ` ${stamp.timezone}` : '';
    switch (format) {
      case 'film':
        return `${stamp.shortYear} ${stamp.month} ${stamp.day}  ${stamp.hours}:${stamp.minutes}:${stamp.seconds}${tz}`;
      case 'minimal':
        return `${stamp.year}.${stamp.month}.${stamp.day}  ${stamp.hours}:${stamp.minutes}:${stamp.seconds}${tz}`;
      case 'japanese':
      default:
        return `${stamp.year}/${stamp.month}/${stamp.day} ${stamp.hours}:${stamp.minutes}:${stamp.seconds}${tz}`;
    }
  }

  function getTimestampSizeScale(size) {
    switch (size) {
      case 'xs': return 0.72;
      case 'sm': return 0.86;
      case 'lg': return 1.18;
      case 'xl': return 1.36;
      case 'md':
      default:   return 1;
    }
  }

  // -------------------------------------------------------------------------
  // Layout helpers
  // -------------------------------------------------------------------------

  // 描画前に context.font をセットしてテキスト幅を測り、文字サイズに比例した
  // padding を加えたボックスサイズを返す。fontSize は実 px 値。
  function measureBox(context, font, text, padX, padY) {
    context.font = font;
    const metrics = context.measureText(text);
    const fontSize = extractFontSize(font);
    return {
      w: metrics.width + fontSize * padX * 2,
      h: fontSize * (padY * 2 + 1),
      fontSize,
    };
  }

  function placeBox(canvas, margin, w, h, position) {
    const left = position === 'left' ? margin : canvas.width - w - margin;
    const top = canvas.height - h - margin;
    return { left, top };
  }

  function extractFontSize(font) {
    const match = /(\d+(?:\.\d+)?)px/.exec(font);
    return match ? Number(match[1]) : 24;
  }

  function roundRect(context, x, y, w, h, r) {
    // min_chrome_version=117 なのでネイティブ roundRect が常に使える。
    context.beginPath();
    context.roundRect(x, y, w, h, r);
  }

  // -------------------------------------------------------------------------
  // Individual stamp renderers (15 styles)
  // -------------------------------------------------------------------------

  // 01 manuscript: 公文書 — 二重枠 + 朱の左罫 + 角の認印
  function drawManuscript(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize);
    const { w, h, fontSize } = measureBox(context, font, text, 1.25, 0.78);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    context.fillStyle = '#fbfaf6';
    context.fillRect(left, top, w, h);

    context.strokeStyle = '#1a1818';
    context.lineWidth = 1.5;
    context.strokeRect(left + 0.75, top + 0.75, w - 1.5, h - 1.5);
    context.lineWidth = 0.5;
    context.strokeRect(left + 4, top + 4, w - 8, h - 8);

    // 左の朱罫 (公文書の余白罫線)
    context.fillStyle = '#a3221a';
    context.fillRect(left + 8, top + 6, 2, h - 12);

    // 「№」mini-label (受付番号風)
    const labelSize = Math.max(8, Math.round(fontSize * 0.42));
    context.font = fontDecl(700, labelSize);
    context.fillStyle = '#a3221a';
    context.textBaseline = 'top';
    context.fillText('№', left + 14, top + 6);

    // 本文
    context.font = font;
    context.fillStyle = '#1a1818';
    context.textBaseline = 'middle';
    context.fillText(text, left + fontSize * 1.25, top + h / 2);

    // 右下に認印 (空円)
    context.strokeStyle = '#a3221a';
    context.lineWidth = 1.2;
    const dotR = Math.max(5, fontSize * 0.3);
    context.beginPath();
    context.arc(left + w - dotR - 6, top + h - dotR - 6, dotR, 0, Math.PI * 2);
    context.stroke();
  }

  // 02 seal: 朱印 (角印) — 二重角枠 + 擦れ
  function drawSeal(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.95);
    const { w, h, fontSize } = measureBox(context, font, text, 1.05, 0.78);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    // 和紙風背景 (印影を浮き立たせる)
    context.fillStyle = '#fdf7e8';
    context.fillRect(left, top, w, h);

    const seal = '#b6271f';
    context.strokeStyle = seal;
    context.lineWidth = 2.4;
    context.strokeRect(left + 2, top + 2, w - 4, h - 4);
    context.lineWidth = 0.8;
    context.strokeRect(left + 6, top + 6, w - 12, h - 12);

    // 印影の擦れ (薄朱の小斑点)
    context.fillStyle = 'rgba(182, 39, 31, 0.22)';
    const speckles = Math.round(w * h / 600);
    for (let i = 0; i < speckles; i += 1) {
      const px = left + 8 + Math.random() * (w - 16);
      const py = top + 8 + Math.random() * (h - 16);
      const s = Math.random() < 0.3 ? 2 : 1;
      context.fillRect(px, py, s, s);
    }

    // 本文 (朱)
    context.font = font;
    context.fillStyle = seal;
    context.textBaseline = 'middle';
    context.fillText(text, left + fontSize * 1.05, top + h / 2);
  }

  // 03 ledger: 会計台帳 — アイボリー紙 + 深緑罫
  function drawLedger(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.92);
    const { w, h, fontSize } = measureBox(context, font, text, 1.1, 0.74);
    const { left, top } = placeBox(canvas, margin, w, h, position);
    const accent = '#0d5440';

    context.fillStyle = '#f4ead4';
    context.fillRect(left, top, w, h);

    // 上下二重罫
    context.strokeStyle = accent;
    context.lineWidth = 1.8;
    context.beginPath();
    context.moveTo(left, top + 2); context.lineTo(left + w, top + 2);
    context.moveTo(left, top + h - 2); context.lineTo(left + w, top + h - 2);
    context.stroke();
    context.lineWidth = 0.6;
    context.beginPath();
    context.moveTo(left, top + 6); context.lineTo(left + w, top + 6);
    context.moveTo(left, top + h - 6); context.lineTo(left + w, top + h - 6);
    context.stroke();

    // 左の縦罫 (台帳の余白罫)
    context.lineWidth = 1.2;
    context.beginPath();
    const colX = left + fontSize * 0.78;
    context.moveTo(colX, top + 8);
    context.lineTo(colX, top + h - 8);
    context.stroke();

    // 「№」mini-label
    const labelSize = Math.max(8, Math.round(fontSize * 0.42));
    context.font = fontDecl(700, labelSize);
    context.fillStyle = accent;
    context.textBaseline = 'top';
    context.fillText('№', left + 10, top + 9);

    // 本文
    context.font = font;
    context.fillStyle = accent;
    context.textBaseline = 'middle';
    context.fillText(text, left + fontSize * 1.1, top + h / 2);
  }

  // 04 blueprint: 青焼き図面 — 紺地 + L字コーナーマーク + 細格子
  function drawBlueprint(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.95);
    const { w, h, fontSize } = measureBox(context, font, text, 1.2, 0.76);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    context.fillStyle = '#0d2840';
    context.fillRect(left, top, w, h);

    // 薄シアンの格子
    context.strokeStyle = 'rgba(174, 224, 254, 0.14)';
    context.lineWidth = 0.6;
    const gridStep = Math.max(6, Math.round(fontSize * 0.55));
    for (let x = gridStep; x < w; x += gridStep) {
      context.beginPath();
      context.moveTo(left + x, top); context.lineTo(left + x, top + h);
      context.stroke();
    }
    for (let y = gridStep; y < h; y += gridStep) {
      context.beginPath();
      context.moveTo(left, top + y); context.lineTo(left + w, top + y);
      context.stroke();
    }

    // L字コーナーマーク (図面の刈り取り目印)
    const cornerLen = Math.max(8, Math.round(fontSize * 0.7));
    context.strokeStyle = '#bae8ff';
    context.lineWidth = 1.6;
    drawCornerL(context, left + 4, top + 4, cornerLen, +1, +1);
    drawCornerL(context, left + w - 4, top + 4, cornerLen, -1, +1);
    drawCornerL(context, left + 4, top + h - 4, cornerLen, +1, -1);
    drawCornerL(context, left + w - 4, top + h - 4, cornerLen, -1, -1);

    // 本文
    context.font = font;
    context.fillStyle = '#bae8ff';
    context.textBaseline = 'middle';
    context.fillText(text, left + fontSize * 1.2, top + h / 2);
  }

  function drawCornerL(context, x, y, len, dx, dy) {
    context.beginPath();
    context.moveTo(x + len * dx, y);
    context.lineTo(x, y);
    context.lineTo(x, y + len * dy);
    context.stroke();
  }

  // 05 terminal: CLI — 黒地 + 緑文字 + $ プロンプト + ブロックカーソル
  function drawTerminal(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.92);
    const promptText = `$ ${text}`;
    // ブロックカーソル幅を含めた仮想の長文でボックスを測り、余裕を確保
    const { w, h, fontSize } = measureBox(context, font, `${promptText}  ▮`, 0.95, 0.78);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    context.fillStyle = '#0c0c0d';
    context.fillRect(left, top, w, h);
    context.strokeStyle = '#5af778';
    context.lineWidth = 0.8;
    context.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);

    // プロンプト + 本文
    context.font = font;
    context.fillStyle = '#5af778';
    context.textBaseline = 'middle';
    const textX = left + fontSize * 0.9;
    context.fillText(promptText, textX, top + h / 2);

    // ブロックカーソル ▮ を実描画 (フォント依存の差を回避するため矩形)
    const promptW = context.measureText(promptText).width;
    const cursorW = fontSize * 0.55;
    const cursorH = fontSize * 0.95;
    context.fillRect(textX + promptW + fontSize * 0.15, top + h / 2 - cursorH / 2, cursorW, cursorH);
  }

  // 06 receipt: 感熱レシート — 灰色紙 + 上下ジザギ + ハサミマーク
  function drawReceipt(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.88);
    const zig = 6;
    const { w, h, fontSize } = measureBox(context, font, text, 1.2, 0.85);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    context.fillStyle = '#e8e3d8';
    // 中央帯
    context.fillRect(left, top + zig, w, h - zig * 2);

    // 上下のジザギ (鋸歯) を中央帯と同じ色で重ねる
    context.beginPath();
    context.moveTo(left, top + zig);
    for (let x = 0; x < w; x += zig) {
      context.lineTo(left + x + zig / 2, top);
      context.lineTo(left + x + zig, top + zig);
    }
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(left, top + h - zig);
    for (let x = 0; x < w; x += zig) {
      context.lineTo(left + x + zig / 2, top + h);
      context.lineTo(left + x + zig, top + h - zig);
    }
    context.closePath();
    context.fill();

    // 左にハサミマーク
    context.font = fontDecl(700, fontSize * 0.7);
    context.fillStyle = '#5a5752';
    context.textBaseline = 'middle';
    context.fillText('✂', left + fontSize * 0.32, top + h / 2);

    // 本文 (黒)
    context.font = font;
    context.fillStyle = '#1a1818';
    context.fillText(text, left + fontSize * 1.2, top + h / 2);
  }

  // 07 kraft: クラフト紙タグ — 茶背景 + 紐穴 + 縦罫
  function drawKraft(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.92);
    const { w, h, fontSize } = measureBox(context, font, text, 1.25, 0.7);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    const grad = context.createLinearGradient(left, top, left, top + h);
    grad.addColorStop(0, '#a08366');
    grad.addColorStop(1, '#85684e');
    context.fillStyle = grad;
    roundRect(context, left, top, w, h, 6);
    context.fill();

    context.strokeStyle = 'rgba(253, 247, 232, 0.25)';
    context.lineWidth = 0.8;
    context.stroke();

    // 紐穴
    context.fillStyle = '#3a2f24';
    context.beginPath();
    context.arc(left + fontSize * 0.55, top + h / 2, Math.max(3, fontSize * 0.22), 0, Math.PI * 2);
    context.fill();

    // 紐穴の右側に縦罫
    context.strokeStyle = 'rgba(244, 234, 212, 0.45)';
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(left + fontSize * 1.0, top + 6);
    context.lineTo(left + fontSize * 1.0, top + h - 6);
    context.stroke();

    // 本文 (クリーム)
    context.font = font;
    context.fillStyle = '#fdf7e8';
    context.textBaseline = 'middle';
    context.fillText(text, left + fontSize * 1.25, top + h / 2);
  }

  // 08 carbon: カーボン複写 — ベージュ紙 + 紫黒文字の複写ズレ
  function drawCarbon(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(400, baseSize * 0.95);
    const { w, h, fontSize } = measureBox(context, font, text, 1.05, 0.74);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    context.fillStyle = '#e8dfc8';
    context.fillRect(left, top, w, h);

    // 細い水平罫 (台紙の罫感)
    context.strokeStyle = 'rgba(80, 60, 90, 0.16)';
    context.lineWidth = 0.5;
    context.beginPath();
    context.moveTo(left + 4, top + 3); context.lineTo(left + w - 4, top + 3);
    context.moveTo(left + 4, top + h - 3); context.lineTo(left + w - 4, top + h - 3);
    context.stroke();

    // 複写のズレ影 (薄い紫)
    context.font = font;
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(70, 40, 90, 0.32)';
    context.fillText(text, left + fontSize * 1.05 + 1.2, top + h / 2 + 0.8);
    // 本文
    context.fillStyle = '#2a1b3d';
    context.fillText(text, left + fontSize * 1.05, top + h / 2);
  }

  // 09 stencil: ステンシル — 黒地 + 上下に黄ハザード斜めストライプ
  function drawStencil(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.92);
    const { w, h, fontSize } = measureBox(context, font, text, 1.2, 0.82);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    context.fillStyle = '#101010';
    context.fillRect(left, top, w, h);

    // 上下のハザード斜めストライプ
    drawHazardStripe(context, left, top, w, 7, '#f7c100');
    drawHazardStripe(context, left, top + h - 7, w, 7, '#f7c100');

    // 本文 (黄)
    context.font = font;
    context.fillStyle = '#f7c100';
    context.textBaseline = 'middle';
    context.fillText(text, left + fontSize * 1.2, top + h / 2);
  }

  function drawHazardStripe(context, x, y, w, h, color) {
    const stripeW = h * 1.8;
    context.save();
    context.beginPath();
    context.rect(x, y, w, h);
    context.clip();
    for (let i = -h; i < w + h; i += stripeW) {
      context.fillStyle = ((i / stripeW) % 2 < 1) ? color : '#101010';
      context.beginPath();
      context.moveTo(x + i, y);
      context.lineTo(x + i + stripeW / 2, y);
      context.lineTo(x + i + stripeW / 2 - h, y + h);
      context.lineTo(x + i - h, y + h);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  // 10 wax-seal: 蝋封 — 深紅丸 + 金枠 + 鋸歯
  function drawWaxSeal(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.85);
    const { w, h, fontSize } = measureBox(context, font, text, 1.1, 0.85);
    const { left, top } = placeBox(canvas, margin, w, h, position);
    const cx = left + w / 2;
    const cy = top + h / 2;
    const radius = h / 2;

    // 蝋の影
    context.save();
    context.shadowColor = 'rgba(94, 14, 21, 0.5)';
    context.shadowBlur = 14;
    context.shadowOffsetY = 6;

    // 蝋本体 (深紅放射状グラデ)
    const grad = context.createRadialGradient(
      cx - radius * 0.35, cy - radius * 0.35, radius * 0.2,
      cx, cy, radius * 1.2
    );
    grad.addColorStop(0, '#902028');
    grad.addColorStop(1, '#4d0a10');
    context.fillStyle = grad;
    roundRect(context, left, top, w, h, radius);
    context.fill();
    context.restore();

    // 上下に鋸歯 (蝋の溶け跡)
    const notches = Math.max(16, Math.round(w / 12));
    context.fillStyle = 'rgba(28, 5, 8, 0.7)';
    for (let i = 0; i < notches; i += 1) {
      const px = left + (w / notches) * i + (w / notches) / 2;
      // 上
      context.beginPath();
      context.moveTo(px - 2.5, top + 2);
      context.lineTo(px, top + 5);
      context.lineTo(px + 2.5, top + 2);
      context.fill();
      // 下
      context.beginPath();
      context.moveTo(px - 2.5, top + h - 2);
      context.lineTo(px, top + h - 5);
      context.lineTo(px + 2.5, top + h - 2);
      context.fill();
    }

    // 金縁 (内枠)
    context.strokeStyle = '#d6b25a';
    context.lineWidth = 1.4;
    roundRect(context, left + 5, top + 5, w - 10, h - 10, Math.max(0, radius - 5));
    context.stroke();

    // 本文 (金)
    context.font = font;
    context.fillStyle = '#f5dba0';
    context.textBaseline = 'middle';
    context.fillText(text, left + fontSize * 1.1, cy);
  }

  // 11 microfiche: マイクロフィルム — 黒地 + フィルム穴 + クロスヘア
  function drawMicrofiche(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.92);
    const { w, h, fontSize } = measureBox(context, font, text, 1.2, 0.85);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    context.fillStyle = '#0d0d0e';
    context.fillRect(left, top, w, h);

    // 上下のフィルム穴 (sprocket)
    const holeStep = Math.max(10, Math.round(fontSize * 0.55));
    context.fillStyle = '#22201d';
    for (let x = holeStep / 2; x < w; x += holeStep) {
      context.fillRect(left + x - 2, top + 3, 4, 3);
      context.fillRect(left + x - 2, top + h - 6, 4, 3);
    }

    // 四隅クロスヘア
    const ch = Math.max(4, Math.round(fontSize * 0.32));
    context.strokeStyle = '#d8a155';
    context.lineWidth = 1;
    drawCrosshair(context, left + 9, top + 10, ch);
    drawCrosshair(context, left + w - 9, top + 10, ch);
    drawCrosshair(context, left + 9, top + h - 10, ch);
    drawCrosshair(context, left + w - 9, top + h - 10, ch);

    // 本文 (琥珀)
    context.font = font;
    context.fillStyle = '#d8a155';
    context.textBaseline = 'middle';
    context.fillText(text, left + fontSize * 1.2, top + h / 2);
  }

  function drawCrosshair(context, cx, cy, size) {
    context.beginPath();
    context.moveTo(cx - size, cy); context.lineTo(cx + size, cy);
    context.moveTo(cx, cy - size); context.lineTo(cx, cy + size);
    context.stroke();
  }

  // 12 postit: 黄色付箋 — 微回転 + テープアクセント + 影
  function drawPostit(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.95);
    const { w, h, fontSize } = measureBox(context, font, text, 1.1, 0.9);
    const { left, top } = placeBox(canvas, margin, w, h, position);
    const cx = left + w / 2;
    const cy = top + h / 2;

    context.save();
    context.translate(cx, cy);
    context.rotate(-0.026); // ≈ -1.5°
    context.shadowColor = 'rgba(150, 100, 0, 0.32)';
    context.shadowBlur = 10;
    context.shadowOffsetY = 5;
    context.fillStyle = '#ffd54a';
    context.fillRect(-w / 2, -h / 2, w, h);
    context.shadowColor = 'transparent';

    // 右上に半透明テープ (内側に少し被せる)
    context.fillStyle = 'rgba(255, 255, 255, 0.55)';
    const tapeW = fontSize * 1.4;
    const tapeH = fontSize * 0.5;
    const tapeX = w / 2 - tapeW * 0.7;
    const tapeY = -h / 2 - tapeH * 0.35;
    context.fillRect(tapeX, tapeY, tapeW, tapeH);
    context.strokeStyle = 'rgba(180, 150, 40, 0.32)';
    context.lineWidth = 0.6;
    context.strokeRect(tapeX, tapeY, tapeW, tapeH);

    // 本文 (黒)
    context.font = font;
    context.fillStyle = '#1a1818';
    context.textBaseline = 'middle';
    context.fillText(text, -w / 2 + fontSize * 1.1, 0);

    context.restore();
  }

  // 13 chalk: 黒板チョーク — 黒板 + チョーク粉 + 白文字
  function drawChalk(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.95);
    const { w, h, fontSize } = measureBox(context, font, text, 1.15, 0.85);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    // 黒板色 (緑寄り墨)
    const grad = context.createLinearGradient(left, top, left + w, top + h);
    grad.addColorStop(0, '#1f2a26');
    grad.addColorStop(1, '#171f1d');
    context.fillStyle = grad;
    context.fillRect(left, top, w, h);

    // チョーク粉ノイズ
    context.fillStyle = 'rgba(245, 242, 232, 0.06)';
    const dustCount = Math.round(w * h / 240);
    for (let i = 0; i < dustCount; i += 1) {
      const px = left + Math.random() * w;
      const py = top + Math.random() * h;
      context.fillRect(px, py, 1, 1);
    }

    // 本文 (白チョーク、わずかなにじみ)
    context.font = font;
    context.fillStyle = '#f5f2e8';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(245, 242, 232, 0.32)';
    context.shadowBlur = 1.6;
    context.fillText(text, left + fontSize * 1.15, top + h / 2);
    context.shadowColor = 'transparent';
  }

  // 14 typewriter: タイプライター — 紙地 + 文字毎 Y ズレ + インクにじみ
  function drawTypewriter(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize * 0.92);
    const { w, h, fontSize } = measureBox(context, font, text, 1.1, 0.78);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    context.fillStyle = '#f4ead4';
    context.fillRect(left, top, w, h);

    // 紙の粒子感
    context.fillStyle = 'rgba(40, 30, 10, 0.05)';
    const grainCount = Math.round(w * h / 600);
    for (let i = 0; i < grainCount; i += 1) {
      const px = left + Math.random() * w;
      const py = top + Math.random() * h;
      context.fillRect(px, py, 1, 1);
    }

    // 一文字ずつ Y 軸を擬似ランダムにずらす (打鍵のインパクトズレ)。
    // shadow による「インクのにじみ」は per-char shadow ラスタライズが 4K で重く、
    // 大きく見た目に効かないので採用しない。Y ズレだけで十分タイプライター感が出る。
    context.font = font;
    context.fillStyle = '#221813';
    context.textBaseline = 'middle';

    let x = left + fontSize * 1.1;
    const cy = top + h / 2;
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i += 1) {
      // 同じ text なら同じズレに見える擬似乱数 (描画ごとに揺れない)
      const off = (((i * 1031) % 7) - 3) * 0.18;
      context.fillText(chars[i], x, cy + off);
      x += context.measureText(chars[i]).width;
    }
  }

  // 15 neon: ネオン — 黒地 + ピンク&シアン二重グロー
  function drawNeon(context, canvas, text, baseSize, margin, position) {
    const font = fontDecl(700, baseSize);
    const { w, h, fontSize } = measureBox(context, font, text, 1.25, 0.9);
    const { left, top } = placeBox(canvas, margin, w, h, position);

    context.fillStyle = '#0a0a14';
    context.fillRect(left, top, w, h);

    // 外側ピンク枠
    context.strokeStyle = '#ff44a8';
    context.lineWidth = 1.5;
    context.shadowColor = '#ff44a8';
    context.shadowBlur = 12;
    roundRect(context, left + 2, top + 2, w - 4, h - 4, 8);
    context.stroke();

    // 内側シアン枠
    context.strokeStyle = '#3df0ff';
    context.lineWidth = 0.8;
    context.shadowColor = '#3df0ff';
    context.shadowBlur = 7;
    roundRect(context, left + 5, top + 5, w - 10, h - 10, 6);
    context.stroke();
    context.shadowColor = 'transparent';

    // 文字: シアン外側グロー → ピンク主グロー → 白ハイライト の 3 層重ね描き。
    // 4K 撮影で shadow ラスタライズが重いので blur 値は控えめに抑える (枠側の glow と
    // 合算で十分な発光感が出る)。
    context.font = font;
    context.textBaseline = 'middle';
    const textX = left + fontSize * 1.25;
    const textY = top + h / 2;

    context.fillStyle = '#3df0ff';
    context.shadowColor = '#3df0ff';
    context.shadowBlur = 10;
    context.fillText(text, textX, textY);

    context.fillStyle = '#ff8acb';
    context.shadowColor = '#ff44a8';
    context.shadowBlur = 6;
    context.fillText(text, textX, textY);

    context.fillStyle = '#ffffff';
    context.shadowColor = 'transparent';
    context.fillText(text, textX, textY);
  }

  // -------------------------------------------------------------------------
  // Dispatch table + export
  // -------------------------------------------------------------------------

  const STAMP_STYLES = {
    manuscript: drawManuscript,
    seal: drawSeal,
    ledger: drawLedger,
    blueprint: drawBlueprint,
    terminal: drawTerminal,
    receipt: drawReceipt,
    kraft: drawKraft,
    carbon: drawCarbon,
    stencil: drawStencil,
    'wax-seal': drawWaxSeal,
    microfiche: drawMicrofiche,
    postit: drawPostit,
    chalk: drawChalk,
    typewriter: drawTypewriter,
    neon: drawNeon,
  };

  globalThis.EvidenceShotStampRenderer = {
    drawTimestamp,
    drawFooterLabel,
  };
})();
