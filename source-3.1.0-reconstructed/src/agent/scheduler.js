'use strict';

const fs = require('fs/promises');
const { serializeFileWrite, writeJsonAtomic } = require('../runtime/atomic-write');
const path = require('path');

const SCHEDULE_FILE = 'schedules.json';
const HISTORY_FILE = 'schedule-history.jsonl';
const HISTORY_LIMIT = 200;

function createId(prefix = 'sch') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function atLocal(date, hour, minute) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function computeNextRun(schedule, from = new Date()) {
  const kind = schedule.kind;
  if (kind === 'interval') {
    const minutes = Math.min(Math.max(Number(schedule.everyMinutes) || 60, 1), 7 * 24 * 60);
    return from.getTime() + minutes * 60_000;
  }
  const time = parseTime(schedule.time || '09:00') || { hour: 9, minute: 0 };
  if (kind === 'daily') {
    let next = atLocal(from, time.hour, time.minute);
    if (next.getTime() <= from.getTime()) next = new Date(next.getTime() + 24 * 60 * 60_000);
    return next.getTime();
  }
  if (kind === 'weekly') {
    const weekday = Math.min(Math.max(Number(schedule.weekday) || 1, 0), 6); // 0=Sun
    let next = atLocal(from, time.hour, time.minute);
    const delta = (weekday - next.getDay() + 7) % 7;
    next = new Date(next.getTime() + delta * 24 * 60 * 60_000);
    if (next.getTime() <= from.getTime()) next = new Date(next.getTime() + 7 * 24 * 60 * 60_000);
    return next.getTime();
  }
  throw new Error(`未知调度类型：${kind}`);
}

function normalizeSchedule(raw = {}, { existing } = {}) {
  const kind = ['daily', 'weekly', 'interval'].includes(raw.kind) ? raw.kind : 'daily';
  const templateId = String(raw.templateId || '').trim();
  if (!templateId) throw new Error('请选择模板');
  const name = String(raw.name || '').trim().slice(0, 80) || '定时任务';
  const mode = ['readonly', 'workspace', 'full'].includes(raw.mode) ? raw.mode : 'workspace';
  const enabled = raw.enabled !== false;
  const base = {
    id: String(raw.id || existing?.id || createId()),
    templateId,
    name,
    kind,
    mode,
    enabled,
    createdAt: existing?.createdAt || raw.createdAt || Date.now(),
    updatedAt: Date.now(),
    lastRunAt: existing?.lastRunAt || raw.lastRunAt || 0,
    lastStatus: existing?.lastStatus || raw.lastStatus || ''
  };
  if (kind === 'interval') {
    base.everyMinutes = Math.min(Math.max(Number(raw.everyMinutes) || 60, 1), 7 * 24 * 60);
  } else {
    if (!parseTime(raw.time || '09:00')) throw new Error('时间格式应为 HH:MM');
    base.time = `${pad(parseTime(raw.time || '09:00').hour)}:${pad(parseTime(raw.time || '09:00').minute)}`;
    if (kind === 'weekly') base.weekday = Math.min(Math.max(Number(raw.weekday) || 1, 0), 6);
  }
  base.nextRunAt = Number(raw.nextRunAt) || computeNextRun(base, new Date());
  return base;
}

function agentDir(storageDir) {
  return path.join(storageDir, 'agent');
}

async function loadSchedules(storageDir) {
  const file = path.join(agentDir(storageDir), SCHEDULE_FILE);
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(data?.schedules) ? data.schedules : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveSchedules(storageDir, schedules) {
  await fs.mkdir(agentDir(storageDir), { recursive: true });
  const file = path.join(agentDir(storageDir), SCHEDULE_FILE);
  await writeJsonAtomic(file, { version: 1, schedules });
  return schedules;
}

async function listSchedules(storageDir) {
  return (await loadSchedules(storageDir)).slice().sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0));
}

async function upsertScheduleUnlocked(storageDir, payload) {
  const list = await loadSchedules(storageDir);
  const index = list.findIndex(item => item.id === payload?.id);
  const next = normalizeSchedule(payload, { existing: index >= 0 ? list[index] : null });
  if (!Number(payload?.nextRunAt)) next.nextRunAt = computeNextRun(next, new Date());
  if (index >= 0) list[index] = next;
  else list.unshift(next);
  await saveSchedules(storageDir, list);
  return next;
}

async function deleteScheduleUnlocked(storageDir, id) {
  const list = await loadSchedules(storageDir);
  const next = list.filter(item => item.id !== id);
  if (next.length === list.length) throw new Error('定时任务不存在');
  await saveSchedules(storageDir, next);
  return true;
}

function dueSchedules(schedules, now = Date.now()) {
  return (schedules || []).filter(item => item.enabled && Number(item.nextRunAt || 0) <= now);
}

async function markScheduleRunUnlocked(storageDir, id, { status, at = Date.now() } = {}) {
  const list = await loadSchedules(storageDir);
  const item = list.find(entry => entry.id === id);
  if (!item) return null;
  item.lastRunAt = at;
  item.lastStatus = String(status || '');
  item.nextRunAt = computeNextRun(item, new Date(at + 1000));
  item.updatedAt = Date.now();
  await saveSchedules(storageDir, list);
  return item;
}

async function appendHistory(storageDir, entry) {
  await fs.mkdir(agentDir(storageDir), { recursive: true });
  const file = path.join(agentDir(storageDir), HISTORY_FILE);
  const line = JSON.stringify({ id: createId('hist'), at: Date.now(), ...entry }) + '\n';
  await fs.appendFile(file, line, 'utf8');
}

async function listHistory(storageDir, { limit = 50 } = {}) {
  const file = path.join(agentDir(storageDir), HISTORY_FILE);
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const lines = text.split(/\n/).filter(Boolean);
  const items = [];
  for (let i = lines.length - 1; i >= 0 && items.length < Math.min(limit, HISTORY_LIMIT); i -= 1) {
    try { items.push(JSON.parse(lines[i])); } catch (_err) { /* skip */ }
  }
  return items;
}


// Read-modify-write updates are serialized per store file so concurrent IPC calls cannot drop each other's changes.
function upsertSchedule(...args) {
  return serializeFileWrite(`${path.join(agentDir(args[0]), SCHEDULE_FILE)}#update`, () => upsertScheduleUnlocked(...args));
}
function deleteSchedule(...args) {
  return serializeFileWrite(`${path.join(agentDir(args[0]), SCHEDULE_FILE)}#update`, () => deleteScheduleUnlocked(...args));
}
function markScheduleRun(...args) {
  return serializeFileWrite(`${path.join(agentDir(args[0]), SCHEDULE_FILE)}#update`, () => markScheduleRunUnlocked(...args));
}

module.exports = {
  SCHEDULE_FILE,
  HISTORY_FILE,
  computeNextRun,
  normalizeSchedule,
  parseTime,
  listSchedules,
  upsertSchedule,
  deleteSchedule,
  dueSchedules,
  markScheduleRun,
  appendHistory,
  listHistory,
  loadSchedules
};
