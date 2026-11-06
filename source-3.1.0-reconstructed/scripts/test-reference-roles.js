'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {window: {}};
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'media', 'reference-roles.js'), 'utf8');
vm.runInNewContext(source, sandbox, {filename: 'reference-roles.js'});
const roles = sandbox.window.FutureAIReferenceRoles;

const imageRefs = roles.mergeResolvedReferences({
  nodeType: 'image',
  references: [],
  resolvedItems: [
    {key: 'n1', sourceNodeId: 'n1', url: 'file:///one.png'},
    {key: 'n2', sourceNodeId: 'n2', url: 'file:///two.png'}
  ]
});
assert.equal(imageRefs[0].role, 'source');
assert.equal(imageRefs[1].role, 'reference');
assert.equal(imageRefs[0].order, 0);

const videoRefs = roles.mergeResolvedReferences({
  nodeType: 'video',
  references: [],
  resolvedItems: [{key: 'n1', url: 'file:///one.png'}, {key: 'n2', url: 'file:///two.png'}]
});
assert.equal(videoRefs[0].role, 'first-frame');
assert.equal(videoRefs[1].role, 'reference');

const preserved = roles.mergeResolvedReferences({
  nodeType: 'image',
  references: [{key: 'n2', role: 'style', order: 0}, {key: 'n1', role: 'character', order: 1}],
  resolvedItems: [{key: 'n2', url: 'file:///two.png'}, {key: 'n1', url: 'file:///one.png'}]
});
assert.equal(preserved[0].role, 'style');
assert.equal(preserved[1].role, 'character');

const sized = roles.mergeResolvedReferences({
  nodeType: 'image',
  resolvedItems: [{key: 'sized', url: 'file:///sized.png', mime: 'image/png', sizeBytes: 12345, fileName: 'sized.png'}]
});
assert.equal(sized[0].sizeBytes, 12345);
assert.equal(sized[0].fileName, 'sized.png');

const duplicate = roles.setReferenceRole([
  {key: 'a', role: 'first-frame'},
  {key: 'b', role: 'reference'}
], 'b', 'first-frame');
assert.ok(duplicate.error);
assert.equal(duplicate.references[1].role, 'reference');

const assigned = roles.setReferenceRole(imageRefs, 'n2', 'style');
assert.equal(assigned.error, '');
assert.equal(assigned.references[1].role, 'style');
assert.match(roles.referenceRoleInstructions(assigned.references), /风格参考/);
assert.equal(roles.roleLabel('last-frame'), '尾帧');

console.log('Reference role tests passed.');
