'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.FUTURE_AI_PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
async function main() {
  const browser = await chromium.launch({headless: true, ...(process.env.FUTURE_AI_BROWSER_EXECUTABLE ? {executablePath: process.env.FUTURE_AI_BROWSER_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport: {width: 1440, height: 920}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
    const section = html.slice(html.indexOf('<section id="shortAssets"'), html.indexOf('<section id="shortFrames"'));
    await page.setContent('<body class="dark-mode nexus-layout"><div style="margin-left:220px;padding:12px"><p>隔离 UI 验证 · 300 条模拟资产 · 不保存到用户项目</p>' + section + '</div></body>');
    for (const file of ['src/styles.css', 'src/media/short-asset-pipeline.css']) await page.addStyleTag({content: fs.readFileSync(path.join(root, file), 'utf8')});
    for (const file of ['src/short-batch-coordinator.js', 'src/media/short-workbench.js']) await page.addScriptTag({content: fs.readFileSync(path.join(root, file), 'utf8')});
    const bindings = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8').split('\n').filter(line => /\$\('shortAsset(?:Search|Columns|BrowserTools)'\)\?\.addEventListener/.test(line)).join('\n');
    await page.evaluate(({bindings}) => {
      const storage = new Map();
      Object.defineProperty(window, 'localStorage', {value: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value)}});
      const items = Array.from({length: 300}, (_, index) => {
        const type = ['人物', '场景', '道具'][index % 3];
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="' + ['#284351','#354052','#494236'][index % 3] + '"/><circle cx="160" cy="128" r="55" fill="#a0b8bd"/><text x="160" y="245" text-anchor="middle" font-size="25" fill="white">' + type + ' ' + index + '</text></svg>';
        return {id: 'asset-' + index, name: type + '测试' + index, type, prompt: '测试提示词 ' + index, episodes: [index % 80 + 1], aliases: ['别名' + index], url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), version: 1};
      });
      const host = {assetItems: items, storyboardItems: [], audioPlan: [], timelineItems: [], qcItems: [], shortTaskCoordinator: window.FutureAIShortBatch.createCoordinator()};
      const notices = [];
      const $ = id => document.getElementById(id);
      const workbench = window.FutureAIShortWorkbench.create({host, $, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), safeMediaUrl: value => value || '', saveProject: () => {}, queueSave: () => {}, toast: message => notices.push(message)});
      new Function('$', 'shortWorkbench', 'onShortAssetsListClick', bindings)($, () => workbench, workbench.onShortAssetsListClick);
      $('shortAssetsList').addEventListener('click', workbench.onShortAssetsListClick);
      $('shortAssetsList').addEventListener('input', workbench.onShortAssetsListInput);
      window.fixture = {host, workbench, storage, notices};
      workbench.renderShortWorkbench();
    }, {bindings});
    assert.equal(await page.locator('.short-asset-tile').count(), 300);
    assert.equal(await page.locator('#shortAssetsList textarea').count(), 0, 'no expanded prompt editors in the grid');
    assert.equal(await page.locator('#shortAssetsList img[loading="lazy"]').count(), 300);
    for (const columns of [3, 4, 5, 6, 8]) {
      await page.locator('#shortAssetColumns').selectOption(String(columns));
      const measured = await page.locator('.short-asset-grid').first().evaluate(grid => {
        const firstTop = grid.firstElementChild.getBoundingClientRect().top;
        return [...grid.children].filter(tile => Math.abs(tile.getBoundingClientRect().top - firstTop) < 1).length;
      });
      assert.equal(measured, columns, 'exact columns per row');
    }
    await page.locator('#shortAssetColumns').selectOption('6');
    await page.locator('#shortAssetsList').scrollIntoViewIfNeeded();
    await page.locator('#shortAssetsList').hover();
    await page.mouse.wheel(0, 800);
    await page.waitForFunction(() => document.getElementById('shortAssetsList').scrollTop > 100);
    const scroll = await page.locator('#shortAssetsList').evaluate(element => element.scrollTop);
    await page.evaluate(() => fixture.workbench.renderShortAssets());
    assert.ok(await page.locator('#shortAssetsList').evaluate(element => element.scrollTop) >= scroll - 1, 'generation rerender preserves scroll');
    await page.locator('#shortAssetSearch').fill('asset-297');
    assert.equal(await page.locator('.short-asset-tile').count(), 1);
    assert.equal(await page.locator('.short-asset-tile').getAttribute('data-asset-index'), '297', 'filtered cards retain their original asset identity');
    await page.locator('.short-asset-tile-preview').click();
    await page.locator('#shortAssetDetailDrawer:not(.hidden)').waitFor();
    assert.equal(await page.locator('#shortAssetDetailDrawer .short-asset-detail-preview img').count(), 1);
    await page.locator('#shortAssetDetailBody [data-detail-field="prompt"]').fill('改过的第297号提示词');
    await page.locator('#shortAssetDetailSave').click();
    assert.equal(await page.evaluate(() => fixture.host.assetItems[297].prompt), '改过的第297号提示词');
    assert.equal(await page.evaluate(() => fixture.host.assetItems[0].prompt), '测试提示词 0');
    await page.locator('#shortAssetSearch').fill('第1集');
    assert.equal(await page.locator('.short-asset-tile').count(), 4);
    await page.locator('#shortAssetSearch').fill('不存在的资产');
    assert.equal(await page.locator('.short-asset-tile').count(), 0);
    assert.ok(await page.locator('#shortAssetsList').innerText().then(text => text.includes('没有匹配')));
    await page.locator('#shortAssetSearch').fill('');
    await page.locator('#shortAssetBrowserTools [data-asset-filter="scenes"]').click();
    assert.equal(await page.locator('.short-asset-tile').count(), 100);
    await page.locator('#shortAssetBrowserTools [data-asset-filter="all"]').click();
    await page.evaluate(() => document.getElementById('shortAssetsList').scrollTop = 0);
    if (process.env.FUTURE_AI_UI_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.FUTURE_AI_UI_EVIDENCE_DIR, {recursive: true});
      await page.locator('#shortAssetBrowserTools').scrollIntoViewIfNeeded();
      await page.screenshot({path: path.join(process.env.FUTURE_AI_UI_EVIDENCE_DIR, 'asset-grid-300-fixture.png')});
    }
    for (const width of [1100, 1440]) {
      await page.setViewportSize({width, height: 920});
      await page.locator('#shortAssetColumns').selectOption('8');
      const clipped = await page.locator('.short-asset-grid').first().evaluate(grid => [...grid.querySelectorAll('button')].some(button => button.getBoundingClientRect().right > button.closest('.short-asset-tile').getBoundingClientRect().right + 1));
      assert.equal(clipped, false, 'node buttons fit at ' + width);
    }
    assert.deepEqual(errors, []);
    console.log('Asset browser UI passed: 300 fixtures, 3/4/5/6/8 columns, wheel scrolling, lazy images, search, category filter, original-index editing, narrow controls.');
  } finally {
    await browser.close();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
