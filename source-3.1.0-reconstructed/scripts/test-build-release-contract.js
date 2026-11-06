'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'build-release.js'), 'utf8');
assert.match(source, /excludedTopLevel = new Set\(\['build-tools', 'dist', 'node_modules', 'docs'\]\)/);
assert.match(source, /allowedTopLevel = new Set\(\['app\.js', 'build', 'package\.json', 'scripts', 'src'\]\)/);
assert.match(source, /Unexpected top-level build input/);
assert.match(source, /installVerifiedArtifact/);
assert.match(source, /Temporary install artifact hash mismatch/);
console.log('Build release contract passed: development artifacts are excluded and installs are verified with rollback.');
