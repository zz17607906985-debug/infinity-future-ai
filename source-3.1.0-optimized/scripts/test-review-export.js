'use strict';

const assert = require('assert/strict');
const {buildZip, readZipEntries} = require('../src/runtime/zip-utils');
const {buildOfflineReviewEntries} = require('../src/review/review-export');

const media = Buffer.from('fake-png-bytes');
const result = buildOfflineReviewEntries({
  packageId: 'review-1',
  project: {id: 'p1', name: '审片测试'},
  outputs: [{outputId: 'out-1', outputVersion: 'v1', mediaType: 'image', title: '测试图', mediaPath: 'media/001-test.png', prompt: 'safe prompt'}],
  apiKey: 'sk-secret'
}, [{name: 'media/001-test.png', data: media}]);
assert.ok(result.html.includes('media/001-test.png'));
assert.ok(!result.html.includes('sk-secret'));
const archive = buildZip(result.entries, new Date('2026-08-09T00:00:00Z'));
const entries = readZipEntries(archive);
assert.deepEqual(entries.map(item => item.name), ['index.html', 'review.json', 'README.md', 'media/001-test.png']);
const json = JSON.parse(entries.find(item => item.name === 'review.json').data.toString('utf8'));
assert.equal(json.outputs[0].mediaPath, 'media/001-test.png');
assert.equal(entries.find(item => item.name === 'media/001-test.png').data.toString('utf8'), media.toString('utf8'));
assert.throws(() => buildOfflineReviewEntries({}, [{name: '../secret.txt', data: 'x'}]), /路径不安全/);
console.log('Review export tests passed.');
