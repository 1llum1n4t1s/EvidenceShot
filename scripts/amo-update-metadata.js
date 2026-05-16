#!/usr/bin/env node
// AMO listing メタデータ更新スクリプト (API v5)
//
// 使い方:
//   AMO_JWT_ISSUER=... AMO_JWT_SECRET=... node scripts/amo-update-metadata.js
//
// やること:
//   1. PATCH /addons/addon/<gecko-id>/  で summary / description / homepage / support_url /
//      support_email / privacy_policy / categories / tags / default_locale を更新
//   2. POST /addons/addon/<gecko-id>/previews/  で webstore/images/*.png をスクリーンショットとして登録
//
// 注: addon listing 自体は 1.0.17 の web-ext sign で作成済み。本スクリプトは「中身を埋める」役。
//     既に登録されている previews は上書きせず追加する仕様 (重複時は手動で AMO Developer Hub から整理)。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ISSUER = process.env.AMO_JWT_ISSUER;
const SECRET = process.env.AMO_JWT_SECRET;
if (!ISSUER || !SECRET) {
  console.error('❌ AMO_JWT_ISSUER / AMO_JWT_SECRET を環境変数に設定してください');
  process.exit(1);
}

const GECKO_ID = '{ff2db429-9e61-439d-9e11-b565113d5711}';
const API_BASE = 'https://addons.mozilla.org/api/v5';
const ROOT = path.resolve(__dirname, '..');
const ADDON_PATH = `/addons/addon/${encodeURIComponent(GECKO_ID)}`;

function generateJWT() {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER,
    jti: crypto.randomBytes(16).toString('hex'),
    iat: now,
    // AMO は exp が現在時刻から短い (~60s) JWT を要求する。長すぎると弾かれる。
    exp: now + 60,
  };
  const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64u(header)}.${b64u(payload)}`;
  const sig = crypto.createHmac('sha256', SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

async function apiJSON(method, urlPath, body) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `JWT ${generateJWT()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} → ${res.status}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function apiFormData(method, urlPath, formData) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `JWT ${generateJWT()}`,
      Accept: 'application/json',
    },
    body: formData,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} → ${res.status}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function readListing(file) {
  return fs.readFileSync(path.join(ROOT, 'webstore', file), 'utf8').trim();
}

