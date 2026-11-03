'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'project', 'store.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
}

function createHarness(writeJson) {
  const status = {
    classList: {remove() {}, add() {}},
    innerHTML: ''
  };
  const toasts = [];
  const localStorage = {
    getItem() { return null; },
    setItem() { return true; },
    removeItem() {}
  };
  const sandbox = {
    console: {...console, warn() {}},
    localStorage,
    window: {
      localStorageBridge: {writeJson},
      FutureAICanvasStorage: {
        FILE_STORE_BY_KEY: {projects: 'projects.json'},
        compactBrowserStoreValue: (_key, value) => value,
        shouldUseCompactBrowserStore: () => false,
        isQuotaError: () => false
      },
      FutureAIProjectTemplates: {selectedProjectTemplateId: id => id || 'default'},
      FutureAIAssistantTopics: {}
    }
  };
  vm.runInNewContext(source, sandbox, {filename: 'project/store.js'});
  const host = {
    storageDir: 'C:/future-ai-data',
    fileStoreCache: {},
    storageSyncSeq: 0,
    STORE: {projects: 'projects'},
    projects: [],
    currentProjectId: null
  };
  const api = sandbox.window.FutureAIProjectStore.create({
    host,
    $: id => id === 'saveStatus' ? status : null,
    esc: value => String(value),
    toast: (message, level) => toasts.push({message, level}),
    setStore: () => true
  });
  return {api, host, status, toasts};
}

(async () => {
  const failed = createHarness(() => Promise.reject(new Error('disk full')));
  await failed.api.syncLocalStore('projects.json', {version: 1});
  assert.equal(failed.host.storageSyncFailed, true);
  assert.match(failed.status.innerHTML, /保存失败/);
  assert.equal(failed.toasts.length, 1);

  const first = deferred();
  const second = deferred();
  let calls = 0;
  const ordered = createHarness(() => (++calls === 1 ? first.promise : second.promise));
  const oldWrite = ordered.api.syncLocalStore('projects.json', {version: 1});
  const newWrite = ordered.api.syncLocalStore('projects.json', {version: 2});
  second.resolve(true);
  first.reject(new Error('old write failed'));
  await Promise.all([oldWrite, newWrite]);
  assert.equal(ordered.host.storageSyncFailed, false);
  assert.equal(ordered.toasts.length, 0);

  console.log('Project store save tests passed.');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
