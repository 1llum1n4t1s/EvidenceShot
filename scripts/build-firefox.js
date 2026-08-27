#!/usr/bin/env node
// EvidenceShot Firefox 用ビルドスクリプト
// Chrome 用 manifest.json をベースに Firefox AMO 向け manifest を生成し、
// firefox-build/ ディレクトリに配信内容一式 (manifest + icons + src + _locales)
// を展開する。出力ディレクトリは web-ext sign の --source-dir に渡す前提。
//
// 主な差分:
//   - background.service_worker → background.page (Canvas 合成のため DOM 必須)
//   - permissions から 'offscreen' を除外 (Firefox には offscreen API が無い)
//   - minimum_chrome_version を削除 (Firefox では無意味)
//   - browser_specific_settings.gecko を付与 (AMO 必須)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_MANIFEST = path.join(ROOT, 'manifest.json');
const OUT_DIR = path.join(ROOT, 'firefox-build');
const OUT_MANIFEST = path.join(OUT_DIR, 'manifest.json');

// Firefox AMO に登録する拡張機能 ID (UUID 形式)。
// 一度 AMO に submit したら変更不可なので、新規取得時のみ書き換える。
const GECKO_ID = '{ff2db429-9e61-439d-9e11-b565113d5711}';
// chrome.action / chrome.scripting / chrome.commands / chrome.downloads /
// navigator.locks / document.fonts.load が安定して動く Firefox 最小バージョン。
// 140.0 は ESR 140 を含み、かつ data_collection_permissions プロパティを認識する
// バージョン帯への先行対応 (data_collection_permissions 自体は Firefox 142+ で
// 正式サポートされるが、それ未満の Firefox では無視される。AMO 公開には支障なし)。
const STRICT_MIN_VERSION = '140.0';

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function buildFirefoxManifest() {
  const chromeManifest = JSON.parse(fs.readFileSync(SRC_MANIFEST, 'utf8'));
  const ff = { ...chromeManifest };

  // service_worker (DOM 無し) → page (DOM あり event page) に切替。
  // Canvas 合成・PNG iTXt 埋込のために document/canvas が必要なため。
  ff.background = {
    page: 'src/background/background.html',
    persistent: false,
  };

  // offscreen permission は Firefox では unknown 警告 → 除外。
  ff.permissions = (chromeManifest.permissions || []).filter((p) => p !== 'offscreen');

  // minimum_chrome_version は Firefox には無意味なので除去。
  delete ff.minimum_chrome_version;

  // Firefox の拡張機能 ID と最小バージョン。
  // data_collection_permissions は 2026 以降 AMO 必須化。撮影画像はローカル保存のみだが、
  // お問い合わせフォーム (Kagayoi Support) がメールアドレスと確認コードを送るため、
  // personallyIdentifyingInfo と authenticationInfo を申告する。'none' は併記できない。
  ff.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: STRICT_MIN_VERSION,
      data_collection_permissions: {
        required: ['personallyIdentifyingInfo', 'authenticationInfo'],
      },
    },
  };

  return ff;
}

function main() {
  if (!fs.existsSync(SRC_MANIFEST)) {
    fail(`manifest.json が見つかりません: ${SRC_MANIFEST}`);
  }

  // 出力ディレクトリを clean して再構築
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const firefoxManifest = buildFirefoxManifest();
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(firefoxManifest, null, 2) + '\n', 'utf8');
  console.log(`✅ ${path.relative(ROOT, OUT_MANIFEST)} を生成 (version=${firefoxManifest.version})`);

  // 配信ファイル一式をコピー
  const dirsToCopy = ['icons', 'src', '_locales'];
  for (const dir of dirsToCopy) {
    const srcDir = path.join(ROOT, dir);
    if (!fs.existsSync(srcDir)) {
      console.warn(`⚠️  ${dir} ディレクトリが見つからないためスキップ`);
      continue;
    }
    const destDir = path.join(OUT_DIR, dir);
    copyDir(srcDir, destDir);
    console.log(`✅ ${dir}/ をコピー`);
  }

  console.log(`\n🦊 Firefox build dir: ${path.relative(ROOT, OUT_DIR)}`);
}

main();
