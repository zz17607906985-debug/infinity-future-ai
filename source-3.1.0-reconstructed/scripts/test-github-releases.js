'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {canonicalizeJson} = require('../src/licensing/license-core');
const {
  cacheGitHubReleaseInstaller,
  checkLatestGitHubUpdate,
  repositoryPath,
  validateAssetUrl
} = require('../src/update/github-releases');
const {buildSignedUpdateManifest} = require('../src/update/update-release');
const {buildUpdateHelperCommand, verifyInstallerPackage} = require('../src/update/installer-update');

function signedManifest(privateKey, artifactBytes, version = '3.2.0') {
  const payload = {
    schema: 'future-ai-update/v1',
    version,
    minimumVersion: '3.1.0',
    artifact: `FutureAI-Setup-${version}-x64.exe`,
    artifactType: 'nsis-installer',
    sha256: crypto.createHash('sha256').update(artifactBytes).digest('hex'),
    bytes: artifactBytes.length,
    notes: 'Update test',
    releasedAt: '2026-11-06T00:00:00.000Z'
  };
  const payloadBytes = Buffer.from(canonicalizeJson(payload), 'utf8');
  return Buffer.from(JSON.stringify({
    schema: 'future-ai-update-envelope/v1',
    signed: {
      alg: 'Ed25519',
      kid: 'update-test-key',
      payload: payloadBytes.toString('base64url'),
      signature: crypto.sign(null, payloadBytes, privateKey).toString('base64url')
    }
  }));
}

async function main() {
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
  const artifactBytes = Buffer.from('test-installer-bytes');
  const manifestBytes = signedManifest(privateKey, artifactBytes);
  const currentArtifactBytes = Buffer.from('current-installer-bytes');
  const currentManifestBytes = signedManifest(privateKey, currentArtifactBytes, '3.1.0');
  const keyRing = new Map([['update-test-key', publicKey]]);
  const releasePath = '/repos/example/infinity-future-ai/releases/latest';
  const currentReleasePath = '/repos/example/infinity-future-ai/releases/tags/v3.1.0';
  const manifestUrl = 'https://api.github.com/repos/example/infinity-future-ai/releases/assets/10';
  const artifactUrl = 'https://api.github.com/repos/example/infinity-future-ai/releases/assets/11';
  const currentManifestUrl = 'https://api.github.com/repos/example/infinity-future-ai/releases/assets/20';
  const currentArtifactUrl = 'https://api.github.com/repos/example/infinity-future-ai/releases/assets/21';
  const release = {
    tag_name: 'v3.2.0',
    draft: false,
    prerelease: false,
    assets: [
      {id: 10, name: 'update-manifest.json', size: manifestBytes.length, url: manifestUrl},
      {id: 11, name: 'FutureAI-Setup-3.2.0-x64.exe', size: artifactBytes.length, url: artifactUrl}
    ]
  };
  const currentRelease = {
    tag_name: 'v3.1.0',
    draft: false,
    prerelease: false,
    assets: [
      {id: 20, name: 'update-manifest.json', size: currentManifestBytes.length, url: currentManifestUrl},
      {id: 21, name: 'FutureAI-Setup-3.1.0-x64.exe', size: currentArtifactBytes.length, url: currentArtifactUrl}
    ]
  };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({url: String(url), options});
    const responseBody = String(url) === `${'https://api.github.com'}${releasePath}`
      ? JSON.stringify(release)
      : String(url) === `${'https://api.github.com'}${currentReleasePath}`
        ? JSON.stringify(currentRelease)
      : String(url) === manifestUrl
        ? manifestBytes
        : String(url) === artifactUrl
          ? artifactBytes
          : String(url) === currentManifestUrl
            ? currentManifestBytes
            : String(url) === currentArtifactUrl
              ? currentArtifactBytes
          : null;
    if (responseBody == null) return new Response('', {status: 404});
    return new Response(responseBody, {status: 200});
  };
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'future-ai-github-update-test-'));
  try {
    const result = await checkLatestGitHubUpdate({
      owner: 'example',
      repo: 'infinity-future-ai',
      currentVersion: '3.1.0',
      keyRing,
      cacheDir,
      fetchImpl
    });
    assert.equal(result.updateAvailable, true);
    assert.equal(result.availableVersion, '3.2.0');
    assert.equal(await fs.readFile(result.installerPath, 'utf8'), artifactBytes.toString('utf8'));
    assert.equal(await fs.readFile(path.join(result.packageDir, 'update-manifest.json'), 'utf8'), manifestBytes.toString('utf8'));
    assert.equal(calls[2].options.headers.Accept, 'application/octet-stream');
    const verifiedInstaller = await verifyInstallerPackage({
      packageDir: result.packageDir,
      currentVersion: '3.1.0',
      keyRing
    });
    assert.equal(verifiedInstaller.verification, 'ed25519-manifest+sha256');
    assert.equal(verifiedInstaller.authenticode, undefined);

    const upToDate = await checkLatestGitHubUpdate({
      owner: 'example',
      repo: 'infinity-future-ai',
      currentVersion: '3.2.0',
      keyRing,
      cacheDir,
      fetchImpl
    });
    assert.equal(upToDate.updateAvailable, false);
    assert.equal(calls.length, 5);
    const rollbackInstaller = await cacheGitHubReleaseInstaller({
      owner: 'example',
      repo: 'infinity-future-ai',
      version: '3.1.0',
      keyRing,
      cacheDir,
      fetchImpl
    });
    assert.equal(rollbackInstaller.cached, false);
    assert.equal(await fs.readFile(rollbackInstaller.installerPath, 'utf8'), currentArtifactBytes.toString('utf8'));
    const helper = buildUpdateHelperCommand({transactionFile: 'C:\\update.json', transactionSha256: 'a'.repeat(64)});
    const helperScript = Buffer.from(helper.args.at(-1), 'base64').toString('utf16le');
    assert.doesNotMatch(helperScript, /Get-AuthenticodeSignature|Authenticode/);
    assert.match(helperScript, /Get-FileHash .*SHA256/);
    assert.equal(repositoryPath('example', 'infinity-future-ai'), releasePath.replace('/releases/latest', ''));
    assert.throws(() => repositoryPath('bad/owner', 'infinity-future-ai'), /配置无效/);
    assert.throws(() => validateAssetUrl('https://example.com/payload', 'example', 'infinity-future-ai', 10), /不受信任/);
    const generated = buildSignedUpdateManifest({
      version: '3.2.0',
      minimumVersion: '3.1.0',
      artifact: 'FutureAI-Setup-3.2.0-x64.exe',
      artifactBytes,
      notes: 'Release notes',
      releasedAt: '2026-11-06T00:00:00.000Z',
      kid: 'update-test-key',
      privateKey,
      keyRing
    });
    assert.equal(JSON.parse(generated).schema, 'future-ai-update-envelope/v1');
    assert.throws(() => buildSignedUpdateManifest({
      version: '3.2.0',
      minimumVersion: '3.1.0',
      artifact: 'FutureAI-Setup-3.2.0-x64.exe',
      artifactBytes,
      kid: 'update-test-key',
      privateKey,
      keyRing: new Map()
    }), /尚未信任/);

    await assert.rejects(
      checkLatestGitHubUpdate({
        owner: 'example',
        repo: 'infinity-future-ai',
        currentVersion: '3.1.0',
        keyRing: new Map(),
        cacheDir,
        fetchImpl
      }),
      /未知或尚未配置/
    );
    console.log('GitHub updater contract passed: signed release metadata, bounded downloads, and update ordering.');
  } finally {
    await fs.rm(cacheDir, {recursive: true, force: true});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
