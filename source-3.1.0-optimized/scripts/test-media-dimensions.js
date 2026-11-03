'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sandbox = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'media', 'dimensions.js'), 'utf8'), sandbox, {filename: 'dimensions.js'});

const dimensions = sandbox.window.FutureAIMediaDimensions;
vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'canvas', 'nodes.js'), 'utf8'), sandbox, {filename: 'nodes.js'});
const canvasNodes = sandbox.window.FutureAICanvasNodes;

assert.equal(dimensions.ASPECT_PRESETS.length, 11);
for (const resolution of ['1K', '2K', '4K']) {
  for (const preset of dimensions.ASPECT_PRESETS) {
    const size = dimensions.imageSizeForResolution(preset.value, resolution);
    assert.ok(dimensions.parseSize(size), `${resolution} ${preset.value} must resolve to pixels`);
    assert.equal(dimensions.normalizeAspect(size), preset.value, `${resolution} ${size} must preserve ${preset.value}`);
  }
}

assert.equal(dimensions.normalizeAspect('1792x1024'), '16:9', 'legacy image nodes must migrate to 16:9');
assert.equal(dimensions.sizeAspectLabel('1792x1024'), '7:4');
assert.equal(dimensions.sizeAspectLabel('4085x1290'), '19:6');
assert.equal(canvasNodes.normalizeData('image', {size: '1900x600'}).aspect, '19:6', 'legacy image size must not be masked by the new default aspect');
assert.equal(canvasNodes.normalizeData('image', {size: 'custom', customWidth: 900, customHeight: 500}).aspect, 'custom');
assert.equal(dimensions.imageTargetSize({aspect: '16:9', resolution: '4K'}), '4096x2304');
assert.equal(dimensions.imageTargetSize({aspect: '19:6', resolution: '4K'}), '4085x1290');
assert.equal(dimensions.imageTargetSize({aspect: 'custom', customWidth: 1500, customHeight: 700}), '1500x700');
assert.equal(dimensions.imageTargetSize({aspect: 'custom', customWidth: 20, customHeight: 700}), '');

for (const preset of dimensions.VIDEO_PRESETS) {
  assert.equal(dimensions.videoTargetSize(preset.value), preset.value);
}
assert.equal(dimensions.openAiVideoSize('1280x720'), '1280x720');
assert.equal(dimensions.openAiVideoSize('720x1280'), '720x1280');
assert.equal(dimensions.openAiVideoSize('1792x1024'), '1792x1024');
assert.equal(dimensions.openAiVideoSize('1024x1792'), '1024x1792');
assert.equal(dimensions.openAiVideoSize('1024x1024'), '', 'square video must not be silently remapped for OpenAI');
assert.equal(dimensions.customVideoTargetSize({size: 'custom', customWidth: 1280, customHeight: 960}), '1280x960');
assert.equal(dimensions.videoTargetSize({size: 'custom', customWidth: 1280, customHeight: 960}), '1280x960');
assert.equal(dimensions.videoTargetSize({size: 'custom', customWidth: 20, customHeight: 960}), '');
assert.equal(canvasNodes.normalizeData('video', {size: 'custom', customWidth: 1280, customHeight: 960}).size, '1280x960');

console.log('Media dimension tests passed: generation request targets and legacy migration are consistent.');
