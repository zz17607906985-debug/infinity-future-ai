'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'build-release.js'), 'utf8');
assert.match(source, /excludedTopLevel = new Set\(\['build-tools', 'node_modules', 'docs'\]\)/);
assert.doesNotMatch(source, /excludedTopLevel = new Set\(\[[^\]]*src/);
console.log('Build release contract passed: internal docs are excluded from app.asar.');
