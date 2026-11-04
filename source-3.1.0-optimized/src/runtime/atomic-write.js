'use strict';

// One atomic-write implementation for the whole main process.
// - Temp names are unique per call (pid + time + counter + random), so two writers in the same
//   millisecond can never share (and steal) a temp file.
// - Writes to the same target are serialized, so the last caller's content always wins.
// - Windows transiently fails renames with EPERM/EBUSY/EACCES (AV scanners, indexers, open
//   handles); those are retried with backoff. ENOENT (temp vanished) rewrites the temp file.
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOENT', 'EMFILE']);
const queues = new Map();
let counter = 0;

function uniqueTempPath(file, tag = 'tmp') {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${file}.${process.pid}.${Date.now()}.${counter}.${crypto.randomBytes(4).toString('hex')}.${tag}`;
}

function serializeFileWrite(file, work) {
  const key = path.resolve(String(file));
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  queues.set(key, current);
  return current.finally(() => {
    if (queues.get(key) === current) queues.delete(key);
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withFsRetry(work, {retries = 6, baseDelayMs = 15} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work(attempt);
    } catch (err) {
      if (attempt >= retries || !RETRY_CODES.has(err?.code)) throw err;
      await delay(baseDelayMs * 2 ** attempt);
    }
  }
}

// Writes data to a fresh temp file next to target and renames it into place.
async function writeFileAtomicUnlocked(file, data, {encoding = 'utf8', mkdir = false} = {}) {
  if (mkdir) await fsp.mkdir(path.dirname(file), {recursive: true});
  await withFsRetry(async () => {
    const temp = uniqueTempPath(file);
    try {
      await fsp.writeFile(temp, data, Buffer.isBuffer(data) ? undefined : encoding);
      await fsp.rename(temp, file);
    } finally {
      await fsp.rm(temp, {force: true}).catch(() => {});
    }
  });
  return file;
}

function writeFileAtomic(file, data, options = {}) {
  return serializeFileWrite(file, () => writeFileAtomicUnlocked(file, data, options));
}

function writeJsonAtomic(file, value, options = {}) {
  return writeFileAtomic(file, JSON.stringify(value, null, options.space ?? 2), options);
}

module.exports = {uniqueTempPath, serializeFileWrite, withFsRetry, writeFileAtomic, writeFileAtomicUnlocked, writeJsonAtomic};
