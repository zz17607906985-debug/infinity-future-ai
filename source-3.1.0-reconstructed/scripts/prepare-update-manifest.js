'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {loadIssuerKeyRing} = require('../src/licensing/issuer-keys');
const {buildSignedUpdateManifest} = require('../src/update/update-release');

async function main() {
  const appRoot = path.resolve(__dirname, '..');
  const packageMetadata = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
  const version = String(packageMetadata.version || '');
  const arch = process.env.FUTURE_AI_UPDATE_ARCH || 'x64';
  if (!['x64', 'arm64', 'ia32'].includes(arch)) throw new Error('FUTURE_AI_UPDATE_ARCH must be x64, arm64, or ia32');
  const artifact = `FutureAI-Setup-${version}-${arch}.exe`;
  const outputDir = path.resolve(process.env.FUTURE_AI_RELEASE_DIR || path.resolve(appRoot, 'dist'));
  const artifactPath = path.join(outputDir, artifact);
  const privateKeyPem = process.env.FUTURE_AI_UPDATE_PRIVATE_KEY;
  const kid = process.env.FUTURE_AI_UPDATE_KEY_ID;
  const minimumVersion = process.env.FUTURE_AI_UPDATE_MINIMUM_VERSION || version;
  const notesFile = process.env.FUTURE_AI_RELEASE_NOTES_FILE || '';
  if (!privateKeyPem || !kid) throw new Error('FUTURE_AI_UPDATE_PRIVATE_KEY and FUTURE_AI_UPDATE_KEY_ID are required');
  const stats = await fs.stat(artifactPath);
  if (!stats.isFile()) throw new Error('找不到要签名的安装器');
  const notes = notesFile ? await fs.readFile(path.resolve(notesFile), 'utf8') : '';
  const keyRing = loadIssuerKeyRing(path.join(appRoot, 'src', 'update', 'update-public-keys.json'), 'future-ai-update-keys/v1');
  const manifest = buildSignedUpdateManifest({
    version,
    minimumVersion,
    artifact,
    artifactBytes: await fs.readFile(artifactPath),
    notes,
    kid,
    privateKey: require('node:crypto').createPrivateKey(privateKeyPem),
    keyRing
  });
  const manifestPath = path.join(outputDir, 'update-manifest.json');
  await fs.writeFile(manifestPath, manifest, {encoding: 'utf8', flag: 'wx'});
  console.log(`Signed update manifest created: ${manifestPath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
