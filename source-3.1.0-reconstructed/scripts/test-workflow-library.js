const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {performance} = require('perf_hooks');

const memory = new Map();
const sandbox = {window: {localStorage: {getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value)}}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'workflows', 'workflow-library.js'), 'utf8'), sandbox, {filename: 'workflow-library.js'});
const workflows = sandbox.window.FutureAIWorkflowLibrary;

const definition = workflows.createDefinition({
  name: '测试流程',
  nodes: [
    {id: 'a', type: 'image', x: 100, y: 200, data: {model: 'image-model', apiKey: 'secret', url: 'C:\\private\\asset.png', references: [{role: 'character'}]}},
    {id: 'b', type: 'video', x: 500, y: 200, data: {model: 'video-model', operation: 'image-to-video'}}
  ],
  edges: [{from: 'a', fromPort: 'image', to: 'b', toPort: 'ref'}],
  exposed: {
    inputs: [{nodeId: 'a', field: 'prompt'}],
    outputs: [{nodeId: 'b'}],
    parameters: [{nodeId: 'a', field: 'prompt'}, {nodeId: 'b', field: 'size'}]
  },
  groups: [{id: 'g', name: '组合', nodeIds: ['a', 'b']}]
});
assert.equal(definition.nodes[0].data.apiKey, undefined);
assert.equal(definition.nodes[0].data.url, '');
assert.equal(definition.nodes[0].x, 0);
assert.equal(definition.edges.length, 1);

const instance = workflows.instantiate(definition, {originX: 1000, originY: 500});
assert.equal(instance.nodes.length, 2);
assert.equal(instance.edges[0].from, instance.nodes[0].id);
assert.equal(instance.groups[0].workflowVersion, '1.0.0');
assert.ok(instance.groups[0].workflowDefinition.nodes.length === 2);
assert.deepEqual(instance.definition.exposed.outputs, [{nodeId: 'b'}]);
assert.deepEqual(instance.nodes.find(node => node.sourceId === 'a').data.workflowExposure.parameters, ['prompt']);
assert.equal(instance.nodes.find(node => node.sourceId === 'b').data.workflowExposure.output, true);

const saved = workflows.saveLibrary([definition]);
assert.equal(saved.length, 1);
assert.equal(workflows.loadLibrary().length, 1);
assert.equal(workflows.BUILT_INS.length, 6);
assert.deepEqual(Array.from(workflows.BUILT_INS, item => item.name), ['角色定妆', '三镜头分镜', '图片转视频', '首尾帧视频', '广告变体', '漫剧单镜头']);

// Legacy definitions without an explicit schema version remain importable.
const legacy = workflows.normalizeDefinition({
  id: 'legacy-workflow',
  name: 'legacy',
  nodes: [{id: 'legacy-node', type: 'prompt', x: 20, y: 30, data: {prompt: 'hello'}}],
  edges: []
});
assert.equal(legacy.schemaVersion, workflows.SCHEMA_VERSION);
assert.equal(legacy.compatibility.minAppVersion, '3.1.0');

// Large saved workflows should instantiate without quadratic blowups.
const largeNodes = Array.from({length: 500}, (_, index) => ({
  id: `node-${index}`,
  type: index % 2 ? 'image' : 'prompt',
  x: index * 12,
  y: (index % 20) * 24,
  data: {prompt: `node ${index}`, model: index % 2 ? '__IMAGE_MODEL__' : ''}
}));
const largeEdges = largeNodes.slice(1).map((node, index) => ({
  from: largeNodes[index].id,
  fromPort: 'text',
  to: node.id,
  toPort: 'prompt'
}));
const largeDefinition = workflows.createDefinition({name: 'large', nodes: largeNodes, edges: largeEdges});
const started = performance.now();
const largeInstance = workflows.instantiate(largeDefinition, {imageModel: 'image-model'});
const elapsed = performance.now() - started;
assert.equal(largeInstance.nodes.length, 500);
assert.equal(largeInstance.edges.length, 499);
assert.ok(elapsed < 1500, `large workflow instantiate took ${elapsed.toFixed(1)}ms`);

console.log('Workflow library tests passed.');
