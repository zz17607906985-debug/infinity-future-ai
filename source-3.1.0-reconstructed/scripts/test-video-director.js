const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {window: {}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'media', 'video-director.js'), 'utf8'), sandbox, {filename: 'video-director.js'});
const director = sandbox.window.FutureAIVideoDirector;

const basic = {operations: ['generate'], inputs: {image: {maxCount: 1}}};
assert.deepEqual(Array.from(director.availableOperations(basic), item => item.id), ['text-to-video', 'image-to-video']);
assert.ok(!director.availableOperations(basic).some(item => item.id === 'first-last-frame'));

const full = {
  operations: ['generate', 'first-last-frame', 'keyframes', 'edit', 'extend', 'loop'],
  inputs: {image: {maxCount: 8}, video: {maxCount: 2}, audio: {maxCount: 1}}
};
const operations = Array.from(director.availableOperations(full), item => item.id);
assert.ok(operations.includes('first-last-frame'));
assert.ok(operations.includes('keyframes'));
assert.ok(operations.includes('stylize'));
assert.ok(operations.includes('local-edit'));
assert.ok(operations.includes('extend-forward'));
assert.ok(operations.includes('extend-backward'));
assert.ok(operations.includes('loop'));

const firstLast = director.validateRequest({
  operation: 'first-last-frame',
  duration: 8,
  references: [
    {role: 'first-frame', url: 'first.png', mediaType: 'image'},
    {role: 'last-frame', url: 'last.png', mediaType: 'image'}
  ]
});
assert.equal(firstLast.valid, true);

const badEdit = director.validateRequest({operation: 'edit', references: [{role: 'source', url: 'still.png'}]});
assert.ok(badEdit.errors.some(item => item.code === 'MISSING_SOURCE_VIDEO'));
const goodEdit = director.validateRequest({operation: 'edit', references: [{role: 'source', url: 'source.mp4'}]});
assert.equal(goodEdit.valid, true);

const timed = director.ensureKeyframeTimes([
  {role: 'first-frame', url: 'a.png'},
  {role: 'keyframe', url: 'b.png'},
  {role: 'last-frame', url: 'c.png'}
], 10);
assert.equal(timed[0].frameTime, 0);
assert.equal(timed[2].frameTime, 10);
assert.ok(timed[1].frameTime > 0 && timed[1].frameTime < 10);
assert.deepEqual(Array.from(director.keyframeTimeline(timed, 10), item => item.url), ['a.png', 'b.png', 'c.png']);

const payload = director.protocolPayload({
  operation: 'extend-backward',
  duration: 5,
  speed: 0.8,
  references: [
    {role: 'source', url: 'clip.mp4'},
    {role: 'audio', url: 'beat.mp3'},
    {role: 'style', url: 'look.png'}
  ]
});
assert.equal(payload.operation, 'extend-backward');
assert.equal(payload.capabilityOperation, 'extend');
assert.equal(payload.extendDirection, 'backward');
assert.equal(payload.videos[0], 'clip.mp4');
assert.equal(payload.audios[0], 'beat.mp3');
assert.equal(payload.images[0], 'look.png');
const firstLastPayload = director.protocolPayload({
  operation: 'first-last-frame',
  duration: 6,
  references: [
    {role: 'first-frame', url: 'first.png', mediaType: 'image'},
    {role: 'last-frame', url: 'last.png', mediaType: 'image'}
  ]
});
assert.deepEqual(firstLastPayload.images, ['first.png', 'last.png']);
assert.deepEqual(firstLastPayload.keyframes.map(item => item.role), ['first-frame', 'last-frame']);
assert.equal(firstLastPayload.keyframes[0].time, 0);
assert.equal(firstLastPayload.keyframes[1].time, 6);
assert.match(director.operationInstructions({operation: 'loop'}), /无缝循环/);

const runtime = fs.readFileSync(path.join(__dirname, '..', 'src', 'canvas', 'runtime.js'), 'utf8');
assert.match(runtime, /data-field="operation"/);
assert.match(runtime, /data-reference-time/);
assert.match(runtime, /data-keyframe-timeline/);
assert.doesNotMatch(runtime, /node\.data\.operation = available\[0\]\.id/);
assert.match(runtime, /没有修改当前选择/);
const providerApi = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'provider-api.js'), 'utf8');
assert.match(providerApi, /videoVersions/);
assert.match(providerApi, /actualDuration/);
assert.match(providerApi, /audioTrack/);

console.log('Video director tests passed.');
