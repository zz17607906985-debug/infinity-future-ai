'use strict';

const fs = require('fs/promises');
const { serializeFileWrite, writeJsonAtomic } = require('../runtime/atomic-write');
const fsSync = require('fs');
const path = require('path');

const FILE_NAME = 'templates.json';

function createId() {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeParam(raw = {}) {
  const key = String(raw.key || '').trim().replace(/[^\w\u4e00-\u9fff-]/g, '_').slice(0, 40);
  if (!key) return null;
  return {
    key,
    label: String(raw.label || key).slice(0, 80),
    default: String(raw.default ?? '').slice(0, 2000)
  };
}

function normalizeTemplate(raw = {}, { existing } = {}) {
  const name = String(raw.name || '').trim().slice(0, 80);
  const prompt = String(raw.prompt || '').trim();
  if (!name) throw new Error('请填写模板名称');
  if (!prompt) throw new Error('请填写模板提示词');
  const params = (Array.isArray(raw.params) ? raw.params : [])
    .map(normalizeParam)
    .filter(Boolean)
    .slice(0, 20);
  const now = Date.now();
  return {
    id: String(raw.id || existing?.id || createId()),
    name,
    prompt: prompt.slice(0, 20_000),
    params,
    createdAt: existing?.createdAt || raw.createdAt || now,
    updatedAt: now
  };
}

function detectParams(promptText) {
  const found = [];
  const seen = new Set();
  const re = /\{\{\s*([\w\u4e00-\u9fff-]+)\s*\}\}/g;
  let match;
  while ((match = re.exec(String(promptText || '')))) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    found.push({ key: match[1], label: match[1], default: '' });
  }
  return found;
}

function renderPrompt(template, values = {}) {
  const map = Object.create(null);
  for (const param of template.params || []) map[param.key] = param.default ?? '';
  for (const [key, value] of Object.entries(values || {})) map[key] = String(value ?? '');
  return String(template.prompt || '').replace(/\{\{\s*([\w\u4e00-\u9fff-]+)\s*\}\}/g, (_, key) => (key in map ? map[key] : `{{${key}}}`));
}

function agentDir(storageDir) {
  return path.join(storageDir, 'agent');
}

function templatesFile(storageDir) {
  return path.join(agentDir(storageDir), FILE_NAME);
}

async function loadTemplates(storageDir) {
  const file = templatesFile(storageDir);
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(data?.templates) ? data.templates : Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveTemplates(storageDir, templates) {
  const dir = agentDir(storageDir);
  await fs.mkdir(dir, { recursive: true });
  const file = templatesFile(storageDir);
  await writeJsonAtomic(file, { version: 1, templates });
  return templates;
}

async function listTemplates(storageDir) {
  const list = await loadTemplates(storageDir);
  return list.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function getTemplate(storageDir, id) {
  const list = await loadTemplates(storageDir);
  return list.find(item => item.id === id) || null;
}

async function upsertTemplateUnlocked(storageDir, payload) {
  const list = await loadTemplates(storageDir);
  const index = list.findIndex(item => item.id === payload?.id);
  const next = normalizeTemplate(payload, { existing: index >= 0 ? list[index] : null });
  if (index >= 0) list[index] = next;
  else list.unshift(next);
  await saveTemplates(storageDir, list);
  return next;
}

async function deleteTemplateUnlocked(storageDir, id) {
  const list = await loadTemplates(storageDir);
  const next = list.filter(item => item.id !== id);
  if (next.length === list.length) throw new Error('模板不存在');
  await saveTemplates(storageDir, next);
  return true;
}


// Read-modify-write updates are serialized per store file so concurrent IPC calls cannot drop each other's changes.
function upsertTemplate(...args) {
  return serializeFileWrite(`${templatesFile(args[0])}#update`, () => upsertTemplateUnlocked(...args));
}
function deleteTemplate(...args) {
  return serializeFileWrite(`${templatesFile(args[0])}#update`, () => deleteTemplateUnlocked(...args));
}

module.exports = {
  FILE_NAME,
  createId,
  normalizeTemplate,
  detectParams,
  renderPrompt,
  listTemplates,
  getTemplate,
  upsertTemplate,
  deleteTemplate,
  loadTemplates,
  templatesFile
};
