const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const {
  LicenseError,
  canonicalizeJson,
  createActivationRequest,
  verifyLicenseBundle
} = require('./license-core');

const LICENSING_DIR = 'Licensing';
const DEVICE_IDENTITY_FILE = 'device-identity.json';
const ACTIVATION_FILE = 'activation.json';
const LICENSE_STATE_FILE = 'license-state.json';
const MAX_STORED_FILE_BYTES = 128 * 1024;
const CLOCK_ROLLBACK_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function atomicWrite(file, contents) {
  const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  return fs.mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.writeFile(temp, contents, { encoding: 'utf8', mode: 0o600 }))
    .then(() => fs.rename(temp, file))
    .catch(async error => {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    });
}

async function readBoundedText(file) {
  const stats = await fs.stat(file);
  if (!stats.isFile() || stats.size > MAX_STORED_FILE_BYTES) throw new Error('授权文件超过安全限制');
  return fs.readFile(file, 'utf8');
}

function createLicenseService(options) {
  if (!options || typeof options !== 'object') throw new TypeError('许可证服务配置无效');
  const {
    userDataDir,
    safeStorage,
    keyRing,
    expectedProduct,
    appVersion,
    machineIdProvider,
    redemptionClient,
    now = () => new Date()
  } = options;
  if (typeof userDataDir !== 'string' || !path.isAbsolute(userDataDir)) throw new TypeError('授权数据目录无效');
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') throw new TypeError('系统加密服务无效');
  if (!(keyRing instanceof Map)) throw new TypeError('发行公钥配置无效');
  if (typeof expectedProduct !== 'string' || typeof appVersion !== 'string') throw new TypeError('产品版本配置无效');
  if (typeof machineIdProvider !== 'function') throw new TypeError('设备标识提供器无效');
  const majorVersion = Number.parseInt(appVersion.split('.')[0], 10);
  if (!Number.isInteger(majorVersion) || majorVersion < 1) throw new TypeError('应用大版本无效');

  const licensingDir = path.join(userDataDir, LICENSING_DIR);
  const identityFile = path.join(licensingDir, DEVICE_IDENTITY_FILE);
  const activationFile = path.join(licensingDir, ACTIVATION_FILE);
  const stateFile = path.join(licensingDir, LICENSE_STATE_FILE);
  let mutationQueue = Promise.resolve();
  let redemptionQueue = Promise.resolve();

  function requireEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统加密不可用，已拒绝以明文保存设备授权');
    }
  }

  async function readEncryptedJson(file) {
    requireEncryption();
    const record = JSON.parse(await readBoundedText(file));
    if (!record || Object.keys(record).sort().join(',') !== 'ciphertext,format'
      || record.format !== 'safeStorage-v1' || typeof record.ciphertext !== 'string') {
      throw new Error('授权加密记录格式无效');
    }
    const plaintext = safeStorage.decryptString(Buffer.from(record.ciphertext, 'base64'));
    return JSON.parse(plaintext);
  }

  async function writeEncryptedJson(file, value) {
    requireEncryption();
    const ciphertext = safeStorage.encryptString(canonicalizeJson(value)).toString('base64');
    await atomicWrite(file, JSON.stringify({ format: 'safeStorage-v1', ciphertext }));
  }

  async function loadState() {
    try {
      const state = await readEncryptedJson(stateFile);
      if (state?.schema !== 'future-ai-license-state/v1'
        || !Number.isInteger(state.minimumGeneration) || state.minimumGeneration < 0
        || typeof state.maxSeenUtc !== 'string' || !Number.isFinite(new Date(state.maxSeenUtc).getTime())) {
        throw new Error('授权防回滚状态无效');
      }
      return state;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return {
        schema: 'future-ai-license-state/v1',
        minimumGeneration: 0,
        maxSeenUtc: '1970-01-01T00:00:00.000Z'
      };
    }
  }

  async function saveState(state) {
    await writeEncryptedJson(stateFile, state);
  }

  function publicKeyBytes(publicKey) {
    return publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  }

  async function getMachineDigest() {
    const rawId = await machineIdProvider();
    if (typeof rawId !== 'string' || rawId.trim().length < 4 || rawId.length > 1024) {
      throw new Error('无法取得稳定的本机设备标识');
    }
    return crypto.createHash('sha256')
      .update('future-ai-device/v1\0', 'utf8')
      .update(rawId.trim(), 'utf8')
      .digest('base64url');
  }

  async function ensureIdentity() {
    requireEncryption();
    let identity;
    try {
      identity = await readEncryptedJson(identityFile);
      if (identity?.schema !== 'future-ai-device-identity/v1'
        || typeof identity.privateKey !== 'string' || typeof identity.publicKey !== 'string') {
        throw new Error('设备身份记录无效');
      }
      const privateKey = crypto.createPrivateKey({
        key: Buffer.from(identity.privateKey, 'base64url'),
        type: 'pkcs8',
        format: 'der'
      });
      const derivedPublic = publicKeyBytes(crypto.createPublicKey(privateKey));
      if (derivedPublic !== identity.publicKey) throw new Error('设备密钥对不匹配');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const pair = crypto.generateKeyPairSync('ed25519');
      identity = {
        schema: 'future-ai-device-identity/v1',
        privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
        publicKey: publicKeyBytes(pair.publicKey),
        createdAt: currentTime().toISOString()
      };
      await writeEncryptedJson(identityFile, identity);
    }
    return {
      ...identity,
      machineDigest: await getMachineDigest()
    };
  }

  function currentTime() {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('系统时间无效');
    return value;
  }

  function effectiveTime(current, state) {
    const maxSeen = new Date(state.maxSeenUtc);
    return maxSeen.getTime() > current.getTime() ? maxSeen : current;
  }

  async function advanceClockState(state, current) {
    if (current.getTime() > new Date(state.maxSeenUtc).getTime()) {
      const next = { ...state, maxSeenUtc: current.toISOString() };
      await saveState(next);
      return next;
    }
    return state;
  }

  function toPublicStatus(result, clockWarning = false) {
    return Object.freeze({
      status: result.status,
      perpetual: result.perpetual,
      maskedLicenseId: result.maskedLicenseId,
      majorVersion: result.majorVersion,
      maintenanceUntil: result.maintenanceUntil,
      updateEligible: result.updateEligible,
      features: result.features,
      generation: result.generation,
      clockWarning
    });
  }

  async function verifyBundle(bundleInput, { persistClock = true } = {}) {
    const [identity, initialState] = await Promise.all([ensureIdentity(), loadState()]);
    const current = currentTime();
    const maxSeen = new Date(initialState.maxSeenUtc);
    const clockWarning = current.getTime() + CLOCK_ROLLBACK_TOLERANCE_MS < maxSeen.getTime();
    const result = verifyLicenseBundle(bundleInput, {
      keyRing,
      expectedProduct,
      appMajorVersion: majorVersion,
      machineDigest: identity.machineDigest,
      devicePublicKey: identity.publicKey,
      now: effectiveTime(current, initialState)
    });
    if (result.generation < initialState.minimumGeneration) {
      throw new Error('激活证书代次已停用，请导入新的激活证书');
    }
    const state = persistClock ? await advanceClockState(initialState, current) : initialState;
    return { result, identity, state, current, clockWarning };
  }

  async function readActivation() {
    return readBoundedText(activationFile);
  }

  function decodeActivationInput(input) {
    if (typeof input !== 'string') return input;
    const trimmed = input.trim();
    if (Buffer.byteLength(trimmed, 'utf8') > MAX_STORED_FILE_BYTES) throw new Error('激活码超过安全限制');
    if (trimmed.startsWith('{')) return trimmed;
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) throw new Error('激活码格式无效');
    const decoded = Buffer.from(trimmed, 'base64url');
    if (decoded.toString('base64url') !== trimmed) throw new Error('激活码编码无效');
    return decoded.toString('utf8');
  }

  function withMutation(operation) {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.catch(() => {});
    return next;
  }

  async function getStatus() {
    if (keyRing.size === 0) return Object.freeze({ status: 'not-configured' });
    let bundle;
    try {
      bundle = await readActivation();
    } catch (error) {
      if (error?.code === 'ENOENT') return Object.freeze({ status: 'not-activated' });
      return Object.freeze({ status: 'invalid', reason: 'LICENSE_STORAGE_ERROR' });
    }
    try {
      const verified = await verifyBundle(bundle);
      return toPublicStatus(verified.result, verified.clockWarning);
    } catch (error) {
      return Object.freeze({
        status: 'invalid',
        reason: error instanceof LicenseError ? error.code : 'LICENSE_LOCAL_STATE_ERROR'
      });
    }
  }

  async function makeActivationRequest({ licenseId } = {}) {
    const identity = await ensureIdentity();
    return createActivationRequest({
      licenseId,
      product: expectedProduct,
      appVersion,
      machineDigest: identity.machineDigest,
      devicePublicKey: identity.publicKey,
      nonce: crypto.randomBytes(16).toString('base64url'),
      createdAt: currentTime().toISOString()
    });
  }

  async function importActivation(input) {
    return withMutation(async () => {
      if (keyRing.size === 0) throw new Error('正式发行公钥尚未配置，不能导入许可证');
      const decoded = decodeActivationInput(input);
      const verified = await verifyBundle(decoded, { persistClock: false });
      const normalized = typeof decoded === 'string' ? JSON.stringify(JSON.parse(decoded)) : JSON.stringify(decoded);
      await atomicWrite(activationFile, normalized);
      await saveState({
        ...verified.state,
        maxSeenUtc: verified.current.getTime() > new Date(verified.state.maxSeenUtc).getTime()
          ? verified.current.toISOString()
          : verified.state.maxSeenUtc
      });
      return toPublicStatus(verified.result, verified.clockWarning);
    });
  }

  async function redeem(redemptionCode) {
    const operation = async () => {
      if (!redemptionClient?.resolve || !redemptionClient?.activate) throw new Error('在线激活服务尚未配置');
      const current = await getStatus();
      if (current.status === 'active') return current;
      const resolved = await redemptionClient.resolve(redemptionCode);
      const request = await makeActivationRequest({licenseId: resolved.licenseId});
      const response = await redemptionClient.activate(redemptionCode, request);
      return importActivation(response.activationCode);
    };
    const next = redemptionQueue.then(operation, operation);
    redemptionQueue = next.catch(() => {});
    return next;
  }

  async function prepareDeactivation() {
    const bundle = await readActivation();
    const verified = await verifyBundle(bundle, { persistClock: false });
    const payload = Buffer.from(canonicalizeJson({
        schema: 'future-ai-deactivation-receipt/v1',
        licenseId: verified.result.licenseId,
        activationId: verified.result.activationId,
        generation: verified.result.generation,
        devicePublicKey: verified.identity.publicKey,
        deactivatedAt: verified.current.toISOString(),
        nonce: crypto.randomBytes(16).toString('base64url')
    }), 'utf8');
    const privateKey = crypto.createPrivateKey({
        key: Buffer.from(verified.identity.privateKey, 'base64url'),
        type: 'pkcs8',
        format: 'der'
      });
    const receipt = {
        alg: 'Ed25519',
        payload: payload.toString('base64url'),
        signature: crypto.sign(null, payload, privateKey).toString('base64url')
    };
    return {receipt, verified};
  }

  async function commitDeactivation(verified) {
    await saveState({
        ...verified.state,
        minimumGeneration: Math.max(verified.state.minimumGeneration, verified.result.generation + 1),
        maxSeenUtc: verified.current.getTime() > new Date(verified.state.maxSeenUtc).getTime()
          ? verified.current.toISOString()
          : verified.state.maxSeenUtc
    });
    await fs.rm(activationFile, { force: true });
  }

  async function deactivate() {
    return withMutation(async () => {
      const prepared = await prepareDeactivation();
      await commitDeactivation(prepared.verified);
      return Object.freeze(prepared.receipt);
    });
  }

  async function release() {
    return withMutation(async () => {
      if (!redemptionClient?.deactivate) throw new Error('在线激活服务尚未配置');
      const prepared = await prepareDeactivation();
      const confirmation = await redemptionClient.deactivate(prepared.receipt);
      if (confirmation?.deactivated !== true) throw new Error('授权服务未确认解除');
      await commitDeactivation(prepared.verified);
      return Object.freeze({deactivated: true});
    });
  }

  return Object.freeze({
    getStatus,
    redeem,
    release,
    createActivationRequest: makeActivationRequest,
    importActivation,
    deactivate
  });
}

module.exports = {
  CLOCK_ROLLBACK_TOLERANCE_MS,
  createLicenseService
};
