const crypto = require('node:crypto');

const MAX_BUNDLE_BYTES = 64 * 1024;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const LICENSE_ERROR = Object.freeze({
  INPUT_TOO_LARGE: 'LICENSE_INPUT_TOO_LARGE',
  INVALID_FORMAT: 'LICENSE_INVALID_FORMAT',
  UNKNOWN_ISSUER: 'LICENSE_UNKNOWN_ISSUER',
  INVALID_SIGNATURE: 'LICENSE_INVALID_SIGNATURE',
  PRODUCT_MISMATCH: 'LICENSE_PRODUCT_MISMATCH',
  VERSION_MISMATCH: 'LICENSE_VERSION_MISMATCH',
  DEVICE_MISMATCH: 'LICENSE_DEVICE_MISMATCH',
  ENTITLEMENT_MISMATCH: 'LICENSE_ENTITLEMENT_MISMATCH'
});

class LicenseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LicenseError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LicenseError(code, message);
}

function canonicalizeJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(LICENSE_ERROR.INVALID_FORMAT, '许可证包含无效数字');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  fail(LICENSE_ERROR.INVALID_FORMAT, '许可证包含不支持的数据类型');
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(LICENSE_ERROR.INVALID_FORMAT, `${name}格式无效`);
  }
}

function assertExactKeys(value, expected, name) {
  assertPlainObject(value, name);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    fail(LICENSE_ERROR.INVALID_FORMAT, `${name}字段不完整或包含未知字段`);
  }
}

function assertString(value, name, min, max, pattern) {
  if (typeof value !== 'string' || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    fail(LICENSE_ERROR.INVALID_FORMAT, `${name}无效`);
  }
}

function assertInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(LICENSE_ERROR.INVALID_FORMAT, `${name}无效`);
  }
}

function parseIsoDate(value, name) {
  assertString(value, name, 20, 32);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(LICENSE_ERROR.INVALID_FORMAT, `${name}不是规范 UTC 时间`);
  }
  return parsed;
}

function decodeBase64url(value, name, minBytes = 1, maxBytes = MAX_PAYLOAD_BYTES) {
  assertString(value, name, 2, Math.ceil(maxBytes * 4 / 3) + 2, BASE64URL_PATTERN);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length < minBytes || decoded.length > maxBytes || decoded.toString('base64url') !== value) {
    fail(LICENSE_ERROR.INVALID_FORMAT, `${name}编码无效`);
  }
  return decoded;
}

function parseInput(input) {
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_BUNDLE_BYTES) {
      fail(LICENSE_ERROR.INPUT_TOO_LARGE, '许可证输入超过安全限制');
    }
    try {
      return JSON.parse(input);
    } catch {
      fail(LICENSE_ERROR.INVALID_FORMAT, '许可证不是有效 JSON');
    }
  }
  assertPlainObject(input, '许可证');
  let encoded;
  try {
    encoded = JSON.stringify(input);
  } catch {
    fail(LICENSE_ERROR.INVALID_FORMAT, '许可证无法解析');
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BUNDLE_BYTES) {
    fail(LICENSE_ERROR.INPUT_TOO_LARGE, '许可证输入超过安全限制');
  }
  return input;
}

function verifyEnvelope(envelope, keyRing) {
  if (envelope && typeof envelope.kid === 'string' && !envelope.kid.startsWith('issuer-')) {
    fail(LICENSE_ERROR.UNKNOWN_ISSUER, 'license signing key purpose mismatch');
  }
  assertExactKeys(envelope, ['alg', 'kid', 'payload', 'signature'], '签名封装');
  if (envelope.alg !== 'Ed25519') fail(LICENSE_ERROR.INVALID_FORMAT, '不支持的签名算法');
  assertString(envelope.kid, '签发密钥编号', 3, 64, KID_PATTERN);
  if (!(keyRing instanceof Map)) fail(LICENSE_ERROR.INVALID_FORMAT, '发行公钥配置无效');
  const publicKey = keyRing.get(envelope.kid);
  if (!publicKey) fail(LICENSE_ERROR.UNKNOWN_ISSUER, '许可证签发者未知');

  const payloadBytes = decodeBase64url(envelope.payload, '许可证载荷', 2, MAX_PAYLOAD_BYTES);
  const signature = decodeBase64url(envelope.signature, '许可证签名', 64, 64);
  if (!crypto.verify(null, payloadBytes, publicKey, signature)) {
    fail(LICENSE_ERROR.INVALID_SIGNATURE, '许可证签名验证失败');
  }

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    fail(LICENSE_ERROR.INVALID_FORMAT, '许可证载荷不是有效 JSON');
  }
  assertPlainObject(payload, '许可证载荷');
  if (Buffer.from(canonicalizeJson(payload), 'utf8').compare(payloadBytes) !== 0) {
    fail(LICENSE_ERROR.INVALID_FORMAT, '许可证载荷不是规范化 JSON');
  }
  return { payload, payloadBytes };
}

