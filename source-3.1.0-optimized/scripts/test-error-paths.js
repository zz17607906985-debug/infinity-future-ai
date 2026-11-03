'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

async function main() {
  const clientSandbox = {
    window: {},
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: null
  };
  vm.runInNewContext(read('src/ai-client.js'), clientSandbox, {filename: 'ai-client.js'});
  const client = clientSandbox.window.FutureAICanvasAIClient;

  let calls = 0;
  clientSandbox.fetch = async () => {
    calls += 1;
    return calls === 1
      ? {status: 503, headers: {get: () => ''}, body: {cancel: async () => {}}}
      : {status: 200, headers: {get: () => ''}, body: {cancel: async () => {}}};
  };
  const retried = await client.fetchJsonWithRetry('https://example.test/status', {retries: 1});
  assert.equal(retried.status, 200);
  assert.equal(calls, 2);

  calls = 0;
  clientSandbox.fetch = async () => {
    calls += 1;
    return {status: 503, headers: {get: () => ''}, body: {cancel: async () => {}}};
  };
  const unsafe = await client.fetchJsonWithRetry('https://example.test/post', {
    method: 'POST',
    body: '{}',
    retries: 2
  });
  assert.equal(unsafe.status, 503);
  assert.equal(calls, 1);

  calls = 0;
  clientSandbox.fetch = async () => {
    calls += 1;
    return {status: 503, headers: {get: () => ''}, body: {cancel: async () => {}}};
  };
  await client.fetchJsonWithRetry('https://example.test/post', {
    method: 'POST',
    retryUnsafe: true,
    body: '{}',
    retries: 1
  });
  assert.equal(calls, 2);

  clientSandbox.fetch = async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})));
  });
  await assert.rejects(
    client.fetchWithTimeout('https://example.test/timeout', {timeoutMs: 10}),
    err => err.isTimeout === true && err.name === 'AbortError'
  );

  const providerSandbox = {window: {}};
  vm.runInNewContext(read('src/providers/provider-api.js'), providerSandbox, {filename: 'provider-api.js'});
  const provider = providerSandbox.window.FutureAIProviderApi.create({});
  const htmlResponse = {
    status: 502,
    statusText: 'Bad Gateway',
    headers: {get: name => name === 'content-type' ? 'text/html' : ''}
  };
  assert.match(provider.apiResponseErrorText(htmlResponse, '<!doctype html><title>Gateway</title>'), /HTTP 502/);
  const invalidJson = await provider.safeJson({
    status: 400,
    statusText: 'Bad Request',
    headers: {get: () => 'application/json'},
    text: async () => '{not-json'
  });
  assert.equal(invalidJson.message, '{not-json');
  assert.equal(provider.classifyImageProviderError({status: 422, code: 'unsupported_size'}).kind, 'size-unsupported');
  assert.equal(provider.classifyImageProviderError({status: 503}).kind, 'upstream-failure');
  assert.equal(provider.isUnsupportedImageModelError({status: 404, message: 'model not found'}), true);

  console.log('Error-path tests passed: retry safety, timeout, HTML/invalid JSON, and provider error classification.');
}

main().catch(err => {
  console.error(err.stack || err);
  process.exitCode = 1;
});
