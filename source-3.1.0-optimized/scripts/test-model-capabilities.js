'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {window: {}};
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'models', 'capabilities.js'), 'utf8');
vm.runInNewContext(source, sandbox, {filename: 'capabilities.js'});

const capabilities = sandbox.window.FutureAIModelCapabilities;

const imageProfile = capabilities.resolveProfile({
  provider: {type: 'openai-images'},
  modelId: 'gpt-image-1',
  kind: 'image'
});
assert.equal(imageProfile.schemaVersion, 1);
assert.ok(imageProfile.operations.includes('generate'));
assert.ok(imageProfile.operations.includes('edit'));
assert.ok(imageProfile.outputs.image.aspects.includes('16:9'));
assert.equal(
  capabilities.validateRequest(imageProfile, {
    operation: 'edit',
    aspect: '16:9',
    resolution: '2K',
    references: [{role: 'character'}]
  }).errors.length,
  0
);

const customVideoProfile = capabilities.resolveProfile({
  provider: {
    type: 'custom-sync',
    modelCapabilityProfiles: {
      'director-video': {
        modalities: ['video'],
        operations: ['generate', 'first-last-frame'],
        inputs: {image: {maxCount: 2, roles: ['first-frame', 'last-frame']}},
        outputs: {video: {sizes: ['1280x720'], durations: [5, 10]}},
        billing: {unit: 'video-second', estimatedPrice: 0.12, currency: 'USD'},
        lifecycle: {status: 'active'}
      }
    }
  },
  modelId: 'director-video',
  kind: 'video'
});
assert.equal(customVideoProfile.source.kind, 'provider-custom');
assert.equal(JSON.stringify(customVideoProfile.outputs.video.durations), JSON.stringify([5, 10]));

const invalidVideo = capabilities.validateRequest(customVideoProfile, {
  operation: 'first-last-frame',
  size: '720x1280',
  duration: 8,
  references: [{role: 'first-frame'}, {role: 'first-frame'}]
});
assert.ok(invalidVideo.errors.some(issue => issue.code === 'UNSUPPORTED_SIZE'));
assert.ok(invalidVideo.errors.some(issue => issue.code === 'UNSUPPORTED_DURATION'));
assert.ok(invalidVideo.errors.some(issue => issue.code === 'DUPLICATE_REFERENCE_ROLE'));
assert.ok(invalidVideo.errors.some(issue => issue.code === 'MISSING_REQUIRED_REFERENCE'));

const validVideo = capabilities.validateRequest(customVideoProfile, {
  operation: 'first-last-frame',
  size: '1280x720',
  duration: 10,
  references: [{role: 'first-frame'}, {role: 'last-frame'}]
});
assert.equal(validVideo.errors.length, 0);
assert.equal(capabilities.estimateCost(customVideoProfile, {duration: 10, count: 1}).amount, 1.2);

