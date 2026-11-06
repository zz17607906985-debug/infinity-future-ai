'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const queue = read('src/generation/generation-queue.js');
const runtime = read('src/canvas/runtime.js');
const styles = read('src/styles.css');

assert.match(queue, /const count = Math\.max\(1, Math\.min\(4, parseInt\(node\.data\.count, 10\) \|\| 1\)\)/);
assert.match(queue, /const errors = new Array\(count\)/);
assert.match(queue, /while \(nextRequestIndex < count\) \{[\s\S]*try \{[\s\S]*await runOneImageRequest\(requestIndex\)[\s\S]*\} catch \(err\) \{[\s\S]*errors\[requestIndex\] = err/);
assert.match(queue, /const completedUrls = urls\.filter\(Boolean\)/);
assert.doesNotMatch(queue, /if \(failedWorker\) throw failedWorker\.reason;/);
assert.match(queue, /if \(!completedUrls\.length\)/);
assert.match(queue, /node\.data\.urls = completedUrls/);
assert.match(queue, /applyPartialOutputs/);
assert.match(queue, /hydrateNode\(node\)/);
assert.match(runtime, /function imagePreviewUrls\(node\)/);
assert.match(runtime, /list\.slice\(0, 4\)/);
assert.match(runtime, /renderImageVariantPreview/);
assert.match(runtime, /data-select-variant/);
assert.match(styles, /\.image-preview\.has-variants/);
assert.match(runtime, /class="composer-send"/);
assert.match(queue, /composerSend/);
assert.match(queue, /fa-arrow-up/);
assert.match(queue, /quality: String(node.data.quality || 'auto').trim() || 'auto'/);
assert.doesNotMatch(queue, /quality: imageRequest.quality[sS]{0,160}status: 'queued'/);

console.log('Generation count=4 contract tests passed.');
