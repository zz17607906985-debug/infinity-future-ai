'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const sandbox = {window: {}};
vm.runInNewContext(read('src/providers/key-pool.js'), sandbox, {filename: 'key-pool.js'});
const KeyPool = sandbox.window.FutureAIKeyPool;

const provider = {
  keyRotationMode: 'round-robin',
  keyPool: [
    {id: 'image-a', scope: 'image', lastUsedAt: 1},
    {id: 'image-b', scope: 'image', lastUsedAt: 1},
    {id: 'chat-a', scope: 'chat', lastUsedAt: 1},
    {id: 'video-a', scope: 'video', lastUsedAt: 1}
  ]
};

assert.equal(KeyPool.selectKeyIdForRequest(provider, 'image', '', 1000, {}), 'image-a');
assert.equal(KeyPool.selectKeyIdForRequest(provider, 'image', '', 1000, {'image-a': 1}), 'image-b');
assert.equal(KeyPool.selectKeyIdForRequest(provider, 'chat', '', 1000, {'image-a': 3}), 'chat-a');
assert.equal(KeyPool.selectKeyIdForRequest(provider, 'video', '', 1000, {'chat-a': 3}), 'video-a');

const keySpecificCapability = {
  keyRotationMode: 'round-robin',
  keyPool: [
    {id: 'image-disabled', scope: 'image', lastUsedAt: 0},
    {id: 'image-enabled', scope: 'image', lastUsedAt: 10}
  ],
  imageCapabilityStatus: 'blocked',
  imageCapabilityByKey: {
    'image-disabled': {status: 'blocked', message: 'group disabled'}
  }
};
assert.equal(KeyPool.selectKeyIdForRequest(keySpecificCapability, 'image', '', 1000, {}), 'image-enabled');
assert.equal(KeyPool.selectKeyIdForRequest({
  ...keySpecificCapability,
  modelKeyBindings: {'image-model': 'image-disabled'}
}, 'image', 'image-model', 1000, {}), 'image-enabled');
assert.equal(KeyPool.selectKeyIdForRequest({
  keyRotationMode: 'round-robin',
  keyPool: [{id: 'legacy-image', scope: 'image'}],
  imageCapabilityStatus: 'blocked'
}, 'image', '', 1000, {}), 'legacy-image');

const generationQueue = read('src/generation/generation-queue.js');
vm.runInNewContext(generationQueue, sandbox, {filename: 'generation-queue.js'});
const queue = sandbox.window.FutureAIGenerationQueue.create({host: {
  apiProviders: [{id: 'provider', concurrency: 1, keyPool: [{id: 'only-key'}]}],
  providerConcurrency: new Map([['provider', 1]])
}});
assert.equal(queue.providerConcurrencyLimit('provider'), Infinity, 'legacy provider limits cannot throttle the queue');
const pendingQueue = Array.from({length: 10}, (_, index) => ({
  id: `q-${index}`, nodeId: `image-${index}`, providerId: 'provider', status: 'queued', attempts: 0
}));
const queueHost = {
  generationQueue: pendingQueue, providerRunningCounts: new Map(),
  queuePaused: true
};
const unlimitedQueue = sandbox.window.FutureAIGenerationQueue.create({
  host: queueHost, $: () => null, getNode: () => ({data: {prompt: 'test'}}),
  getInputPrompt: () => '', ensureInputImageRefs: () => new Promise(() => {}),
  saveProject: () => {}
});
unlimitedQueue.pumpGenerationQueue();
assert.ok(pendingQueue.every(item => item.status === 'queued'), 'pause still holds submitted tasks');
queueHost.queuePaused = false;
unlimitedQueue.pumpGenerationQueue();
assert.ok(pendingQueue.every(item => item.status === 'running'), 'all ten tasks start without a provider cap');
assert.equal(queueHost.providerRunningCounts.get('provider'), 10);
assert.match(generationQueue, /const requestApiKey = provider\.type === 'custom-sync' \? '' : await providerApiKey\(provider, 'image', imageModel\)/);
assert.match(generationQueue, /apiKey: requestApiKey/);
assert.match(generationQueue, /reportProviderKeyResult\?\.\(provider, 'image', requestError, requestApiKey\)/);
assert.match(generationQueue, /Array\.from\(\{length: batchSubmitted \? 0 : count\}/, 'every requested image can start without a software worker cap');
assert.match(generationQueue, /Promise\.allSettled\(workers\)/);
assert.match(generationQueue, /正在自动尝试下一把 Key/);
assert.match(read('src/providers/key-pool.js'), /!isKeyCapabilityBlocked\(provider, item\.id, capability\)/);
assert.doesNotMatch(generationQueue, /running >= providerConcurrencyLimit/, 'queued nodes must not wait for a provider slot');
assert.doesNotMatch(generationQueue, /provider\.concurrency \|\| 1/, 'saved legacy concurrency must not cap requests');
assert.match(generationQueue, /errors\[requestIndex\] = err/);
assert.match(generationQueue, /const completedUrls = urls\.filter\(Boolean\)/);
assert.match(generationQueue, /已保留 \$\{completedUrls\.length\} 张成功结果/);
assert.match(generationQueue, /applyPartialOutputs/);
assert.match(generationQueue, /variantSeedFor/);

const dialogRuntime = read('src/assistant/dialog-runtime.js');
assert.match(dialogRuntime, /if \(runKind === 'image'\) imageApiKey = await providerApiKey\(imageProvider, 'image', imageModel\)/);
assert.match(dialogRuntime, /finishDialogKeyLeases/);

const shortWorkbench = read('src/media/short-workbench.js');
assert.match(shortWorkbench, /async function shortApiSettings\(kind = 'all'\)/);
assert.match(shortWorkbench, /kind === 'all' \|\| kind === 'chat'/);
assert.match(shortWorkbench, /reportShortApiResult\(s, 'chat', error\)/);
assert.match(shortWorkbench, /reportShortApiResult\(s, 'image', requestError\)/);
assert.match(shortWorkbench, /reportShortApiResult\(s, 'video', requestError\)/);

const providerApi = read('src/providers/provider-api.js');
assert.match(providerApi, /assertImageProviderCapability\(o\.provider, o\.apiKey\)/);
assert.match(providerApi, /markImageProviderCapability\(o\.provider, 'blocked',[\s\S]*?o\.apiKey\)/);

const providerUi = read('src/providers/provider-ui.js');
assert.match(providerUi, /imageCapabilityByKey/);
assert.match(providerUi, /软件会继续尝试其他可用图片 Key/);
assert.match(providerUi, /delete provider\.imageCapabilityByKey\[savedId\]/);
assert.match(providerUi, /\$\{keys\.length\} 把 Key 已保存 <span>自动分配<\/span>/);
assert.doesNotMatch(providerUi, /data-provider-key-select/);
assert.doesNotMatch(providerUi, /data-provider-model-key/);
assert.doesNotMatch(providerUi, /模型 Key/);
assert.doesNotMatch(providerUi, /固定当前 Key/);
assert.match(providerUi, /const keyId = ''/);
assert.match(providerUi, /const scope = 'all'/);
assert.match(providerUi, /provider\.keyRotationMode = 'round-robin'/);

console.log('Provider multi-key concurrency tests passed.');
