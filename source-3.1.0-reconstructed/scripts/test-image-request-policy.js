'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sandbox = {window: {}, URL, FormData, Blob, setTimeout, clearTimeout};
for (const file of ['src/media/dimensions.js', 'src/generation/image-request-policy.js', 'src/canvas/nodes.js', 'src/providers/provider-api.js', 'src/generation/generation-queue.js']) vm.runInNewContext(read(file), sandbox, {filename: file});
const policy = sandbox.window.FutureAIImageRequestPolicy;
const prompt = '  【正向提示词】\n完整合同，不能改写。\n【负向提示词】\n不要文字  ';
let enrichCalls = 0;
const options = {ownPrompt: prompt, model: 'gpt-image-2-adobe', size: '2304x4096', enrichPrompt: text => { enrichCalls += 1; return 'context:' + text; }};
const raw = policy.build(options);
assert.equal(raw.prompt, prompt);
assert.equal(raw.quality, 'high');
assert.equal(enrichCalls, 0);
assert.equal(raw.allowModelFallback, false);
assert.equal(raw.allowReferenceFallback, false);
assert.equal(policy.build({...options, data: {promptMode: 'context', quality: 'auto'}}).prompt, 'context:' + prompt);
assert.equal(enrichCalls, 1);
assert.equal(policy.build({...options, data: {quality: 'auto'}}).quality, 'auto');
assert.equal(policy.build({...options, ownPrompt: '', linkedPrompt: prompt}).prompt, prompt);
assert.equal(policy.qualityForModel('high', 'dall-e-3'), 'hd');
assert.throws(() => policy.build({...options, ownPrompt: ''}), /缺少提示词/);
const nodes = sandbox.window.FutureAICanvasNodes;
assert.equal(nodes.normalizeData('image', {}).quality, 'high');
assert.equal(nodes.normalizeData('image', {quality: 'auto'}).quality, 'auto');
const node = {id: 'test', type: 'image', data: {prompt, model: options.model, quality: 'high', resolution: '4K', count: '1'}, el: {querySelector: () => null}};
let actualRequest;
let failRequest = false;
const testKey = Object.assign(new String('private-test-key-do-not-save'), {keyId: 'key-test'});
const history = [];
const queue = sandbox.window.FutureAIGenerationQueue.create({
  getNode: () => node,
  getInputPrompt: () => '',
  currentProviderForNode: () => ({id: 'test-provider', name: 'Test', type: 'openai', apiUrl: 'https://example.test/v1', keyPool: [{id: 'key-test', label: 'Test Key', scope: 'image'}]}),
  providerApiKey: async () => testKey,
  formatImageGenerationError: error => error.message,
  imageErrorTitle: () => '生成失败',
  imageTargetSize: () => options.size,
  apiCompatibleImageSize: value => value,
  ensureInputImageRefs: async () => [],
  withCameraPrompt: () => { throw new Error('raw mode invoked camera'); },
  hydrateNode: () => {}, saveProject: () => {}, setImageStatus: () => {},
  imageGenerateRequest: async request => {
    actualRequest = request;
    if (failRequest) throw new Error('fixture failure');
    return {url: 'fixture:original', model: 'adapter-normalized-model'};
  },
  persistGeneratedImageResult: async result => result.url,
  refreshDownstreamLinkedInputs: () => {}, addHistory: item => history.push(item), toast: () => {}
});
async function main() {
  const preview = queue.buildImageRequest(node);
  assert.equal(await queue.runImageNow('test'), true);
  assert.equal(actualRequest.prompt, preview.prompt);
  assert.equal(actualRequest.size, preview.size);
  assert.equal(actualRequest.model, preview.model);
  assert.equal(actualRequest.quality, preview.quality);
  assert.equal(node.data.lastImageRequest.prompt, prompt);
  assert.equal(history[0].prompt, prompt);
  assert.equal(node.data.outputModel, 'adapter-normalized-model');
  assert.equal(history[0].model, 'adapter-normalized-model');
  assert.equal(history[0].requestedModel, options.model);
  assert.equal(history[0].outputModels[0], 'adapter-normalized-model');
  assert.equal(history[0].requests[0].keyId, 'key-test');
  assert.equal(node.data.lastImageRequest.keyLabel, 'Test Key');
  assert.equal(node.data.lastImageRequest.status, 'saved');
  assert.match(policy.describe(node.data.lastImageRequest), /适配器实际请求模型：adapter-normalized-model/);
  assert.doesNotMatch(policy.describe(node.data.lastImageRequest), /返回像素/);
  assert.equal(JSON.stringify({history, data: node.data}).includes(String(testKey)), false);
  failRequest = true;
  await assert.rejects(queue.runImageNow('test'), /fixture failure/);
  assert.equal(node.data.lastImageRequest.status, 'failed');
  assert.equal(history.length, 1);
  failRequest = false;
  const calls = [];
  const api = sandbox.window.FutureAIProviderApi.create({
    normalizeKnownImageModelAlias: model => model,
    assertImageProviderCapability: () => {},
    assertUsableApiBaseAddress: () => {},
    API_TIMEOUTS: {image: 1000},
    fetchJsonWithRetry: async (url, request) => {
      calls.push({url, request});
      return {ok: false, status: 400, statusText: 'Bad Request', text: async () => JSON.stringify({error: {code: 'model_not_found', message: 'unsupported model'}})};
    }
  });
  for (const type of ['generate', 'edit']) {
    calls.length = 0;
    const request = {...raw, provider: {type: 'custom-sync', models: ['fallback-model']}, apiUrl: 'https://example.test/v1', refUrls: ['fixture:ref1', 'fixture:ref2']};
    await assert.rejects(type === 'generate' ? api.imageGenerateRequest(request) : api.imageEditWithFallback(request));
    assert.equal(calls.length, 1, 'no catalog/model/reference fallback');
    const sent = JSON.parse(calls[0].request.body);
    assert.equal(sent.model, options.model);
    assert.equal(sent.prompt, prompt);
    assert.equal(sent.quality, 'high');
    assert.equal(sent.size, options.size);
  }
  let addressCalls = 0;
  const addressApi = sandbox.window.FutureAIProviderApi.create({assertUsableApiBaseAddress: () => {}, fetchJsonWithRetry: async () => {
    addressCalls += 1;
    return new Response(JSON.stringify({error: {message: 'Model is not supported by any configured account in this group'}}), {status: 404, headers: {'content-type':'application/json'}});
  }});
  const rejected = await addressApi.fetchApiWithBaseFallback('https://example.test', '/images/generations', {method:'POST'});
  assert.equal(addressCalls, 1, 'model rejection must not retry the v1 address');
  assert.equal(rejected.res.status, 404);
  console.log('Image request policy tests passed: raw/context, quality, preview/run parity, locked model, single failed request and no 404 model retry.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