async function patchListing() {
  // summary は 250 字以内推奨 (AMO の hard limit に近い)。
  const summaryJa = 'Web テスト向けに、表示領域 / スクロール連結 / 中央本文のスクリーンショットを 15 種の日時スタンプ入りで保存できる拡張機能。PNG 出力には改ざん検知用の iTXt メタデータを自動付与します。';
  const summaryEn = 'A Firefox extension for evidence-style screenshots (viewport / full-page stitched / main column) with 15 timestamp overlay styles. PNG output embeds tamper-detection iTXt metadata for auditing.';

  const descriptionJa = readListing('store-listing.txt');
  const descriptionEn = readListing('store-listing.en-US.txt');

  const privacyJa = [
    'EvidenceShot はユーザーがポップアップまたはショートカットキーから明示的に撮影を開始した場合にのみ、現在のタブの内容を撮影し、ブラウザの既定ダウンロードフォルダに画像を保存します。',
    '',
    '撮影した画像・URL・タイムスタンプを含む一切の情報を、外部サーバへ送信することはありません。',
    '撮影設定 (フォーマット / スタンプ種別 / クリップボード設定など) は chrome.storage.local に、撮影履歴は同じく chrome.storage.local の captureHistory キーに、最大 50 件まで保存されます。これらの情報はユーザーのブラウザ内のみに残ります。',
    '',
    '広告・トラッキング・アナリティクス目的のコードは一切含みません。',
  ].join('\n');

  const privacyEn = [
    'EvidenceShot captures the current tab\'s contents only when you explicitly start a capture from the popup or via a keyboard shortcut, and saves the resulting image to your browser\'s default download folder.',
    '',
    'No data, including captured images, URLs, or timestamps, is ever sent to any external server.',
    'Capture preferences (format / timestamp style / clipboard option / etc.) are stored solely in chrome.storage.local, and a rolling history of up to 50 captures is stored under the captureHistory key in the same chrome.storage.local. All of this remains on your machine only.',
    '',
    'The extension contains no advertising, tracking, or analytics code.',
  ].join('\n');

  const homepage = 'https://github.com/1llum1n4t1s/EvidenceShot';
  const supportUrl = 'https://github.com/1llum1n4t1s/EvidenceShot/issues';

  const body = {
    default_locale: 'ja',
    summary: { ja: summaryJa, 'en-US': summaryEn },
    description: { ja: descriptionJa, 'en-US': descriptionEn },
    homepage: { ja: homepage, 'en-US': homepage },
    support_url: { ja: supportUrl, 'en-US': supportUrl },
    // support_email も AMO 仕様では translated field (locale ごとに別アドレスを設定可能)
    support_email: { ja: 'yuro.7878@gmail.com', 'en-US': 'yuro.7878@gmail.com' },
    has_privacy_policy: true,
    privacy_policy: { ja: privacyJa, 'en-US': privacyEn },
    categories: ['web-development'],
    // AMO の tag は事前定義リスト (https://addons.mozilla.org/api/v5/addons/tags/) のみ可。
    // スクリーンショット用の専用 tag が無いので、最も近い "download" のみ採用。
    tags: ['download'],
    is_experimental: false,
    requires_payment: false,
  };

  console.log('🔧 listing metadata を PATCH...');
  const result = await apiJSON('PATCH', `${ADDON_PATH}/`, body);
  console.log(`✅ metadata 更新成功: slug=${result.slug} guid=${result.guid}`);
  return result;
}

async function uploadPreview(file, captionJa, captionEn) {
  const filePath = path.join(ROOT, 'webstore', 'images', file);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  ${file} が見つかりません。先に \`npm run generate-screenshots\` を実行してください。スキップ`);
    return null;
  }
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.set('image', new Blob([buf], { type: 'image/png' }), file);
  // caption は translated field。multipart では各 locale を `caption[ja]` 形式の
  // 別フィールドで送る (AMO の addons-server が parse する形式)。
  form.set('caption[ja]', captionJa);
  form.set('caption[en-US]', captionEn);

  console.log(`🖼️  ${file} をアップロード...`);
  const result = await apiFormData('POST', `${ADDON_PATH}/previews/`, form);
  console.log(`   ✅ uploaded id=${result.id}`);
  return result;
}

async function listExistingPreviews() {
  try {
    const result = await apiJSON('GET', `${ADDON_PATH}/previews/`);
    return result?.results || [];
  } catch (e) {
    console.warn('⚠️  既存プレビュー一覧取得に失敗 (続行):', e.message.split('\n')[0]);
    return [];
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const skipMetadata = flags.has('--previews-only');
  const skipPreviews = flags.has('--metadata-only');

  if (!skipMetadata) {
    await patchListing();
  }

  if (!skipPreviews) {
    const existing = await listExistingPreviews();
    if (existing.length > 0) {
      console.log(`ℹ️  既存 preview: ${existing.length} 件 (重複したくない場合は AMO Developer Hub で整理してください)`);
    }

    const previews = [
      { file: '01-feature-overview-1280x800.png', ja: '機能概要', en: 'Feature overview' },
      { file: '02-how-to-use-1280x800.png', ja: '使い方', en: 'How to use' },
      { file: '03-hero-promo-1280x800.png', ja: '撮影サンプル', en: 'Sample capture' },
    ];
    for (const p of previews) {
      await uploadPreview(p.file, p.ja, p.en);
    }
  }

  console.log('\n🎉 AMO メタデータ入力完了！');
  console.log('   AMO Developer Hub: https://addons.mozilla.org/developers/addon/evidenceshot/');
}

main().catch((e) => {
  console.error('❌ エラー:');
  console.error(e.message);
  process.exit(1);
});
