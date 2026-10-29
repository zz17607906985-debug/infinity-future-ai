'use strict';

// Durable agent sessions: one JSON file per session, written atomically after every step, so a
// crash, restart or relay failure leaves a resumable snapshot instead of a lost task.
// Snapshots never contain API keys: model config is supplied fresh on resume.
const fs = require('fs/promises');
const path = require('path');
const { writeJsonAtomic } = require('../runtime/atomic-write');

const VERSION = 1;
const RESUMABLE = new Set(['running', 'awaiting_approval', 'stopped', 'truncated', 'error']);
// Delegated child runs append `_s<n>` to the parent id.
const SESSION_ID = /^agent_[a-z0-9]+_[a-f0-9]+(?:_s\d{1,2})?$/;
const KEY_PATTERNS = [/sk-[A-Za-z0-9_-]{10,}/g, /(bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, /xox[baprs]-[A-Za-z0-9-]{8,}/g];

// Masks key-shaped tokens inside text but keeps the rest, so the history stays usable on resume.
function scrub(value) {
  if (typeof value === 'string') return KEY_PATTERNS.reduce((text, re) => text.replace(re, (match, prefix) => `${typeof prefix === 'string' ? prefix : ''}[REDACTED]`), value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, scrub(child)]));
  return value;
}

// Screenshots are not persisted: they are large and stale after a restart.
const withoutImages = messages => messages.map(item => (item.images ? { ...item, images: undefined } : item));

function sessionFile(root, sessionId) {
  const id = String(sessionId || '');
  if (!SESSION_ID.test(id)) throw new Error('无效的会话编号');
  return path.join(root, `${id}.json`);
}

async function saveSession(root, state) {
  if (!root) return;
  await writeJsonAtomic(sessionFile(root, state.sessionId), { version: VERSION, ...scrub({ ...state, messages: withoutImages(state.messages || []) }), savedAt: Date.now() }, { mkdir: true, space: 0 });
}

async function loadSession(root, sessionId) {
  const raw = JSON.parse(await fs.readFile(sessionFile(root, sessionId), 'utf8'));
  if (raw?.version !== VERSION || !Array.isArray(raw.messages)) throw new Error('会话快照已损坏或版本不兼容');
  return raw;
}

// Discarding a parent also drops its delegated children's snapshots.
async function deleteSession(root, sessionId) {
  if (!root) return;
  await fs.rm(sessionFile(root, sessionId), { force: true });
  let names = [];
  try { names = await fs.readdir(root); } catch (_err) { return; }
  const prefix = `${sessionId}_s`;
  await Promise.all(names.filter(name => name.startsWith(prefix) && name.endsWith('.json')).map(name => fs.rm(path.join(root, name), { force: true })));
}

// A snapshot still marked running/awaiting_approval with no live run behind it was interrupted.
async function listResumable(root, liveIds = new Set()) {
  let names = [];
  try { names = await fs.readdir(root); } catch (_err) { return []; }
  const list = [];
  for (const name of names.filter(item => item.endsWith('.json'))) {
    const sessionId = name.slice(0, -5);
    if (liveIds.has(sessionId) || !SESSION_ID.test(sessionId)) continue;
    try {
      const state = await loadSession(root, sessionId);
      // Children resume through their parent, never on their own.
      if (!RESUMABLE.has(state.status) || state.parentSessionId) continue;
      const interrupted = state.status === 'running' || state.status === 'awaiting_approval';
      list.push({
        sessionId,
        prompt: String(state.prompt || '').slice(0, 200),
        status: interrupted ? 'interrupted' : state.status,
        workspace: state.workspace || '',
        storageDir: state.storageDir || '',
        mode: state.settings?.mode || '',
        plan: Array.isArray(state.plan) ? state.plan : [],
        step: state.step || 0,
        pendingApproval: state.pendingApproval || null,
        error: state.error || '',
        startedAt: state.startedAt || 0,
        savedAt: state.savedAt || 0,
        resumable: true,
        done: true
      });
    } catch (_err) { /* unreadable snapshot: skip, never block the list */ }
  }
  return list.sort((a, b) => b.savedAt - a.savedAt);
}

module.exports = { VERSION, scrub, saveSession, loadSession, deleteSession, listResumable, sessionFile };
