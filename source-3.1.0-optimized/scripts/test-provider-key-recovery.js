'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const main = read('src/main.js');
const providerUi = read('src/providers/provider-ui.js');

const writeStart = main.indexOf('async function writeProviderApiKey');
const writeEnd = main.indexOf('async function updateProviderApiKeyMetadata', writeStart);
assert.ok(writeStart >= 0 && writeEnd > writeStart, 'provider key writer is missing');
const writeBody = main.slice(writeStart, writeEnd);
assert.match(writeBody, /failureCount:\s*0/);
assert.match(writeBody, /cooldownUntil:\s*0/);
assert.match(writeBody, /lastError:\s*''/);
assert.match(writeBody, /health:\s*'unknown'/);

assert.match(providerUi, /function providerKeyUnavailableMessage\(/);
assert.match(providerUi, /当前用途的 Key 已停用/);
assert.match(providerUi, /重新点击“保存密钥”/);
assert.match(providerUi, /runWithCapabilityKey\('chat'/);
assert.match(providerUi, /runWithCapabilityKey\('image'/);
assert.match(providerUi, /runWithCapabilityKey\('video'/);
assert.doesNotMatch(providerUi, /请先填写该 API 配置的地址和密钥/);

console.log('Provider key recovery tests passed.');
