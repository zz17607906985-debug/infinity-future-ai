'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const providerApi = fs.readFileSync(path.join(root, 'src', 'providers', 'provider-api.js'), 'utf8');
const queue = fs.readFileSync(path.join(root, 'src', 'generation', 'generation-queue.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

assert.match(providerApi, /async function requestImageEditWithModel\(o, model\)/);
assert.match(providerApi, /async function imageEditRequest\(o\)[\s\S]*?imageModelCandidates\(o\.provider, o\.model, false, o\.resolution \|\| '1K'\)/);
assert.match(providerApi, /const result = await requestImageEditWithModel\(o, model\);[\s\S]*?rememberWorkingImageModel\(o\.provider, model\)/);
assert.match(providerApi, /if \(!isUnsupportedImageModelError\(err\)\) throw err;/);
assert.match(providerApi, /当前图片供应商没有可用于图生图的模型/);
assert.match(queue, /imageEditWithFallback\(\{[\s\S]*?resolution: node\.data\.resolution \|\| '1K'/);
assert.match(app, /当前账户未开通该图片模型/);
assert.match(app, /4K 专用模型需要中转站为当前账户组单独开通/);

console.log('Provider image-edit model fallback tests passed.');
