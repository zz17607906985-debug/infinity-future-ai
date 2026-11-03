const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {window: {}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'generation', 'variant-manager.js'), 'utf8'), sandbox, {filename: 'variant-manager.js'});
const variants = sandbox.window.FutureAIVariantManager;

const data = {url: 'a.png', urls: ['a.png'], model: 'm1', prompt: 'p1'};
variants.ensureCurrentOutput(data, 'image');
assert.equal(data.variants.length, 1);
variants.recordOutputs(data, [{url: 'b.png', mediaType: 'image', model: 'm2', elapsedMs: 1000}]);
assert.equal(data.variants.length, 2);
const approved = variants.setStatus(data, data.variants[0].id, 'approved');
assert.equal(approved.status, 'approved');
assert.equal(variants.approvedVariants(data).length, 1);
const replaced = variants.replaceWithVariant(data, approved.id);
assert.equal(data.url, approved.url);
assert.ok(replaced.previous.url);

const specs = variants.branchSpecs({models: ['a', 'b'], prompts: ['p1', 'p2'], aspects: ['16:9'], max: 3});
assert.equal(specs.length, 3);
assert.deepEqual(Array.from(new Set(specs.map(item => item.model))), ['a', 'b']);
const referenceSpecs = variants.branchSpecs({referenceSets: [[{url: 'a'}], [{url: 'b'}]], max: 2});
assert.equal(referenceSpecs.length, 2);
assert.equal(referenceSpecs[1].references[0].url, 'b');

data.approval = {status: 'approved', outputUrl: data.url};
variants.recordOutputs(data, [{url: 'new.png', mediaType: 'image'}]);
assert.equal(data.approval.status, 'invalidated');

console.log('Variant manager tests passed.');
