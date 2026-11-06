'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.FUTURE_AI_PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
async function main() {
  const browser = await chromium.launch({headless: true, executablePath: process.env.FUTURE_AI_BROWSER_EXECUTABLE});
  try {
    const page = await browser.newPage({viewport: {width: 1100, height: 800}});
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('UI fixture:', error.message); });
    await page.setContent('<main id="viewport"><svg id="edges"></svg><input id="imageModel" value="gpt-image-2-adobe"><section class="node image" id="fixture"></section></main>');
    await page.addStyleTag({path: path.join(root, 'src/styles.css')});
    await page.addStyleTag({path: path.join(root, 'src/generation/image-request-policy.css')});
    await page.addStyleTag({content: 'body{overflow:auto} #fixture{position:relative;left:20px;top:20px;width:480px} #fixture .image-panel{display:block;position:relative;opacity:1;visibility:visible}'});
    for (const file of ['src/media/dimensions.js', 'src/ui/render-helpers.js', 'src/canvas/nodes.js', 'src/generation/image-request-policy.js', 'src/generation/generation-queue.js', 'src/canvas/runtime.js']) await page.addScriptTag({path: path.join(root, file)});
    await page.evaluate(() => {
      const node = {id: 'fixture', type: 'image', data: window.FutureAICanvasNodes.normalizeData('image', {prompt: '  完整提示词\n<script>不能执行</script>  ', model: 'gpt-image-2-adobe', aspect: '9:16', resolution: '4K'}), el: document.getElementById('fixture')};
      const provider = {id: 'fixture', name: '本地测试', type: 'openai-images', imageModel: node.data.model};
      const host = {nodes: new Map([[node.id,node]]), edges: [], apiProviders: [provider], selectedNodes: new Set(), canvasTypeFilter: 'all'};
      const queue = window.FutureAIGenerationQueue.create({getNode: () => node, getInputPrompt: () => '', currentProviderForNode: () => provider, imageTargetSize: () => '2304x4096', withCameraPrompt: prompt => '机位：' + prompt, promptWithCanvasContext: prompt => prompt + '\n画布上下文', applyModelAgnosticGenerationRules: prompt => '通用规则\n' + prompt});
      const runtime = window.FutureAICanvasRuntime.create({host, $: id => document.getElementById(id), esc: text => String(text ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'), currentProviderForNode: () => provider, normalizeKnownImageModelAlias: model => model, providerOptionsHtml: () => '<option value="fixture">本地测试</option>', providerModelsForKind: () => [node.data.model], previewImageRequest: (...args) => queue.previewImageRequest(...args), currentWorldBounds: () => ({x:0,y:0,w:1100,h:800}), closeNodeContextMenu: () => {}, queueSave: () => {}, saveProject: () => {}, toast: message => {throw new Error(message);}});
      node.el.innerHTML = runtime.renderImageNode(node);
      node.el.querySelectorAll('[data-field]').forEach(input => {input.value = node.data[input.dataset.field] ?? '';});
      runtime.bindNode(node);
      window.fixture = {node, queue};
    });
    assert.equal(await page.locator('[data-field="quality"]').inputValue(), 'high');
    assert.equal(await page.locator('[data-field="promptMode"]').inputValue(), 'raw');
    await page.locator('[data-preview-request]').click();
    const requestText = await page.getByRole('textbox', {name: '完整图片请求'}).inputValue();
    assert.ok(requestText.endsWith('  完整提示词\n<script>不能执行</script>  '));
    assert.ok(requestText.includes('高质量参数不保证'));
    for (const [width,height] of [[1100,800],[390,720]]) {
      await page.setViewportSize({width,height});
      const bounds = await page.locator('.image-request-dialog').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
      const close = await page.getByRole('button', {name: '关闭', exact:true}).boundingBox();
      assert.ok(close.y + close.height <= height);
    }
    if (process.env.FUTURE_AI_UI_EVIDENCE_DIR) await page.screenshot({path: path.join(process.env.FUTURE_AI_UI_EVIDENCE_DIR, 'image-request-preview-mobile.png')});
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.image-request-dialog').count(), 0);
    await page.setViewportSize({width:1100,height:800});
    await page.locator('[data-field="promptMode"]').selectOption('context');
    await page.locator('[data-preview-request]').click();
    assert.ok((await page.getByRole('textbox',{name:'完整图片请求'}).inputValue()).includes('通用规则\n机位：'));
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.evaluate(() => {fixture.node.data.lastImageRequest = fixture.queue.buildImageRequest(fixture.node); fixture.node.data.prompt = '改过的新提示词';});
    await page.locator('[data-last-request]').click();
    assert.ok(!(await page.getByRole('textbox',{name:'完整图片请求'}).inputValue()).includes('改过的新提示词'));
    if (process.env.FUTURE_AI_UI_EVIDENCE_DIR) await page.screenshot({path:path.join(process.env.FUTURE_AI_UI_EVIDENCE_DIR,'image-request-preview-desktop.png')});
    assert.deepEqual(errors, []);
    console.log('Image request UI passed: real node buttons, raw/context controls, last request, literal text, Escape, desktop/mobile bounds.');
  } finally {await browser.close();}
}
main().catch(error => {console.error(error);process.exitCode=1;});
