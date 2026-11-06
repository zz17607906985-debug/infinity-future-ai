'use strict';

const assert = require('assert/strict');
const {buildZip} = require('../src/runtime/zip-utils');
const {buildOfflineReviewEntries} = require('../src/review/review-export');
const {verifyArchive} = require('./verify-review-package-input');

const result = buildOfflineReviewEntries({
  packageId: 'review-fixture',
  project: {id: 'project-1', name: 'fixture'},
  outputs: [{outputId: 'output-1', outputVersion: 'v1', mediaType: 'image', mediaPath: 'media/001.png'}]
}, [{name: 'media/001.png', data: Buffer.from('fixture-image')}]);
const archive = buildZip(result.entries, new Date('2026-08-09T00:00:00Z'));
const verified = verifyArchive(archive, 'fixture.zip');
assert.equal(verified.safePaths, true);
assert.equal(verified.keysRedacted, true);
assert.equal(verified.offlineHtml, true);
assert.equal(verified.mediaEntries, 1);
assert.throws(() => verifyArchive(buildZip([
  {name: 'index.html', data: '<html></html>'},
  {name: 'review.json', data: JSON.stringify({outputs: [{mediaPath: '../secret.txt'}]})},
  {name: 'README.md', data: 'bad'}
], new Date('2026-08-09T00:00:00Z'))), /路径不安全/);

console.log('Review package input verification tests passed.');
