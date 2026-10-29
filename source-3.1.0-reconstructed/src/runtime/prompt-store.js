'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('./atomic-write');

// User prompt snippets travel with a copied app folder (prompts/), same idea as templates/.
const SNIPPET_FILE = /^snip-[a-z0-9_-]{4,80}\.json$/i;
const MAX_SNIPPET_BYTES = 16 * 1024;
const MAX_SNIPPETS = 80;

function assertSnippetSize(size) {
  if (!(size > 0)) throw new Error('片段文件是空的');
  if (size > MAX_SNIPPET_BYTES) throw new Error('单个提示词片段不能超过 16 KB');
}

function safeSnippetId(value) {
  const raw = String(value || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 72);
  return raw || `snip-${Date.now().toString(36)}`;
}

function fileNameFor(id) {
  const clean = safeSnippetId(id).replace(/^snip-/, '');
  return `snip-${clean}.json`;
}

async function listSnippetFiles(dir) {
  try {
    return (await fs.readdir(dir)).filter(name => SNIPPET_FILE.test(name)).sort();
  } catch {
    return [];
  }
}

async function readJsonSafe(file) {
  const text = await fs.readFile(file, 'utf8');
  assertSnippetSize(Buffer.byteLength(text, 'utf8'));
  return JSON.parse(text);
}

function scrubText(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (/^(?:[a-z]:[\\/]|\\\\|\/Users\/|\/home\/)/i.test(text) || /^file:/i.test(text) || /^data:/i.test(text)) return '';
  return text.slice(0, 2000);
}

async function listSnippets(dirs) {
  const seen = new Set();
  const items = [];
  for (const dir of dirs) {
    for (const name of await listSnippetFiles(dir)) {
      const idKey = name.toLowerCase();
      if (seen.has(idKey)) continue;
      seen.add(idKey);
      try {
        const data = await readJsonSafe(path.join(dir, name));
        const text = scrubText(data?.text);
        if (!text) continue;
        items.push({
          id: safeSnippetId(data.id || name.replace(/\.json$/i, '')),
          cat: scrubText(data.cat || '我的').slice(0, 20) || '我的',
          label: scrubText(data.label || data.id || '未命名').slice(0, 40) || '未命名',
          text,
          user: true,
          updatedAt: Number(data.updatedAt || data.createdAt || 0),
          createdAt: Number(data.createdAt || Date.now()),
          _file: name,
          _dir: dir
        });
      } catch {
        // skip corrupt
      }
    }
  }
  items.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  return items.slice(0, MAX_SNIPPETS);
}

async function saveSnippet(dirs, definition) {
  if (!definition || typeof definition !== 'object') throw new Error('片段内容无效');
  const text = scrubText(definition.text);
  if (!text) throw new Error('请填写提示词内容');
  const id = safeSnippetId(definition.id || `user-${crypto.randomBytes(3).toString('hex')}`);
  const payload = {
    id,
    cat: scrubText(definition.cat || '我的').slice(0, 20) || '我的',
    label: scrubText(definition.label || id).slice(0, 40) || id,
    text,
    user: true,
    updatedAt: Date.now(),
    createdAt: Number(definition.createdAt || Date.now())
  };
  const body = JSON.stringify(payload, null, 2);
  assertSnippetSize(Buffer.byteLength(body, 'utf8'));
  const name = fileNameFor(id);
  let lastError = null;
  for (const dir of dirs) {
    try {
      await writeFileAtomic(path.join(dir, name), body, { mkdir: true });
      for (const other of dirs) {
        if (other === dir) continue;
        await fs.rm(path.join(other, name), { force: true }).catch(() => {});
      }
      return Object.assign({}, payload, { _file: name, _dir: dir });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法保存片段：${lastError?.message || '没有可写入的位置'}`);
}

async function deleteSnippet(dirs, id) {
  const name = fileNameFor(id);
  let removed = false;
  for (const dir of dirs) {
    try {
      await fs.rm(path.join(dir, name), { force: true });
      removed = true;
    } catch {}
  }
  return removed;
}

module.exports = {
  listSnippets,
  saveSnippet,
  deleteSnippet,
  assertSnippetSize,
  safeSnippetId,
  scrubText,
  MAX_SNIPPETS,
  MAX_SNIPPET_BYTES
};
