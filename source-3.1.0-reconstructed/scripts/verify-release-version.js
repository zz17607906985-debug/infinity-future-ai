const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const releaseRoot = process.env.FUTURE_AI_RELEASE_ROOT
  ? path.resolve(process.env.FUTURE_AI_RELEASE_ROOT)
  : path.resolve(appRoot, '..');
const packageMetadata = require(path.join(appRoot, 'package.json'));
const {createActivationRequest} = require(path.join(appRoot, 'src', 'licensing', 'license-core'));
const {compareVersions} = require(path.join(appRoot, 'src', 'update', 'installer-update'));
const {parseInstallerUpdateOutcome} = require(path.join(appRoot, 'src', 'update', 'update-outcome'));

const EXPECTED_VERSION = '3.1.1';
const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

function loadBrowserModule(relativePath, exportName, globals = {}) {
  const context = vm.createContext({window: {}, ...globals});
  vm.runInContext(read(relativePath), context, {filename: relativePath});
  return {module: context.window[exportName], window: context.window};
}

async function verifySupportVersionDisplay() {
  const elements = new Map([
    ['homeVersionBadge', {textContent: ''}],
    ['supportVersion', {textContent: ''}],
    ['supportChannel', {textContent: ''}],
    ['supportTrustStatus', {textContent: '', dataset: {}}]
  ]);
  const {module: SupportUI, window} = loadBrowserModule('src/support/support-ui.js', 'FutureAISupportUI');
  const ui = SupportUI.create({
    $: id => elements.get(id),
    toast() {},
    getStore: () => ({}),
    setStore() {},
    STORE: {settings: 'settings'},
    RendererDiagnostics: {},
    getStorageDir: () => '',
    getCurrentProjectId: () => '',
    getAppReleaseChannel: () => 'internal',
    setAppReleaseChannel() {},
    getCodexPermission: () => 'project',
    setCodexPermission() {},
    setCodexCommand() {}
  });
  window.supportBridge = {
    getInfo: async () => ({
      version: EXPECTED_VERSION,
      releaseChannel: 'internal',
      signatureStatus: 'pending',
      supportConfigured: false,
      legalStatus: 'pending'
    })
  };
  await ui.loadSupportCenter();
  assert.match(elements.get('homeVersionBadge').textContent, /v3\.1\.1$/);
  assert.equal(elements.get('supportVersion').textContent, 'v3.1.1');
}

function verifyLicenseDisplay() {
  const card = {dataset: {}, innerHTML: ''};
  const deactivate = {disabled: true};
  const {module: LicenseUI} = loadBrowserModule('src/licensing/license-ui.js', 'FutureAILicenseUI');
  const ui = LicenseUI.create({
    $: id => id === 'licenseStatus' ? card : id === 'deactivateLicense' ? deactivate : null,
    esc: value => String(value),
    toast() {},
    openModal() {}
  });
  ui.renderLicenseStatus({
    status: 'active',
    maskedLicenseId: '...3100',
    majorVersion: 3,
    updateEligible: true
  });
  assert.match(card.innerHTML, /v3/);
  assert.equal(card.dataset.status, 'active');
  assert.equal(deactivate.disabled, false);
}

async function main() {
  assert.equal(packageMetadata.version, EXPECTED_VERSION);
  assert.match(EXPECTED_VERSION, /^3\.1\.\d+$/);
  assert.doesNotMatch(read('src/index.html'), /v1\.0\.0/);
  assert.match(
    fs.readFileSync(path.join(releaseRoot, 'resources', 'legal', 'RELEASE-NOTES.md'), 'utf8'),
    /^## 3\.1\.1\b/m
  );

  assert(compareVersions('3.1.2', EXPECTED_VERSION) > 0);
  assert(compareVersions(EXPECTED_VERSION, '3.1.0') > 0);
  assert(compareVersions('3.0.9', EXPECTED_VERSION) < 0);

  const transaction = {
    schema: 'future-ai-installer-update-transaction/v1',
    token: TOKEN,
    mode: 'update',
    currentVersion: EXPECTED_VERSION,
    targetVersion: '3.1.2'
  };
  const status = {
    schema: 'future-ai-installer-update-status/v1',
    token: TOKEN,
    status: 'rolled-back',
    updatedAt: '2026-08-08T00:00:00.000Z'
  };
  assert.deepEqual(
    {...parseInstallerUpdateOutcome({transaction, status})},
    {
      token: TOKEN,
      status: 'rolled-back',
      mode: 'update',
      updatedAt: status.updatedAt,
      currentVersion: EXPECTED_VERSION,
      targetVersion: '3.1.2',
      workspaceBackupVerified: true
    }
  );

  const requestCode = createActivationRequest({
    licenseId: TOKEN,
    product: 'future-ai',
    appVersion: EXPECTED_VERSION,
    machineDigest: Buffer.alloc(32, 1).toString('base64url'),
    devicePublicKey: Buffer.alloc(32, 2).toString('base64url'),
    nonce: Buffer.alloc(16, 3).toString('base64url'),
    createdAt: '2026-08-08T00:00:00.000Z'
  });
  const request = JSON.parse(Buffer.from(requestCode, 'base64url').toString('utf8'));
  assert.equal(request.appVersion, EXPECTED_VERSION);

  await verifySupportVersionDisplay();
  verifyLicenseDisplay();
  console.log(`Release version verified: ${EXPECTED_VERSION}`);
  console.log('Update comparison, rollback outcome, activation request, support UI, and license UI passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
