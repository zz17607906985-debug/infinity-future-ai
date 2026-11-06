'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {createBalanceService} = require('../src/runtime/provider-balance');
const WallpaperStore = require('../src/runtime/wallpaper-store');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('src/index.html');
const app = read('src/app.js');
const main = read('src/main.js');
const preload = read('src/preload.js');
const runtime = read('src/canvas/runtime.js');
const styles = read('src/styles.css');

for (const id of ['homeWallpaper', 'canvasWallpaper', 'canvasWallpaperUpload', 'canvasWallpaperBlur',
  'canvasWallpaperDim', 'canvasWallpaperGridToggle', 'balanceChip', 'balancePopover']) {
  assert.ok(html.includes(`id="${id}"`), `${id} must remain in the interface`);
}
assert.match(app, /canvasWallpaper\?\.load\(s\.canvasWallpaper\)/);
assert.match(app, /balanceChip\?\.load\(s\.balanceChipProviderId\)/);
assert.match(app, /canvasWallpaper: canvasWallpaper\?\.value\(\)/);
assert.match(app, /balanceChipProviderId: balanceChip \? balanceChip\.value\(\)/);
assert.match(main, /ipcMain\.handle\('wallpaper:import'[\s\S]*?wallpaperImageExt\(bytes\)/);
assert.match(main, /ipcMain\.handle\('provider:balance'[\s\S]*?assertTrustedRenderer\(event\)/);
assert.match(preload, /getProviderBalance: request => ipcRenderer\.invoke\('provider:balance'/);
const providerUi = read('src/providers/provider-ui.js');
assert.match(providerUi, /provider\.useGlobalKey \? \$\('apiKey'\)\?\.value\.trim\(\)/);
assert.doesNotMatch(providerUi, /FutureAIApiDefaults/);
assert.match(providerUi, /data-provider-detect-models/);
assert.match(providerUi, /function providerAvailabilityHtml\(provider\)/);
assert.match(providerUi, /async function detectAvailableModelsForCard\(card\)/);
assert.match(runtime, /data-background-toggle/);
assert.match(runtime, /node\.data\.backgroundMode === 'transparent' \? 'opaque' : 'transparent'/);
assert.match(styles, /\.image-node\.transparent-preview \.image-preview/);
assert.match(styles, /object-fit:contain!important/);

async function run() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'future-ai-wallpaper-test-'));
  try {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
    const saved = await WallpaperStore.saveWallpaper([dir], bytes, 'png');
    assert.equal(await WallpaperStore.findWallpaper([dir]), saved);
    const original = path.join(dir, 'my-reference.png');
    await fsp.writeFile(original, bytes);
    await WallpaperStore.deleteWallpapers([dir]);
    assert.equal(await WallpaperStore.findWallpaper([dir]), '');
    assert.equal((await fsp.readFile(original)).length, bytes.length, 'deletion must not touch user assets');
  } finally {
    await fsp.rm(dir, {recursive: true, force: true});
  }

  let requests = 0;
  let selectedKeyId = '';
  const service = createBalanceService({
    readKey: ({keyId}) => { selectedKeyId = keyId; return 'secret-not-for-renderer'; },
    fetchImpl: async (url, options) => {
      requests += 1;
      assert.equal(options.headers.Authorization, 'Bearer secret-not-for-renderer');
      assert.match(url, /\/v1\/usage$/);
      return {ok: true, headers: {get: () => 'application/json'}, json: async () => ({
        isValid: true, mode: 'quota_limited', quota: {limit: 10, remaining: 7, used: 3}
      })};
    }
  });
  const request = {providerId: 'one', apiUrl: 'https://relay.example/v1', keyId: 'active'};
  const first = await service.query(request);
  const cached = await service.query(request);
  assert.equal(first.remaining, 7);
  assert.equal(cached.remaining, 7);
  assert.equal(requests, 1, 'balance reads must be cached');
  assert.equal(selectedKeyId, 'active');
  assert.ok(!JSON.stringify(first).includes('secret-not-for-renderer'));
  await service.query({...request, force: true});
  assert.equal(requests, 2);
  console.log('Restored canvas features passed: wallpaper, balance and explicit transparency contracts.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
