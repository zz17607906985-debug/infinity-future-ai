'use strict';
// When the app or the storage folder was copied/moved (another PC, another drive), the saved
// absolute storageDir points at a folder that no longer exists. Map the old path's tail onto the
// current install/profile/Documents locations to find where the folder lives now.
const path = require('path');

function splitParts(dir) {
  return path.resolve(String(dir || '')).split(/[\\/]+/).filter(Boolean);
}

// Candidate folders, most specific first: the last 1..maxTail segments of the old path joined onto each base.
function movedStorageCandidates(oldDir, bases = [], maxTail = 4) {
  const parts = splitParts(oldDir).filter(part => !/^[A-Za-z]:$/.test(part));
  const out = [];
  const seen = new Set();
  const add = dir => {
    const resolved = path.resolve(dir);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(resolved);
  };
  for (let tail = Math.min(maxTail, parts.length); tail >= 1; tail--) {
    const rel = parts.slice(parts.length - tail);
    for (const base of bases) {
      if (!base) continue;
      add(path.join(base, ...rel));
    }
  }
  return out;
}

async function resolveMovedStorageRoot(oldDir, {bases = [], exists, hasStore, extra = []} = {}) {
  const old = path.resolve(String(oldDir || ''));
  if (!oldDir) return {dir: '', moved: false};
  if (await exists(old)) return {dir: old, moved: false};
  for (const candidate of [...movedStorageCandidates(old, bases), ...extra]) {
    if (!candidate || path.resolve(candidate) === old) continue;
    if (await hasStore(candidate)) return {dir: path.resolve(candidate), moved: true, from: old};
  }
  return {dir: old, moved: false, missing: true};
}

module.exports = {movedStorageCandidates, resolveMovedStorageRoot};
