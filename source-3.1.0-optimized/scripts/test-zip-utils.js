'use strict';

const assert = require('assert/strict');
const {
  buildZip,
  isSafeZipEntryName,
  readZipTextSummary,
  readZipEntries
} = require('../src/runtime/zip-utils');

const fixedDate = new Date('2026-08-08T12:00:00+08:00');
const entries = [
  {name: 'README.md', data: '# Future AI'},
  {name: 'nested/settings.json', data: '{"version":"3.1.0"}'}
];
const first = buildZip(entries, fixedDate);
const second = buildZip(entries, fixedDate);

assert.deepEqual(first, second, 'fixed ZIP inputs must produce identical bytes');
assert.match(readZipTextSummary(first), /Future AI/);
assert.match(readZipTextSummary(first), /3\.1\.0/);
assert.equal(isSafeZipEntryName('../secret.txt'), false);
assert.equal(isSafeZipEntryName('C:/secret.txt'), false);
assert.equal(isSafeZipEntryName('/absolute.txt'), false);
assert.equal(isSafeZipEntryName('nested/safe.txt'), true);
const unpacked = readZipEntries(first);
assert.equal(unpacked.length, 2);
assert.equal(unpacked.find(item => item.name === 'README.md').data.toString('utf8'), '# Future AI');

console.log('ZIP utility tests passed.');
