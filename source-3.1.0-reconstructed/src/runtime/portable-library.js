'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { writeFileAtomic } = require('./atomic-write');

// Portable media library next to the exe (library/). Copy the app folder and these travel with it.
const INDEX_NAME = 'index.json';
const MEDIA_DIR = 'media';
const MAX_ITEMS = 200;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm']);

function safeId(value) {
  const raw = String(value || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return raw || `lib-${Date.now().toString(36)}`;
}

function scrubText(value, max = 500) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (/^(?:[a-z]:[\\/]|\\\\|\/Users\/|\/home\/)/i.test(text) || /^file:/i.test(text)) return '';
  return text.slice(0, max);
}

function normalizeExt(value, kind = 'image') {
  const ext = String(value || '').trim().toLowerCase().replace(/^\./, '');
  if (ALLOWED_EXT.has(ext)) return ext === 'jpeg' ? 'jpg' : ext;
  return kind === 'video' ? 'mp4' : 'png';
}

function mediaDir(root) {
  return path.join(root, MEDIA_DIR);
}

function indexPath(root) {
  return path.join(root, INDEX_NAME);
}

async function ensureLibraryRoot(root) {
  await fs.mkdir(mediaDir(root), { recursive: true });
}

async function readIndex(root) {
  try {
    const text = await fs.readFile(indexPath(root), 'utf8');
    const data = JSON.parse(text);
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

async function writeIndex(root, items) {
  await ensureLibraryRoot(root);
  const payload = {
    version: 1,
    updatedAt: Date.now(),
    items: items.slice(0, MAX_ITEMS)
  };
  await writeFileAtomic(indexPath(root), JSON.stringify(payload, null, 2));
}

function publicItem(root, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fileName = String(raw.fileName || '').replace(/[\\/]/g, '');
  if (!fileName || fileName.includes('..')) return null;
  const file = path.join(mediaDir(root), fileName);
  if (!fsSync.existsSync(file)) return null;
  const kind = raw.kind === 'video' ? 'video' : 'image';
  return {
    id: safeId(raw.id || fileName.replace(/\.[^.]+$/, '')),
    name: scrubText(raw.name || fileName, 80) || fileName,
    kind,
    type: kind,
    prompt: scrubText(raw.prompt || '', 1200),
    tags: Array.isArray(raw.tags) ? raw.tags.map(t => scrubText(t, 24)).filter(Boolean).slice(0, 12) : ['便携'],
    mime: scrubText(raw.mime || '', 80),
    size: scrubText(raw.size || '', 40),
    model: scrubText(raw.model || '', 80),
    time: Number(raw.time || raw.updatedAt || Date.now()),
    updatedAt: Number(raw.updatedAt || raw.time || Date.now()),
    portable: true,
    fileName,
    url: pathToFileURL(file).href,
    urls: [pathToFileURL(file).href],
    bytes: Number(raw.bytes || 0),
    sha256: String(raw.sha256 || '').slice(0, 64)
  };
}

async function listItems(dirs) {
  const seen = new Set();
  const out = [];
  for (const root of dirs) {
    const items = await readIndex(root);
    for (const raw of items) {
      const item = publicItem(root, raw);
      if (!item) continue;
      const key = (item.sha256 || item.id).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  out.sort((a, b) => Number(b.updatedAt || b.time || 0) - Number(a.updatedAt || a.time || 0));
  return out.slice(0, MAX_ITEMS);
}

async function saveBytes(dirs, meta, bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('素材内容为空');
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`单个素材不能超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`);
  const kind = meta?.kind === 'video' ? 'video' : 'image';
  const ext = normalizeExt(meta?.ext, kind);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const id = safeId(meta?.id || `lib-${sha256.slice(0, 12)}`);
  const fileName = `${sha256}.${ext}`;
  const record = {
    id,
    name: scrubText(meta?.name || id, 80) || id,
    kind,
    prompt: scrubText(meta?.prompt || '', 1200),
    tags: Array.isArray(meta?.tags) ? meta.tags.map(t => scrubText(t, 24)).filter(Boolean).slice(0, 12) : ['便携'],
    mime: scrubText(meta?.mime || '', 80),
    size: scrubText(meta?.size || '', 40),
    model: scrubText(meta?.model || '', 80),
    time: Number(meta?.time || Date.now()),
    updatedAt: Date.now(),
    fileName,
    bytes: bytes.length,
    sha256,
    portable: true
  };
  if (!record.tags.includes('便携')) record.tags = ['便携', ...record.tags].slice(0, 12);

  let lastError = null;
  for (const root of dirs) {
    try {
      await ensureLibraryRoot(root);
      const target = path.join(mediaDir(root), fileName);
      if (!fsSync.existsSync(target)) await writeFileAtomic(target, bytes);
      const items = (await readIndex(root)).filter(item => item && item.sha256 !== sha256 && item.id !== id);
      items.unshift(record);
      await writeIndex(root, items);
      for (const other of dirs) {
        if (other === root) continue;
        try {
          const otherItems = (await readIndex(other)).filter(item => item && item.sha256 !== sha256 && item.id !== id);
          if (otherItems.length !== (await readIndex(other)).length) await writeIndex(other, otherItems);
        } catch {}
      }
      return publicItem(root, record);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法写入便携素材库：${lastError?.message || '没有可写入的位置'}`);
}

async function deleteItem(dirs, id) {
  const want = safeId(id);
  let removed = false;
  for (const root of dirs) {
    const items = await readIndex(root);
    const next = [];
    for (const item of items) {
      if (!item) continue;
      if (safeId(item.id) === want || String(item.sha256 || '') === want) {
        removed = true;
        if (item.fileName) {
          await fs.rm(path.join(mediaDir(root), String(item.fileName).replace(/[\\/]/g, '')), { force: true }).catch(() => {});
        }
        continue;
      }
      next.push(item);
    }
    if (next.length !== items.length) await writeIndex(root, next);
  }
  return removed;
}

module.exports = {
  MAX_ITEMS,
  MAX_FILE_BYTES,
  ALLOWED_EXT,
  safeId,
  scrubText,
  normalizeExt,
  listItems,
  saveBytes,
  deleteItem,
  publicItem,
  readIndex
};
