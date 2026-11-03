const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

const context = vm.createContext({
  window: {},
  document: {baseURI: 'file:///E:/FutureAI/src/index.html'},
  URL,
  Blob,
  Uint8Array,
  atob
});
vm.runInContext(read('src/media/media-utils.js'), context, {filename: 'media-utils.js'});
vm.runInContext(read('src/history/history.js'), context, {filename: 'history.js'});
vm.runInContext(read('src/ui/render-helpers.js'), context, {filename: 'render-helpers.js'});

const {safeMediaUrl, safeExternalUrl} = context.window.FutureAIMediaUtils;
assert.equal(safeMediaUrl('javascript:alert(1)'), '');
assert.equal(safeMediaUrl('vbscript:msgbox(1)'), '');
assert.equal(safeMediaUrl('data:text/html,<script>alert(1)</script>'), '');
assert.equal(safeMediaUrl('data:image/svg+xml,<svg onload=alert(1)>'), '');
assert.equal(safeMediaUrl('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
assert.equal(safeMediaUrl('https://example.com/image.png'), 'https://example.com/image.png');
assert.equal(safeExternalUrl('file:///C:/secret.txt'), '');
assert.equal(safeExternalUrl('javascript:alert(1)'), '');
assert.equal(safeExternalUrl('https://example.com/source'), 'https://example.com/source');

const historyHtml = context.window.FutureAICanvasHistory.historyCardsHtml([{
  id: 'history-1',
  type: 'image',
  url: 'javascript:alert(1)',
  model: 'test',
  prompt: 'test'
}]);
assert.doesNotMatch(historyHtml, /<img|<video|javascript:/i);
assert.equal(context.window.FutureAIUIRenderHelpers.referencePreviewHtml({item: {url: 'javascript:alert(1)'}}), '');

const appSource = read('src/app.js');
const canvasSource = read('src/canvas/runtime.js');
const projectSource = read('src/project/store.js');
const shortSource = read('src/media/short-workbench.js');
const workbenchSource = read('src/media/workbench.js');
const dialogSource = read('src/assistant/dialog-runtime.js');
for (const source of [appSource, canvasSource]) {
  assert.doesNotMatch(source, /src="\$\{(?:a\.|node\.data\.)?url\}"/);
}
assert.match(appSource, /document\.createElement\(isVideoMedia/);
assert.match(canvasSource, /replacePreviewMedia\(preview/);
assert.match(canvasSource, /media\.src = url/);
for (const source of [projectSource, shortSource, workbenchSource, dialogSource]) {
  assert.match(source, /safeMediaUrl/);
}
assert.doesNotMatch(projectSource, /<img src="\$\{thumb\}">/);
assert.doesNotMatch(shortSource, /src="\$\{esc\(item\.(?:audioUrl|videoUrl|firstFrameUrl|url)\)\}"/);
assert.doesNotMatch(workbenchSource, /src="\$\{esc\(asset\.url\)\}"/);
assert.doesNotMatch(dialogSource, /src="\$\{esc\(item\.url\)\}"/);

console.log('URL DOM safety verified: active-content schemes rejected and media URLs use DOM properties.');
