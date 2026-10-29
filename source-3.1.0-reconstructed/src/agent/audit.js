'use strict';

const fs = require('fs/promises');
const path = require('path');
const Model = require('./model');

const AUDIT_DIR = 'audit';
const MAX_LINES_PER_FILE = 5000;

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function auditDir(storageDir) {
  return path.join(storageDir, 'agent', AUDIT_DIR);
}

function auditFile(storageDir, key = monthKey()) {
  return path.join(auditDir(storageDir), `${key}.jsonl`);
}

async function appendAudit(storageDir, event = {}) {
  if (!storageDir) return null;
  await fs.mkdir(auditDir(storageDir), { recursive: true });
  const file = auditFile(storageDir);
  const entry = Model.redact({
    at: Date.now(),
    ...event
  });
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return file;
}

async function listAuditMonths(storageDir) {
  try {
    const entries = await fs.readdir(auditDir(storageDir));
    return entries.filter(name => /^\d{4}-\d{2}\.jsonl$/.test(name)).map(name => name.replace(/\.jsonl$/, '')).sort().reverse();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function readAudit(storageDir, { month = monthKey(), limit = 200, sessionId = '' } = {}) {
  const file = auditFile(storageDir, month);
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return { month, entries: [] };
    throw err;
  }
  const lines = text.split(/\n/).filter(Boolean);
  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < Math.min(limit, MAX_LINES_PER_FILE); i -= 1) {
    try {
      const item = JSON.parse(lines[i]);
      if (sessionId && item.sessionId !== sessionId) continue;
      entries.push(item);
    } catch (_err) { /* skip */ }
  }
  return { month, entries };
}

module.exports = {
  AUDIT_DIR,
  monthKey,
  appendAudit,
  listAuditMonths,
  readAudit,
  auditFile
};
