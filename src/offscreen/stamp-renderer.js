(function initializeStampRenderer() {
  if (globalThis.WebTestShotStampRenderer) {
    return;
  }

  const Shared = globalThis.WebTestShotShared;

  // スタンプスタイル定義を一元管理。
  // rounded スタイルは drawRoundedStamp に渡す options を返す。
  // 'film' / 'polaroid' / 'pastel' / 'night' のみ専用描画関数を使う。
  function resolveStampDescriptor(style, baseFontSize) {
    switch (style) {
      case 'audit':
        return {
          type: 'rounded',
          options: {
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
          },
        };
      case 'document':
        return {
          type: 'rounded',
          options: {
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
          },
        };
      case 'ledger':
        return {
          type: 'rounded',
          options: {
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
          },
        };
      case 'blueprint':
        return {
          type: 'rounded',
          options: {
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
          },
        };
      case 'monochrome':
        return {
          type: 'rounded',
          options: {
            font: `700 ${Math.round(baseFontSize * 0.9)}px "Aptos", "Yu Gothic UI", sans-serif`,
            textColor: '#f8fafc',
            background: 'rgba(15, 15, 15, 0.86)',
            borderColor: 'rgba(255, 255, 255, 0.22)',
            borderWidth: 1,
            radius: 999,
            paddingX: 0.9,
            paddingY: 0.55,
          },
        };
      case 'compact':
        return {
          type: 'rounded',
          options: {
            font: `700 ${Math.round(baseFontSize * 0.74)}px "Aptos Mono", "Consolas", monospace`,
            textColor: '#0f172a',
            background: 'rgba(255, 255, 255, 0.9)',
            borderColor: 'rgba(148, 163, 184, 0.38)',
            borderWidth: 1,
            radius: 10,
            paddingX: 0.65,
            paddingY: 0.42,
          },
        };
      case 'minimal':
        return {
          type: 'rounded',
          options: {
            font: `600 ${Math.round(baseFontSize * 0.92)}px "Aptos", "Yu Gothic UI", sans-serif`,
            textColor: '#f8fafc',
            background: 'rgba(15, 23, 42, 0.82)',
            radius: 999,
            paddingX: 0.82,
            paddingY: 0.5,
          },
        };
      case 'diary':
        return {
          type: 'rounded',
          options: {
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
          },
        };
      case 'film':
        return { type: 'special', render: drawFilmStamp };
      case 'polaroid':
        return { type: 'special', render: drawPolaroidStamp };
      case 'pastel':
        return { type: 'special', render: drawPastelStamp };
      case 'night':
        return { type: 'special', render: drawNightStamp };
      case 'japanese':
      default:
        return {
          type: 'rounded',
          options: {
            font: `700 ${baseFontSize}px "Aptos", "Yu Gothic UI", sans-serif`,
            textColor: '#fef3c7',
            background: 'rgba(15, 23, 42, 0.7)',
            radius: 18,
            paddingX: 0.9,
            paddingY: 0.58,
          },
        };
    }
  }

  // timestamp と footer label の共通描画本体。position だけ差し替えて同一スタイルを再利用。
  function drawStampOverlay(context, canvas, text, style, size, position) {
    if (!text) {
      return;
    }
    const scale = getTimestampSizeScale(size);
    const baseFontSize = Math.max(18, Math.round(canvas.width * 0.017 * scale));
    const margin = Math.max(20, Math.round(canvas.width * 0.02 * Math.min(scale, 1.26)));

    context.save();
    context.textBaseline = 'middle';

    const descriptor = resolveStampDescriptor(style, baseFontSize);
    if (descriptor.type === 'rounded') {
      drawRoundedStamp(context, canvas, text, { ...descriptor.options, margin, position });
    } else {
      descriptor.render(context, canvas, text, baseFontSize, margin, position);
    }

    context.restore();
  }

  function drawTimestamp(context, canvas, style, size = 'md') {
    const timestamp = Shared.buildTimestampText(resolveTimestampTextStyle(style), new Date());
    drawStampOverlay(context, canvas, timestamp, style, size, 'right');
  }

  function drawFooterLabel(context, canvas, footerText, style, size = 'md') {
    const safeText = String(footerText).trim().slice(0, 80);
    drawStampOverlay(context, canvas, safeText, style, size, 'left');
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
    // Canvas 2D API ネイティブ実装を利用（Chrome 99+、min_chrome_version=117 なので安全）。
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
  }

  globalThis.WebTestShotStampRenderer = {
    drawTimestamp,
    drawFooterLabel,
  };
})();
