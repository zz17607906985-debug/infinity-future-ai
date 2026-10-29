'use strict';

// Finds project media whose stored path no longer exists (app folder renamed or
// copied to another PC, storage folder moved, library moved) and pulls media that
// lives outside the project's media folder into it, so a project is self-contained.
// Nothing here deletes or rewrites files outside <storageDir>/media.
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const {fileURLToPath, pathToFileURL} = require('url');
const {uniqueTempPath} = require('./atomic-write');

const MEDIA_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac)$/i;
const ANCHORS = ['media', 'library', 'wallpapers', 'templates'];
const IMPORT_LIMIT_BYTES = 1024 * 1024 * 1024;
const INDEX_FILE_LIMIT = 50000;

function refToPath(text) {
  const value = String(text || '');
  if (!value.startsWith('file:')) return '';
  try { return fileURLToPath(value); } catch { return ''; }
}

function isMediaFileRef(text) {
  const file = refToPath(text);
  return Boolean(file) && MEDIA_EXT.test(file);
}

function pathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

// Splits on both separators so a Windows path stored on one PC still yields its tail.
function anchorTail(file) {
  const parts = String(file || '').split(/[\\/]+/).filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i--) {
    const anchor = parts[i].toLowerCase();
    if (ANCHORS.includes(anchor)) return {anchor, tail: parts.slice(i + 1)};
  }
  return null;
}

function baseName(file) {
  const parts = String(file || '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function uniqueDirs(list) {
  const seen = new Set();
  const out = [];
  for (const dir of list || []) {
    if (!dir) continue;
    const resolved = path.resolve(String(dir));
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function walkFiles(dir, depth, out) {
  if (out.size >= INDEX_FILE_LIMIT) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
  for (const entry of entries) {
    if (out.size >= INDEX_FILE_LIMIT) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0 && !entry.name.startsWith('.')) walkFiles(full, depth - 1, out);
    } else if (entry.isFile() && MEDIA_EXT.test(entry.name)) {
      const key = entry.name.toLowerCase();
      if (!out.has(key)) out.set(key, full);
    }
  }
}

// mediaDirs are searched flat (content-addressed files), libraryDirs/extraDirs a few levels deep.
function createResolver({mediaDirs = [], libraryDirs = [], wallpaperDirs = [], templateDirs = [], extraDirs = []} = {}) {
  const dirsByAnchor = {
    media: uniqueDirs(mediaDirs),
    library: uniqueDirs(libraryDirs),
    wallpapers: uniqueDirs(wallpaperDirs),
    templates: uniqueDirs(templateDirs)
  };
  let index = null;
  const buildIndex = () => {
    index = new Map();
    for (const dir of dirsByAnchor.media) walkFiles(dir, 0, index);
    for (const dir of [...dirsByAnchor.library, ...dirsByAnchor.wallpapers, ...dirsByAnchor.templates]) walkFiles(dir, 4, index);
    for (const dir of uniqueDirs(extraDirs)) walkFiles(dir, 1, index);
    return index;
  };
  function resolve(file) {
    if (!file) return '';
    if (fs.existsSync(file)) return file;
    const anchored = anchorTail(file);
    if (anchored && anchored.tail.length) {
      for (const dir of dirsByAnchor[anchored.anchor] || []) {
        const candidate = path.join(dir, ...anchored.tail);
        if (pathInside(dir, candidate) && fs.existsSync(candidate)) return candidate;
      }
    }
    const name = baseName(file).toLowerCase();
    if (!name || !MEDIA_EXT.test(name)) return '';
    return (index || buildIndex()).get(name) || '';
  }
  return {resolve, reset: () => { index = null; }};
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', resolve);
  });
  return hash.digest('hex');
}

// Copies a file into <mediaDir>/<sha256>.<ext> (atomic rename) and returns the target path.
const importCache = new Map();
async function importIntoMedia(mediaDir, file) {
  const stat = await fsp.stat(file);
  if (!stat.isFile() || stat.size > IMPORT_LIMIT_BYTES) throw new Error('媒体文件过大或无效');
  const cacheKey = `${path.resolve(mediaDir)}|${path.resolve(file)}|${stat.size}|${stat.mtimeMs}`;
  const cached = importCache.get(cacheKey);
  if (cached && fs.existsSync(cached)) return cached;
  const ext = (path.extname(file).slice(1) || 'bin').toLowerCase().replace('jpeg', 'jpg');
  const target = path.join(mediaDir, `${await hashFile(file)}.${ext}`);
  if (!fs.existsSync(target)) {
    await fsp.mkdir(mediaDir, {recursive: true});
    const temp = uniqueTempPath(target);
    await fsp.copyFile(file, temp);
    try { await fsp.rename(temp, target); } catch (err) {
      await fsp.rm(temp, {force: true});
      if (!fs.existsSync(target)) throw err;
    }
  }
  importCache.set(cacheKey, target);
  return target;
}

async function mapStringsAsync(value, mapString) {
  if (typeof value === 'string') return await mapString(value);
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await mapStringsAsync(item, mapString));
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = await mapStringsAsync(item, mapString);
    return out;
  }
  return value;
}

// Read side: every file:// media ref that no longer exists is looked up by its
// folder tail / file name; hits outside the current media folder are copied in.
// Refs that cannot be found are left untouched (the canvas shows 「图片文件找不到」).
async function repairStoreRefs(value, {mediaDir, resolver, importFile = importIntoMedia} = {}) {
  const report = {repaired: 0, imported: 0, missing: []};
  const out = await mapStringsAsync(value, async text => {
    if (!isMediaFileRef(text)) return text;
    const file = refToPath(text);
    if (fs.existsSync(file)) return text;
    const found = resolver?.resolve(file);
    if (!found) {
      if (!report.missing.includes(text)) report.missing.push(text);
      return text;
    }
    try {
      const local = mediaDir && !pathInside(mediaDir, found) ? await importFile(mediaDir, found) : found;
      if (local !== found) report.imported += 1;
      report.repaired += 1;
      return pathToFileURL(local).href;
    } catch {
      report.repaired += 1;
      return pathToFileURL(found).href;
    }
  });
  return {value: out, ...report};
}

// Write side: existing media files outside <dir>/media (library, other folders)
// are copied into it so the stored ref can be relative (`media/<file>`).
async function importForeignRefs(value, {mediaDir, importFile = importIntoMedia} = {}) {
  let imported = 0;
  const out = await mapStringsAsync(value, async text => {
    if (!isMediaFileRef(text)) return text;
    const file = refToPath(text);
    if (pathInside(mediaDir, file) || !fs.existsSync(file)) return text;
    try {
      const local = await importFile(mediaDir, file);
      imported += 1;
      return pathToFileURL(local).href;
    } catch {
      return text;
    }
  });
  return {value: out, imported};
}

module.exports = {
  MEDIA_EXT,
  anchorTail,
  createResolver,
  importForeignRefs,
  importIntoMedia,
  isMediaFileRef,
  refToPath,
  repairStoreRefs
};
