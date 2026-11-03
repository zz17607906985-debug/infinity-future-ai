const crypto = require('node:crypto');

const { canonicalizeJson } = require('../licensing/license-core');

const MAX_MANIFEST_BYTES = 64 * 1024;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function fail(message) {
  throw new Error(message);
}

function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(message);
}

function assertExactKeys(value, expected, message) {
  assertObject(value, message);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) fail(message);
}

function decodeBase64url(value, name, min, max) {
  if (typeof value !== 'string' || !BASE64URL.test(value) || value.length > Math.ceil(max * 4 / 3) + 2) fail(`${name}编码无效`);
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length < min || bytes.length > max || bytes.toString('base64url') !== value) fail(`${name}编码无效`);
  return bytes;
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function parseInput(input) {
  if (typeof input !== 'string') {
    assertObject(input, '更新清单格式无效');
    if (Buffer.byteLength(JSON.stringify(input)) > MAX_MANIFEST_BYTES) fail('更新清单超过安全限制');
    return input;
  }
  if (Buffer.byteLength(input, 'utf8') > MAX_MANIFEST_BYTES) fail('更新清单超过安全限制');
  try { return JSON.parse(input); } catch { fail('更新清单格式无效'); }
}

function verifySignedUpdateManifest(input, keyRing) {
  const manifest = parseInput(input);
  assertExactKeys(manifest, ['schema', 'signed'], '更新清单格式无效');
  if (manifest.schema !== 'future-ai-update-envelope/v1') fail('更新清单版本不受支持');
  assertExactKeys(manifest.signed, ['alg', 'kid', 'payload', 'signature'], '更新签名封装格式无效');
  const signed = manifest.signed;
  if (typeof signed.kid !== 'string' || !signed.kid.startsWith('update-')) fail('update signing key purpose mismatch');
  if (signed.alg !== 'Ed25519' || typeof signed.kid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(signed.kid)) {
    fail('更新签名配置无效');
  }
  if (!(keyRing instanceof Map)) fail('更新发布者公钥配置无效');
  const publicKey = keyRing.get(signed.kid);
  if (!publicKey) fail('更新发布者未知或尚未配置');
  const payloadBytes = decodeBase64url(signed.payload, '更新载荷', 2, 32 * 1024);
  const signature = decodeBase64url(signed.signature, '更新签名', 64, 64);
  if (!crypto.verify(null, payloadBytes, publicKey, signature)) fail('更新清单签名验证失败');

  let payload;
  try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { fail('更新载荷格式无效'); }
  if (Buffer.from(canonicalizeJson(payload)).compare(payloadBytes) !== 0) fail('更新载荷不是规范化 JSON');
  assertExactKeys(payload, [
    'schema', 'version', 'minimumVersion', 'artifact', 'artifactType', 'sha256', 'bytes', 'notes', 'releasedAt'
  ], '更新载荷字段无效');
  if (payload.schema !== 'future-ai-update/v1') fail('更新载荷版本不受支持');
  if (typeof payload.version !== 'string' || !VERSION.test(payload.version)
    || typeof payload.minimumVersion !== 'string' || !VERSION.test(payload.minimumVersion)
    || compareVersions(payload.minimumVersion, payload.version) > 0) {
    fail('更新版本无效');
  }
  if (payload.artifactType !== 'nsis-installer') fail('更新制品类型无效');
  const escapedVersion = payload.version.replaceAll('.', '\\.');
  if (typeof payload.artifact !== 'string'
    || !(new RegExp(`^FutureAI-Setup-${escapedVersion}-(?:x64|arm64|ia32)\\.exe$`, 'i')).test(payload.artifact)) {
    fail('更新包路径无效');
  }
  if (typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sha256)) fail('更新包 SHA-256 无效');
  if (!Number.isSafeInteger(payload.bytes) || payload.bytes < 1 || payload.bytes > 4 * 1024 * 1024 * 1024) fail('更新包大小无效');
  if (typeof payload.notes !== 'string' || payload.notes.length > 4000) fail('更新说明无效');
  const releasedAt = new Date(payload.releasedAt);
  if (typeof payload.releasedAt !== 'string' || !Number.isFinite(releasedAt.getTime()) || releasedAt.toISOString() !== payload.releasedAt) {
    fail('更新发布时间无效');
  }
  return Object.freeze({ ...payload });
}

module.exports = { verifySignedUpdateManifest };
