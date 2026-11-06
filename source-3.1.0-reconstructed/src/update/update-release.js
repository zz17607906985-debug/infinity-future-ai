'use strict';

const crypto = require('node:crypto');

const {canonicalizeJson} = require('../licensing/license-core');
const {verifySignedUpdateManifest} = require('./update-signature');

const VERSION_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function buildSignedUpdateManifest(options = {}) {
  const {
    version,
    minimumVersion,
    artifact,
    artifactBytes,
    notes = '',
    releasedAt = new Date().toISOString(),
    kid,
    privateKey,
    keyRing
  } = options;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)
    || typeof minimumVersion !== 'string' || !VERSION_PATTERN.test(minimumVersion)
    || compareVersions(minimumVersion, version) > 0) {
    throw new Error('更新版本范围无效');
  }
  if (!(privateKey?.asymmetricKeyType === 'ed25519')
    || typeof kid !== 'string' || !/^update-[A-Za-z0-9._-]{1,56}$/.test(kid)) {
    throw new Error('更新签名私钥或 key id 无效');
  }
  if (!(keyRing instanceof Map) || !keyRing.has(kid)) throw new Error('应用尚未信任此更新签名公钥');
  const publicKeyFromPrivate = crypto.createPublicKey(privateKey).export({type: 'spki', format: 'der'});
  const configuredPublicKey = keyRing.get(kid).export({type: 'spki', format: 'der'});
  if (!publicKeyFromPrivate.equals(configuredPublicKey)) throw new Error('更新签名私钥与应用内置公钥不匹配');
  const escapedVersion = version.replaceAll('.', '\\.');
  if (typeof artifact !== 'string'
    || !(new RegExp(`^FutureAI-Setup-${escapedVersion}-(?:x64|arm64|ia32)\\.exe$`, 'i')).test(artifact)) {
    throw new Error('更新安装器文件名无效');
  }
  const bytes = Buffer.isBuffer(artifactBytes) ? artifactBytes : Buffer.from(artifactBytes || []);
  if (bytes.length < 1 || bytes.length > 4 * 1024 * 1024 * 1024) throw new Error('更新安装器大小无效');
  if (typeof notes !== 'string' || notes.length > 4000) throw new Error('更新说明超过 4000 个字符');
  const releaseDate = new Date(releasedAt);
  if (!Number.isFinite(releaseDate.getTime()) || releaseDate.toISOString() !== releasedAt) throw new Error('更新时间格式无效');

  const payload = {
    schema: 'future-ai-update/v1',
    version,
    minimumVersion,
    artifact,
    artifactType: 'nsis-installer',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    notes,
    releasedAt
  };
  const payloadBytes = Buffer.from(canonicalizeJson(payload), 'utf8');
  const envelope = {
    schema: 'future-ai-update-envelope/v1',
    signed: {
      alg: 'Ed25519',
      kid,
      payload: payloadBytes.toString('base64url'),
      signature: crypto.sign(null, payloadBytes, privateKey).toString('base64url')
    }
  };
  const manifest = `${JSON.stringify(envelope, null, 2)}\n`;
  verifySignedUpdateManifest(manifest, keyRing);
  return manifest;
}

module.exports = {buildSignedUpdateManifest};
