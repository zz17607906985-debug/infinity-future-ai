'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {normalizeUiPreferences, readUiPreferences, writeUiPreferences} = require('../src/runtime/ui-preferences');

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'future-ai-ui-preferences-'));
  const file = path.join(dir, 'ui-preferences.json');
  try {
    assert.deepEqual(await readUiPreferences(file), {});
    const saved = await writeUiPreferences(file, {
      fastCanvasMode: false,
      canvasWallpaper: {id: 'aurora', blur: 18, dim: 42, grid: false},
      apiProviders: [{id: 'must-not-persist'}]
    });
    assert.deepEqual(saved, {
      fastCanvasMode: false,
      canvasWallpaper: {id: 'aurora', blur: 18, dim: 42, grid: false}
    });
    assert.deepEqual(await readUiPreferences(file), saved);
    const updated = await writeUiPreferences(file, {...saved, fastCanvasMode: true});
    assert.deepEqual(updated, {
      fastCanvasMode: true,
      canvasWallpaper: {id: 'aurora', blur: 18, dim: 42, grid: false}
    });
    assert.deepEqual(await readUiPreferences(file), updated);
    assert.deepEqual(normalizeUiPreferences({
      fastCanvasMode: 'off',
      canvasWallpaper: {id: 'unsupported', blur: 100, dim: -5, grid: 0}
    }), {
      canvasWallpaper: {id: 'none', blur: 24, dim: 0, grid: true}
    });
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
}

main().then(() => {
  console.log('UI preference persistence tests passed.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