const constrainedProfile = capabilities.normalizeProfile({
  modalities: ['image'],
  operations: ['edit'],
  inputs: {
    image: {
      maxCount: 2,
      roles: ['source', 'reference'],
      mimeTypes: ['image/png', 'image/jpeg'],
      maxFileSizeMB: 5,
      maxTotalSizeMB: 8
    }
  },
  billing: {
    unit: 'image',
    estimatedPrice: 0.04,
    currency: 'USD',
    inputReferencePrice: 0.01,
    resolutionMultipliers: {'2K': 1.5},
    uncertaintyPercent: 20
  },
  lifecycle: {status: 'active', availableFrom: '2026-08-10'}
}, {kind: 'image', modelId: 'constrained-image', now: Date.parse('2026-08-09T12:00:00Z')});
assert.equal(constrainedProfile.lifecycle.availableFrom, '2026-08-10');
assert.deepEqual(Array.from(constrainedProfile.inputs.image.mimeTypes), ['image/png', 'image/jpeg']);
assert.equal(constrainedProfile.inputs.image.maxFileSizeMB, 5);
assert.equal(constrainedProfile.inputs.image.maxTotalSizeMB, 8);
const unavailable = capabilities.validateRequest(constrainedProfile, {operation: 'edit'});
assert.ok(unavailable.errors.some(issue => issue.code === 'MODEL_NOT_AVAILABLE'));
const invalidFiles = capabilities.validateRequest({...constrainedProfile, lifecycle: {...constrainedProfile.lifecycle, availableFrom: '2026-08-01'}}, {
  operation: 'edit',
  references: [
    {role: 'source', mime: 'image/webp', sizeBytes: 6 * 1024 * 1024},
    {role: 'reference', mime: 'image/png', sizeBytes: 3 * 1024 * 1024}
  ]
});
assert.ok(invalidFiles.errors.some(issue => issue.code === 'UNSUPPORTED_REFERENCE_FILE_TYPE'));
assert.ok(invalidFiles.errors.some(issue => issue.code === 'REFERENCE_FILE_TOO_LARGE'));
assert.ok(invalidFiles.errors.some(issue => issue.code === 'REFERENCE_TOTAL_TOO_LARGE'));
const rangedImageCost = capabilities.estimateCost(constrainedProfile, {
  count: 2,
  resolution: '2K',
  references: [{role: 'source'}]
});
assert.equal(rangedImageCost.amount, 0.13);
assert.equal(rangedImageCost.minAmount, 0.104);
assert.equal(rangedImageCost.maxAmount, 0.156);
assert.equal(rangedImageCost.exact, false);
assert.match(capabilities.formatEstimate(rangedImageCost), /0\.104.*0\.156/);

const tokenProfile = capabilities.normalizeProfile({
  modalities: ['chat'],
  operations: ['complete'],
  billing: {unit: 'token', estimatedPrice: 0.002, tokensPerUnit: 1000, currency: 'USD'}
}, {kind: 'chat', modelId: 'token-chat'});
assert.equal(capabilities.estimateCost(tokenProfile, {tokens: 2500}).amount, 0.005);
const audioSecondProfile = capabilities.normalizeProfile({
  modalities: ['audio'],
  operations: ['synthesize'],
  billing: {unit: 'audio-second', estimatedPrice: 0.003, currency: 'USD'}
}, {kind: 'audio', modelId: 'timed-tts'});
assert.equal(capabilities.estimateCost(audioSecondProfile, {duration: 12}).amount, 0.036);

const retired = capabilities.resolveProfile({
  provider: {
    modelCapabilityProfiles: {
      old: {modalities: ['image'], lifecycle: {status: 'retired', replacementModelId: 'new-image'}}
    }
  },
  modelId: 'old',
  kind: 'image'
});
assert.ok(capabilities.validateRequest(retired, {operation: 'generate'}).errors.some(issue => issue.code === 'MODEL_RETIRED'));

const datedLifecycle = capabilities.normalizeProfile({
  modalities: ['image'],
  lifecycle: {status: 'active', deprecatedAt: '2026-08-01', shutdownAt: '2026-08-09', replacementModelId: 'new-image'}
}, {kind: 'image', modelId: 'dated-image', now: Date.parse('2026-08-09T12:00:00Z')});
assert.equal(datedLifecycle.lifecycle.status, 'retired');
assert.equal(datedLifecycle.lifecycle.daysUntilShutdown, 0);

