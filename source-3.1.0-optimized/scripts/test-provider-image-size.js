'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {window: {}};
const dimensionsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media', 'dimensions.js'), 'utf8');
vm.runInNewContext(dimensionsSource, sandbox, {filename: 'dimensions.js'});
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'provider-api.js'), 'utf8');
vm.runInNewContext(source, sandbox, {filename: 'provider-api.js'});

const providerApi = sandbox.window.FutureAIProviderApi.create({});

assert.equal(providerApi.imageSizeForResolution('1024x576', '4K'), '4096x2304');
assert.equal(providerApi.imageSizeForResolution('1024x576', '1K'), '1024x576');
assert.equal(providerApi.imageSizeForResolution('1024x576', '2K'), '2048x1152');
assert.deepEqual(
  JSON.parse(JSON.stringify(providerApi.imageRequestDimensionFields({imageRequestFormat: 'size'}, '4096x2304'))),
  {size: '4096x2304'}
);
assert.deepEqual(
  JSON.parse(JSON.stringify(providerApi.imageRequestDimensionFields({imageRequestFormat: 'width-height'}, '2048x1152'))),
  {width: 2048, height: 1152}
);
assert.deepEqual(
  JSON.parse(JSON.stringify(providerApi.imageRequestDimensionFields({imageRequestFormat: 'size-and-aspect'}, '1024x576'))),
  {size: '1024x576', aspect_ratio: '16:9'}
);
assert.equal(providerApi.imageSizeForResolution('1900x600', '4K'), '4085x1290');
assert.equal(providerApi.imageSizeFromDialogPrompt('请生成一张 16:9 图片'), '1024x576');
assert.equal(providerApi.imageSizeFromDialogPrompt('请生成一张 9:16 图片'), '576x1024');
assert.equal(providerApi.imageSizeFromDialogPrompt('请生成一张 19:6 图片'), '1900x600');
assert.equal(providerApi.sizeToOpenAiVideoSize('1280x720'), '1280x720');
assert.equal(providerApi.sizeToOpenAiVideoSize('1024x1792'), '1024x1792');
assert.throws(() => providerApi.sizeToOpenAiVideoSize('1024x1024'), /OpenAI 视频接口不支持/);
assert.equal(providerApi.imageRequestSeedFields({model: 'flux-schnell', seed: 42}).seed, 42);
assert.equal(Object.keys(providerApi.imageRequestSeedFields({model: 'gpt-image-1', seed: 42})).length, 0);
assert.equal(Object.keys(providerApi.imageRequestSeedFields({model: 'flux', seed: ''})).length, 0);

const requestApi = sandbox.window.FutureAIProviderApi.create({
  unique: values => [...new Set(values)],
  saveSettings: () => {},
  normalizeKnownImageModelAlias: model => model,
  assertImageProviderCapability: () => {},
  assertUsableApiBaseAddress: () => {},
  API_TIMEOUTS: {image: 1000},
  fetchJsonWithRetry: async () => new Response(JSON.stringify({data: [{url: 'https://example.test/generated.png'}]}), {
    status: 200,
    headers: {'content-type': 'application/json'}
  })
});

requestApi.imageGenerateRequest({
  provider: {type: 'openai-images', imageEndpoint: '/images/generations'},
  apiUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'test-image',
  prompt: 'test',
  size: '2304x4096',
  quality: 'auto'
}).then(result => {
  assert.equal(result.url, 'https://example.test/generated.png');
  assert.equal(result.normalization, undefined, 'provider response must not be normalized by output dimensions');
  assert.equal(result.actualSize, undefined, 'provider response must not contain measured output pixels');
  console.log('Provider image request tests passed: request dimensions are preserved without output-size inspection.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