function validateEntitlement(payload) {
  assertExactKeys(payload, [
    'schema', 'licenseId', 'product', 'edition', 'ownerId', 'issuedAt', 'perpetual',
    'majorVersion', 'maintenanceUntil', 'deviceLimit', 'features', 'nonce'
  ], '授权权益');
  if (payload.schema !== 'future-ai-entitlement/v1') fail(LICENSE_ERROR.INVALID_FORMAT, '授权权益版本不受支持');
  assertString(payload.licenseId, '许可证编号', 36, 36, UUID_PATTERN);
  assertString(payload.product, '产品编号', 3, 64, PRODUCT_ID_PATTERN);
  if (payload.edition !== 'perpetual-standard') fail(LICENSE_ERROR.INVALID_FORMAT, '授权版本不受支持');
  assertString(payload.ownerId, '客户编号', 3, 128, /^[A-Za-z0-9._-]+$/);
  parseIsoDate(payload.issuedAt, '签发时间');
  if (payload.perpetual !== true) fail(LICENSE_ERROR.INVALID_FORMAT, '买断许可证必须是永久权益');
  assertInteger(payload.majorVersion, '授权大版本', 1, 999);
  parseIsoDate(payload.maintenanceUntil, '维护截止时间');
  assertInteger(payload.deviceLimit, '设备数量', 1, 10);
  if (!Array.isArray(payload.features) || payload.features.length < 1 || payload.features.length > 64) {
    fail(LICENSE_ERROR.INVALID_FORMAT, '功能授权列表无效');
  }
  const features = new Set();
  for (const feature of payload.features) {
    assertString(feature, '功能编号', 2, 64, PRODUCT_ID_PATTERN);
    if (features.has(feature)) fail(LICENSE_ERROR.INVALID_FORMAT, '功能授权列表包含重复项');
    features.add(feature);
  }
  decodeBase64url(payload.nonce, '授权随机数', 16, 64);
}

function validateActivation(payload) {
  assertExactKeys(payload, [
    'schema', 'activationId', 'licenseId', 'entitlementHash', 'generation',
    'deviceBinding', 'issuedAt', 'mode', 'allowedMajorVersion'
  ], '激活证书');
  if (payload.schema !== 'future-ai-activation/v1') fail(LICENSE_ERROR.INVALID_FORMAT, '激活证书版本不受支持');
  assertString(payload.activationId, '激活编号', 36, 36, UUID_PATTERN);
  assertString(payload.licenseId, '许可证编号', 36, 36, UUID_PATTERN);
  decodeBase64url(payload.entitlementHash, '授权摘要', 32, 32);
  assertInteger(payload.generation, '激活代次', 1, Number.MAX_SAFE_INTEGER);
  assertExactKeys(payload.deviceBinding, ['version', 'machineDigest', 'devicePublicKey'], '设备绑定');
  if (payload.deviceBinding.version !== 1) fail(LICENSE_ERROR.INVALID_FORMAT, '设备绑定版本不受支持');
  decodeBase64url(payload.deviceBinding.machineDigest, '设备摘要', 32, 32);
  decodeBase64url(payload.deviceBinding.devicePublicKey, '设备公钥', 32, 1024);
  parseIsoDate(payload.issuedAt, '激活时间');
  if (payload.mode !== 'perpetual-offline') fail(LICENSE_ERROR.INVALID_FORMAT, '激活模式不受支持');
  assertInteger(payload.allowedMajorVersion, '允许大版本', 1, 999);
}

function timingSafeTextEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyLicenseBundle(input, options) {
  const bundle = parseInput(input);
  assertExactKeys(bundle, ['schema', 'entitlement', 'activation'], '许可证包');
  if (bundle.schema !== 'future-ai-license-bundle/v1') fail(LICENSE_ERROR.INVALID_FORMAT, '许可证包版本不受支持');
  assertPlainObject(options, '许可证验证选项');

  const entitlementResult = verifyEnvelope(bundle.entitlement, options.keyRing);
  const activationResult = verifyEnvelope(bundle.activation, options.keyRing);
  const entitlement = entitlementResult.payload;
  const activation = activationResult.payload;
  validateEntitlement(entitlement);
  validateActivation(activation);

  if (entitlement.product !== options.expectedProduct) {
    fail(LICENSE_ERROR.PRODUCT_MISMATCH, '许可证不属于当前产品');
  }
  if (entitlement.majorVersion !== options.appMajorVersion || activation.allowedMajorVersion !== options.appMajorVersion) {
    fail(LICENSE_ERROR.VERSION_MISMATCH, '许可证不适用于当前大版本');
  }
  if (activation.licenseId !== entitlement.licenseId) {
    fail(LICENSE_ERROR.ENTITLEMENT_MISMATCH, '激活证书与授权权益不匹配');
  }
  const entitlementHash = crypto.createHash('sha256').update(entitlementResult.payloadBytes).digest('base64url');
  if (!timingSafeTextEqual(activation.entitlementHash, entitlementHash)) {
    fail(LICENSE_ERROR.ENTITLEMENT_MISMATCH, '授权权益摘要不匹配');
  }
  if (!timingSafeTextEqual(activation.deviceBinding.machineDigest, options.machineDigest)
    || !timingSafeTextEqual(activation.deviceBinding.devicePublicKey, options.devicePublicKey)) {
    fail(LICENSE_ERROR.DEVICE_MISMATCH, '许可证已绑定到另一台设备');
  }

  const now = options.now instanceof Date ? options.now : new Date();
  if (!Number.isFinite(now.getTime())) fail(LICENSE_ERROR.INVALID_FORMAT, '当前时间无效');
  const maintenanceUntil = parseIsoDate(entitlement.maintenanceUntil, '维护截止时间');
  return Object.freeze({
    status: 'active',
    perpetual: true,
    licenseId: entitlement.licenseId,
    activationId: activation.activationId,
    maskedLicenseId: `...${entitlement.licenseId.slice(-4)}`,
    majorVersion: entitlement.majorVersion,
    maintenanceUntil: entitlement.maintenanceUntil,
    updateEligible: now.getTime() <= maintenanceUntil.getTime(),
    features: Object.freeze([...entitlement.features].sort()),
    generation: activation.generation
  });
}

function createActivationRequest(input) {
  assertExactKeys(input, [
    'licenseId', 'product', 'appVersion', 'machineDigest', 'devicePublicKey', 'nonce', 'createdAt'
  ], '激活请求');
  assertString(input.licenseId, '许可证编号', 36, 36, UUID_PATTERN);
  assertString(input.product, '产品编号', 3, 64, PRODUCT_ID_PATTERN);
  assertString(input.appVersion, '应用版本', 5, 32, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
  decodeBase64url(input.machineDigest, '设备摘要', 32, 32);
  decodeBase64url(input.devicePublicKey, '设备公钥', 32, 1024);
  decodeBase64url(input.nonce, '请求随机数', 16, 64);
  parseIsoDate(input.createdAt, '请求时间');
  const payload = {
    schema: 'future-ai-activation-request/v1',
    licenseId: input.licenseId,
    product: input.product,
    appVersion: input.appVersion,
    machineDigest: input.machineDigest,
    devicePublicKey: input.devicePublicKey,
    nonce: input.nonce,
    createdAt: input.createdAt
  };
  return Buffer.from(canonicalizeJson(payload), 'utf8').toString('base64url');
}

module.exports = {
  LICENSE_ERROR,
  LicenseError,
  canonicalizeJson,
  createActivationRequest,
  verifyLicenseBundle
};
