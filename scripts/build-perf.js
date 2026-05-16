#!/usr/bin/env node
// パフォーマンス計測専用ビルドスクリプト
// 本番 manifest をベースに `permissions` に `tabs` を一時追加した perf-build/ を生成する。
// cxcx などの自動計測ハーネスが chrome.tabs.query/get で対象タブの URL を取得するために必要。
// `tabs` 権限を本番に入れると CWS / AMO の privacy practices 再記入や審査リスクが増えるため、
// 計測時のみこの build を `cxcx run --ext perf-build` で指定する。

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC_MANIFEST = path.join(ROOT, 'manifest.json');
const OUT_DIR = path.join(ROOT, 'perf-build');
const OUT_MANIFEST = path.join(OUT_DIR, 'manifest.json');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  if (!fs.existsSync(SRC_MANIFEST)) {
    console.error('manifest.json が見つかりません');
    process.exit(1);
  }
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const m = JSON.parse(fs.readFileSync(SRC_MANIFEST, 'utf8'));
  const perms = new Set(m.permissions || []);
  perms.add('tabs');
  m.permissions = Array.from(perms);
  // 計測時は chrome.scripting.executeScript を任意の http(s) ページに inject 可能にする必要があるため
  // host_permissions に <all_urls> を追加。activeTab だけだとブラウザアクションのクリックで
  // activate されていないタブには inject できず、自動計測で「Cannot access contents of url ...
  // Extension manifest must request permission to access this host」エラーになる。
  const hosts = new Set(m.host_permissions || []);
  hosts.add('<all_urls>');
  m.host_permissions = Array.from(hosts);
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(m, null, 2) + '\n', 'utf8');
  console.log(`perf-build/manifest.json を生成 (permissions=tabs, host_permissions=<all_urls> 追加)`);

  for (const d of ['icons', 'src', '_locales']) {
    const s = path.join(ROOT, d);
    if (!fs.existsSync(s)) continue;
    copyDir(s, path.join(OUT_DIR, d));
  }
  console.log(`perf-build/ 生成完了: ${OUT_DIR}`);
}

main();
