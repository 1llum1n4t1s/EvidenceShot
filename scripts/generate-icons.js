const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const svgPath = path.join(__dirname, '../icons/icon.svg');
const iconsDir = path.join(__dirname, '../icons');

async function generateIcons() {
  console.log('🎨 アイコン生成を開始します...\n');

  if (!fs.existsSync(svgPath)) {
    console.error('❌ エラー: icon.svg が見つかりません');
    process.exit(1);
  }

  fs.mkdirSync(iconsDir, { recursive: true });

  const results = await Promise.allSettled(sizes.map(async (size) => {
    const outputPath = path.join(iconsDir, `icon-${size}.png`);
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`✅ ${size}x${size} アイコンを生成しました: ${path.basename(outputPath)}`);
    return size;
  }));

  const failures = results
    .map((r, i) => ({ r, size: sizes[i] }))
    .filter(({ r }) => r.status === 'rejected');

  if (failures.length > 0) {
    failures.forEach(({ r, size }) => {
      console.error(`❌ ${size}x${size} アイコンの生成に失敗しました:`, r.reason?.message ?? r.reason);
    });
    process.exit(1);
  }

  console.log('\n🎉 アイコン生成が完了しました！');
}

generateIcons().catch(error => {
  console.error('❌ エラーが発生しました:', error);
  process.exit(1);
});
