'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

const FILE_NAME = 'agent-memory.json';
const MAX_ENTRIES = 200;
const MAX_KEY = 80;
const MAX_VALUE = 2000;
const MAX_TAGS = 8;

function memoryDir(storageDir) {
  return path.join(String(storageDir || ''), '.future-ai');
}

function memoryPath(storageDir) {
  return path.join(memoryDir(storageDir), FILE_NAME);
}

function createId() {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeKey(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, MAX_KEY);
}

function normalizeEntry(raw = {}, { existing } = {}) {
  const key = normalizeKey(raw.key);
  const value = String(raw.value ?? '').trim().slice(0, MAX_VALUE);
  if (!key) throw new Error('记忆键不能为空');
  if (!value) throw new Error('记忆内容不能为空');
  const tags = (Array.isArray(raw.tags) ? raw.tags : String(raw.tags || '').split(/[,，]/))
    .map(tag => String(tag || '').trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  const now = Date.now();
  return {
    id: String(raw.id || existing?.id || createId()),
    key,
    value,
    tags,
    createdAt: existing?.createdAt || Number(raw.createdAt) || now,
    updatedAt: now
  };
}

async function ensureStore(storageDir) {
  if (!storageDir) throw new Error('未设置存储目录');
  const dir = memoryDir(storageDir);
  await fs.mkdir(dir, { recursive: true });
  const file = memoryPath(storageDir);
  if (!fsSync.existsSync(file)) {
    await fs.writeFile(file, JSON.stringify({ version: 1, entries: [] }, null, 2), 'utf8');
  }
  return file;
}

async function readStore(storageDir) {
  const file = await ensureStore(storageDir);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return { file, entries: entries.filter(item => item && item.id && item.key && item.value).slice(0, MAX_ENTRIES) };
  } catch (_err) {
    return { file, entries: [] };
  }
}

async function writeStore(storageDir, entries) {
  const file = await ensureStore(storageDir);
  const cleaned = (Array.isArray(entries) ? entries : []).slice(0, MAX_ENTRIES);
  await fs.writeFile(file, JSON.stringify({ version: 1, entries: cleaned, updatedAt: Date.now() }, null, 2), 'utf8');
  return cleaned;
}

async function listMemory(storageDir) {
  const { entries } = await readStore(storageDir);
  return entries.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function upsertMemory(storageDir, raw = {}) {
  const { entries } = await readStore(storageDir);
  const key = normalizeKey(raw.key);
  const existing = raw.id
    ? entries.find(item => item.id === raw.id)
    : entries.find(item => item.key === key);
  const entry = normalizeEntry(raw, { existing });
  const next = existing
    ? entries.map(item => (item.id === existing.id ? entry : item))
    : [entry, ...entries].slice(0, MAX_ENTRIES);
  await writeStore(storageDir, next);
  return entry;
}

async function deleteMemory(storageDir, idOrKey) {
  const target = String(idOrKey || '').trim();
  if (!target) throw new Error('请指定要删除的记忆 id 或键');
  const { entries } = await readStore(storageDir);
  const next = entries.filter(item => item.id !== target && item.key !== target);
  if (next.length === entries.length) throw new Error(`未找到记忆：${target}`);
  await writeStore(storageDir, next);
  return { ok: true, deleted: target, remaining: next.length };
}

async function forgetMemory(storageDir, { id, key, query } = {}) {
  if (id || key) return deleteMemory(storageDir, id || key);
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) throw new Error('请提供 id、key 或 query');
  const { entries } = await readStore(storageDir);
  const hit = entries.find(item =>
    item.key.toLowerCase().includes(needle) ||
    item.value.toLowerCase().includes(needle) ||
    (item.tags || []).some(tag => String(tag).toLowerCase().includes(needle))
  );
  if (!hit) throw new Error(`未找到匹配记忆：${query}`);
  return deleteMemory(storageDir, hit.id);
}

/** Compact text block for system prompt injection. */
function formatForPrompt(entries = [], { maxChars = 2500 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return '';
  const lines = ['【用户长期记忆 / 偏好】（来自设置，可增删）'];
  let used = lines[0].length;
  for (const item of list) {
    const tags = (item.tags || []).length ? ` [${item.tags.join(', ')}]` : '';
    const line = `- ${item.key}: ${item.value}${tags}`;
    if (used + line.length + 1 > maxChars) {
      lines.push(`…另有 ${list.length - lines.length + 1} 条未展开`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

async function promptBlock(storageDir, options) {
  if (!storageDir) return '';
  try {
    const entries = await listMemory(storageDir);
    return formatForPrompt(entries, options);
  } catch (_err) {
    return '';
  }
}

module.exports = {
  FILE_NAME,
  MAX_ENTRIES,
  memoryPath,
  listMemory,
  upsertMemory,
  deleteMemory,
  forgetMemory,
  formatForPrompt,
  promptBlock,
  normalizeEntry
};
