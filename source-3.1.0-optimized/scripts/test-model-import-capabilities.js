'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const start = source.indexOf('  function classifyModelKind');
const end = source.indexOf('  function apiBaseAddressProblem', start);
assert.ok(start >= 0 && end > start, 'model import helpers must remain in app.js');

const block = source.slice(start, end);
const helpers = new Function('unique', 'expandKnownModelAliases', `${block}\nreturn {
  classifyModelKind,
  extractModelRecords,
  normalizeModelRecords
};`)(
  values => [...new Set(values)],
  values => [...new Set(values)]
);

const records = helpers.extractModelRecords({
  data: [
    {id: 'opaque-image-model', type: 'image', capabilities: ['text-to-image']},
    {model_id: 'opaque-task-model', task_type: 'text_to_image'},
    {id: 'opaque-video-model', modalities: ['video']},
    {id: 'opaque-image-model', supported_tasks: ['image_generation']}
  ]
});

assert.equal(records.find(record => record.id === 'opaque-image-model')?.kind, 'image');
assert.equal(records.find(record => record.id === 'opaque-task-model')?.kind, 'image');
assert.equal(records.find(record => record.id === 'opaque-video-model')?.kind, 'video');
assert.equal(records.filter(record => record.id === 'opaque-image-model').length, 1);
assert.equal(helpers.normalizeModelRecords([
  {id: 'merge-me', kind: ''},
  {id: 'merge-me', kind: 'image'}
])[0].kind, 'image');

console.log('Model import capability tests passed.');
