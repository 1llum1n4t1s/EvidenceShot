const fs = require('node:fs');
const path = require('node:path');

// 許可rootの境界とリンクを検査してから標準APIへ渡す。
function assertCleanupPath(target, allowedRoot) {
  if (typeof target !== 'string' || !target || typeof allowedRoot !== 'string' || !allowedRoot || !path.isAbsolute(target) || !path.isAbsolute(allowedRoot)) throw new Error('Cleanup paths must be absolute');
  const resolved = path.resolve(target);
  const relative = path.relative(path.resolve(allowedRoot), resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Cleanup target is outside the allowed root');
  for (let current = resolved; ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Cleanup path contains a link'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
  const pending = [resolved];
  while (pending.length) {
    const current = pending.pop();
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Cleanup directory contains a link');
    if (stat.isDirectory()) for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
  }
  return resolved;
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

module.exports = { assertCleanupPath, copyDir };
