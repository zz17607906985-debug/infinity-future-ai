'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {readZipEntries} = require('../src/runtime/zip-utils');

function usage() {
  console.error('用法：node scripts/verify-review-package-input.js <审片包.zip>');
}

function isSafeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return normalized && !normalized.startsWith('/') && !/^[a-z]:\//i.test(normalized)
    && !normalized.split('/').includes('..');
}

function verifyArchive(archive, input = '') {
  const entries = readZipEntries(archive);
  const names = new Set(entries.map(item => item.name));
  for (const required of ['index.html', 'review.json', 'README.md']) assert.ok(names.has(required), `缺少审片包文件：${required}`);
  for (const name of names) assert.ok(isSafeRelativePath(name), `审片包路径不安全：${name}`);
  const review = JSON.parse(entries.find(item => item.name === 'review.json').data.toString('utf8'));
  const outputs = Array.isArray(review.outputs) ? review.outputs : [];
  for (const output of outputs) {
    if (output.mediaPath) assert.ok(isSafeRelativePath(output.mediaPath), `媒体路径不安全：${output.mediaPath}`);
    assert.doesNotMatch(JSON.stringify(output), /(?:api[_-]?key|bearer\s+|sk-[a-z0-9])/i, `输出档案疑似包含 Key：${output.outputId || ''}`);
  }
  const html = entries.find(item => item.name === 'index.html').data.toString('utf8');
  assert.doesNotMatch(html, /<script\b[^>]*src\s*=|javascript:|on(?:click|load|error)\s*=/i, '审片包包含外部脚本或内联事件注入点');
  return {
    package: input ? path.resolve(input) : '',
    entries: entries.length,
    outputs: outputs.length,
    mediaEntries: [...names].filter(name => name.startsWith('media/')).length,
    safePaths: true,
    keysRedacted: true,
    offlineHtml: true
  };
}

function main() {
  const input = process.argv[2];
  if (!input) {
    usage();
    process.exitCode = 2;
    return;
  }
  const result = verifyArchive(fs.readFileSync(path.resolve(input)), input);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`审片包验收失败：${err.message || err}`);
    process.exitCode = 1;
  }
}

module.exports = {verifyArchive, isSafeRelativePath};
