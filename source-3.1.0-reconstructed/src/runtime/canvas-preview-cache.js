'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.avif']);

function createCanvasPreviewCache({cacheDir, resolveSource, convert, maxSourceBytes = 100 * 1024 * 1024}) {
  const pending = new Map();
  const workers = [Promise.resolve(), Promise.resolve()];
  let nextWorker = 0;

  async function previewUrl(sourceUrl) {
    if (typeof sourceUrl !== 'string' || !sourceUrl.startsWith('file:')) return '';
    const source = await resolveSource(sourceUrl);
    if (!IMAGE_EXTENSIONS.has(path.extname(source).toLowerCase())) return '';
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxSourceBytes) return '';
    const key = crypto.createHash('sha256').update(JSON.stringify([source, stat.size, stat.mtimeMs])).digest('hex');
    const output = path.join(cacheDir, `${key}.png`);
    try {
      if ((await fs.stat(output)).size > 0) return pathToFileURL(output).href;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!pending.has(key)) {
      const worker = nextWorker++ % workers.length;
      const job = workers[worker].catch(() => {}).then(async () => {
        await fs.mkdir(cacheDir, {recursive: true});
        const temporary = path.join(cacheDir, `${key}.${process.pid}.tmp.png`);
        try {
          await convert(source, temporary);
          await fs.rename(temporary, output);
          return pathToFileURL(output).href;
        } finally {
          await fs.rm(temporary, {force: true}).catch(() => {});
        }
      });
      pending.set(key, job);
      workers[worker] = job.catch(() => {});
      job.finally(() => pending.delete(key)).catch(() => {});
    }
    return pending.get(key);
  }

  return {previewUrl};
}

module.exports = {createCanvasPreviewCache};
