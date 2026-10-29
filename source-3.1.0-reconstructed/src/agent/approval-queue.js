'use strict';

const fs = require('fs/promises');
const { writeJsonAtomic } = require('../runtime/atomic-write');
const path = require('path');

const FILE_NAME = 'pending-approvals.json';
const DEFAULT_TTL_MS = 24 * 60 * 60_000;

function createId() {
  return `apr_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function agentDir(storageDir) {
  return path.join(storageDir, 'agent');
}

function queueFile(storageDir) {
  return path.join(agentDir(storageDir), FILE_NAME);
}

async function loadQueue(storageDir) {
  try {
    const data = JSON.parse(await fs.readFile(queueFile(storageDir), 'utf8'));
    return Array.isArray(data?.items) ? data.items : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveQueue(storageDir, items) {
  await fs.mkdir(agentDir(storageDir), { recursive: true });
  const file = queueFile(storageDir);
  await writeJsonAtomic(file, { version: 1, items });
  return items;
}

function isExpired(item, now = Date.now()) {
  return Number(item.expiresAt || 0) > 0 && now >= Number(item.expiresAt);
}

/**
 * In-memory waiters keyed by approval id. Main process resolves these when the user acts.
 */
function createApprovalHub({ defaultTtlMs = DEFAULT_TTL_MS } = {}) {
  const waiters = new Map();

  async function enqueue(storageDir, request = {}) {
    const now = Date.now();
    const ttl = Math.min(Math.max(Number(request.ttlMs) || defaultTtlMs, 60_000), 7 * 24 * 60 * 60_000);
    const item = {
      id: createId(),
      sessionId: String(request.sessionId || ''),
      callId: String(request.callId || ''),
      name: String(request.name || ''),
      arguments: request.arguments || {},
      categories: Array.isArray(request.categories) ? request.categories : [],
      reason: String(request.reason || ''),
      scheduleId: String(request.scheduleId || ''),
      templateId: String(request.templateId || ''),
      status: 'pending',
      createdAt: now,
      expiresAt: now + ttl,
      resolvedAt: 0,
      resolution: ''
    };
    const items = await loadQueue(storageDir);
    items.unshift(item);
    await saveQueue(storageDir, items.slice(0, 200));
    return item;
  }

  function wait(id, { signal, timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      if (waiters.has(id)) {
        reject(new Error('该审批已在等待中'));
        return;
      }
      const entry = { resolve, reject };
      waiters.set(id, entry);
      const onAbort = () => {
        cleanup();
        resolve('cancel');
      };
      const cleanup = () => {
        waiters.delete(id);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
      };
      let timer = null;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          resolve('expire');
        }, timeoutMs);
      }
      if (signal) {
        if (signal.aborted) { cleanup(); resolve('cancel'); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      entry.cleanup = cleanup;
    });
  }

  async function resolve(storageDir, id, answer, { actor = 'user' } = {}) {
    const normalized = answer === 'always' ? 'always' : answer === 'allow' || answer === 'approve' ? 'allow' : answer === 'expire' ? 'expire' : answer === 'cancel' ? 'cancel' : 'deny';
    const items = await loadQueue(storageDir);
    const item = items.find(entry => entry.id === id);
    if (!item) throw new Error('审批项不存在');
    if (item.status !== 'pending') throw new Error('该审批已处理');
    item.status = normalized === 'allow' || normalized === 'always' ? 'approved' : normalized === 'expire' ? 'expired' : normalized === 'cancel' ? 'cancelled' : 'denied';
    item.resolution = normalized;
    item.resolvedAt = Date.now();
    item.actor = actor;
    await saveQueue(storageDir, items);
    const waiter = waiters.get(id);
    if (waiter) {
      waiter.cleanup?.();
      waiter.resolve(normalized);
    }
    return item;
  }

  async function list(storageDir, { includeResolved = false } = {}) {
    const now = Date.now();
    const items = await loadQueue(storageDir);
    let changed = false;
    for (const item of items) {
      if (item.status === 'pending' && isExpired(item, now)) {
        item.status = 'expired';
        item.resolution = 'expire';
        item.resolvedAt = now;
        item.actor = 'system';
        changed = true;
        const waiter = waiters.get(item.id);
        if (waiter) {
          waiter.cleanup?.();
          waiter.resolve('expire');
        }
      }
    }
    if (changed) await saveQueue(storageDir, items);
    return includeResolved ? items : items.filter(item => item.status === 'pending');
  }

  async function pendingCount(storageDir) {
    return (await list(storageDir)).length;
  }

  function _resetForTests() {
    for (const waiter of waiters.values()) {
      try { waiter.cleanup?.(); waiter.resolve('cancel'); } catch (_err) { /* ignore */ }
    }
    waiters.clear();
  }

  return {
    enqueue,
    wait,
    resolve,
    list,
    pendingCount,
    defaultTtlMs,
    _resetForTests,
    waiters
  };
}

module.exports = {
  FILE_NAME,
  DEFAULT_TTL_MS,
  createApprovalHub,
  createId,
  isExpired,
  loadQueue,
  saveQueue
};
