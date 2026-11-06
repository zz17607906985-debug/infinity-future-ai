'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const runtime = fs.readFileSync(path.join(__dirname, '..', 'src', 'canvas', 'runtime.js'), 'utf8');

assert.match(runtime, /function imageNodeHasOutput\(node\)/);
assert.match(runtime, /delete data\.outputModel;/);
assert.match(runtime, /delete data\.lastImageRequest;/);
assert.match(runtime, /function imageRegenerationData\(node\)[\s\S]*?data\.url = ''[\s\S]*?data\.urls = \[\]/);
assert.match(runtime, /data\.variants = \[\][\s\S]*?data\.provenanceRecords = \[\]/);
assert.match(runtime, /function createImageRegenerationNode\(node\)[\s\S]*?addNode\('image',[\s\S]*?imageRegenerationData\(node\), null, false\)/);
assert.match(runtime, /filter\(edge => edge\.to === node\.id && \(edge\.toPort === 'prompt' \|\| edge\.toPort === 'ref'\)\)/);
assert.match(runtime, /connectSilently\(edge\.from, edge\.fromPort, next\.id, edge\.toPort\)/);
assert.match(runtime, /const target = imageNodeHasOutput\(node\) \? createImageRegenerationNode\(node\) : node;/);
assert.match(runtime, /runImageFromComposer\(node\)\.catch\(\(\) => \{\}\)/);

console.log('Image regeneration node contract tests passed.');
