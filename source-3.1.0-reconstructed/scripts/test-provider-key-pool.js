'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'key-pool.js'), 'utf8');
const sandbox = {window: {}};
vm.runInNewContext(source, sandbox, {filename: 'key-pool.js'});
const KeyPool = sandbox.window.FutureAIKeyPool;

const migrated = KeyPool.migrateLegacyProviderKey({apiKeySaved: true});
assert.equal(migrated.keys.length, 1);
assert.equal(migrated.keys[0].id, 'key-1');
assert.equal(migrated.keys[0].scope, 'all');

const normalized = KeyPool.normalizeKeyPool({
  activeKeyId: 'image-key',
  keyPool: [
    {id: 'chat-key', label: '文本 Key', scope: 'chat'},
    {id: 'image-key', label: '图片 Key', scope: 'image'},
    {id: 'video-key', label: '视频 Key', scope: 'video'}
  ]
});
assert.equal(normalized.keys.length, 3);
assert.equal(normalized.activeKeyId, 'image-key');
assert.equal(normalized.keys[0].scope, 'chat');
assert.equal(normalized.keys[1].scope, 'image');
assert.equal(normalized.keys[2].scope, 'video');

const health = KeyPool.normalizeKeyPool({keyPool: [{id: 'k', scope: 'image', cooldownUntil: 123, failureCount: 2, lastError: 'quota', health: 'cooldown'}]});
assert.equal(health.keys[0].cooldownUntil, 123);
assert.equal(health.keys[0].failureCount, 2);
assert.equal(health.keys[0].health, 'cooldown');

const bindings = KeyPool.normalizeModelKeyBindings({imageModel: 'image-key', stale: 'missing'}, normalized.keys);
assert.equal(JSON.stringify(bindings), JSON.stringify({imageModel: 'image-key'}));
assert.equal(KeyPool.selectKeyIdForRequest({
  keyPool: normalized.keys,
  activeKeyId: 'chat-key',
  keyRotationMode: 'manual',
  imageModel: 'image-model',
  modelKeyBindings: { 'image-model': 'image-key' }
}, 'image', 'image-model', 1000), 'image-key');
assert.equal(KeyPool.selectKeyIdForRequest({
  keyPool: [{id: 'blocked', scope: 'image', health: 'blocked'}],
  imageModel: 'image-model',
  modelKeyBindings: {'image-model': 'blocked'}
}, 'image', 'image-model', 1000), '');

assert.equal(KeyPool.selectKeyIdForRequest({
  keyPool: [
    {id: 'a', scope: 'image', lastUsedAt: 1},
    {id: 'b', scope: 'image', lastUsedAt: 1}
  ],
  imageModel: 'image-model'
}, 'image', 'image-model', 1000, {a: 2, b: 0}), 'b');

const outOfOrderLeases = ['key-a', 'key-b'];
assert.equal(KeyPool.takeLease(outOfOrderLeases, 'key-b'), 'key-b');
assert.deepEqual(outOfOrderLeases, ['key-a']);
assert.equal(KeyPool.takeLease(outOfOrderLeases, 'key-a'), 'key-a');
assert.deepEqual(outOfOrderLeases, []);

assert.equal(KeyPool.shouldRotateOnError({status: 401}), true);
assert.equal(KeyPool.shouldRotateOnError({status: 429}), true);
assert.equal(KeyPool.shouldRotateOnError(new Error('invalid api key')), true);
assert.equal(KeyPool.shouldRotateOnError({status: 500, message: 'server error'}), false);
assert.equal(
  KeyPool.sanitizeErrorSummary('Authorization: Bearer secret-value and api_key=secret-value', ['secret-value']),
  'Authorization: Bearer [REDACTED] and api_key=[REDACTED]'
);
assert.equal(KeyPool.sanitizeErrorSummary('invalid key sk-1234567890abcdef'), 'invalid key sk-[REDACTED]');

console.log('Provider key pool tests passed.');
