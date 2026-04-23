// Chrome Web Store用のスクリーンショット画像を自動生成するスクリプト
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = __dirname;
const OUTPUT_DIR = path.join(__dirname, 'images');

// レンダリング安定化のための待機ミリ秒（font/画像ロードのフォールバック）
const RENDER_SETTLE_MS = 800;
// ストア画像は枚数が少ないため、安定性優先で直列実行に寄せる
const CONCURRENCY = 1;

const HTML_CONFIGS = [
  // スクリーンショット：1280x800
  { input: path.join(TEMPLATE_DIR, '01-feature-overview.html'), output: '01-feature-overview-1280x800.png', width: 1280, height: 800 },
  { input: path.join(TEMPLATE_DIR, '02-how-to-use.html'),       output: '02-how-to-use-1280x800.png',       width: 1280, height: 800 },
  { input: path.join(TEMPLATE_DIR, '03-hero-promo.html'),       output: '03-hero-promo-1280x800.png',       width: 1280, height: 800 },
  // プロモーション タイル（小）：440x280
  { input: path.join(TEMPLATE_DIR, '04-promo-small.html'),      output: 'promo-small-440x280.png',          width: 440,  height: 280 },
  // マーキー プロモーション タイル：1400x560
  { input: path.join(TEMPLATE_DIR, '05-promo-marquee.html'),    output: 'promo-marquee-1400x560.png',       width: 1400, height: 560 },
];

async function generateScreenshot(browser, htmlPath, outputPath, width, height) {
  const page = await browser.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    const absolutePath = path.resolve(htmlPath);
    await page.goto(`file://${absolutePath}`, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    await new Promise(resolve => setTimeout(resolve, RENDER_SETTLE_MS));

    await page.screenshot({
      path: outputPath,
      type: 'png',
      omitBackground: false,
      clip: { x: 0, y: 0, width, height },
      timeout: 120000
    });

    console.log(`✅ 生成完了: ${outputPath} (${width}x${height})`);
  } finally {
    await page.close();
  }
}

async function runWithConcurrency(factories, limit) {
  const results = [];
  for (let i = 0; i < factories.length; i += limit) {
    const chunk = factories.slice(i, i + limit);
    const settled = await Promise.allSettled(chunk.map(fn => fn()));
    results.push(...settled);
  }
  return results;
}

async function main() {
  console.log('🎨 Chrome Web Store用スクリーンショットを生成中...\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    protocolTimeout: 120000
  });

  let results;
  try {
    const factories = HTML_CONFIGS.map(config => {
      const outputPath = path.join(OUTPUT_DIR, config.output);
      return () => generateScreenshot(browser, config.input, outputPath, config.width, config.height);
    });
    results = await runWithConcurrency(factories, CONCURRENCY);
  } finally {
    await browser.close();
  }

  const failures = results
    .map((r, i) => ({ r, config: HTML_CONFIGS[i] }))
    .filter(({ r }) => r.status === 'rejected');

  if (failures.length > 0) {
    failures.forEach(({ r, config }) => {
      console.error(`❌ ${config.input} → ${config.output} の生成に失敗:`, r.reason?.message ?? r.reason);
    });
    process.exit(1);
  }

  console.log('\n✨ すべての画像生成が完了しました！');
  console.log(`\n📂 生成された画像は ${OUTPUT_DIR} ディレクトリにあります。`);

  console.log('\n📋 生成された画像一覧:');
  const files = fs.readdirSync(OUTPUT_DIR);
  files.forEach(file => {
    const filePath = path.join(OUTPUT_DIR, file);
    const stats = fs.statSync(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(`   - ${file} (${sizeKB} KB)`);
  });

  console.log('\n📝 Chrome Web Storeアップロード仕様:');
  console.log('   ✓ スクリーンショット: 1280x800 または 640x400');
  console.log('   ✓ プロモーション タイル（小）: 440x280');
  console.log('   ✓ マーキー プロモーション タイル: 1400x560');
  console.log('   ✓ 形式: PNG (24ビット、アルファなし)');
}

main().catch(error => {
  console.error('❌ エラーが発生しました:', error);
  process.exit(1);
});
