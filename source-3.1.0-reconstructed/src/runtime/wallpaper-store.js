'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('./atomic-write');

// One user-uploaded canvas wallpaper, stored as a copy (never a reference to the original file).
// `dirs` is an ordered list of candidate folders: the first writable one receives the upload and
// lookups return the first match, so the caller decides which location wins.
const WALLPAPER_EXTS = Object.freeze(['png', 'jpg', 'webp']);
const WALLPAPER_MAX_BYTES = 16 * 1024 * 1024;
const WALLPAPER_FILE = /^custom-[0-9a-f]{12}\.(?:png|jpg|webp)$/;

function assertWallpaperSize(size) {
  if (!(size > 0)) throw new Error('壁纸图片是空文件');
  if (size > WALLPAPER_MAX_BYTES) throw new Error(`壁纸图片超过 ${WALLPAPER_MAX_BYTES / 1024 / 1024} MB`);
}

async function listWallpapers(dir) {
  try {
    return (await fs.readdir(dir)).filter(name => WALLPAPER_FILE.test(name)).sort();
  } catch {
    return [];
  }
}

async function findWallpaper(dirs) {
  for (const dir of dirs) {
    const [name] = await listWallpapers(dir);
    if (name) return path.join(dir, name);
  }
  return '';
}

async function removeWallpapers(dirs, keep = '') {
  for (const dir of dirs) {
    for (const name of await listWallpapers(dir)) {
      const file = path.join(dir, name);
      if (file !== keep) await fs.rm(file, {force: true}).catch(() => {});
    }
  }
}

async function saveWallpaper(dirs, bytes, ext) {
  if (!WALLPAPER_EXTS.includes(ext)) throw new Error('壁纸仅支持 PNG、JPG 或 WebP 图片');
  assertWallpaperSize(bytes.length);
  const name = `custom-${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.${ext}`;
  let lastError = null;
  for (const dir of dirs) {
    const file = path.join(dir, name);
    try {
      await writeFileAtomic(file, bytes, {mkdir: true});
    } catch (error) {
      lastError = error;
      continue;
    }
    await removeWallpapers(dirs, file);
    return file;
  }
  throw new Error(`无法保存壁纸：${lastError?.message || '没有可写入的位置'}`);
}

// Only ever touches custom-* uploads inside the given managed folders; no caller-supplied path.
async function deleteWallpapers(dirs) {
  await removeWallpapers(dirs);
  if (await findWallpaper(dirs)) throw new Error('无法删除壁纸图片，文件可能被占用或文件夹只读');
}

module.exports = {WALLPAPER_MAX_BYTES, assertWallpaperSize, deleteWallpapers, findWallpaper, saveWallpaper};
