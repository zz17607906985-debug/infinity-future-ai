'use strict';

const assert = require('assert/strict');
const {spawnSync} = require('child_process');
const path = require('path');
const fs = require('fs');

const result = spawnSync(process.execPath, [path.join(__dirname, 'real-api-smoke.js')], {
  encoding: 'utf8',
  env: {...process.env, FUTUREAI_API_URL: '', FUTUREAI_API_KEY: '', FUTUREAI_REAL_API_CONFIRM: ''}
});
assert.notEqual(result.status, 0);
assert.match(result.stderr, /需要 FUTUREAI_API_URL 和 FUTUREAI_API_KEY/);
assert.doesNotMatch(result.stderr, /\[REDACTED\]需要/);
const smokeSource = fs.readFileSync(path.join(__dirname, 'real-api-smoke.js'), 'utf8');
assert.match(smokeSource, /async function smokeImage\(\)/);
assert.match(smokeSource, /FUTUREAI_IMAGE_ENDPOINT/);
assert.match(smokeSource, /mode === 'all' \|\| mode === 'image'/);
const fixture = spawnSync(process.execPath, [path.join(__dirname, 'test-real-api-image-fixture.js')], {encoding: 'utf8'});
assert.equal(fixture.status, 0, fixture.stderr || fixture.stdout);
console.log('Real API smoke guard test passed: missing credentials fail cleanly without fabricated redaction.');
