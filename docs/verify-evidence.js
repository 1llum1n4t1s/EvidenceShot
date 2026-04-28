#!/usr/bin/env node
// EvidenceShot で撮影された PNG ファイルの改ざん検知メタデータを検証するスクリプト
//
// 使い方:
//   node docs/verify-evidence.js <path-to-png>
//
// 出力:
//   - 埋め込まれた EvidenceShot:* メタデータ一覧
//   - IDAT チャンクの SHA-256 を再計算した値
//   - 埋め込みハッシュとの一致 / 不一致
//
// 注意:
//   このスクリプトは「素人による画像改変」を検知することが目的。
//   攻撃者が iTXt の IdatHashSha256 を書き換えることまでは防げない (TSA や署名が必要)。
//   Photoshop で開いて再保存すると IDAT が再エンコードされハッシュ不一致になる。

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function readUint32BE(buf, offset) {
  return buf.readUInt32BE(offset);
}

function decodeITextData(data) {
  // PNG iTXt: keyword \0 [compFlag][compMethod] \0 \0 text
  const sep1 = data.indexOf(0x00);
  if (sep1 < 0) return null;
  const keyword = data.slice(0, sep1).toString('latin1');
  // sep1 + 1 = compression flag
  // sep1 + 2 = compression method
  const langStart = sep1 + 3;
  const sep2 = data.indexOf(0x00, langStart);
  if (sep2 < 0) return null;
  const sep3 = data.indexOf(0x00, sep2 + 1);
  if (sep3 < 0) return null;
  const text = data.slice(sep3 + 1).toString('utf8');
  return { keyword, text };
}

function decodeTextData(data) {
  // PNG tEXt: keyword \0 text(latin1)
  const sep = data.indexOf(0x00);
  if (sep < 0) return null;
  const keyword = data.slice(0, sep).toString('latin1');
  const text = data.slice(sep + 1).toString('latin1');
  return { keyword, text };
}

function verify(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.slice(0, 8).equals(sig)) {
    console.error('❌ Not a valid PNG file:', filePath);
    process.exit(1);
  }

  const evidenceFields = {};
  const idatChunks = [];
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length = readUint32BE(buf, offset);
    const type = buf.slice(offset + 4, offset + 8).toString('latin1');
    const data = buf.slice(offset + 8, offset + 8 + length);

    if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'iTXt') {
      const decoded = decodeITextData(data);
      if (decoded && decoded.keyword.startsWith('EvidenceShot:')) {
        evidenceFields[decoded.keyword] = decoded.text;
      }
    } else if (type === 'tEXt') {
      const decoded = decodeTextData(data);
      if (decoded && decoded.keyword.startsWith('EvidenceShot:')) {
        evidenceFields[decoded.keyword] = decoded.text;
      }
    }

    if (type === 'IEND') break;
    offset += 12 + length;
  }

  console.log('📁 File:', path.basename(filePath));
  console.log();
  console.log('--- Embedded EvidenceShot Metadata ---');
  if (Object.keys(evidenceFields).length === 0) {
    console.log('(no EvidenceShot metadata found — file is not produced by EvidenceShot or stripped)');
    process.exit(2);
  }
  for (const [k, v] of Object.entries(evidenceFields)) {
    console.log(`  ${k}: ${v}`);
  }

  console.log();
  console.log('--- Tamper Check (IDAT SHA-256) ---');
  const idatTotal = Buffer.concat(idatChunks);
  const recomputed = crypto.createHash('sha256').update(idatTotal).digest('hex');
  const embedded = evidenceFields['EvidenceShot:IdatHashSha256'];

  console.log(`  Recomputed: ${recomputed}`);
  console.log(`  Embedded:   ${embedded || '(missing)'}`);
  console.log();

  if (!embedded) {
    console.log('⚠️  No embedded hash. Cannot verify.');
    process.exit(2);
  }
  if (recomputed === embedded) {
    console.log('✅ MATCH — IDAT data is intact (no naive tampering detected).');
    process.exit(0);
  }
  console.log('❌ MISMATCH — image data has been modified after capture.');
  process.exit(3);
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node docs/verify-evidence.js <path-to-png>');
    process.exit(64);
  }
  verify(arg);
}

main();
