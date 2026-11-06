'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const providerUi = fs.readFileSync(path.join(root, 'src', 'providers', 'provider-ui.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

assert.match(providerUi, /async function autoConfigureProviderFromCard\(/);
assert.match(providerUi, /saveProviderKeyFromCard\(card, true\)/);
assert.match(providerUi, /withTimeout\(autoDetectProviderProtocol\(provider, provider\.apiUrl, apiKey\)/);
assert.match(providerUi, /fetchApiWithBaseFallback\(provider\.apiUrl, '\/models'/);
assert.match(providerUi, /extractModelRecords\(data\)/);
assert.match(providerUi, /applyImportedModelRecordsToProvider\(provider, records\)/);
assert.match(providerUi, /automaticModelForKind\(provider, records, 'image'\)/);
assert.match(providerUi, /provider\.setupStatus = provider\.imageModel \? 'ready' : 'needs-model'/);
assert.doesNotMatch(providerUi.slice(providerUi.indexOf('async function autoConfigureProviderFromCard'), providerUi.indexOf('async function saveAndTestProviderFromCard')), /requestImageGenerationWithModel\(/, 'saving a provider must not make a paid image request');
assert.match(app, /applyImportedModelRecordsToProvider,\n        extractModelIds/);
assert.match(app, /async function autoConfigureProviderFromCard\(\.\.\.args\)/);

console.log('Provider automatic configuration tests passed.');
