'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

async function main() {
  const requests = [];
  let asyncPolls = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({url: req.url, authorization: req.headers.authorization || '', body});
    if (req.url === '/images/generations') {
      res.writeHead(404, {'content-type': 'application/json'});
      return res.end(JSON.stringify({message: 'use v1'}));
    }
    if (req.url === '/v1/images/generations') {
      res.writeHead(200, {'content-type': 'application/json'});
      const count = JSON.parse(body).n || 1;
      return res.end(JSON.stringify({data: Array.from({length: count}, (_, index) => ({url: `data:image/png;base64,AAAA${index}`}))}));
    }
    if (req.url === '/async/images/generations') {
      res.writeHead(202, {'content-type': 'application/json'});
      return res.end(JSON.stringify({id: 'task-1'}));
    }
    if (req.url === '/async/image/query?id=task-1') {
      asyncPolls += 1;
      res.writeHead(200, {'content-type': 'application/json'});
      return res.end(JSON.stringify(asyncPolls === 1 ? {status: 'queued'} : {status: 'completed', data: [{url: 'data:image/png;base64,BBBB'}]}));
    }
    res.writeHead(404, {'content-type': 'application/json'});
    res.end(JSON.stringify({message: 'not found'}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const providerSandbox = {window: {}, URL, FormData, Blob, setTimeout, clearTimeout, fetch};
    vm.runInNewContext(read('src/providers/provider-api.js'), providerSandbox, {filename: 'provider-api.js'});
    const provider = providerSandbox.window.FutureAIProviderApi.create({
      fetchJsonWithRetry: (url, options) => fetch(url, options),
      API_TIMEOUTS: {text: 5000, image: 5000, poll: 5000},
      assertUsableApiBaseAddress: value => { new URL(value); return value; },
      saveSettings: () => {},
      renderApiProviders: () => {},
      providerTypeLabel: value => value,
      normalizeKnownImageModelAlias: value => value,
      effectiveImageModel: (_provider, model) => model,
      classifyModelKind: () => 'image',
      unique: values => [...new Set(values)]
    });

    const syncUrl = await provider.rawImageGenerationWithModel({
      apiUrl: base,
      apiKey: 'image-key',
      model: 'image-model',
      prompt: 'test',
      size: '1536x1024',
      provider: {type: 'openai-images', imageRequestFormat: 'width-height'}
    }, 'image-model', '1536x1024');
    assert.match(syncUrl, /^data:image\/png/);
    const syncRequest = requests.find(item => item.url === '/v1/images/generations');
    assert.ok(syncRequest);
    assert.equal(syncRequest.authorization, 'Bearer image-key');
    assert.deepEqual(JSON.parse(syncRequest.body), {model: 'image-model', prompt: 'test', n: 1, width: 1536, height: 1024});

    const batch = await provider.imageGenerateBatchRequest({
      apiUrl: base, apiKey: 'batch-key', model: 'gpt-image-2.5-sunburst', prompt: 'transparent object',
      size: '1024x1024', count: 3, backgroundMode: 'transparent',
      provider: {type: 'openai-images'}
    });
    assert.equal(batch.length, 3);
    assert.notEqual(batch[0].url, batch[1].url);
    const batchRequest = requests.find(item => item.authorization === 'Bearer batch-key');
    assert.deepEqual(JSON.parse(batchRequest.body), {
      model: 'gpt-image-2.5-sunburst', prompt: 'transparent object', n: 3,
      size: '1024x1024', background: 'transparent', output_format: 'png'
    });
    await assert.rejects(provider.rawImageGenerationWithModel({
      apiUrl: base, apiKey: 'batch-key', model: 'image-model', prompt: 'test',
      size: '1024x1024', backgroundMode: 'transparent', provider: {type: 'openai-images'}
    }, 'image-model', '1024x1024'), /未确认支持透明背景/);

    const asyncUrl = await provider.rawImageGenerationWithModel({
      apiUrl: base,
      apiKey: 'async-key',
      model: 'async-model',
      prompt: 'async',
      size: '1024x1024',
      provider: {type: 'openai-images', imageTaskMode: 'async', imageEndpoint: '/async/images/generations', imageQueryEndpoint: '/async/image/query?id={id}', imagePollIntervalMs: 1000, imageMaxPollAttempts: 3}
    }, 'async-model', '1024x1024');
    assert.match(asyncUrl, /^data:image\/png/);
    assert.equal(asyncPolls, 2);
    assert.ok(requests.some(item => item.url === '/async/images/generations' && item.authorization === 'Bearer async-key'));

    console.log('Provider runtime tests passed: auth, dimensions, batch images, transparent PNG, /v1 fallback, and async polling.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(err => {
  console.error(err.stack || err);
  process.exitCode = 1;
});
