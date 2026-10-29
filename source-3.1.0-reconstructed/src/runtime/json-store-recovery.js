const fs = require('fs');
const {uniqueTempPath, writeFileAtomic} = require('./atomic-write');
const fsp = fs.promises;
const path = require('path');

function assertStoreValue(value) {
  if (!Array.isArray(value)) {
    const error = new Error('存储文件顶层结构必须是数组');
    error.code = 'STORE_INVALID_SHAPE';
    throw error;
  }
  return value;
}

async function readValidStore(file) {
  return assertStoreValue(JSON.parse(await fsp.readFile(file, 'utf8')));
}

const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
const BACKUP_KEEP_RECENT = 10;
const BACKUP_KEEP_DAILY = 7;
const BACKUP_TOTAL_LIMIT_BYTES = 500 * 1024 * 1024;

// Names start with YYYYMMDD-HHMMSS, so lexical order is chronological.
// Keep the newest `keepRecent` plus the newest backup of each of the last `keepDaily` days.
function staleBackupNames(names, {keepRecent = BACKUP_KEEP_RECENT, keepDaily = BACKUP_KEEP_DAILY} = {}) {
  const sorted = [...names].sort((a, b) => b.localeCompare(a));
  const keep = new Set(sorted.slice(0, keepRecent));
  const days = new Set();
  for (const name of sorted) {
    const day = name.slice(0, 8);
    if (days.has(day)) continue;
    days.add(day);
    if (days.size > keepDaily) break;
    keep.add(name);
  }
  return sorted.filter(name => !keep.has(name));
}

// Throttled, rotated backup: `writeBackup(target)` produces the backup file.
async function rotateBackup({backupDir, backupName, suffix, writeBackup, minIntervalMs = BACKUP_MIN_INTERVAL_MS, now = Date.now()}) {
  await fsp.mkdir(backupDir, {recursive: true});
  const existing = (await fsp.readdir(backupDir, {withFileTypes: true}))
    .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (existing.length) {
    const latest = await fsp.stat(path.join(backupDir, existing[0]));
    if (now - latest.mtimeMs < minIntervalMs) return '';
  }
  const backupFile = path.join(backupDir, backupName);
  await writeBackup(backupFile);
  const stale = staleBackupNames([backupName, ...existing.filter(name => name !== backupName)]);
  await Promise.all(stale.map(name => fsp.rm(path.join(backupDir, name), {force: true})));
  return backupFile;
}

async function backupValidStore({file, backupDir, backupName, minIntervalMs, now}) {
  try {
    await readValidStore(file);
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    if (error instanceof SyntaxError || error.code === 'STORE_INVALID_SHAPE') return '';
    throw error;
  }
  return await rotateBackup({
    backupDir, backupName, minIntervalMs, now,
    suffix: `-${path.basename(file)}`,
    writeBackup: target => fsp.copyFile(file, target)
  });
}

async function backupStoreSnapshot({value, backupDir, backupName, suffix, minIntervalMs, now}) {
  assertStoreValue(value);
  return await rotateBackup({
    backupDir, backupName, suffix, minIntervalMs, now,
    writeBackup: async target => {
      await writeFileAtomic(target, JSON.stringify(value));
    }
  });
}

async function listFilesRecursive(dir) {
  let entries;
  try { entries = await fsp.readdir(dir, {withFileTypes: true}); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursive(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

// Deletes the oldest store backups until the given backup folders fit `limitBytes`
// together; the newest backup in each folder is always kept.
async function enforceBackupSizeCap(backupDirs, limitBytes = BACKUP_TOTAL_LIMIT_BYTES) {
  const all = (await Promise.all(backupDirs.map(listFilesRecursive))).flat();
  const files = await Promise.all(all.map(async file => {
    const stats = await fsp.stat(file);
    return {file, size: stats.size, mtimeMs: stats.mtimeMs};
  }));
  const newestPerDir = new Map();
  for (const item of files) {
    const dir = path.dirname(item.file);
    if (!newestPerDir.has(dir) || newestPerDir.get(dir).mtimeMs < item.mtimeMs) newestPerDir.set(dir, item);
  }
  let total = files.reduce((sum, item) => sum + item.size, 0);
  const removed = [];
  for (const item of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= limitBytes) break;
    if (newestPerDir.get(path.dirname(item.file)) === item) continue;
    await fsp.rm(item.file, {force: true});
    total -= item.size;
    removed.push(item.file);
  }
  return {removed, totalBytes: total};
}

async function recoverStoreFromBackup({file, backupDir, corruptDir}) {
  try {
    return {value: await readValidStore(file), recovered: false};
  } catch (error) {
    if (error.code === 'ENOENT') return {value: null, recovered: false};
    const suffix = `-${path.basename(file)}`;
    let candidates = [];
    try {
      candidates = (await fsp.readdir(backupDir, {withFileTypes: true}))
        .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
        .map(entry => path.join(backupDir, entry.name))
        .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
    } catch (readError) {
      if (readError.code !== 'ENOENT') throw readError;
    }
    for (const backupFile of candidates) {
      let value;
      try {
        value = await readValidStore(backupFile);
      } catch (_invalidBackup) {
        continue;
      }
      await fsp.mkdir(corruptDir, {recursive: true});
      const corruptFile = path.join(corruptDir, `${Date.now()}-${path.basename(file)}.corrupt`);
      const tempFile = uniqueTempPath(file, 'recovery.tmp');
      await fsp.copyFile(backupFile, tempFile);
      await fsp.rename(file, corruptFile);
      try {
        await fsp.rename(tempFile, file);
      } catch (commitError) {
        await fsp.rename(corruptFile, file).catch(() => {});
        await fsp.rm(tempFile, {force: true}).catch(() => {});
        throw commitError;
      }
      return {value, recovered: true, backupFile, corruptFile};
    }
    const failure = new Error(`存储文件损坏且没有可用备份：${path.basename(file)}`);
    failure.code = 'STORE_CORRUPT_NO_BACKUP';
    failure.cause = error;
    throw failure;
  }
}

module.exports = {
  assertStoreValue,
  backupStoreSnapshot,
  backupValidStore,
  enforceBackupSizeCap,
  staleBackupNames,
  readValidStore,
  recoverStoreFromBackup
};