const projects = [{
  id: 'p1', name: '项目一', updatedAt: 1,
  state: {
    edges: [{from: 'n1', to: 'n2'}],
    nodes: [
      {id: 'n1', type: 'image', data: {providerId: 'provider-1', model: 'old-image', url: 'keep.png', references: [{role: 'character'}]}},
      {id: 'n2', type: 'video', data: {providerId: 'provider-2', model: 'old-image', url: 'keep.mp4'}}
    ]
  }
}];
const usage = capabilities.scanModelUsage(projects, {providerId: 'provider-1', modelId: 'old-image'});
assert.equal(usage.length, 1);
const migration = capabilities.migrateModelUsage(projects, {providerId: 'provider-1', fromModelId: 'old-image', toModelId: 'new-image', at: 123});
assert.equal(migration.changes.length, 1);
assert.equal(migration.projects[0].state.nodes[0].data.model, 'new-image');
assert.equal(migration.projects[0].state.nodes[0].data.url, 'keep.png');
assert.equal(migration.projects[0].state.nodes[1].data.model, 'old-image');
assert.equal(JSON.stringify(migration.projects[0].state.edges), JSON.stringify(projects[0].state.edges));
assert.equal(migration.projects[0].history.at(-1).label, '模型迁移前：old-image');
const rollback = capabilities.rollbackModelMigration(migration.projects, migration.migration);
assert.equal(rollback.restored, 1);
assert.equal(rollback.projects[0].state.nodes[0].data.model, 'old-image');

const unknown = capabilities.resolveProfile({provider: {type: 'custom-sync'}, modelId: 'private-model', kind: 'video'});
assert.equal(unknown.source.kind, 'safe-default');
assert.ok(unknown.outputs.video.sizes.includes('1024x1024'));
assert.ok(capabilities.profileSummary(unknown).includes('能力待确认'));

const chatProfile = capabilities.resolveProfile({provider: {type: 'openai-compatible'}, modelId: 'qwen-plus', kind: 'chat'});
assert.ok(chatProfile.operations.includes('complete'));
assert.ok(chatProfile.outputs.text);
assert.equal(chatProfile.source.kind, 'built-in');

const audioProfile = capabilities.resolveProfile({provider: {type: 'openai-compatible'}, modelId: 'voice-tts', kind: 'audio'});
assert.ok(audioProfile.operations.includes('synthesize'));
assert.ok(audioProfile.outputs.audio.formats.includes('mp3'));

const providerUiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'provider-ui.js'), 'utf8');
vm.runInNewContext(providerUiSource, sandbox, {filename: 'provider-ui.js'});
const providerUi = sandbox.window.FutureAIProviderUI.create({
  $: () => ({value: ''}),
  esc: value => String(value ?? ''),
  unique: values => [...new Set(values)],
  IMAGE_PROVIDER_TYPES: [
    {id: 'openai-images', label: 'OpenAI', capabilities: [], supports: {text: true, image: true, edit: true, video: true}},
    {id: 'custom-sync', label: 'Custom', capabilities: [], supports: {text: true, image: true, edit: true, video: true}}
  ],
  normalizeModelRecords: values => Array.isArray(values) ? values : [],
  normalizeKnownImageModelAlias: value => String(value || ''),
  classifyModelKind: () => 'video',
  isZexImageGateway: () => false,
  KeyPool: {
    migrateLegacyProviderKey: () => ({keys: [], activeKeyId: ''}),
    normalizeModelKeyBindings: value => value || {}
  },
  ModelCapabilities: capabilities
});
const normalizedProvider = providerUi.normalizeApiProvider({
  id: 'custom',
  type: 'custom-sync',
  videoModel: 'director-video',
  modelCapabilityProfiles: {'director-video': customVideoProfile}
});
assert.equal(normalizedProvider.modelCapabilityProfiles['director-video'].billing.estimatedPrice, 0.12);
const capabilityEditor = providerUi.providerCapabilityEditorHtml(normalizedProvider, 'video');
assert.match(capabilityEditor, /本地自定义/);
assert.match(capabilityEditor, /支持文件类型/);
assert.match(capabilityEditor, /单文件上限/);
assert.match(capabilityEditor, /启用日期/);
assert.match(capabilityEditor, /价格浮动/);

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
assert.ok(indexHtml.indexOf('./models/capabilities.js') < indexHtml.indexOf('./providers/provider-api.js'));
const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
assert.match(appSource, /ModelCapabilities\.validateRequest\(profile, request\)/);
assert.match(appSource, /已配置价格的模型预计费用/);

console.log('Model capability tests passed.');
