'use strict';

const fs = require('fs/promises');
const path = require('path');

const WALLPAPER_IDS = new Set(['none', 'aurora', 'dusk', 'forest', 'ocean', 'mist', 'custom']);

function normalizeUiPreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const result = {};
  if (typeof value.fastCanvasMode === 'boolean') result.fastCanvasMode = value.fastCanvasMode;
  if (value.canvasWallpaper && typeof value.canvasWallpaper === 'object') {
    const wallpaper = value.canvasWallpaper;
    const id = String(wallpaper.id || 'none');
    const clamp = (input, max, fallback) => {
      const number = Number(input);
      return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(0, number))) : fallback;
    };
    result.canvasWallpaper = {
      id: WALLPAPER_IDS.has(id) ? id : 'none',
      blur: clamp(wallpaper.blur, 24, 0),
      dim: clamp(wallpaper.dim, 90, 35),
      grid: wallpaper.grid !== false
    };
  }
  return result;
}

async function readUiPreferences(file) {
  try {
    return normalizeUiPreferences(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeUiPreferences(file, value) {
  const normalized = normalizeUiPreferences(value);
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(normalized, null, 2), 'utf8');
  await fs.rename(temp, file);
  return normalized;
}

module.exports = {normalizeUiPreferences, readUiPreferences, writeUiPreferences};
