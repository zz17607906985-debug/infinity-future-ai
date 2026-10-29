'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('./atomic-write');

// User-saved workflow templates travel with a copied app folder (same idea as wallpapers/).
const TEMPLATE_FILE = /^tpl-[a-z0-9_-]{4,80}\.json$/i;
const MAX_TEMPLATE_BYTES = 512 * 1024;
const MAX_TEMPLATES = 100;

function assertTemplateSize(size) {
  if (!(size > 0)) throw new Error('模板文件是空的');
  if (size > MAX_TEMPLATE_BYTES) throw new Error('单个模板不能超过 512 KB');
}

function safeTemplateId(value) {
  const raw = String(value || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 72);
  return raw || `tpl-${Date.now().toString(36)}`;
}

function fileNameFor(id) {
  const clean = safeTemplateId(id).replace(/^tpl-/, '');
  return `tpl-${clean}.json`;
}

async function listTemplateFiles(dir) {
  try {
    return (await fs.readdir(dir)).filter(name => TEMPLATE_FILE.test(name)).sort();
  } catch {
    return [];
  }
}

async function readJsonSafe(file) {
  const text = await fs.readFile(file, 'utf8');
  assertTemplateSize(Buffer.byteLength(text, 'utf8'));
  return JSON.parse(text);
}

async function listTemplates(dirs) {
  const seen = new Set();
  const items = [];
  for (const dir of dirs) {
    for (const name of await listTemplateFiles(dir)) {
      const idKey = name.toLowerCase();
      if (seen.has(idKey)) continue;
      seen.add(idKey);
      try {
        const data = await readJsonSafe(path.join(dir, name));
        if (data && typeof data === 'object') {
          items.push(Object.assign({}, data, {_file: name, _dir: dir}));
        }
      } catch {
        // skip corrupt files; do not block the gallery
      }
    }
  }
  items.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  return items.slice(0, MAX_TEMPLATES);
}

const PRIVATE_KEYS = /^(?:apiKey|apiKeys|keyPool|ciphertext|storageDir|license|activation|secret|token)$/i;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/Users\/|\/home\/)/i;

function scrubPortable(value, key = '') {
  if (PRIVATE_KEYS.test(key)) return undefined;
  if (Array.isArray(value)) return value.map(item => scrubPortable(item)).filter(item => item !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const clean = scrubPortable(childValue, childKey);
      if (clean !== undefined) out[childKey] = clean;
    }
    return out;
  }
  if (typeof value === 'string') {
    if (ABSOLUTE_PATH.test(value) || /^file:/i.test(value)) return '';
    if (/^data:/i.test(value) && value.length > 2048) return '';
  }
  return value;
}

async function saveTemplate(dirs, definition) {
  if (!definition || typeof definition !== 'object') throw new Error('模板内容无效');
  if (!Array.isArray(definition.nodes) || definition.nodes.length < 1) throw new Error('模板至少需要一个节点');
  const id = safeTemplateId(definition.id || `user-${crypto.randomBytes(4).toString('hex')}`);
  const scrubbed = scrubPortable(definition) || {};
  const payload = Object.assign({}, scrubbed, {
    id,
    builtIn: false,
    updatedAt: Date.now(),
    createdAt: Number(definition.createdAt || Date.now())
  });
  // Never persist absolute media paths / data URLs / secrets in portable templates.
  const text = JSON.stringify(payload, null, 2);
  assertTemplateSize(Buffer.byteLength(text, 'utf8'));
  const name = fileNameFor(id);
  let lastError = null;
  for (const dir of dirs) {
    const file = path.join(dir, name);
    try {
      await writeFileAtomic(file, text, {mkdir: true});
      // Remove duplicates with the same id from other candidate dirs.
      for (const other of dirs) {
        if (other === dir) continue;
        await fs.rm(path.join(other, name), {force: true}).catch(() => {});
      }
      return Object.assign({}, payload, {_file: name, _dir: dir});
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法保存模板：${lastError?.message || '没有可写入的位置'}`);
}

async function deleteTemplate(dirs, id) {
  const name = fileNameFor(id);
  let removed = false;
  for (const dir of dirs) {
    try {
      await fs.rm(path.join(dir, name), {force: true});
      removed = true;
    } catch {
      // continue
    }
  }
  if (!removed) throw new Error('找不到要删除的模板');
  // Confirm gone from all dirs
  for (const dir of dirs) {
    try {
      await fs.access(path.join(dir, name));
      throw new Error('无法删除模板，文件可能被占用或文件夹只读');
    } catch (error) {
      if (error && error.message && error.message.includes('无法删除')) throw error;
    }
  }
  return true;
}

module.exports = {
  MAX_TEMPLATE_BYTES,
  MAX_TEMPLATES,
  TEMPLATE_FILE,
  assertTemplateSize,
  safeTemplateId,
  fileNameFor,
  scrubPortable,
  listTemplates,
  saveTemplate,
  deleteTemplate
};
