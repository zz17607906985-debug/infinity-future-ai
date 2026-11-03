const { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const APP_PACKAGE_METADATA = require('../package.json');
const { internalTestChannelsAllowed, readReleaseChannel } = require('./runtime/release-channel');
const { codexSelfUpdateAllowed, normalizeCodexPermission, resolveCodexCommandPolicy } = require('./runtime/codex-security');
const { selectRuntimePaths } = require('./runtime/runtime-paths');
const { RESTORE_JOURNAL_FORMAT, recoverWorkspaceRestore, restoreJournalFile, writeRestoreJournal } = require('./runtime/workspace-restore');
const { assertStoreValue, backupValidStore, readValidStore, recoverStoreFromBackup } = require('./runtime/json-store-recovery');
const { redactSecrets, safeLogEntry, sanitizeDiagnosticReport } = require('./diagnostics/diagnostic-privacy');
const { buildSupportInfo, readSupportDocument, resolveLegalRoot } = require('./support/support-service');
const ProviderConformanceEvidence = require('./providers/provider-conformance');
const { createLicenseService } = require('./licensing/license-service');
const { loadIssuerKeyRing } = require('./licensing/issuer-keys');
const { createRedemptionClient } = require('./licensing/redemption-client');
const { readWindowsMachineGuid } = require('./licensing/windows-machine-id');
const {
  createMusicSourcePolicy,
  openMusicRights,
  platformStreamRights
} = require('./media/music-source-policy');
const {
  buildUpdateHelperCommand,
  loadTrustedPublisherThumbprints,
  prepareInstallerRollback,
  prepareInstallerUpdate,
  verifyInstallerPackage
} = require('./update/installer-update');
const { parseInstallerUpdateOutcome } = require('./update/update-outcome');
const { searchSkillMarket } = require('./skills/skill-market');
const { buildZip, readZipTextSummary, readZipEntries } = require('./runtime/zip-utils');
const ShortImports = require('./media/short-import-service');
const MediaProcessContract = require('./media/media-process-contract');
const ReviewPackage = require('./review/review-package');
const { buildOfflineReviewEntries } = require('./review/review-export');

app.setName('∞未来 AI');

const RELEASE_CHANNEL = readReleaseChannel(APP_PACKAGE_METADATA);
const INTERNAL_TEST_CHANNELS_ALLOWED = internalTestChannelsAllowed(APP_PACKAGE_METADATA);

const LOCAL_RUNTIME_DIR = 'runtime-data';
const STORAGE_ROOTS_FILE = 'allowed-storage-roots.json';
const API_KEY_FILE = 'api-key.json';
const PROVIDER_KEYS_FILE = 'provider-api-keys.json';
const PROJECT_BACKUP_LIMIT = 20;
/** Keep one previous Codex binary for rollback; extra copies waste ~300MB each. */
const CODEX_BACKUP_LIMIT = 1;
/** Keep one previous app.asar under user-data/update-backups for installer rollback. */
const UPDATE_ASAR_BACKUP_LIMIT = 1;
const WORKSPACE_BACKUP_FORMAT = 'future-ai-workspace-backup';
const WORKSPACE_BACKUP_VERSION = 1;
const WORKSPACE_BACKUP_FILE_LIMIT = 10000;
const WORKSPACE_BACKUP_TOTAL_LIMIT = 20 * 1024 * 1024 * 1024;
const STORE_FILES = {
  projects: 'projects.json',
  history: 'history.json',
  assets: 'assets.json',
  'asset-folders': 'asset-folders.json',
  models: 'models.json'
};
const DIAGNOSTIC_LOG_FILE = 'app.log';
const UPDATE_PROTECTED_FILES = ['projects.json', 'history.json', 'assets.json', 'asset-folders.json', 'models.json', 'api-key.json', 'storageDir', 'runtime-data'];
const allowedStorageRoots = new Set();
const allowedUpdatePackageDirs = new Set();
const cleanupScans = new Map();
const storageWriteQueues = new Map();
const codexSessions = new Map();
const CODEX_OUTPUT_LIMIT = 240000;
const CODEX_PROMPT_LIMIT = 12000;
const CODEX_RUN_TIMEOUT_MS = 20 * 60 * 1000;
const MUSIC_SEARCH_LIMIT = 12;
const MEDIA_SEARCH_TIMEOUT_MS = 8000;
const MANJU_EXPORT_LIMIT = 200;
const MANJU_EXPORT_TIMEOUT_MS = 30 * 60 * 1000;
const MANJU_MEDIA_LIMIT = 500 * 1024 * 1024;
const MANJU_EXPORT_TOTAL_MEDIA_LIMIT = 2 * 1024 * 1024 * 1024;
const MANJU_TTS_LIMIT = 50 * 1024 * 1024;
const MANJU_TTS_TIMEOUT_MS = 240000;
let manjuExportActive = false;
let manjuVoiceActive = false;
let manjuH264StrategiesPromise = null;

function enqueueStorageWrite(file, work) {
  const previous = storageWriteQueues.get(file) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  storageWriteQueues.set(file, current);
  return current.finally(() => {
    if (storageWriteQueues.get(file) === current) storageWriteQueues.delete(file);
  });
}

function releaseChannel() {
  try {
    const manifest = JSON.parse(fsSync.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
    return manifest.releaseChannel === 'stable' ? 'stable' : 'internal';
  } catch {
    return 'internal';
  }
}

function supportLegalRoot() {
  return resolveLegalRoot([
    path.join(process.resourcesPath, 'legal'),
    path.join(__dirname, '..', '..', 'resources', 'legal')
  ]);
}

const MANJU_H264_STRATEGIES = [
  {
    id: 'h264_mf',
    args: ['-c:v', 'h264_mf', '-rate_control', 'quality', '-quality', '80', '-scenario', 'archive', '-pix_fmt', 'yuv420p']
  },
  {
    id: 'libopenh264',
    args: ['-c:v', 'libopenh264', '-rc_mode', 'quality', '-b:v', '8M', '-maxrate', '12M', '-bufsize', '16M', '-pix_fmt', 'yuv420p']
  }
];

function packagedBaseDir() {
  return process.resourcesPath || path.dirname(app.getPath('exe'));
}

function configureLocalRuntimePaths(baseDir = packagedBaseDir()) {
  const legacyRoot = path.join(baseDir, LOCAL_RUNTIME_DIR);
  const localAppData = process.env.LOCALAPPDATA || app.getPath('appData');
  const runtimeRootOverride = INTERNAL_TEST_CHANNELS_ALLOWED ? process.env.FUTURE_AI_RUNTIME_ROOT : '';
  const targetRoot = runtimeRootOverride || path.join(localAppData, 'InfinityFutureAI');
  const selection = selectRuntimePaths({ legacyRoot, targetRoot });
  const paths = selection.paths;

  app.setPath('userData', paths.userData);
  app.setPath('sessionData', paths.sessionData);
  app.setAppLogsPath(paths.logs);
  app.setPath('crashDumps', paths.crashDumps);
  return { ...paths, legacyRoot, migration: selection };
}

const LOCAL_RUNTIME_PATHS = configureLocalRuntimePaths();
const LICENSE_KEY_RING = loadIssuerKeyRing(path.join(__dirname, 'licensing', 'issuer-public-keys.json'));
const UPDATE_KEY_RING = loadIssuerKeyRing(
  path.join(__dirname, 'update', 'update-public-keys.json'),
  'future-ai-update-keys/v1'
);
const TRUSTED_UPDATE_PUBLISHERS = loadTrustedPublisherThumbprints(
  path.join(__dirname, 'update', 'trusted-publishers.json')
);
function loadRedemptionClient() {
  const file = path.join(__dirname, 'licensing', 'redemption-service.json');
  let config = {};
  try { config = JSON.parse(fsSync.readFileSync(file, 'utf8')); } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('授权服务配置无效');
  }
  const endpoint = INTERNAL_TEST_CHANNELS_ALLOWED && process.env.FUTURE_AI_REDEMPTION_ENDPOINT
    ? process.env.FUTURE_AI_REDEMPTION_ENDPOINT
    : config.endpoint;
  if (config.status !== 'configured' || !endpoint) return null;
  return createRedemptionClient({
    endpoint,
    allowInsecureLocalhost: INTERNAL_TEST_CHANNELS_ALLOWED
  });
}
const REDEMPTION_CLIENT = loadRedemptionClient();
const licenseService = createLicenseService({
  userDataDir: LOCAL_RUNTIME_PATHS.userData,
  safeStorage,
  keyRing: LICENSE_KEY_RING,
  expectedProduct: 'future-ai-desktop',
  appVersion: app.getVersion(),
  machineIdProvider: readWindowsMachineGuid,
  redemptionClient: REDEMPTION_CLIENT
});

function isAllowedExternalUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function storageRootsFile() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, STORAGE_ROOTS_FILE);
}

function apiKeyFile() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, API_KEY_FILE);
}

function providerKeysFile() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, PROVIDER_KEYS_FILE);
}

function appLogFile() {
  return path.join(LOCAL_RUNTIME_PATHS.logs, DIAGNOSTIC_LOG_FILE);
}

function loadAllowedStorageRoots() {
  try {
    const roots = JSON.parse(fsSync.readFileSync(storageRootsFile(), 'utf8'));
    if (!Array.isArray(roots)) return;
    roots.forEach(root => {
      if (typeof root === 'string' && root.trim()) allowedStorageRoots.add(path.resolve(root));
    });
  } catch {}
}

async function findProjectRoot() {
  const candidates = [];
  for (const root of allowedStorageRoots) {
    const file = path.join(root, STORE_FILES.projects);
    try {
      const [raw, stats] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
      const projects = JSON.parse(raw);
      if (!Array.isArray(projects) || !projects.length) continue;
      const updatedAt = projects.reduce((latest, project) => Math.max(latest, Number(project?.updatedAt || project?.createdAt || 0)), 0);
      candidates.push({root, updatedAt, size:stats.size});
    } catch {}
  }
  candidates.sort((a, b) => b.size - a.size || b.updatedAt - a.updatedAt || a.root.localeCompare(b.root));
  return candidates[0]?.root || '';
}

async function persistAllowedStorageRoots() {
  const file = storageRootsFile();
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify([...allowedStorageRoots].sort(), null, 2), 'utf8');
  await fs.rename(tempFile, file);
}

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasExistingStoreFiles(root) {
  return Object.values(STORE_FILES).some(file => fsSync.existsSync(path.join(root, file)));
}

async function rememberStorageRoot(dir) {
  const root = path.resolve(String(dir || ''));
  if (!root) throw new Error('存储目录无效');
  allowedStorageRoots.add(root);
  await persistAllowedStorageRoots();
  return root;
}

async function ensureStorageRootAllowed(dir) {
  const root = path.resolve(String(dir || ''));
  if (!root) throw new Error('存储目录无效');
  if (allowedStorageRoots.has(root)) return root;
  if (hasExistingStoreFiles(root)) return await rememberStorageRoot(root);
  throw new Error('未授权的存储目录，请重新选择本地存储位置');
}

function safeStoragePath(dir, ...segments) {
  const root = path.resolve(String(dir || ''));
  if (!allowedStorageRoots.has(root)) throw new Error('未授权的存储目录');
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (!pathInside(root, target)) throw new Error('存储路径越界：' + relative);
  return target;
}

function safeExistingMediaPath(target) {
  const file = path.resolve(String(target || '').startsWith('file:') ? fileURLToPath(target) : String(target || ''));
  for (const root of allowedStorageRoots) {
    if (pathInside(root, file)) return file;
  }
  throw new Error('未授权的媒体文件路径');
}

function timestampForBackup(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function projectBackupsDir(dir) {
  return safeStoragePath(dir, 'backups', 'projects');
}

function storeBackupsDir(dir, name) {
  return name === 'projects' ? projectBackupsDir(dir) : safeStoragePath(dir, 'backups', 'stores', name);
}

function corruptStoresDir(dir) {
  return safeStoragePath(dir, 'backups', 'corrupt');
}

function safeProjectBackupPath(dir, fileName) {
  const name = path.basename(String(fileName || ''));
  if (!/^\d{8}-\d{6}-projects\.json$/.test(name)) throw new Error('无效的项目备份文件名');
  return safeStoragePath(dir, 'backups', 'projects', name);
}

async function listProjectBackups(dir) {
  await ensureStorageRootAllowed(dir);
  const backupDir = projectBackupsDir(dir);
  try {
    const entries = await fs.readdir(backupDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d{8}-\d{6}-projects\.json$/.test(entry.name)) continue;
      const file = path.join(backupDir, entry.name);
      const stats = await fs.stat(file);
      files.push({ fileName: entry.name, size: stats.size, mtime: stats.mtimeMs });
    }
    return files.sort((a, b) => b.fileName.localeCompare(a.fileName));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function pruneProjectBackups(dir) {
  const backups = await listProjectBackups(dir);
  const stale = backups.slice(PROJECT_BACKUP_LIMIT);
  await Promise.all(stale.map(item => fs.rm(safeProjectBackupPath(dir, item.fileName), { force: true })));
}

async function backupProjectStore(dir, file) {
  return await backupValidStore({
    file,
    backupDir: projectBackupsDir(dir),
    backupName: `${timestampForBackup()}-projects.json`,
    limit: PROJECT_BACKUP_LIMIT
  });
}

async function backupStoreFile(dir, name, file) {
  if (name === 'projects') return await backupProjectStore(dir, file);
  return await backupValidStore({
    file,
    backupDir: storeBackupsDir(dir, name),
    backupName: `${timestampForBackup()}-${path.basename(file)}`,
    limit: PROJECT_BACKUP_LIMIT
  });
}

async function readStoreWithRecovery(dir, name) {
  const file = safeStoragePath(dir, safeStoreFile(name));
  return await recoverStoreFromBackup({
    file,
    backupDir: storeBackupsDir(dir, name),
    corruptDir: corruptStoresDir(dir)
  });
}

async function restoreProjectBackup(dir, fileName) {
  await ensureStorageRootAllowed(dir);
  const backupFile = safeProjectBackupPath(dir, fileName);
  await readValidStore(backupFile);
  const targetFile = safeStoragePath(dir, safeStoreFile('projects'));
  await ensureDir(path.dirname(targetFile));
  if (fsSync.existsSync(targetFile)) await backupProjectStore(dir, targetFile);
  const tempFile = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
  await fs.copyFile(backupFile, tempFile);
  await fs.rename(tempFile, targetFile);
  return true;
}

loadAllowedStorageRoots();

function e2eConfig() {
  if (!INTERNAL_TEST_CHANNELS_ALLOWED || process.env.FUTURE_CANVAS_E2E !== '1') return { enabled: false };
  return {
    enabled: true,
    processId: process.pid,
    storageDir: process.env.FUTURE_CANVAS_E2E_STORAGE_DIR || '',
    reportPath: process.env.FUTURE_CANVAS_E2E_REPORT || '',
    manjuVideo: process.env.FUTURE_CANVAS_E2E_MANJU_VIDEO || '',
    mockApiUrl: process.env.FUTURE_CANVAS_E2E_MOCK_API_URL || '',
    resume: process.env.FUTURE_CANVAS_E2E_RESUME === '1',
    crashPrepare: process.env.FUTURE_CANVAS_E2E_CRASH_PREPARE === '1',
    crashVerify: process.env.FUTURE_CANVAS_E2E_CRASH_VERIFY === '1',
    soakMs: Math.max(0, Math.min(900000, Number(process.env.FUTURE_CANVAS_E2E_SOAK_MS) || 0))
  };
}

const E2E_CONFIG = e2eConfig();
if (E2E_CONFIG.enabled && E2E_CONFIG.storageDir) {
  allowedStorageRoots.add(path.resolve(E2E_CONFIG.storageDir));
}

async function readApiKeySecret() {
  try {
    const data = JSON.parse(await fs.readFile(apiKeyFile(), 'utf8'));
    if (data.format === 'safeStorage-v1' && typeof data.ciphertext === 'string') {
      requireSecretEncryption();
      return safeStorage.decryptString(Buffer.from(data.ciphertext, 'base64'));
    }
    if (data.format === 'plain-fallback-v1' && typeof data.apiKey === 'string') {
      requireSecretEncryption();
      await writeApiKeySecret(data.apiKey);
      return data.apiKey;
    }
    const legacy = readLegacyApiKeySecret(data);
    if (!legacy) return '';
    requireSecretEncryption();
    await writeApiKeySecret(legacy);
    return legacy;
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

function requireSecretEncryption() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储当前不可用，API 密钥未保存。请重新登录 Windows 后再试。');
  }
}

function readLegacyApiKeySecret(data) {
  return typeof data.apiKey === 'string' ? data.apiKey : '';
}

async function writeApiKeySecret(apiKey) {
  const file = apiKeyFile();
  const value = String(apiKey || '').trim();
  if (value.length > 8192) throw new Error('API 密钥长度超出安全限制');
  if (!value) {
    await fs.rm(file, { force: true });
    return false;
  }
  requireSecretEncryption();
  const record = {
    format: 'safeStorage-v1',
    ciphertext: safeStorage.encryptString(value).toString('base64')
  };
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(record, null, 2), 'utf8');
  await fs.rename(tempFile, file);
  return true;
}

function sanitizeProviderKeyId(providerId) {
  const id = String(providerId || '').trim();
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) throw new Error('无效的 API 配置 ID');
  return id;
}

async function readProviderKeyStore() {
  try {
    const data = JSON.parse(await fs.readFile(providerKeysFile(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function decryptProviderKeyRecord(record) {
  if (!record || typeof record !== 'object') return '';
  if (record.format === 'safeStorage-v1' && typeof record.ciphertext === 'string') {
    requireSecretEncryption();
    try {
      return safeStorage.decryptString(Buffer.from(record.ciphertext, 'base64'));
    } catch (error) {
      // An old Windows keyring must not prevent replacing a stale API key.
      return '';
    }
  }
  if (record.format === 'plain-fallback-v1' && typeof record.apiKey === 'string') return record.apiKey;
  return typeof record.apiKey === 'string' ? record.apiKey : '';
}

function encryptProviderKeyRecord(apiKey) {
  const value = String(apiKey || '').trim();
  if (value.length > 8192) throw new Error('API 密钥长度超出安全限制');
  if (!value) return null;
  requireSecretEncryption();
  return { format: 'safeStorage-v1', ciphertext: safeStorage.encryptString(value).toString('base64') };
}

async function writeProviderKeyStore(store) {
  const file = providerKeysFile();
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tempFile, file);
}

function normalizeStoredProviderKeyEntries(record) {
  if (record && record.format === 'safeStorage-pool-v1' && Array.isArray(record.keys)) {
    return record.keys.map((item, index) => ({
      id: String(item?.id || `key-${index + 1}`).trim(),
      label: String(item?.label || `Key ${index + 1}`).trim() || `Key ${index + 1}`,
      scope: ['all', 'chat', 'image', 'video'].includes(item?.scope) ? item.scope : 'all',
      lastUsedAt: Number(item?.lastUsedAt || 0),
      failureCount: Number(item?.failureCount || 0),
      cooldownUntil: Number(item?.cooldownUntil || 0),
      lastError: String(item?.lastError || '').slice(0, 240),
      health: ['unknown', 'ok', 'cooldown', 'blocked'].includes(item?.health) ? item.health : 'unknown',
      ciphertext: String(item?.ciphertext || '')
    })).filter(item => item.id && item.ciphertext);
  }
  const value = decryptProviderKeyRecord(record);
  return value ? [{id: 'key-1', label: '主 Key', scope: 'all', lastUsedAt: 0, failureCount: 0, ciphertext: encryptProviderKeyRecord(value).ciphertext}] : [];
}

async function readProviderKeyEntries(providerId) {
  const id = sanitizeProviderKeyId(providerId);
  const store = await readProviderKeyStore();
  const record = store[id];
  let entries = [];
  try {
    entries = normalizeStoredProviderKeyEntries(record);
  } catch (error) {
    // A legacy ciphertext can become undecryptable after a Windows profile or
    // machine migration. Preserve the provider as unavailable instead of
    // making every generation request fail with a raw safeStorage exception.
    if (record && typeof record === 'object') {
      entries = [{
        id: 'key-1',
        label: '无法解密的 Key',
        scope: 'all',
        lastUsedAt: 0,
        failureCount: 1,
        cooldownUntil: Date.now() + 24 * 60 * 60 * 1000,
        lastError: String(error?.message || error).slice(0, 240),
        health: 'blocked',
        ciphertext: String(record.ciphertext || '')
      }].filter(item => item.ciphertext);
    }
  }
  if (entries.length && record?.format !== 'safeStorage-pool-v1') {
    store[id] = {format: 'safeStorage-pool-v1', keys: entries};
    await writeProviderKeyStore(store);
  }
  const decryptedEntries = entries.map(entry => {
    try {
      return {...entry, apiKey: decryptProviderKeyRecord({format: 'safeStorage-v1', ciphertext: entry.ciphertext})};
    } catch (error) {
      return {
        ...entry,
        apiKey: '',
        health: 'blocked',
        failureCount: Math.max(1, Number(entry.failureCount || 0)),
        cooldownUntil: Math.max(Date.now() + 24 * 60 * 60 * 1000, Number(entry.cooldownUntil || 0)),
        lastError: String(error?.message || error).slice(0, 240)
      };
    }
  });
  // Drop ciphertexts that belong to an unavailable Windows keyring. Keeping
  // them in the pool would make selection prefer an empty, undecryptable key
  // over a newly saved key.
  const validEntries = decryptedEntries.filter(entry => entry.apiKey);
  if (validEntries.length !== decryptedEntries.length) {
    if (validEntries.length) {
      store[id] = {
        format: 'safeStorage-pool-v1',
        keys: validEntries.map(({apiKey, ...entry}) => entry)
      };
    } else {
      delete store[id];
    }
    await writeProviderKeyStore(store);
  }
  return validEntries;
}

async function readProviderApiKey(providerId, keyId = '') {
  const entries = await readProviderKeyEntries(providerId);
  const selected = (keyId && entries.find(entry => entry.id === keyId)) || entries[0];
  return selected?.apiKey || '';
}

async function listProviderApiKeys(providerId) {
  const entries = await readProviderKeyEntries(providerId);
  return entries.map(entry => ({
    id: entry.id,
    label: entry.label,
    scope: entry.scope,
    lastUsedAt: entry.lastUsedAt,
    failureCount: entry.failureCount,
    cooldownUntil: entry.cooldownUntil,
    lastError: entry.lastError,
    health: entry.health,
    masked: entry.apiKey ? `${entry.apiKey.slice(0, 3)}...${entry.apiKey.slice(-4)}` : ''
  }));
}

async function writeProviderApiKey(providerId, apiKey, keyId = '', label = '', scope = 'all') {
  const id = sanitizeProviderKeyId(providerId);
  const store = await readProviderKeyStore();
  const rawExisting = normalizeStoredProviderKeyEntries(store[id]);
  const existing = rawExisting.filter(entry => {
    try {
      return Boolean(decryptProviderKeyRecord({format: 'safeStorage-v1', ciphertext: entry.ciphertext}));
    } catch {
      return false;
    }
  });
  const record = encryptProviderKeyRecord(apiKey);
  if (!record) return false;
  const targetId = String(keyId || '').trim() || `key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const index = existing.findIndex(entry => entry.id === targetId);
  const previous = index >= 0 ? existing[index] : null;
  const next = {
    id: targetId,
    label: String(label || (index >= 0 ? existing[index].label : `Key ${existing.length + 1}`)).trim() || `Key ${existing.length + 1}`,
    scope: ['all', 'chat', 'image', 'video'].includes(scope) ? scope : (index >= 0 ? existing[index].scope : 'all'),
    lastUsedAt: previous?.lastUsedAt || 0,
    failureCount: 0,
    cooldownUntil: 0,
    lastError: '',
    health: 'unknown',
    ciphertext: record.ciphertext
  };
  if (index >= 0) existing[index] = next;
  else existing.push(next);
  store[id] = {format: 'safeStorage-pool-v1', keys: existing};
  await writeProviderKeyStore(store);
  return {id: targetId, label: next.label};
}

async function updateProviderApiKeyMetadata(providerId, keyId, metadata = {}) {
  const id = sanitizeProviderKeyId(providerId);
  const store = await readProviderKeyStore();
  const entries = normalizeStoredProviderKeyEntries(store[id]);
  const index = entries.findIndex(entry => entry.id === String(keyId || '').trim());
  if (index < 0) return false;
  const current = entries[index];
  entries[index] = {
    ...current,
    lastUsedAt: Number(metadata.lastUsedAt ?? current.lastUsedAt ?? 0),
    failureCount: Number(metadata.failureCount ?? current.failureCount ?? 0),
    cooldownUntil: Number(metadata.cooldownUntil ?? current.cooldownUntil ?? 0),
    lastError: String(metadata.lastError ?? current.lastError ?? '').slice(0, 240),
    health: ['unknown', 'ok', 'cooldown', 'blocked'].includes(metadata.health) ? metadata.health : (current.health || 'unknown')
  };
  store[id] = {format: 'safeStorage-pool-v1', keys: entries};
  await writeProviderKeyStore(store);
  return true;
}

async function removeProviderApiKey(providerId, keyId = '') {
  const id = sanitizeProviderKeyId(providerId);
  const store = await readProviderKeyStore();
  const entries = normalizeStoredProviderKeyEntries(store[id]);
  if (!keyId) delete store[id];
  else {
    const remaining = entries.filter(entry => entry.id !== keyId);
    if (remaining.length) store[id] = {format: 'safeStorage-pool-v1', keys: remaining};
    else delete store[id];
  }
  await writeProviderKeyStore(store);
  return true;
}

async function clearProviderApiKey(providerId) {
  return removeProviderApiKey(providerId, '');
}

async function writeE2EReport(report) {
  if (!E2E_CONFIG.enabled || !E2E_CONFIG.reportPath) return false;
  const file = path.resolve(E2E_CONFIG.reportPath);
  await ensureDir(path.dirname(file));
  const safeReport = Object.assign({}, report || {}, {
    apiKey: undefined,
    environment: 'e2e'
  });
  await fs.writeFile(file, JSON.stringify(safeReport, null, 2), 'utf8');
  return true;
}

function redactDiagnosticValue(value) {
  return redactSecrets(value);
}

async function appendAppLog(level, message, details = {}) {
  const line = JSON.stringify(redactDiagnosticValue({
    time: new Date().toISOString(),
    level,
    message: String(message || ''),
    details
  })) + '\n';
  await ensureDir(LOCAL_RUNTIME_PATHS.logs);
  await fs.appendFile(appLogFile(), line, 'utf8').catch(() => {});
}

async function readJsonIfExists(file, fallback, diagnosticReadErrors = []) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    diagnosticReadErrors.push({ file: path.basename(file), error: err.message || String(err) });
    await appendAppLog('warn', 'diagnostic json read failed', { file: path.basename(file), error: err.message || String(err) });
    return fallback;
  }
}

async function privateDirSummary(dir) {
  let count = 0;
  let totalBytes = 0;
  let latestTimestamp = 0;
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const file = path.join(dir, item.name);
      const stats = await fs.stat(file);
      count++;
      totalBytes += stats.size;
      latestTimestamp = Math.max(latestTimestamp, stats.mtimeMs || 0);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return {
    count,
    totalBytes,
    latestTimestamp: latestTimestamp || null
  };
}

async function recentLogLines(limit = 120) {
  try {
    const text = await fs.readFile(appLogFile(), 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-limit).map(line => {
      try { return safeLogEntry(JSON.parse(line)); } catch { return safeLogEntry(line); }
    });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function mediaSummary(storageDir) {
  if (!storageDir) return { configured: false, files: 0, totalBytes: 0, sizeBuckets: {} };
  const mediaDir = safeStoragePath(storageDir, 'media');
  let files = 0;
  let totalBytes = 0;
  const sizeBuckets = { under1MiB: 0, from1To20MiB: 0, from20To100MiB: 0, over100MiB: 0 };
  try {
    const entries = await fs.readdir(mediaDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const file = path.join(mediaDir, entry.name);
      const stats = await fs.stat(file);
      files++;
      totalBytes += stats.size;
      if (stats.size < 1024 * 1024) sizeBuckets.under1MiB++;
      else if (stats.size < 20 * 1024 * 1024) sizeBuckets.from1To20MiB++;
      else if (stats.size < 100 * 1024 * 1024) sizeBuckets.from20To100MiB++;
      else sizeBuckets.over100MiB++;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { configured: true, files, totalBytes, sizeBuckets };
}

async function buildDiagnosticsReport(payload = {}) {
  const storageDir = payload.storageDir ? await ensureStorageRootAllowed(payload.storageDir) : '';
  const diagnosticReadErrors = [];
  const projects = storageDir ? await readJsonIfExists(safeStoragePath(storageDir, 'projects.json'), [], diagnosticReadErrors) : [];
  const history = storageDir ? await readJsonIfExists(safeStoragePath(storageDir, 'history.json'), [], diagnosticReadErrors) : [];
  const models = storageDir ? await readJsonIfExists(safeStoragePath(storageDir, 'models.json'), [], diagnosticReadErrors) : [];
  const report = {
    createdAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged
    },
    storage: {
      configured: Boolean(storageDir),
      authorized: Boolean(storageDir && allowedStorageRoots.has(path.resolve(storageDir)))
    },
    settingsSummary: payload.settingsSummary || {},
    projectStats: {
      count: Array.isArray(projects) ? projects.length : 0,
      nodes: Array.isArray(projects) ? projects.reduce((sum, project) => sum + (project?.state?.nodes?.length || 0), 0) : 0
    },
    historyStats: {
      count: Array.isArray(history) ? history.length : 0
    },
    modelStats: {
      count: Array.isArray(models) ? models.length : 0
    },
    mediaSummary: await mediaSummary(storageDir),
    logs: await recentLogLines(),
    crashDumps: await privateDirSummary(LOCAL_RUNTIME_PATHS.crashDumps),
    diagnosticReadErrors,
    notes: [
      'Diagnostics use aggregate counts and exclude API keys, prompts, project identifiers, file names, URLs and local paths.',
      'Media and crash data are summarized without embedding user files.'
    ]
  };
  return sanitizeDiagnosticReport(report);
}

async function exportDiagnosticsPackage(payload = {}) {
  const report = await buildDiagnosticsReport(payload);
  const baseDir = payload.storageDir
    ? safeStoragePath(payload.storageDir, 'diagnostics')
    : path.join(LOCAL_RUNTIME_PATHS.userData, 'diagnostics');
  await ensureDir(baseDir);
  const dir = path.join(baseDir, `diagnostics-${timestampForBackup()}`);
  await ensureDir(dir);
  const reportFile = path.join(dir, 'diagnostic-report.json');
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');
  const latestLogFile = path.join(dir, 'latest-app-log.json');
  await fs.writeFile(latestLogFile, JSON.stringify({ logs: report.logs }, null, 2), 'utf8');
  if (!E2E_CONFIG.enabled) await shell.showItemInFolder(reportFile);
  await appendAppLog('info', 'diagnostics exported', { reportFile });
  return { dir, reportFile };
}

function sanitizeExportPayload(payload = {}) {
  return redactDiagnosticValue({
    exportedAt: new Date().toISOString(),
    project: payload.project || {},
    canvas: payload.canvas || {},
    selectedNodes: Array.isArray(payload.selectedNodes) ? payload.selectedNodes : [],
    selectedNodeIds: Array.isArray(payload.selectedNodeIds) ? payload.selectedNodeIds : [],
    history: Array.isArray(payload.history) ? payload.history : [],
    provenance: Array.isArray(payload.provenance) ? payload.provenance : [],
    settingsSummary: Object.assign({}, payload.settingsSummary || {}, { apiKey: '[REDACTED]' })
  });
}

async function exportProjectPackage(payload = {}) {
  const storageDir = await ensureStorageRootAllowed(payload.storageDir);
  const safePayload = sanitizeExportPayload(payload);
  const baseDir = safeStoragePath(storageDir, 'exports');
  await ensureDir(baseDir);
  const dir = path.join(baseDir, `project-export-${timestampForBackup()}`);
  const mediaDir = path.join(dir, 'referenced-media');
  await ensureDir(mediaDir);

  const mediaManifest = [];
  const copiedMedia = new Map();
  const refs = collectReferencedMedia(safePayload, new Set());
  for (const ref of refs) {
    try {
      const source = safeExistingMediaPath(ref);
      if (copiedMedia.has(source)) continue;
      const targetName = `${String(copiedMedia.size + 1).padStart(3, '0')}-${path.basename(source).replace(/[\\/:*?"<>|]+/g, '_')}`;
      const target = path.join(mediaDir, targetName);
      await fs.copyFile(source, target);
      const stats = await fs.stat(target);
      copiedMedia.set(source, targetName);
      mediaManifest.push({ source: path.basename(source), exportedAs: `referenced-media/${targetName}`, size: stats.size, mime: mimeFromPath(source), sha256: await fileSha256(target) });
    } catch (err) {
      mediaManifest.push({ source: String(ref), error: err.message || String(err) });
    }
  }

  const provenance = (safePayload.provenance || []).map(record => {
    const output = {...record};
    try {
      const source = safeExistingMediaPath(record.url);
      const exportedAs = copiedMedia.get(source);
      const media = mediaManifest.find(item => item.exportedAs === `referenced-media/${exportedAs}`);
      output.relativePath = exportedAs ? `referenced-media/${exportedAs}` : '';
      output.fileHash = media?.sha256 || output.fileHash || '';
    } catch {}
    delete output.url;
    return output;
  });
  const deliveryManifest = [
    '# ∞未来 AI 交付清单',
    '',
    `导出时间：${safePayload.exportedAt}`,
    `项目：${safePayload.project?.name || '未命名项目'}`,
    `正式输出：${provenance.length} 项`,
    '',
    ...provenance.flatMap((item, index) => [
      `## ${index + 1}. ${item.mediaType || 'media'} · ${item.modelId || '未记录模型'}`,
      `- 节点：${item.nodeId || '未记录'}`,
      `- 供应商：${item.providerName || item.providerId || '未记录'}`,
      `- 文件：${item.relativePath || '未复制到生产包'}`,
      `- SHA-256：${item.fileHash || '未计算'}`,
      `- 审批：${item.approvalStatus || '未查看'}`,
      `- 授权备注：${item.licenseNotes || '未填写'}`,
      ''
    ])
  ].join('\n');
  const files = {
    'canvas.json': safePayload.canvas,
    'selected-nodes.json': { selectedNodeIds: safePayload.selectedNodeIds, nodes: safePayload.selectedNodes },
    'history.json': safePayload.history,
    'media-manifest.json': { exportedAt: safePayload.exportedAt, media: mediaManifest },
    'provenance.json': {schemaVersion: 1, exportedAt: safePayload.exportedAt, outputs: provenance},
    'delivery-manifest.md': deliveryManifest,
    'project-summary.json': {
      exportedAt: safePayload.exportedAt,
      project: safePayload.project,
      counts: {
        nodes: safePayload.canvas?.nodes?.length || 0,
        edges: safePayload.canvas?.edges?.length || 0,
        selectedNodes: safePayload.selectedNodes.length,
        history: safePayload.history.length,
        media: mediaManifest.length
      },
      settingsSummary: safePayload.settingsSummary
    }
  };
  const written = [];
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(dir, name);
    await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
    written.push(file);
  }
  const zipEntries = Object.entries(files).map(([name, value]) => ({ name, data: JSON.stringify(value, null, 2) }));
  for (const [source, exportedAs] of copiedMedia) {
    zipEntries.push({ name: `referenced-media/${exportedAs}`, data: await fs.readFile(source) });
  }
  const zipFile = path.join(dir, 'project-package.zip');
  await fs.writeFile(zipFile, buildZip(zipEntries));
  if (!E2E_CONFIG.enabled) await shell.showItemInFolder(zipFile);
  await appendAppLog('info', 'project package exported', { zipFile, media: mediaManifest.length });
  return { dir, zipFile, manifestFile: path.join(dir, 'media-manifest.json'), files: written, mediaCount: mediaManifest.length };
}

async function exportReviewPackage(payload = {}) {
  const storageDir = await ensureStorageRootAllowed(payload.storageDir);
  const baseDir = safeStoragePath(storageDir, 'exports');
  await ensureDir(baseDir);
  const dir = path.join(baseDir, `review-package-${timestampForBackup()}`);
  const mediaDir = path.join(dir, 'media');
  await ensureDir(mediaDir);
  const copied = new Map();
  const outputs = [];
  for (const raw of Array.isArray(payload.outputs) ? payload.outputs : []) {
    const item = {...raw};
    try {
      const source = safeExistingMediaPath(raw.sourceUrl);
      let targetName = copied.get(source);
      if (!targetName) {
        targetName = `${String(copied.size + 1).padStart(3, '0')}-${path.basename(source).replace(/[\\/:*?"<>|]+/g, '_')}`;
        await fs.copyFile(source, path.join(mediaDir, targetName));
        copied.set(source, targetName);
      }
      item.mediaPath = `media/${targetName}`;
    } catch (error) {
      item.mediaPath = '';
      item.mediaError = String(error?.message || error || '媒体无法复制').replace(/[a-zA-Z]:[\\/][^\r\n]*/g, '[private-path]');
    }
    delete item.sourceUrl;
    outputs.push(item);
  }
  const archive = buildOfflineReviewEntries({...payload, storageDir: undefined, outputs}, await Promise.all([...copied].map(async ([source, targetName]) => ({name: `media/${targetName}`, data: await fs.readFile(source)}))));
  const {review, html, reviewJson, readme, entries} = archive;
  await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8');
  await fs.writeFile(path.join(dir, 'review.json'), reviewJson, 'utf8');
  await fs.writeFile(path.join(dir, 'README.md'), readme, 'utf8');
  const zipFile = path.join(dir, 'offline-review-package.zip');
  await fs.writeFile(zipFile, buildZip(entries));
  if (!E2E_CONFIG.enabled) await shell.showItemInFolder(zipFile);
  await appendAppLog('info', 'offline review package exported', {zipFile, media: copied.size, outputs: outputs.length});
  return {dir, zipFile, indexFile: path.join(dir, 'index.html'), mediaCount: copied.size, outputCount: outputs.length};
}

function stripBackupSecrets(value) {
  if (Array.isArray(value)) return value.map(stripBackupSecrets);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/api[_-]?key|apikey|secret|token|authorization|password/i.test(key)) continue;
    output[key] = stripBackupSecrets(child);
  }
  return output;
}

function backupRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('备份包含无效文件路径');
  }
  return normalized;
}

async function collectBackupDirectory(root, prefix, output) {
  if (!fsSync.existsSync(root)) return;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const source = path.join(root, entry.name);
    const relative = backupRelativePath(`${prefix}/${entry.name}`);
    if (entry.isDirectory()) await collectBackupDirectory(source, relative, output);
    else if (entry.isFile()) output.push({ source, relative });
    if (output.length > WORKSPACE_BACKUP_FILE_LIMIT) throw new Error('工作区文件过多，无法安全备份');
  }
}

async function collectWorkspaceBackupFiles(storageDir) {
  const files = [];
  for (const fileName of Object.values(STORE_FILES)) {
    const source = safeStoragePath(storageDir, fileName);
    if (fsSync.existsSync(source)) files.push({ source, relative: `stores/${fileName}` });
  }
  await collectBackupDirectory(safeStoragePath(storageDir, 'media'), 'media', files);
  await collectBackupDirectory(safeStoragePath(storageDir, '.future-ai', 'attachments'), 'attachments', files);
  return files;
}

async function copyWorkspaceBackup(storageDir, parentDir, payload = {}, reason = 'manual') {
  const sourceRoot = await ensureStorageRootAllowed(storageDir);
  const destinationParent = path.resolve(parentDir);
  await ensureDir(destinationParent);
  const backupDir = path.join(destinationParent, `FutureAI-workspace-${timestampForBackup()}`);
  await ensureDir(backupDir);
  try {
    const sources = await collectWorkspaceBackupFiles(sourceRoot);
    const manifestFiles = [];
    let totalBytes = 0;
    for (const item of sources) {
      const stats = await fs.stat(item.source);
      totalBytes += stats.size;
      if (totalBytes > WORKSPACE_BACKUP_TOTAL_LIMIT) throw new Error('工作区超过 20 GB，请先清理无用媒体后再备份');
      const destination = path.join(backupDir, ...backupRelativePath(item.relative).split('/'));
      if (!pathInside(backupDir, destination)) throw new Error('备份目标路径越界');
      await ensureDir(path.dirname(destination));
      await fs.copyFile(item.source, destination);
      manifestFiles.push({ path: item.relative, size: stats.size, sha256: await fileSha256(destination) });
    }

    const settings = stripBackupSecrets(payload.settings || {});
    const settingsFile = path.join(backupDir, 'settings.json');
    await fs.writeFile(settingsFile, JSON.stringify({
      version: 1,
      currentProjectId: String(payload.currentProjectId || ''),
      settings
    }, null, 2), 'utf8');
    const settingsStats = await fs.stat(settingsFile);
    manifestFiles.push({ path: 'settings.json', size: settingsStats.size, sha256: await fileSha256(settingsFile) });
    totalBytes += settingsStats.size;

    const manifest = {
      format: WORKSPACE_BACKUP_FORMAT,
      version: WORKSPACE_BACKUP_VERSION,
      appVersion: getCurrentAppVersion(),
      createdAt: new Date().toISOString(),
      reason,
      source: { storageDir: sourceRoot },
      totals: { files: manifestFiles.length, bytes: totalBytes },
      files: manifestFiles
    };
    const manifestFile = path.join(backupDir, 'manifest.json');
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');
    await appendAppLog('info', 'workspace backup created', { backupDir, files: manifestFiles.length, bytes: totalBytes, reason });
    return { backupDir, manifestFile, files: manifestFiles.length, bytes: totalBytes };
  } catch (err) {
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function exportWorkspaceBackup(payload = {}) {
  const storageDir = await ensureStorageRootAllowed(payload.storageDir);
  const result = await dialog.showOpenDialog({
    title: '选择完整备份的保存位置',
    defaultPath: path.dirname(storageDir),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const backup = await copyWorkspaceBackup(storageDir, result.filePaths[0], payload, 'manual-export');
  await shell.showItemInFolder(backup.manifestFile);
  return backup;
}

async function verifyWorkspaceBackup(manifestFile) {
  const resolvedManifest = path.resolve(manifestFile);
  if (path.basename(resolvedManifest).toLowerCase() !== 'manifest.json') throw new Error('请选择完整备份目录中的 manifest.json');
  const backupDir = path.dirname(resolvedManifest);
  const manifest = JSON.parse(await fs.readFile(resolvedManifest, 'utf8'));
  if (manifest?.format !== WORKSPACE_BACKUP_FORMAT) throw new Error('这不是 ∞未来 AI 完整工作区备份');
  if (!Number.isInteger(manifest.version) || manifest.version < 1 || manifest.version > WORKSPACE_BACKUP_VERSION) {
    throw new Error('备份版本不兼容，请先升级软件');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length > WORKSPACE_BACKUP_FILE_LIMIT) throw new Error('备份文件清单无效');
  let totalBytes = 0;
  const verified = [];
  const seen = new Set();
  for (const entry of manifest.files) {
    const relative = backupRelativePath(entry?.path);
    if (seen.has(relative)) throw new Error(`备份包含重复文件：${relative}`);
    if (!/^(stores\/(projects|history|assets|asset-folders|models)\.json|media\/.+|attachments\/.+|settings\.json)$/.test(relative)) {
      throw new Error(`备份包含不允许的文件：${relative}`);
    }
    const source = path.resolve(backupDir, ...relative.split('/'));
    if (!pathInside(backupDir, source)) throw new Error('备份文件路径越界');
    const stats = await fs.stat(source);
    if (!stats.isFile() || stats.size !== Number(entry.size)) throw new Error(`备份文件大小不匹配：${relative}`);
    totalBytes += stats.size;
    if (totalBytes > WORKSPACE_BACKUP_TOTAL_LIMIT) throw new Error('备份总大小超过安全限制');
    const sha256 = await fileSha256(source);
    if (!entry.sha256 || sha256.toLowerCase() !== String(entry.sha256).toLowerCase()) throw new Error(`备份校验失败：${relative}`);
    if (relative.startsWith('stores/')) {
      const parsed = JSON.parse(await fs.readFile(source, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error(`备份数据结构无效：${relative}`);
    } else if (relative === 'settings.json') {
      const parsed = JSON.parse(await fs.readFile(source, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
        throw new Error('备份设置结构无效');
      }
    }
    seen.add(relative);
    verified.push({ relative, source, size: stats.size });
  }
  if (!seen.has('stores/projects.json') || !seen.has('settings.json')) throw new Error('备份缺少项目或设置快照');
  if (Number(manifest.totals?.files) !== verified.length || Number(manifest.totals?.bytes) !== totalBytes) {
    throw new Error('备份汇总信息不完整');
  }
  return { backupDir, manifest, files: verified, totalBytes };
}

function rewriteRestoredStorageReferences(value, oldRoot, newRoot) {
  if (Array.isArray(value)) return value.map(item => rewriteRestoredStorageReferences(item, oldRoot, newRoot));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewriteRestoredStorageReferences(child, oldRoot, newRoot)]));
  }
  if (typeof value !== 'string' || !oldRoot || path.resolve(oldRoot) === path.resolve(newRoot)) return value;
  if (value.startsWith('file:')) {
    try {
      const source = fileURLToPath(value);
      if (pathInside(oldRoot, source)) return pathToFileURL(path.join(newRoot, path.relative(oldRoot, source))).href;
    } catch {}
    return value;
  }
  if (path.isAbsolute(value) && pathInside(oldRoot, value)) return path.join(newRoot, path.relative(oldRoot, value));
  return value;
}

async function commitRestoredPath(staged, target, old, transaction) {
  await ensureDir(path.dirname(target));
  if (fsSync.existsSync(target)) await fs.rename(target, old);
  try {
    await fs.rename(staged, target);
    transaction.push({ target, old: fsSync.existsSync(old) ? old : '' });
  } catch (err) {
    if (fsSync.existsSync(old)) await fs.rename(old, target).catch(() => {});
    throw err;
  }
}

async function restoreWorkspaceBackup(payload = {}) {
  const storageDir = await ensureStorageRootAllowed(payload.storageDir);
  const choice = await dialog.showOpenDialog({
    title: '选择完整备份的 manifest.json',
    properties: ['openFile'],
    filters: [{ name: '∞未来 AI 完整备份', extensions: ['json'] }]
  });
  if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
  const verified = await verifyWorkspaceBackup(choice.filePaths[0]);
  const safetyParent = safeStoragePath(storageDir, 'backups', 'workspace');
  const safety = await copyWorkspaceBackup(storageDir, safetyParent, payload, 'before-restore');
  const stageRoot = safeStoragePath(storageDir, `.future-ai-restore-${crypto.randomUUID()}`);
  await ensureDir(stageRoot);
  const sourceRoot = String(verified.manifest.source?.storageDir || '');
  let restoredSettings = {};
  let restoredCurrentProjectId = '';
  try {
    for (const item of verified.files) {
      const staged = path.join(stageRoot, ...item.relative.split('/'));
      await ensureDir(path.dirname(staged));
      if (item.relative.startsWith('stores/')) {
        const parsed = JSON.parse(await fs.readFile(item.source, 'utf8'));
        const rewritten = rewriteRestoredStorageReferences(parsed, sourceRoot, storageDir);
        await fs.writeFile(staged, JSON.stringify(rewritten, null, 2), 'utf8');
      } else if (item.relative === 'settings.json') {
        const parsed = JSON.parse(await fs.readFile(item.source, 'utf8'));
        restoredSettings = stripBackupSecrets(parsed.settings || {});
        restoredCurrentProjectId = String(parsed.currentProjectId || '');
        await fs.copyFile(item.source, staged);
      } else {
        await fs.copyFile(item.source, staged);
      }
    }

    for (const fileName of Object.values(STORE_FILES)) {
      const staged = path.join(stageRoot, 'stores', fileName);
      if (!fsSync.existsSync(staged)) {
        await ensureDir(path.dirname(staged));
        await fs.writeFile(staged, '[]', 'utf8');
      }
    }

    const transaction = [];
    const planned = [];
    const addPlanned = (staged, target) => {
      const id = crypto.randomUUID();
      planned.push({staged, target, old: `${target}.restore-old-${id}`, id, hadOriginal: fsSync.existsSync(target)});
    };
    for (const fileName of Object.values(STORE_FILES)) addPlanned(path.join(stageRoot, 'stores', fileName), safeStoragePath(storageDir, fileName));
    for (const [folder, target] of [
      ['media', safeStoragePath(storageDir, 'media')],
      ['attachments', safeStoragePath(storageDir, '.future-ai', 'attachments')]
    ]) {
      const staged = path.join(stageRoot, folder);
      if (!fsSync.existsSync(staged)) await ensureDir(staged);
      addPlanned(staged, target);
    }
    const journal = {
      format: RESTORE_JOURNAL_FORMAT,
      version: 1,
      phase: 'committing',
      stageRoot: path.relative(storageDir, stageRoot).replace(/\\/g, '/'),
      entries: planned.map(item => ({
        target: path.relative(storageDir, item.target).replace(/\\/g, '/'),
        old: path.relative(storageDir, item.old).replace(/\\/g, '/'),
        id: item.id,
        hadOriginal: item.hadOriginal
      }))
    };
    await writeRestoreJournal(storageDir, journal);
    try {
      for (const item of planned) await commitRestoredPath(item.staged, item.target, item.old, transaction);
    } catch (err) {
      for (const item of transaction.reverse()) {
        await fs.rm(item.target, { recursive: true, force: true }).catch(() => {});
        if (item.old) await fs.rename(item.old, item.target).catch(() => {});
      }
      await fs.rm(restoreJournalFile(storageDir), {force: true}).catch(() => {});
      throw err;
    }
    journal.phase = 'committed';
    await writeRestoreJournal(storageDir, journal);
    for (const item of transaction) if (item.old) await fs.rm(item.old, { recursive: true, force: true }).catch(() => {});
    await fs.rm(restoreJournalFile(storageDir), {force: true});
    await appendAppLog('info', 'workspace backup restored', { manifestFile: choice.filePaths[0], safetyBackup: safety.backupDir, files: verified.files.length });
    return {
      restored: true,
      files: verified.files.length,
      bytes: verified.totalBytes,
      safetyBackup: safety.backupDir,
      settings: { ...restoredSettings, storageDir },
      currentProjectId: restoredCurrentProjectId
    };
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function projectRootDir() {
  return path.resolve(__dirname, '..', '..');
}

function installerCacheDir() {
  return path.join(LOCAL_RUNTIME_PATHS.root, 'installers');
}

function installerUpdateStateDir() {
  return path.join(LOCAL_RUNTIME_PATHS.root, 'updates');
}

function getCurrentAppVersion() {
  return app.getVersion();
}

function assertUpdatePackageDirAllowed(value) {
  const target = path.resolve(String(value || ''));
  if (!allowedUpdatePackageDirs.has(target)) throw new Error('更新包目录尚未由用户选择');
  if (!fsSync.existsSync(target) || !fsSync.statSync(target).isDirectory()) throw new Error('更新包目录不存在');
  return target;
}

async function chooseUpdatePackageDir() {
  const result = await dialog.showOpenDialog({
    title: '选择签名更新包文件夹',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return '';
  const target = path.resolve(result.filePaths[0]);
  allowedUpdatePackageDirs.add(target);
  return target;
}

async function resolveUpdatePackageDir(payload = {}) {
  if (payload.updatePath || payload.packageDir) return assertUpdatePackageDirAllowed(payload.updatePath || payload.packageDir);
  return await chooseUpdatePackageDir();
}

async function checkForLocalUpdate(payload = {}) {
  const packageDir = await resolveUpdatePackageDir(payload);
  const currentVersion = getCurrentAppVersion();
  if (!packageDir) return { canceled: true, currentVersion, updateAvailable: false };
  const verified = await verifyInstallerPackage({
    packageDir,
    keyRing: UPDATE_KEY_RING,
    currentVersion,
    trustedPublisherThumbprints: TRUSTED_UPDATE_PUBLISHERS
  });
  return {
    currentVersion,
    availableVersion: verified.version,
    updateAvailable: true,
    compatible: true,
    packageDir,
    installerPath: verified.installerPath,
    sha256: verified.sha256,
    bytes: verified.bytes,
    notes: verified.notes,
    publisher: verified.authenticode.subject,
    publisherThumbprint: verified.authenticode.thumbprint,
    signatureVerified: true,
    protected: UPDATE_PROTECTED_FILES,
    storageDir: payload.storageDir || '',
    runtimeData: LOCAL_RUNTIME_PATHS.root,
    manifestFile: verified.manifestFile
  };
}

function launchInstallerTransaction(prepared) {
  const command = buildUpdateHelperCommand(prepared);
  const child = spawn(command.executable, command.args, {
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child.unref();
  setTimeout(() => app.quit(), 250);
  return child.pid;
}

async function createPreUpdateWorkspaceBackup(payload, reason) {
  if (!payload.storageDir) throw new Error('升级前必须先设置本地存储位置');
  const parent = path.join(installerUpdateStateDir(), 'workspace-backups');
  const backup = await copyWorkspaceBackup(payload.storageDir, parent, payload, reason);
  const verified = await verifyWorkspaceBackup(backup.manifestFile);
  return {
    schema: 'future-ai-verified-workspace-backup/v1',
    backupDir: backup.backupDir,
    manifestFile: backup.manifestFile,
    manifestSha256: await fileSha256(backup.manifestFile),
    files: verified.files.length,
    bytes: verified.totalBytes,
    verifiedAt: new Date().toISOString()
  };
}

async function applyLocalUpdatePackage(payload = {}) {
  const packageDir = assertUpdatePackageDirAllowed(payload.updatePath || payload.packageDir);
  await verifyInstallerPackage({
    packageDir,
    keyRing: UPDATE_KEY_RING,
    currentVersion: getCurrentAppVersion(),
    trustedPublisherThumbprints: TRUSTED_UPDATE_PUBLISHERS
  });
  const safety = await createPreUpdateWorkspaceBackup(payload, 'before-installer-update');
  const prepared = await prepareInstallerUpdate({
    packageDir,
    cacheDir: installerCacheDir(),
    stateDir: installerUpdateStateDir(),
    installDir: path.dirname(app.getPath('exe')),
    applicationExecutable: app.getPath('exe'),
    currentVersion: getCurrentAppVersion(),
    sourcePid: process.pid,
    keyRing: UPDATE_KEY_RING,
    trustedPublisherThumbprints: TRUSTED_UPDATE_PUBLISHERS,
    workspaceBackup: safety
  });
  const helperPid = launchInstallerTransaction(prepared);
  await appendAppLog('info', 'installer update scheduled', {
    targetVersion: prepared.transaction.targetVersion,
    helperPid,
    safetyBackup: safety.backupDir
  });
  return {
    scheduled: true,
    currentVersion: prepared.transaction.currentVersion,
    availableVersion: prepared.transaction.targetVersion,
    helperPid,
    transactionFile: prepared.transactionFile,
    safetyBackup: safety.backupDir,
    protected: UPDATE_PROTECTED_FILES,
    runtimeData: LOCAL_RUNTIME_PATHS.root
  };
}

async function rollbackLastUpdate(payload = {}) {
  const safety = await createPreUpdateWorkspaceBackup(payload, 'before-installer-rollback');
  const prepared = await prepareInstallerRollback({
    cacheDir: installerCacheDir(),
    stateDir: installerUpdateStateDir(),
    installDir: path.dirname(app.getPath('exe')),
    applicationExecutable: app.getPath('exe'),
    currentVersion: getCurrentAppVersion(),
    sourcePid: process.pid,
    trustedPublisherThumbprints: TRUSTED_UPDATE_PUBLISHERS,
    workspaceBackup: safety
  });
  const helperPid = launchInstallerTransaction(prepared);
  await appendAppLog('info', 'installer rollback scheduled', {
    targetVersion: prepared.transaction.targetVersion,
    helperPid,
    safetyBackup: safety.backupDir
  });
  return {
    scheduled: true,
    rolledBack: false,
    currentVersion: prepared.transaction.currentVersion,
    availableVersion: prepared.transaction.targetVersion,
    helperPid,
    transactionFile: prepared.transactionFile,
    safetyBackup: safety.backupDir,
    protected: UPDATE_PROTECTED_FILES,
    runtimeData: LOCAL_RUNTIME_PATHS.root
  };
}

function commandLineValue(prefix) {
  const argument = process.argv.find(item => String(item).startsWith(prefix));
  return argument ? String(argument).slice(prefix.length) : '';
}

async function reportInstallerUpdateHealth() {
  const updateToken = commandLineValue('--future-ai-update-health=');
  const rollbackToken = commandLineValue('--future-ai-rollback-health=');
  if (updateToken && rollbackToken) throw new Error('更新健康检查阶段冲突');
  const token = updateToken || rollbackToken;
  if (!token) return { reported: false };
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error('更新健康检查令牌无效');
  const transactionFile = path.join(installerUpdateStateDir(), 'pending-update.json');
  const transaction = JSON.parse(await fs.readFile(transactionFile, 'utf8'));
  const phase = rollbackToken ? 'rollback' : 'target';
  const expectedVersion = phase === 'rollback' ? transaction?.currentVersion : transaction?.targetVersion;
  if (transaction?.schema !== 'future-ai-installer-update-transaction/v1'
    || transaction.token !== token || expectedVersion !== getCurrentAppVersion()) {
    throw new Error('更新健康检查与当前事务不匹配');
  }
  const healthFile = path.resolve(transaction.healthFile);
  if (!pathInside(installerUpdateStateDir(), healthFile)) throw new Error('更新健康文件路径越界');
  let workspaceBackupVerified = false;
  if (phase === 'rollback') {
    const backupManifest = path.resolve(String(transaction.workspaceBackup?.manifestFile || ''));
    if (!backupManifest || !pathInside(installerUpdateStateDir(), backupManifest)) throw new Error('rollback workspace backup is missing or outside the update state directory');
    if (await fileSha256(backupManifest) !== transaction.workspaceBackup.manifestSha256) throw new Error('rollback workspace backup manifest hash does not match transaction');
    await verifyWorkspaceBackup(backupManifest);
    workspaceBackupVerified = true;
  }
  const health = { token, phase, version: getCurrentAppVersion(), workspaceBackupVerified, readyAt: new Date().toISOString() };
  const temp = `${healthFile}.${process.pid}.tmp`;
  await ensureDir(path.dirname(healthFile));
  await fs.writeFile(temp, JSON.stringify(health), 'utf8');
  await fs.rename(temp, healthFile);
  await appendAppLog('info', 'installer update health reported', { version: health.version });
  return { reported: true, version: health.version };
}

async function readInstallerUpdateOutcome() {
  const transactionFile = path.join(installerUpdateStateDir(), 'pending-update.json');
  const statusFile = `${transactionFile}.status.json`;
  const acknowledgementFile = path.join(installerUpdateStateDir(), 'acknowledged-update.json');
  if (!fsSync.existsSync(transactionFile) || !fsSync.existsSync(statusFile)) return null;
  if (fsSync.statSync(transactionFile).size > 128 * 1024 || fsSync.statSync(statusFile).size > 32 * 1024) throw new Error('update outcome files exceed safety limits');
  const transaction = JSON.parse(await fs.readFile(transactionFile, 'utf8'));
  const status = JSON.parse(await fs.readFile(statusFile, 'utf8'));
  let acknowledgement = null;
  try { acknowledgement = JSON.parse(await fs.readFile(acknowledgementFile, 'utf8')); } catch {}
  return parseInstallerUpdateOutcome({transaction, status, acknowledgement});
}

async function acknowledgeInstallerUpdateOutcome(payload = {}) {
  const outcome = await readInstallerUpdateOutcome();
  if (!outcome || outcome.token !== payload.token || outcome.status !== payload.status || outcome.updatedAt !== payload.updatedAt) {
    return {acknowledged: false};
  }
  const file = path.join(installerUpdateStateDir(), 'acknowledged-update.json');
  const temp = `${file}.${process.pid}.tmp`;
  await ensureDir(path.dirname(file));
  await fs.writeFile(temp, JSON.stringify({schema: 'future-ai-update-acknowledgement/v1', token: outcome.token, status: outcome.status, updatedAt: outcome.updatedAt}), 'utf8');
  await fs.rename(temp, file);
  return {acknowledged: true};
}

function safeCleanupPath(target, roots) {
  const file = path.resolve(String(target || ''));
  for (const root of roots.map(item => path.resolve(item))) {
    if (pathInside(root, file)) return file;
  }
  throw new Error('清理路径越界：' + file);
}

function cleanupItem(type, file, label, size = 0) {
  return { type, path: file, label, size };
}

async function fileSizeIfExists(file) {
  try {
    const stats = await fs.stat(file);
    return stats.size;
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
}

function collectReferencedMedia(value, refs = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('file:')) {
      try { refs.add(fileURLToPath(value)); } catch {}
    }
    return refs;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectReferencedMedia(item, refs));
    return refs;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectReferencedMedia(item, refs));
  }
  return refs;
}

function collectMediaReferences(value, owner, refs = new Map()) {
  if (typeof value === 'string') {
    if (value.startsWith('file:')) {
      const key = path.resolve(fileURLToPath(value));
      const list = refs.get(key) || [];
      list.push(owner);
      refs.set(key, list);
    }
    return refs;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectMediaReferences(item, { ...owner, path: `${owner.path || '$'}[${index}]` }, refs));
    return refs;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectMediaReferences(item, { ...owner, path: `${owner.path || '$'}.${key}` }, refs));
  }
  return refs;
}

async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  const data = await fs.readFile(file);
  hash.update(data);
  return hash.digest('hex');
}

async function packagedAppAsarSha256() {
  const target = path.resolve(app.getAppPath());
  const stats = await fs.lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink() || path.extname(target).toLowerCase() !== '.asar') {
    throw new Error('商业验收证据只能由已打包的 app.asar 应用导出');
  }
  return await fileSha256(target);
}

async function buildMediaLibraryIndex(payload = {}) {
  const storageDir = await ensureStorageRootAllowed(payload.storageDir);
  const mediaDir = safeStoragePath(storageDir, 'media');
  const projects = await readJsonIfExists(safeStoragePath(storageDir, 'projects.json'), []);
  const history = await readJsonIfExists(safeStoragePath(storageDir, 'history.json'), []);
  const refs = new Map();
  (Array.isArray(projects) ? projects : []).forEach(project => collectMediaReferences(project, { type: 'project', projectId: project?.id || '', projectName: project?.name || '', path: '$' }, refs));
  (Array.isArray(history) ? history : []).forEach(item => collectMediaReferences(item, { type: 'history', projectId: item?.projectId || '', historyId: item?.id || '', path: '$' }, refs));
  const files = [];
  const byHash = new Map();
  try {
    const entries = await fs.readdir(mediaDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const file = path.join(mediaDir, entry.name);
      const stats = await fs.stat(file);
      const sha256 = await fileSha256(file);
      const referencedBy = refs.get(path.resolve(file)) || [];
      const item = {
        name: entry.name,
        path: file,
        url: pathToFileURL(file).href,
        size: stats.size,
        mtime: stats.mtimeMs,
        mime: mimeFromPath(file),
        sha256,
        referencedBy,
        unreferenced: referencedBy.length === 0
      };
      files.push(item);
      const group = byHash.get(sha256) || [];
      group.push(item);
      byHash.set(sha256, group);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const existing = new Set(files.map(item => path.resolve(item.path)));
  const missingReferences = [];
  for (const [file, referencedBy] of refs.entries()) {
    if (pathInside(storageDir, file) && !existing.has(path.resolve(file))) {
      missingReferences.push({ path: file, url: pathToFileURL(file).href, referencedBy });
    } else {
      try { safeExistingMediaPath(file); } catch {}
    }
  }
  const duplicateGroups = [...byHash.values()]
    .filter(group => group.length > 1)
    .map(group => ({ sha256: group[0].sha256, count: group.length, totalBytes: group.reduce((sum, item) => sum + item.size, 0), files: group.map(item => ({ name: item.name, path: item.path, size: item.size, referencedBy: item.referencedBy })) }));
  return {
    storageDir,
    mediaDir,
    files,
    duplicateGroups,
    missingReferences,
    unreferenced: files.filter(item => item.unreferenced),
    summary: {
      files: files.length,
      bytes: files.reduce((sum, item) => sum + item.size, 0),
      duplicateGroups: duplicateGroups.length,
      missingReferences: missingReferences.length,
      unreferenced: files.filter(item => item.unreferenced).length
    }
  };
}

function isHistoricalAppAsarName(name) {
  if (!name || name === 'app.asar' || !name.endsWith('.asar')) return false;
  // Official update backups: app.asar.backup-* / app.asar.YYYYMMDD-HHMMSS
  if (name.startsWith('app.asar.')) return true;
  // Manual/hotfix theme copies left beside the live asar (never loaded by Electron)
  if (name.startsWith('app.') && name !== 'app.asar') return true;
  return false;
}

async function cleanupAsarBackups(root) {
  const resourcesDir = path.join(root, 'resources');
  const currentAsar = path.join(resourcesDir, 'app.asar');
  const entries = [];
  try {
    for (const entry of await fs.readdir(resourcesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !isHistoricalAppAsarName(entry.name)) continue;
      const file = path.join(resourcesDir, entry.name);
      if (path.resolve(file) === path.resolve(currentAsar)) continue;
      entries.push(cleanupItem('asarBackup', file, entry.name, await fileSizeIfExists(file)));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return entries;
}

function updateAsarBackupsDir() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, 'update-backups');
}

async function listTimestampedBackups(dir, pattern) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    const stats = await fs.stat(file);
    items.push({ name: entry.name, file, mtimeMs: stats.mtimeMs, size: stats.size });
  }
  return items.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

async function pruneUpdateAsarBackups() {
  const dir = updateAsarBackupsDir();
  const items = await listTimestampedBackups(dir, /^app\.asar\./i);
  const stale = items.slice(UPDATE_ASAR_BACKUP_LIMIT);
  await Promise.all(stale.map(item => fs.rm(item.file, { force: true })));
  return stale.length;
}

async function cleanupStaleUpdateAsarBackups() {
  const dir = updateAsarBackupsDir();
  const items = await listTimestampedBackups(dir, /^app\.asar\./i);
  return items.slice(UPDATE_ASAR_BACKUP_LIMIT).map(item =>
    cleanupItem('updateAsarBackup', item.file, item.name, item.size)
  );
}

async function cleanupStaleCodexBackups() {
  const dir = codexBackupsDir();
  const items = await listTimestampedBackups(dir, /^codex\.exe\.\d{8}-\d{6}$/);
  return items.slice(CODEX_BACKUP_LIMIT).map(item =>
    cleanupItem('codexBackup', item.file, item.name, item.size)
  );
}

/**
 * When runtime already lives under LocalAppData, the install-dir runtime-data
 * often keeps orphaned Codex/update copies that the live app never reads.
 * Never delete keys, projects, or the active LocalAppData runtime.
 */
async function cleanupOrphanInstallRuntime(root) {
  const installRuntime = path.resolve(root, 'resources', LOCAL_RUNTIME_DIR);
  const activeRuntime = path.resolve(LOCAL_RUNTIME_PATHS.root);
  if (installRuntime === activeRuntime) return [];
  if (!fsSync.existsSync(installRuntime)) return [];

  const entries = [];
  const orphanTargets = [
    { type: 'orphanInstallRuntime', rel: path.join('user-data', 'codex-backups'), label: '安装目录 Codex 备份（已迁移）' },
    { type: 'orphanInstallRuntime', rel: path.join('user-data', 'codex'), label: '安装目录 Codex 可写副本（已迁移）' },
    { type: 'orphanInstallRuntime', rel: path.join('user-data', 'update-backups'), label: '安装目录更新备份（已迁移）' },
    { type: 'orphanInstallRuntime', rel: path.join('user-data', 'codex-home-smoke'), label: '安装目录 Codex 冒烟目录' },
    { type: 'orphanInstallRuntime', rel: path.join('session-data', 'Cache'), label: '安装目录会话 Cache' },
    { type: 'orphanInstallRuntime', rel: path.join('session-data', 'Code Cache'), label: '安装目录 Code Cache' },
    { type: 'orphanInstallRuntime', rel: path.join('session-data', 'GPUCache'), label: '安装目录 GPUCache' },
    { type: 'orphanInstallRuntime', rel: path.join('session-data', 'DawnGraphiteCache'), label: '安装目录 DawnGraphiteCache' },
    { type: 'orphanInstallRuntime', rel: path.join('session-data', 'DawnWebGPUCache'), label: '安装目录 DawnWebGPUCache' }
  ];
  for (const target of orphanTargets) {
    const file = path.join(installRuntime, target.rel);
    if (!fsSync.existsSync(file)) continue;
    // Never touch the active writable Codex path
    if (path.resolve(file) === path.resolve(path.dirname(writableCodexCommand()))) continue;
    if (path.resolve(file) === path.resolve(writableCodexCommand())) continue;
    entries.push(cleanupItem(target.type, file, target.label, await fileSizeIfExists(file)));
  }
  return entries;
}

async function cleanupInstallRootDebris(root) {
  const entries = [];
  // Unpack leftovers next to the Electron exe — not loaded by the packaged app.
  const debris = [
    { name: 'index-Dch4LMxb.css', label: '根目录导演台 Demo CSS' },
    { name: 'index.html', label: '根目录导演台 Demo HTML', onlyIfContains: '3D导演台' }
  ];
  for (const item of debris) {
    const file = path.join(root, item.name);
    if (!fsSync.existsSync(file) || !fsSync.statSync(file).isFile()) continue;
    if (item.onlyIfContains) {
      try {
        const head = fsSync.readFileSync(file, 'utf8').slice(0, 400);
        if (!head.includes(item.onlyIfContains)) continue;
      } catch {
        continue;
      }
    }
    entries.push(cleanupItem('installDebris', file, item.label, await fileSizeIfExists(file)));
  }
  return entries;
}

async function cleanupTmpE2E(root) {
  const dir = path.join(root, 'tmp-e2e');
  const size = await fileSizeIfExists(dir);
  return fsSync.existsSync(dir) ? [cleanupItem('tmpE2E', dir, 'tmp-e2e', size)] : [];
}

async function cleanupOldLogs() {
  const items = [];
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    for (const entry of await fs.readdir(LOCAL_RUNTIME_PATHS.logs, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === DIAGNOSTIC_LOG_FILE) continue;
      const file = path.join(LOCAL_RUNTIME_PATHS.logs, entry.name);
      const stats = await fs.stat(file);
      if (stats.mtimeMs < cutoff) items.push(cleanupItem('oldLogs', file, entry.name, stats.size));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return items;
}

async function cleanupUnreferencedMedia(storageDir) {
  if (!storageDir) return [];
  const root = await ensureStorageRootAllowed(storageDir);
  const mediaDir = safeStoragePath(root, 'media');
  const projects = await readJsonIfExists(safeStoragePath(root, 'projects.json'), []);
  const history = await readJsonIfExists(safeStoragePath(root, 'history.json'), []);
  const assets = await readJsonIfExists(safeStoragePath(root, 'assets.json'), []);
  const refs = collectReferencedMedia(projects);
  collectReferencedMedia(history, refs);
  collectReferencedMedia(assets, refs);
  const items = [];
  try {
    for (const entry of await fs.readdir(mediaDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(mediaDir, entry.name);
      if (refs.has(path.resolve(file))) continue;
      items.push(cleanupItem('unreferencedMedia', file, entry.name, await fileSizeIfExists(file)));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return items;
}

function cleanupSummary(items) {
  const byType = {};
  for (const item of items) {
    byType[item.type] = byType[item.type] || { count: 0, bytes: 0 };
    byType[item.type].count += 1;
    byType[item.type].bytes += item.size || 0;
  }
  return {
    count: items.length,
    bytes: items.reduce((sum, item) => sum + (item.size || 0), 0),
    byType
  };
}

async function scanCleanupTargets(payload = {}) {
  const root = projectRootDir();
  const storageDir = payload.storageDir || '';
  const items = [
    ...await cleanupAsarBackups(root),
    ...await cleanupStaleUpdateAsarBackups(),
    ...await cleanupStaleCodexBackups(),
    ...await cleanupOrphanInstallRuntime(root),
    ...await cleanupInstallRootDebris(root),
    ...await cleanupTmpE2E(root),
    ...await cleanupOldLogs(),
    ...await cleanupUnreferencedMedia(storageDir)
  ];
  const cleanupToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const scan = {
    cleanupToken,
    requiresConfirmation: true,
    items,
    summary: cleanupSummary(items),
    protected: [
      'resources/app.asar',
      'resources/codex',
      'resources/ffmpeg',
      'resources/ffmpeg-lgpl',
      'api-key.json',
      'provider-api-keys.json',
      'projects.json',
      'history.json',
      'assets.json',
      'asset-folders.json',
      'models.json'
    ]
  };
  cleanupScans.set(cleanupToken, { createdAt: Date.now(), root, storageDir, items });
  return scan;
}

async function executeCleanupTargets(payload = {}) {
  const scan = cleanupScans.get(payload.cleanupToken);
  if (!scan) throw new Error('清理令牌无效或已过期，请重新扫描');
  cleanupScans.delete(payload.cleanupToken);
  if (!payload.confirmed) throw new Error('清理需要确认');
  const roots = [
    path.join(scan.root, 'resources'),
    path.join(scan.root, 'tmp-e2e'),
    path.join(scan.root, LOCAL_RUNTIME_DIR),
    scan.root,
    LOCAL_RUNTIME_PATHS.root,
    LOCAL_RUNTIME_PATHS.userData,
    LOCAL_RUNTIME_PATHS.logs
  ];
  if (scan.storageDir) roots.push(safeStoragePath(scan.storageDir, 'media'));
  const deleted = [];
  const failed = [];
  for (const item of scan.items) {
    try {
      const resolved = path.resolve(item.path);
      if (resolved === path.resolve(path.join(scan.root, 'resources', 'app.asar'))) {
        throw new Error('禁止删除当前 app.asar');
      }
      if (resolved === path.resolve(writableCodexCommand()) || resolved === path.resolve(bundledCodexCommand())) {
        throw new Error('禁止删除当前使用的 Codex');
      }
      if (path.basename(resolved) === API_KEY_FILE || path.basename(resolved) === PROVIDER_KEYS_FILE) {
        throw new Error('禁止删除密钥文件');
      }
      const file = safeCleanupPath(item.path, roots);
      await fs.rm(file, { recursive: true, force: true });
      deleted.push(item);
    } catch (err) {
      failed.push({ item, error: err.message || String(err) });
    }
  }
  await appendAppLog('info', 'cleanup executed', { deleted: deleted.length, failed: failed.length });
  return { deleted, failed, summary: cleanupSummary(deleted) };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function mimeFromPath(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  return 'image/png';
}

function safeStoreFile(name) {
  const file = STORE_FILES[name];
  if (!file) throw new Error('不支持的存储文件：' + name);
  return file;
}

function findWindowsAppsCodexCommand() {
  if (process.platform !== 'win32') return '';
  const resourceDir = process.resourcesPath || path.join(path.dirname(app.getPath('exe')), 'resources');
  // Prefer writable user copy, then signed/bundled resources. Avoid machine-specific
  // absolute paths so portable installs keep working on any drive letter.
  const portableCandidates = [
    writableCodexCommand(),
    path.join(resourceDir, 'codex', 'codex.exe'),
    path.join(resourceDir, 'codex.exe'),
    path.join(packagedBaseDir(), 'codex', 'codex.exe')
  ];
  if (INTERNAL_TEST_CHANNELS_ALLOWED) {
    const sharedHome = sharedCodexHomeDir();
    if (sharedHome) {
      portableCandidates.push(
        path.join(sharedHome, '.sandbox-bin', 'codex.exe'),
        path.join(sharedHome, 'plugins', '.plugin-appserver', 'codex.exe')
      );
    }
  }
  const portable = portableCandidates.find(candidate => fsSync.existsSync(candidate));
  if (portable) return portable;
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps'),
    path.join(process.env.PROGRAMFILES || '', 'WindowsApps'),
    path.join(process.env.ProgramW6432 || '', 'WindowsApps')
  ].filter(Boolean);
  for (const root of roots) {
    for (const name of ['codex.exe', 'codex.cmd', 'codex']) {
      const direct = path.join(root, name);
      if (fsSync.existsSync(direct)) return direct;
    }
    let entries = [];
    try {
      entries = fsSync.readdirSync(root, { withFileTypes: true });
    } catch (_err) {
      continue;
    }
    const packages = entries
      .filter(entry => entry.isDirectory() && /^OpenAI\.Codex_/i.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => b.localeCompare(a));
    for (const packageName of packages) {
      const nested = [
        path.join(root, packageName, 'app', 'resources', 'codex.exe'),
        path.join(root, packageName, 'app', 'resources', 'codex'),
        path.join(root, packageName, 'codex.exe')
      ].find(candidate => fsSync.existsSync(candidate));
      if (nested) return nested;
    }
  }
  return '';
}

function normalizeCodexCommand(command) {
  const environmentOverride = INTERNAL_TEST_CHANNELS_ALLOWED ? process.env.CODEX_CLI_PATH : '';
  const resolved = resolveCodexCommandPolicy({
    command,
    environmentOverride,
    internal: INTERNAL_TEST_CHANNELS_ALLOWED,
    bundled: bundledCodexCommand(),
    writable: writableCodexCommand(),
    existsSync: fsSync.existsSync
  });
  if (resolved !== 'codex') return resolved;
  return findWindowsAppsCodexCommand() || resolved;
}

function trimCodexOutput(output) {
  const text = String(output || '');
  return text.length > CODEX_OUTPUT_LIMIT ? text.slice(-CODEX_OUTPUT_LIMIT) : text;
}

function bundledCodexCommand() {
  const resourceDir = process.resourcesPath || path.join(path.dirname(app.getPath('exe')), 'resources');
  const candidates = [
    path.join(resourceDir, 'codex', 'codex.exe'),
    path.join(resourceDir, 'codex.exe'),
    path.join(packagedBaseDir(), 'codex', 'codex.exe')
  ];
  return candidates.find(candidate => fsSync.existsSync(candidate)) || candidates[0];
}

function writableCodexCommand() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, 'codex', 'codex.exe');
}

function codexHomeDir() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, 'codex-home');
}

function sharedCodexHomeDir() {
  const managed = path.join(LOCAL_RUNTIME_PATHS.userData, 'codex-shared');
  if (!INTERNAL_TEST_CHANNELS_ALLOWED) return managed;
  const driveRoot = path.parse(packagedBaseDir()).root;
  const candidates = [
    managed,
    process.env.FUTUREAI_SHARED_CODEX_HOME,
    process.env.CODEX_HOME,
    // Same-drive developer layout only — no hard-coded E: path
    path.join(driveRoot, 'SOFT-AI', '.codex')
  ].filter(Boolean).map(candidate => path.resolve(candidate));
  return candidates.find(candidate => candidate !== path.resolve(codexHomeDir()) && fsSync.existsSync(candidate)) || managed;
}

function frontmatterField(content, field) {
  const frontmatter = String(content || '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const match = frontmatter?.[1]?.match(new RegExp(`^${field}:\\s*["']?([^\\r\\n"']+)`, 'mi'));
  return String(match?.[1] || '').trim();
}

function extensionTomlBlocks(content, enabledPluginIds = null) {
  const blocks = [];
  let active = false;
  let lines = [];
  const flush = () => {
    if (active && lines.length) blocks.push(lines.join('\n').trim());
    lines = [];
  };
  String(content || '').split(/\r?\n/).forEach(line => {
    const heading = line.match(/^\[([^\]]+)\]\s*$/);
    if (heading) {
      flush();
      const plugin = heading[1].match(/^plugins\."?([^"\]]+)"?$/);
      active = /^marketplaces\./.test(heading[1]) || (!!plugin && (!Array.isArray(enabledPluginIds) || enabledPluginIds.includes(plugin[1])));
    }
    if (active) lines.push(line);
  });
  flush();
  return blocks.filter(Boolean).join('\n\n');
}

async function sharedCodexExtensionCatalog({ enabledPluginIds = null } = {}) {
  const root = sharedCodexHomeDir();
  if (!root) return { root: '', skills: [], plugins: [], config: '' };
  const skillsDir = path.join(root, 'skills');
  const configFile = path.join(root, 'config.toml');
  let entries = [];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch (_err) {
    entries = [];
  }
  const skills = (await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(async entry => {
    const file = path.join(skillsDir, entry.name, 'SKILL.md');
    try {
      const content = await fs.readFile(file, 'utf8');
      const name = frontmatterField(content, 'name') || entry.name;
      const description = frontmatterField(content, 'description') || '本机 Codex 技能';
      const id = `local-codex-${crypto.createHash('sha1').update(entry.name).digest('hex').slice(0, 16)}`;
      return { id, name: name.slice(0, 80), description: description.slice(0, 220), prompt: content.slice(0, 12000), source: `本机 Codex · ${file}`, tags: ['本机', 'Skill'] };
    } catch (_err) {
      return null;
    }
  }))).filter(Boolean);
  let config = '';
  try {
    config = await fs.readFile(configFile, 'utf8');
  } catch (_err) {
    config = '';
  }
  const configuredPlugins = [...new Set([...String(config).matchAll(/^\[plugins\."?([^"\]]+)"?\]\s*$/gm)].map(match => match[1]))]
    .map(id => ({ id, name: id.split('@')[0], description: `本机 Codex 插件：${id}`, source: root, enabled: true }));
  const pluginsDir = path.join(root, 'plugins');
  let pluginEntries = [];
  try {
    pluginEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
  } catch (_err) {
    pluginEntries = [];
  }
  const importedPlugins = (await Promise.all(pluginEntries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(async entry => {
    const manifestFile = path.join(pluginsDir, entry.name, '.codex-plugin', 'plugin.json');
    try {
      const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
      const id = String(manifest.id || manifest.name || entry.name).trim().replace(/[^a-zA-Z0-9._:@-]/g, '-');
      return { id, name: String(manifest.name || id).slice(0, 100), description: String(manifest.description || `本机插件：${id}`).slice(0, 240), source: manifestFile, enabled: true };
    } catch (_err) {
      return null;
    }
  }))).filter(Boolean);
  const plugins = [...new Map([...configuredPlugins, ...importedPlugins].map(plugin => [plugin.id, plugin])).values()];
  return { root, skills, plugins, config: extensionTomlBlocks(config, enabledPluginIds) };
}

function extensionImportKind(kind) {
  return String(kind || '').toLowerCase() === 'plugin' ? 'plugin' : 'skill';
}

function extensionImportRoot(kind) {
  return path.join(sharedCodexHomeDir(), extensionImportKind(kind) === 'plugin' ? 'plugins' : 'skills');
}

function safeExtensionFolderName(value, fallback = 'imported-extension') {
  const name = path.basename(String(value || '').replace(/[\\/]+$/, ''))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return name || fallback;
}

function extensionMarker(kind) {
  return extensionImportKind(kind) === 'plugin' ? path.join('.codex-plugin', 'plugin.json') : 'SKILL.md';
}

async function findExtensionFolderRoot(source, kind) {
  const marker = extensionMarker(kind);
  const direct = path.join(source, marker);
  try {
    if ((await fs.stat(direct)).isFile()) return source;
  } catch (_err) {
    // Try a single enclosing folder, which is how most downloaded packages are structured.
  }
  const entries = await fs.readdir(source, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      if ((await fs.stat(path.join(source, entry.name, marker))).isFile()) candidates.push(path.join(source, entry.name));
    } catch (_err) {
      // Ignore unrelated folders.
    }
  }
  if (candidates.length === 1) return candidates[0];
  throw new Error(extensionImportKind(kind) === 'plugin' ? '所选文件夹缺少 .codex-plugin/plugin.json' : '所选文件夹缺少 SKILL.md');
}

async function copyExtensionFolder(source, kind) {
  const packageRoot = await findExtensionFolderRoot(source, kind);
  const targetRoot = extensionImportRoot(kind);
  await ensureDir(targetRoot);
  const target = path.join(targetRoot, safeExtensionFolderName(path.basename(packageRoot)));
  if (!pathInside(targetRoot, target)) throw new Error('扩展名称无效');
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(packageRoot, target, { recursive: true, force: true });
  return { target, kind: extensionImportKind(kind) };
}

async function extractExtensionZip(source, kind) {
  const bytes = await fs.readFile(source);
  if (bytes.length > 80 * 1024 * 1024) throw new Error('扩展 ZIP 不能超过 80 MB');
  const entries = readZipEntries(bytes, { maxEntries: 4096, maxUncompressedBytes: 160 * 1024 * 1024 });
  const marker = extensionMarker(kind).replace(/\\/g, '/').toLowerCase();
  const files = entries.filter(entry => entry?.data && !String(entry.name || '').endsWith('/')).map(entry => ({...entry, name: String(entry.name || '').replace(/\\/g, '/') }));
  const markerEntry = files.find(entry => entry.name.toLowerCase() === marker || entry.name.toLowerCase().endsWith(`/${marker}`));
  if (!markerEntry) throw new Error(extensionImportKind(kind) === 'plugin' ? 'ZIP 中缺少 .codex-plugin/plugin.json' : 'ZIP 中缺少 SKILL.md');
  const markerIndex = markerEntry.name.toLowerCase().lastIndexOf(marker);
  const prefix = markerIndex > 0 ? markerEntry.name.slice(0, markerIndex) : '';
  const fallback = path.basename(source, path.extname(source));
  const targetRoot = extensionImportRoot(kind);
  await ensureDir(targetRoot);
  const target = path.join(targetRoot, safeExtensionFolderName(prefix.split('/').filter(Boolean).pop() || fallback));
  await fs.rm(target, { recursive: true, force: true });
  for (const entry of files) {
    if (prefix && !entry.name.startsWith(prefix)) continue;
    const relative = (prefix ? entry.name.slice(prefix.length) : entry.name).replace(/^\/+/, '');
    const normalized = path.posix.normalize(relative);
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || /^[a-zA-Z]:/.test(normalized)) throw new Error('ZIP 包含不安全路径');
    const destination = path.join(target, ...normalized.split('/'));
    if (!pathInside(target, destination)) throw new Error('ZIP 路径超出扩展目录');
    await ensureDir(path.dirname(destination));
    await fs.writeFile(destination, entry.data);
  }
  return { target, kind: extensionImportKind(kind) };
}

async function importCodexExtension(kind, source) {
  const normalizedKind = extensionImportKind(kind);
  const input = path.resolve(String(source || '').trim());
  if (!input) throw new Error('没有选择扩展文件');
  const stats = await fs.stat(input);
  const result = stats.isDirectory() ? await copyExtensionFolder(input, normalizedKind) : await extractExtensionZip(input, normalizedKind);
  const catalog = await sharedCodexExtensionCatalog();
  return { ...result, root: catalog.root, skills: catalog.skills, plugins: catalog.plugins };
}

function tomlQuoted(value) {
  return JSON.stringify(String(value ?? ''));
}

async function codexLaunchEnv({ apiKey = '', baseUrl = '', model = '', useSharedExtensions = true, sharedPluginIds = null } = {}) {
  const home = codexHomeDir();
  await ensureDir(home);
  const configFile = path.join(home, 'config.toml');
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/$/, '');
  const extensions = useSharedExtensions ? await sharedCodexExtensionCatalog({ enabledPluginIds: sharedPluginIds }) : { config: '' };
  if (normalizedBaseUrl) {
    const config = [
      model ? `model = ${tomlQuoted(model)}` : '',
      'model_provider = "future_ai_provider"',
      '',
      '[model_providers.future_ai_provider]',
      'name = "future_ai_provider"',
      'wire_api = "responses"',
      'requires_openai_auth = false',
      'env_key = "OPENAI_API_KEY"',
      `base_url = ${tomlQuoted(normalizedBaseUrl)}`,
      extensions.config,
      ''
    ].filter(Boolean).join('\n');
    await fs.writeFile(configFile, config, 'utf8');
  } else if (extensions.config) {
    await fs.writeFile(configFile, extensions.config + '\n', 'utf8');
  } else {
    await fs.rm(configFile, { force: true });
  }
  // Do not inherit a developer's global Codex home: its plugins and agent files
  // are unrelated to this application's assistant and can break every run.
  const env = { ...process.env, CODEX_HOME: home, NO_COLOR: '1' };
  delete env.OPENAI_BASE_URL;
  delete env.OPENAI_MODEL;
  if (apiKey) env.OPENAI_API_KEY = String(apiKey);
  else delete env.OPENAI_API_KEY;
  return env;
}

async function ensureWritableCodexCommand() {
  const target = writableCodexCommand();
  if (fsSync.existsSync(target)) return target;
  const bundled = bundledCodexCommand();
  if (!fsSync.existsSync(bundled)) return bundled;
  await ensureDir(path.dirname(target));
  await fs.copyFile(bundled, target);
  return target;
}

function codexBackupsDir() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, 'codex-backups');
}

async function pruneCodexBackups() {
  const items = await listTimestampedBackups(codexBackupsDir(), /^codex\.exe\.\d{8}-\d{6}$/);
  const stale = items.slice(CODEX_BACKUP_LIMIT);
  await Promise.all(stale.map(item => fs.rm(item.file, { force: true })));
  return stale.length;
}

async function pruneRuntimeDiskFootprint() {
  try {
    const codexRemoved = await pruneCodexBackups();
    const updateRemoved = await pruneUpdateAsarBackups();
    if (codexRemoved || updateRemoved) {
      await appendAppLog('info', 'runtime disk footprint pruned', {
        codexBackupsRemoved: codexRemoved,
        updateAsarBackupsRemoved: updateRemoved,
        codexBackupLimit: CODEX_BACKUP_LIMIT,
        updateAsarBackupLimit: UPDATE_ASAR_BACKUP_LIMIT
      });
    }
  } catch (error) {
    await appendAppLog('warn', 'runtime disk footprint prune failed', {
      message: error?.message || String(error)
    });
  }
}

function sendCodexOutput(sender, payload) {
  if (!sender || sender.isDestroyed?.()) return;
  sender.send('codex:output', payload);
}

function codexActivityFromJsonLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch (_err) {
    return '';
  }
  const payload = event?.payload || {};
  if (event?.type === 'event_msg') {
    if (payload.type === 'agent_message' && payload.message) return String(payload.message).replace(/\s+/g, ' ').trim().slice(0, 180);
    if (payload.type === 'patch_apply_end' && payload.success) return `已修改 ${Object.keys(payload.changes || {}).length || 1} 个文件`;
    if (payload.type === 'task_complete') return '任务执行完成，正在整理结果';
  }
  if (event?.type === 'response_item' && payload.type === 'function_call') {
    return payload.name === 'shell_command' ? '正在执行终端命令' : `正在调用 ${payload.name || '工具'}`;
  }
  return '';
}

function codexPermissionConfig(mode) {
  const key = normalizeCodexPermission(mode, { internal: INTERNAL_TEST_CHANNELS_ALLOWED });
  if (key === 'readonly') return { sandbox: 'read-only', approval: 'never', label: '只读审查' };
  if (key === 'full') return { sandbox: 'danger-full-access', approval: 'never', label: '完全开发' };
  return { sandbox: 'workspace-write', approval: 'never', label: '项目内开发' };
}

async function confirmInternalFullCodexRun(event) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(owner, {
    type: 'warning',
    title: '确认完全开发权限',
    message: '本次 Codex 任务可以访问和修改工作目录之外的文件。',
    detail: '仅在你理解任务内容和风险时继续。此确认只对本次运行有效。',
    buttons: ['取消', '继续运行'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (result.response !== 1) throw new Error('已取消完全开发权限任务');
}

async function runCodexCheck(command) {
  const env = await codexLaunchEnv();
  return new Promise(resolve => {
    let child;
    let output = '';
    try {
      child = spawn(normalizeCodexCommand(command), ['--version'], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
      return;
    }
    const done = result => resolve({ ...result, output: trimCodexOutput(output).trim() });
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, error: '检测超时' });
    }, 8000);
    child.stdout?.on('data', data => { output += data.toString(); });
    child.stderr?.on('data', data => { output += data.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      done({ ok: false, error: err?.message || String(err) });
    });
    child.on('close', code => {
      clearTimeout(timer);
      done({ ok: code === 0, code, error: code === 0 ? '' : 'Codex CLI 未正常返回' });
    });
  });
}

async function backupBundledCodex(command) {
  const source = path.resolve(command || bundledCodexCommand());
  if (!fsSync.existsSync(source)) return '';
  const allowedDirs = [path.dirname(bundledCodexCommand()), path.dirname(writableCodexCommand())].map(item => path.resolve(item));
  if (!allowedDirs.some(dir => pathInside(dir, source))) return '';
  const dir = codexBackupsDir();
  await ensureDir(dir);
  const backupFile = path.join(dir, `codex.exe.${timestampForBackup()}`);
  await fs.copyFile(source, backupFile);
  await pruneCodexBackups();
  return backupFile;
}

async function runCodexUpdate(event, payload = {}) {
  if (!codexSelfUpdateAllowed({ internal: INTERNAL_TEST_CHANNELS_ALLOWED })) throw new Error('正式版 Codex 随软件签名更新，不支持单独替换');
  const command = payload.command ? normalizeCodexCommand(payload.command) : await ensureWritableCodexCommand();
  const before = await runCodexCheck(command);
  const backupFile = await backupBundledCodex(command);
  const sessionId = crypto.randomUUID();
  const sender = event.sender;
  const env = await codexLaunchEnv();
  let child;
  try {
    child = spawn(command, ['update'], { cwd: path.dirname(command), env, windowsHide: true });
  } catch (err) {
    throw new Error(err?.message || String(err));
  }
  codexSessions.set(sessionId, child);
  sendCodexOutput(sender, { sessionId, type: 'start', text: `Codex 更新开始\n当前版本：${before.output || '未知'}\n${backupFile ? `已备份：${backupFile}\n` : ''}` });
  const append = (type, data) => sendCodexOutput(sender, { sessionId, type, text: data.toString() });
  child.stdout?.on('data', data => append('stdout', data));
  child.stderr?.on('data', data => append('stderr', data));
  child.on('error', err => {
    codexSessions.delete(sessionId);
    sendCodexOutput(sender, { sessionId, type: 'error', text: err?.message || String(err) });
  });
  child.on('close', async code => {
    codexSessions.delete(sessionId);
    const after = await runCodexCheck(command).catch(err => ({ ok: false, output: '', error: err?.message || String(err) }));
    sendCodexOutput(sender, { sessionId, type: 'close', code, text: code === 0 ? `\nCodex 更新完成。当前版本：${after.output || '未知'}\n` : `\nCodex 更新结束，退出码：${code}\n${after.error || ''}` });
  });
  return { ok: true, sessionId, beforeVersion: before.output || '', backupFile };
}

async function startCodexRun(event, payload = {}) {
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) throw new Error('请先输入要交给 Codex 的任务');
  if (prompt.length > CODEX_PROMPT_LIMIT) throw new Error('任务内容过长，请拆成更小的任务');
  const cwd = payload.storageDir ? await ensureStorageRootAllowed(payload.storageDir) : packagedBaseDir();
  const sessionId = crypto.randomUUID();
  const requestedPermission = normalizeCodexPermission(payload.permission, { internal: INTERNAL_TEST_CHANNELS_ALLOWED, scheduled: payload.scheduled === true });
  if (requestedPermission === 'full' && INTERNAL_TEST_CHANNELS_ALLOWED) await confirmInternalFullCodexRun(event);
  const permission = codexPermissionConfig(requestedPermission);
  const model = String(payload.model || '').trim();
  const resultDir = path.join(codexHomeDir(), 'results');
  await ensureDir(resultDir);
  const resultFile = path.join(resultDir, `${sessionId}.txt`);
  await fs.rm(resultFile, { force: true });
  const args = ['exec', '--skip-git-repo-check', '--sandbox', permission.sandbox];
  if (model) args.push('--model', model);
  args.push('--json');
  args.push('--output-last-message', resultFile);
  args.push(prompt);
  const env = await codexLaunchEnv({ apiKey: payload.apiKey, baseUrl: payload.baseUrl, model, useSharedExtensions: payload.useSharedExtensions !== false, sharedPluginIds: Array.isArray(payload.sharedPluginIds) ? payload.sharedPluginIds : null });
  let child;
  try {
    child = spawn(normalizeCodexCommand(payload.command), args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(err?.message || String(err));
  }
  codexSessions.set(sessionId, child);
  const sender = event.sender;
  const runTimer = setTimeout(() => {
    if (!codexSessions.has(sessionId)) return;
    codexSessions.delete(sessionId);
    try {
      child.kill();
    } catch (_err) {
      // The process may have already exited between the timeout and kill attempt.
    }
    sendCodexOutput(sender, { sessionId, type: 'error', text: `Codex 任务超过 ${Math.round(CODEX_RUN_TIMEOUT_MS / 60000)} 分钟仍未结束，已停止。请把任务拆分后重试。` });
  }, CODEX_RUN_TIMEOUT_MS);
  child.__futureAiRunTimer = runTimer;
  let output = '';
  let jsonBuffer = '';
  const append = (type, data) => {
    const text = data.toString();
    output = trimCodexOutput(output + text);
    if (type === 'stdout') {
      jsonBuffer += text;
      const lines = jsonBuffer.split(/\r?\n/);
      jsonBuffer = lines.pop() || '';
      lines.forEach(line => {
        const activity = codexActivityFromJsonLine(line);
        if (activity) sendCodexOutput(sender, { sessionId, type: 'activity', text: activity });
      });
    }
    sendCodexOutput(sender, { sessionId, type, text });
  };
  sendCodexOutput(sender, { sessionId, type: 'start', text: `工作目录：${cwd}\n开发权限：${permission.label}\n模型：${model || 'Codex 默认'}\nAPI：${payload.baseUrl ? '已接入' : '使用 Codex 默认'}\n` });
  child.stdout?.on('data', data => append('stdout', data));
  child.stderr?.on('data', data => append('stderr', data));
  child.on('error', err => {
    clearTimeout(runTimer);
    codexSessions.delete(sessionId);
    sendCodexOutput(sender, { sessionId, type: 'error', text: err?.message || String(err) });
  });
  child.on('close', async code => {
    clearTimeout(runTimer);
    codexSessions.delete(sessionId);
    let result = '';
    try {
      result = (await fs.readFile(resultFile, 'utf8')).trim();
    } catch (_err) {
      // A failed run may not produce a final-message file.
    }
    await fs.rm(resultFile, { force: true }).catch(() => {});
    if (result) sendCodexOutput(sender, { sessionId, type: 'result', text: result });
    sendCodexOutput(sender, { sessionId, type: 'close', code, text: code === 0 ? '\n任务完成。' : `\n任务结束，退出码：${code}` });
  });
  return { ok: true, sessionId };
}

function cancelCodexRun(sessionId) {
  const id = String(sessionId || '');
  const child = codexSessions.get(id);
  if (!child) return false;
  if (child.__futureAiRunTimer) clearTimeout(child.__futureAiRunTimer);
  child.kill();
  codexSessions.delete(id);
  return true;
}

function musicSearchTerms(query = '') {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return 'cinematic OR piano OR ambient OR electronic';
  const mapped = text
    .replace(/电影感|电影|影视|镜头|导演/g, 'cinematic')
    .replace(/钢琴|温柔|抒情/g, 'piano')
    .replace(/氛围|环境|空灵/g, 'ambient')
    .replace(/紧张|悬疑/g, 'suspense')
    .replace(/快乐|轻快/g, 'upbeat')
    .replace(/电子/g, 'electronic')
    .replace(/听歌|流行|热歌/g, 'pop')
    .replace(/摇滚/g, 'rock')
    .replace(/民谣/g, 'folk')
    .replace(/爵士/g, 'jazz')
    .replace(/说唱|嘻哈/g, 'hip hop')
    .replace(/古风/g, 'chinese traditional')
    .replace(/放松|助眠|白噪音/g, 'lofi chill')
    .replace(/工作/g, 'focus');
  return mapped.split(/\s+/).filter(Boolean).slice(0, 6).join(' OR ');
}

function normalizedMusicSearchQuery(query = '') {
  return String(query || '').trim().toLowerCase()
    .replace(/\u7535\u5f71\u611f|\u7535\u5f71|\u5f71\u89c6|\u9884\u544a\u7247/g, ' cinematic soundtrack ')
    .replace(/\u94a2\u7434|\u6e29\u67d4|\u6292\u60c5/g, ' piano instrumental ')
    .replace(/\u6c1b\u56f4|\u73af\u5883|\u7a7a\u7075/g, ' ambient soundscape ')
    .replace(/\u7d27\u5f20|\u60ac\u7591|\u5371\u9669/g, ' suspense tension ')
    .replace(/\u8f7b\u5feb|\u5feb\u4e50|\u6d3b\u6cfc/g, ' upbeat happy ')
    .replace(/\u7535\u5b50|\u79d1\u6280/g, ' electronic synth ')
    .replace(/\u542c\u6b4c|\u6d41\u884c|\u70ed\u6b4c/g, ' pop ')
    .replace(/\u6447\u6eda/g, ' rock ')
    .replace(/\u6c11\u8c23/g, ' folk ')
    .replace(/\u7235\u58eb/g, ' jazz ')
    .replace(/\u8bf4\u5531|\u565c\u54c8/g, ' hip hop ')
    .replace(/\u53e4\u98ce/g, ' chinese traditional ')
    .replace(/\u653e\u677e|\u52a9\u7720|\u767d\u566a\u97f3/g, ' lofi chill ')
    .replace(/\u5de5\u4f5c/g, ' focus instrumental ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedVideoSearchQuery(query = '') {
  const text = String(query || '').trim().toLowerCase();
  if (/^(?:nature|natural|\u81ea\u7136|\u98ce\u666f|\u5c71\u6c34)$/.test(text)) return 'nature landscape wildlife';
  if (/\u57ce\u5e02|city|urban/.test(text)) return 'city urban architecture';
  if (/\u7eaa\u5f55\u7247|documentary/.test(text)) return 'documentary nature culture';
  if (/\u68ee\u6797|forest/.test(text)) return 'forest wildlife';
  if (/\u6d77\u6d0b|ocean|sea/.test(text)) return 'ocean marine nature';
  return text || 'nature landscape wildlife';
}

const MUSIC_BAD_AUDIO_RE = /podcast|episode|interview|commentary|lecture|talk show|audiobook|sermon|speech|radio show|phone call|field recording|news|reading|lesson|class|conference|porn|sexy/i;
const MUSIC_GOOD_AUDIO_RE = /music|instrumental|soundtrack|score|cinematic|piano|ambient|electronic|background|royalty free|creative commons|no copyright|loop|track|song|beat|chill|orchestral|synth|drone|soundscape/i;
const MUSIC_LICENSE_HINT_RE = /creative commons|public domain|royalty free|free music|free download|no copyright|cc-by|cc0|\u514d\u7248\u6743|\u514d\u8d39\u97f3\u4e50|\u514d\u8d39\u4e0b\u8f7d|\u53ef\u5546\u7528|\u516c\u6709\u9886\u57df/i;
const MUSIC_BLOCKED_HOST_RE = /(^|\.)(google|baidu|youtube|youtu|spotify|music\.163|qq|kugou|kuwo|xiami|bilibili|douyin|tiktok|facebook|instagram|x)\./i;
const MUSIC_COLLECTIONS = ['netlabels', 'audio_music', 'opensource_audio'];
const MUSIC_NAME_ALIASES = {
  '王力宏': ['Wang Leehom', 'Leehom Wang'],
  '周杰伦': ['Jay Chou'],
  '林俊杰': ['JJ Lin'],
  '陈奕迅': ['Eason Chan'],
  '邓紫棋': ['G.E.M.', 'Gem Tang'],
  '张学友': ['Jacky Cheung'],
  '蔡依林': ['Jolin Tsai'],
  '孙燕姿': ['Stefanie Sun'],
  '陶喆': ['David Tao'],
  '五月天': ['Mayday']
};
const MUSIC_SOURCE_PLUGINS = [
  { id: 'audius', name: 'Audius', source: 'Audius Open Streaming', description: '开放音乐曲库', capability: 'music.stream', rightsMode: 'platform-stream', termsUrl: 'https://docs.audius.org/', loginRequired: false, enabled: true },
  { id: 'ccmixter', name: 'ccMixter', source: 'Open Music Remix Library', description: '独立音乐与混音曲库', capability: 'music.stream', rightsMode: 'open-license', termsUrl: 'https://ccmixter.org/terms', loginRequired: false, enabled: true },
  { id: 'archive', name: 'Internet Archive Audio', source: 'Internet Archive', description: '音频档案与音乐收藏', capability: 'music.stream', rightsMode: 'open-license', termsUrl: 'https://help.archive.org/help/rights/', loginRequired: false, enabled: true },
  { id: 'wikimedia', name: 'Wikimedia Commons', source: 'Wikimedia Commons', description: '自由授权音频资料库', capability: 'music.stream', rightsMode: 'open-license', termsUrl: 'https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia', loginRequired: false, enabled: true },
  { id: 'radio', name: 'Radio Browser', source: 'radio-browser.info', description: '网络电台目录', capability: 'music.radio', rightsMode: 'platform-stream', termsUrl: 'https://www.radio-browser.info/', loginRequired: false, enabled: true }
];
const MUSIC_PLUGIN_IDS = new Set(MUSIC_SOURCE_PLUGINS.map(plugin => plugin.id));
const MUSICFREE_COMPATIBLE_PROTOCOL_VERSION = 1;
const musicSourcePolicy = createMusicSourcePolicy();

// MusicFree-inspired plugin metadata, implemented locally without loading third-party code.
// Plugins remain declarative and all network work stays in this trusted main process.
function musicFreeCompatibleManifest(plugin = {}) {
  return {
    platform: plugin.id,
    name: plugin.name,
    version: '1.0.0',
    protocolVersion: MUSICFREE_COMPATIBLE_PROTOCOL_VERSION,
    primaryKey: ['id', 'url'],
    defaultSearchType: 'music',
    supportedSearchType: ['music'],
    actions: ['search', 'getMediaSource'],
    cacheControl: 'no-store',
    source: plugin.source,
    rightsMode: plugin.rightsMode,
    termsUrl: plugin.termsUrl,
    downloadAllowed: false,
    exportAllowed: false,
    loginRequired: false,
    enabled: plugin.enabled !== false
  };
}

function musicPluginCatalog() {
  return MUSIC_SOURCE_PLUGINS.map(plugin => ({ ...plugin, manifest: musicFreeCompatibleManifest(plugin) }));
}

function musicFreeCompatibleRegistry() {
  return {
    protocol: 'futureai-musicfree-compatible',
    version: MUSICFREE_COMPATIBLE_PROTOCOL_VERSION,
    plugins: musicPluginCatalog()
  };
}

function musicFreeCompatibleResolveTrack(payload = {}) {
  return musicSourcePolicy.resolve(payload);
}

function normalizeMusicSourceIds(sourceIds, fallbackIds = MUSIC_SOURCE_PLUGINS.filter(plugin => plugin.enabled).map(plugin => plugin.id)) {
  if (Array.isArray(sourceIds)) return [...new Set(sourceIds.filter(id => MUSIC_PLUGIN_IDS.has(id)))];
  return fallbackIds.filter(id => MUSIC_PLUGIN_IDS.has(id));
}

function musicQueryProfile(query = '') {
  const text = String(query || '').trim().toLowerCase();
  const profiles = [
    { test: /电影|影视|镜头|导演|史诗|预告|cinematic|film|movie|trailer|score|soundtrack/i, terms: ['cinematic', 'soundtrack', 'film score', 'orchestral', 'background', 'instrumental', 'epic'] },
    { test: /钢琴|温柔|抒情|治愈|piano|soft|lyrical/i, terms: ['piano', 'solo piano', 'instrumental', 'soft', 'calm'] },
    { test: /氛围|环境|空灵|冥想|ambient|atmosphere|meditation/i, terms: ['ambient', 'soundscape', 'drone', 'atmospheric', 'background'] },
    { test: /紧张|悬疑|危险|恐怖|suspense|tension|dark|horror/i, terms: ['suspense', 'dark ambient', 'tension', 'cinematic', 'soundtrack'] },
    { test: /快乐|轻快|活泼|upbeat|happy|bright/i, terms: ['upbeat', 'happy', 'bright', 'pop', 'instrumental'] },
    { test: /电子|赛博|科技|electronic|synth|techno/i, terms: ['electronic', 'synth', 'ambient', 'downtempo', 'instrumental'] },
    { test: /听歌|流行|热歌|pop/i, terms: ['pop', 'indie pop', 'vocal', 'song'] },
    { test: /摇滚|rock/i, terms: ['rock', 'indie rock', 'guitar'] },
    { test: /民谣|folk/i, terms: ['folk', 'acoustic', 'guitar'] },
    { test: /爵士|jazz/i, terms: ['jazz', 'smooth jazz', 'instrumental'] },
    { test: /说唱|嘻哈|hip ?hop|rap/i, terms: ['hip hop', 'rap', 'beats'] },
    { test: /古风|国风/i, terms: ['chinese', 'traditional', 'guzheng', 'erhu'] },
    { test: /放松|助眠|白噪音|lofi|chill/i, terms: ['lofi', 'chill', 'sleep', 'ambient'] },
    { test: /工作|专注|focus/i, terms: ['focus', 'study', 'instrumental', 'lofi'] }
  ];
  const matched = profiles.find(profile => profile.test.test(text));
  const typedTerms = text
    .replace(/电影|影视|镜头|导演|史诗|预告/g, ' cinematic soundtrack ')
    .replace(/钢琴|温柔|抒情|治愈/g, ' piano instrumental ')
    .replace(/氛围|环境|空灵|冥想/g, ' ambient soundscape ')
    .replace(/紧张|悬疑|危险|恐怖/g, ' suspense tension ')
    .replace(/快乐|轻快|活泼/g, ' upbeat happy ')
    .replace(/电子|赛博|科技/g, ' electronic synth ')
    .split(/[^\p{L}\p{N}]+/u)
    .map(term => term.trim())
    .filter(term => term.length > 1)
    .slice(0, 8);
  const terms = [...new Set([...(matched?.terms || []), ...typedTerms, 'music', 'instrumental'])].slice(0, 12);
  return { raw: text || '电影感', terms, phrase: terms.map(term => `\"${term}\"`).join(' OR ') };
}

function musicDocText(doc = {}, fileName = '') {
  const subject = Array.isArray(doc.subject) ? doc.subject.join(' ') : doc.subject || '';
  const creator = Array.isArray(doc.creator) ? doc.creator.join(' ') : doc.creator || '';
  return `${doc.title || ''} ${creator} ${subject} ${doc.description || ''} ${fileName}`.toLowerCase();
}

function musicRelevanceScore(doc, profile, fileName = '') {
  const text = musicDocText(doc, fileName);
  if (!text.trim()) return -20;
  if (MUSIC_BAD_AUDIO_RE.test(text)) return -30;
  const joinedTerms = (profile?.terms || []).join(' ');
  if (/piano|solo piano/i.test(joinedTerms) && !/piano/i.test(text)) return -8;
  if (/ambient|soundscape|drone/i.test(joinedTerms) && !/ambient|soundscape|drone/i.test(text)) return -8;
  if (/cinematic|soundtrack|film score|orchestral/i.test(joinedTerms) && !/cinematic|soundtrack|film score|score|orchestral/i.test(text)) return -8;
  let score = 0;
  for (const term of profile.terms) {
    const normalized = term.toLowerCase();
    if (text.includes(normalized)) score += normalized.includes(' ') ? 8 : 5;
  }
  if (MUSIC_GOOD_AUDIO_RE.test(text)) score += 8;
  if (/creative commons|public domain|royalty free|no copyright/i.test(text)) score += 4;
  if (/\.(mp3|ogg|m4a)$/i.test(fileName)) score += 3;
  if (/78rpm|karaoke|christmas|hymn|speech|podcast/i.test(text)) score -= 8;
  return score;
}

function archiveDownloadUrl(identifier, fileName) {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName).replace(/%2F/g, '/')}`;
}

async function archivePlayableFile(identifier) {
  const response = await mediaFetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, { headers: { 'User-Agent': 'FutureAI-Music-Player' } });
  if (!response.ok) return null;
  const data = await response.json();
  const files = Array.isArray(data.files) ? data.files : [];
  if (arguments.length < 3) {
    return files.find(file => /\.(mp3|ogg|m4a)$/i.test(file.name || '') && !/_64kb\./i.test(file.name || ''))
      || files.find(file => /\.(mp3|ogg|m4a)$/i.test(file.name || ''))
      || null;
  }
  const profile = arguments[1];
  const doc = arguments[2];
  const playable = files
    .filter(file => /\.(mp3|ogg|m4a)$/i.test(file.name || ''))
    .filter(file => !/_64kb\./i.test(file.name || ''))
    .map(file => ({ file, score: musicRelevanceScore(doc, profile, file.name || '') }))
    .filter(item => item.score > -10)
    .sort((a, b) => b.score - a.score);
  return playable[0]?.file || files.find(file => /\.(mp3|ogg|m4a)$/i.test(file.name || '')) || null;
}

async function searchFreeMusic(payload = {}) {
  return await searchFreeMusicV2(payload);
  const query = String(payload.query || '').trim().slice(0, 80);
  const page = Math.max(1, Number(payload.page || 1) || 1);
  const response = await mediaFetch(url, { headers: { 'User-Agent': 'FutureAI-Music-Player' } });
  if (!response.ok) throw new Error(`音乐搜索失败：${response.status}`);
  const data = await response.json();
  const docs = data?.response?.docs || [];
  const tracks = [];
  for (const doc of docs) {
    const file = await archivePlayableFile(doc.identifier).catch(() => null);
    if (!file) continue;
    tracks.push({
      id: `archive-${doc.identifier}-${file.name}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120),
      title: String(doc.title || file.name || '免费音乐').slice(0, 120),
      artist: String(doc.creator || '未知作者').slice(0, 80),
      source: 'Internet Archive',
      license: String(doc.licenseurl || '请打开来源确认授权').slice(0, 180),
      year: String(doc.date || '').slice(0, 10),
      url: archiveDownloadUrl(doc.identifier, file.name),
      pageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      fileName: file.name,
      size: Number(file.size || 0)
    });
  }
  return { query, page, source: 'Internet Archive', tracks, total: Number(data?.response?.numFound || 0) };
}

function ccmixterSearchTerm(profile) {
  const literal = musicLiteralTerms(arguments[1] || '');
  if (literal.length && musicRequiresLiteralMatch(arguments[1] || '')) return literal.join(' ');
  const joined = (profile?.terms || []).join(' ').toLowerCase();
  if (/piano/.test(joined)) return 'piano';
  if (/ambient|soundscape|drone/.test(joined)) return 'ambient';
  if (/suspense|tension|dark/.test(joined)) return 'dark ambient';
  if (/upbeat|happy|bright/.test(joined)) return 'upbeat instrumental';
  if (/electronic|synth|techno/.test(joined)) return 'electronic instrumental';
  return 'cinematic music for film';
}

function musicSearchVariants(query = '') {
  const original = String(query || '').trim();
  const aliases = MUSIC_NAME_ALIASES[original] || [];
  const normalized = normalizedMusicSearchQuery(original);
  const profileTerms = (musicQueryProfile(original).terms || []).slice(0, 3);
  return [...new Set([original, ...aliases, normalized, ...profileTerms].filter(Boolean))].slice(0, 5);
}

function ccmixterTrackText(item = {}, file = {}) {
  return `${item.upload_name || ''} ${item.user_name || ''} ${item.user_real_name || ''} ${item.upload_tags || ''} ${item.upload_extra?.usertags || ''} ${item.upload_description_plain || ''} ${file.file_name || ''}`.toLowerCase();
}

function musicLiteralTerms(query = '') {
  const originalTerms = String(query || '')
    .trim()
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map(term => term.trim())
    .filter(term => term.length > 1)
    .filter(term => !['music', 'free', 'audio', 'song', 'track', 'instrumental'].includes(term))
    .slice(0, 5);
  const aliasTerms = musicSearchVariants(query)
    .slice(1)
    .flatMap(value => String(value).toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 1));
  return [...new Set([...originalTerms, ...aliasTerms])].slice(0, 8);
}

function musicIsStyleQuery(query = '') {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return true;
  return /cinematic|film|movie|trailer|score|soundtrack|piano|ambient|atmosphere|meditation|suspense|tension|dark|horror|upbeat|happy|bright|electronic|synth|techno|pop|rock|folk|jazz|lofi|chill|focus|hip ?hop|\u7535\u5f71|\u5f71\u89c6|\u955c\u5934|\u5bfc\u6f14|\u94a2\u7434|\u6e29\u67d4|\u6292\u60c5|\u6c1b\u56f4|\u73af\u5883|\u7a7a\u7075|\u7d27\u5f20|\u60ac\u7591|\u5feb\u4e50|\u8f7b\u5feb|\u7535\u5b50|\u542c\u6b4c|\u6d41\u884c|\u6447\u6eda|\u6c11\u8c23|\u7235\u58eb|\u8bf4\u5531|\u53e4\u98ce|\u653e\u677e|\u52a9\u7720|\u5de5\u4f5c/.test(text);
}

function musicRequiresLiteralMatch(query = '') {
  return musicLiteralTerms(query).length > 0 && !musicIsStyleQuery(query);
}

function musicMatchesLiteralTerms(text, terms) {
  if (!terms.length) return true;
  const normalized = String(text || '').toLowerCase();
  return terms.some(term => normalized.includes(term));
}

function musicTrackMatchesLiteralTerms(track, terms) {
  if (!terms.length) return true;
  const text = `${track?.title || ''} ${track?.artist || ''} ${track?.fileName || ''} ${track?.source || ''}`.toLowerCase();
  return terms.every(term => text.includes(String(term || '').toLowerCase()));
}

function ccmixterRelevanceScore(item, file, profile) {
  const text = ccmixterTrackText(item, file);
  if (!text.trim() || MUSIC_BAD_AUDIO_RE.test(text)) return -30;
  const literalTerms = Array.isArray(arguments[3]) ? arguments[3] : [];
  if (literalTerms.length && !musicMatchesLiteralTerms(text, literalTerms)) return -30;
  let score = 16;
  for (const term of profile.terms || []) {
    const normalized = term.toLowerCase().replace(/\s+/g, '_');
    if (text.includes(term.toLowerCase()) || text.includes(normalized)) score += term.includes(' ') ? 8 : 5;
  }
  if (/music_for_video|music_for_film|background_music|instrumental|soundtrack|cinematic|ambient|piano/i.test(text)) score += 12;
  if (/non_commercial|ccplus|creative commons|attribution/i.test(text)) score += 4;
  score += Math.min(8, Number(item.upload_num_scores || 0) / 2);
  return score;
}

async function searchCcmixterMusic(profile) {
  const query = arguments[1] || '';
  const literalTerms = musicRequiresLiteralMatch(query) ? musicLiteralTerms(query) : [];
  const searchp = encodeURIComponent(ccmixterSearchTerm(profile, query));
  const url = `https://ccmixter.org/api/query?searchp=${searchp}&limit=24&f=json`; 
  const response = await mediaFetch(url, { headers: { 'User-Agent': 'FutureAI-Music-Player' } });
  if (!response.ok) return [];
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map(item => {
    const file = (Array.isArray(item.files) ? item.files : []).find(candidate => /\.mp3$/i.test(candidate.file_name || '') && candidate.download_url);
    if (!file) return null;
    const score = ccmixterRelevanceScore(item, file, profile, literalTerms);
    if (score < 16) return null;
    const rights = openMusicRights(item.license_name, item.license_url);
    if (!rights) return null;
    const artist = item.user_real_name || item.user_name || '未知作者';
    return {
      id: `ccmixter-${item.upload_id}-${file.file_id || file.file_name}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120),
      title: String(item.upload_name || file.file_name || '免费音乐').slice(0, 120),
      artist: String(artist).slice(0, 80),
      source: 'ccMixter 免费音乐库',
      license: String(item.license_name || item.license_url || '请打开来源页面确认授权').slice(0, 180),
      year: String(item.upload_date_format || '').slice(-4),
      url: file.download_url,
      pageUrl: item.file_page_url || item.artist_page_url || 'https://ccmixter.org/',
      fileName: file.file_name || '',
      size: Number(file.file_rawsize || 0),
      relevance: score,
      rights,
      downloadAllowed: false,
      exportAllowed: false
    };
  }).filter(Boolean).sort((a, b) => b.relevance - a.relevance).slice(0, MUSIC_SEARCH_LIMIT);
}

function safeUrl(value, base) {
  try { return new URL(value, base); } catch { return null; }
}

function isBlockedMusicHost(url) {
  const parsed = safeUrl(url);
  if (parsed?.hostname === 'www.baidu.com' && parsed.pathname === '/link') return false;
  return !parsed || MUSIC_BLOCKED_HOST_RE.test(parsed.hostname);
}

function decodeSearchTarget(raw, baseUrl) {
  const parsed = safeUrl(raw, baseUrl);
  if (!parsed) return null;
  if (parsed.hostname.includes('google.') && parsed.pathname === '/url') return parsed.searchParams.get('q');
  return parsed.href;
}

function extractLinksFromHtml(html, baseUrl) {
  const links = [];
  const re = /href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = re.exec(html || ''))) {
    const decoded = decodeSearchTarget(match[1], baseUrl);
    const url = safeUrl(decoded || match[1], baseUrl);
    if (!url || !/^https?:$/.test(url.protocol)) continue;
    if (isBlockedMusicHost(url.href)) continue;
    if (!links.includes(url.href)) links.push(url.href);
  }
  return links.slice(0, 12);
}

function extractLinksFromMarkdown(markdown) {
  const links = [];
  const re = /\]\((https?:\/\/[^)]+)\)/gi;
  let match;
  while ((match = re.exec(markdown || ''))) {
    const url = safeUrl(match[1]);
    if (!url || !/^https?:$/.test(url.protocol)) continue;
    if (/^t\d+\.baidu\.com$/i.test(url.hostname)) continue;
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url.pathname)) continue;
    if (isBlockedMusicHost(url.href) && !(url.hostname === 'www.baidu.com' && url.pathname === '/link')) continue;
    if (!links.includes(url.href)) links.push(url.href);
  }
  return links.slice(0, 12);
}

function extractAudioLinksFromHtml(html, pageUrl) {
  const links = [];
  const re = /(?:href|src)=["']([^"']+\.(?:mp3|ogg|m4a)(?:\?[^"']*)?)["']/gi;
  let match;
  while ((match = re.exec(html || ''))) {
    const url = safeUrl(match[1], pageUrl);
    if (!url || !/^https?:$/.test(url.protocol)) continue;
    if (isBlockedMusicHost(url.href)) continue;
    if (!links.includes(url.href)) links.push(url.href);
  }
  return links.slice(0, 4);
}

function pageTitleFromHtml(html) {
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html || '')?.[1] || '';
  return title.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function webMusicQueries(query, profile) {
  const literal = musicLiteralTerms(query).join(' ');
  const style = ccmixterSearchTerm(profile, query);
  const target = literal || style;
  return [
    `${target} free music mp3 creative commons`,
    `${target} royalty free music mp3`,
    `${target} \u514d\u8d39 \u514d\u7248\u6743 mp3`
  ];
}

async function fetchText(url) {
  const response = await mediaFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FutureAI-Music-Player' } });
  if (!response.ok) return '';
  const type = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) return '';
  return await response.text();
}

async function searchGoogleMusicPages(query, profile) {
  const pages = [];
  for (const term of webMusicQueries(query, profile).slice(0, 2)) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(term)}`;
    const html = await fetchText(url).catch(() => '');
    extractLinksFromHtml(html, url).forEach(link => { if (!pages.includes(link)) pages.push(link); });
    const readable = await fetchText(`https://r.jina.ai/http://https://www.google.com/search?q=${encodeURIComponent(term)}`).catch(() => '');
    extractLinksFromMarkdown(readable).forEach(link => { if (!pages.includes(link)) pages.push(link); });
  }
  return pages.slice(0, 10);
}

async function searchBaiduMusicPages(query, profile) {
  const pages = [];
  for (const term of webMusicQueries(query, profile).slice(0, 2)) {
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(term)}`;
    const html = await fetchText(url).catch(() => '');
    extractLinksFromHtml(html, url).forEach(link => { if (!pages.includes(link)) pages.push(link); });
    const readable = await fetchText(`https://r.jina.ai/http://https://www.baidu.com/s?wd=${encodeURIComponent(term)}`).catch(() => '');
    extractLinksFromMarkdown(readable).forEach(link => { if (!pages.includes(link)) pages.push(link); });
  }
  return pages.slice(0, 10);
}

function musicSearchPortalTracks(query, profile) {
  const term = webMusicQueries(query, profile)[0];
  return [
    { name: 'Google 搜索结果', url: `https://www.google.com/search?q=${encodeURIComponent(term)}` },
    { name: '百度搜索结果', url: `https://www.baidu.com/s?wd=${encodeURIComponent(term)}` }
  ].map(item => ({
    id: `search-${crypto.createHash('sha1').update(item.url).digest('hex').slice(0, 16)}`,
    title: item.name,
    artist: term,
    source: '网页搜索入口',
    license: '搜索网页入口：请打开后选择明确免费/免版权/可授权的音乐来源',
    year: '',
    url: '',
    pageUrl: item.url,
    fileName: '',
    size: 0,
    relevance: 20,
    sourceOnly: true
  }));
}

async function searchWebFreeMusic(query, profile) {
  const pages = [...new Set([
    ...(await searchGoogleMusicPages(query, profile).catch(() => [])),
    ...(await searchBaiduMusicPages(query, profile).catch(() => []))
  ])].slice(0, 12);
  const literalTerms = musicRequiresLiteralMatch(query) ? musicLiteralTerms(query) : [];
  const tracks = [];
  for (const pageUrl of pages) {
    if (tracks.length >= MUSIC_SEARCH_LIMIT) break;
    const html = await fetchText(pageUrl).catch(() => '');
    if (!html || !MUSIC_LICENSE_HINT_RE.test(html)) continue;
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    if (literalTerms.length && !musicMatchesLiteralTerms(text, literalTerms)) continue;
    const beforeAudioCount = tracks.length;
    for (const audioUrl of extractAudioLinksFromHtml(html, pageUrl)) {
      if (tracks.some(track => track.url === audioUrl)) continue;
      const fileName = decodeURIComponent(safeUrl(audioUrl)?.pathname.split('/').pop() || '');
      tracks.push({
        id: `web-${crypto.createHash('sha1').update(audioUrl).digest('hex').slice(0, 16)}`,
        title: pageTitleFromHtml(html) || fileName || '网页免费音乐',
        artist: safeUrl(pageUrl)?.hostname || '网页来源',
        source: 'Google / 百度网页发现',
        license: '页面标注免费/免版权/CC，使用前请打开来源确认',
        year: '',
        url: audioUrl,
        pageUrl,
        fileName,
        size: 0,
        relevance: 60
      });
      if (tracks.length >= MUSIC_SEARCH_LIMIT) break;
    }
    if (tracks.length === beforeAudioCount && tracks.length < MUSIC_SEARCH_LIMIT) {
      tracks.push({
        id: `web-source-${crypto.createHash('sha1').update(pageUrl).digest('hex').slice(0, 16)}`,
        title: pageTitleFromHtml(html) || safeUrl(pageUrl)?.hostname || '网页免费音乐来源',
        artist: safeUrl(pageUrl)?.hostname || '网页来源',
        source: 'Google / 百度网页来源',
        license: '未解析到直链，请打开来源页确认授权和播放/下载方式',
        year: '',
        url: '',
        pageUrl,
        fileName: '',
        size: 0,
        relevance: 35,
        sourceOnly: true
      });
    }
  }
  if (!tracks.length) tracks.push(...musicSearchPortalTracks(query, profile));
  return tracks;
}

function trackId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 18)}`;
}

async function searchAudiusMusic(query) {
  const terms = musicSearchVariants(query);
  if (!terms.length) return [];
  const responses = await Promise.allSettled(terms.map(async term => {
    const url = `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(term)}&app_name=future_ai&limit=18`;
    const response = await mediaFetch(url, {headers:{'User-Agent':'FutureAI-Music-Player'}});
    if (!response.ok) throw new Error(`Audius HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.data) ? data.data : [];
  }));
  return responses.flatMap(result => result.status === 'fulfilled' ? result.value : []).map(item => {
    if (!item?.id) return null;
    const permalink = String(item.permalink || '');
    return {
      id:trackId('audius', item.id),
      title:String(item.title || '\u514d\u8d39\u4e32\u6d41\u97f3\u4e50').slice(0, 120),
      artist:String(item.user?.name || item.user?.handle || '\u672a\u77e5\u97f3\u4e50\u4eba').slice(0, 80),
      source:'Audius',
      license:'Audius \u7528\u6237\u516c\u5f00\u4e32\u6d41\uff0c\u7248\u6743\u4fe1\u606f\u4ee5\u6765\u6e90\u9875\u4e3a\u51c6',
      year:String(item.release_date || '').slice(0, 10),
      url:`https://api.audius.co/v1/tracks/${encodeURIComponent(item.id)}/stream?app_name=future_ai`,
      pageUrl:/^https?:\/\//i.test(permalink) ? permalink : `https://audius.co${permalink || '/'}`,
      fileName:'',
      size:0,
      relevance:95,
      freeStream: true,
      downloadAllowed: false,
      exportAllowed: false,
      rights: platformStreamRights('Audius', 'https://docs.audius.org/')
    };
  }).filter(Boolean).filter((track, index, list) => list.findIndex(item => item.id === track.id) === index);
}

async function searchRadioMusic(query, profile) {
  const strictLiteralSearch = musicRequiresLiteralMatch(query);
  const term = strictLiteralSearch ? String(query || '').trim() : ccmixterSearchTerm(profile, query).replace(/ instrumental| music for film/g, '').trim();
  let data = [];
  const searchTerms = strictLiteralSearch ? [term] : [...new Set([term, 'lofi', 'instrumental'].filter(Boolean))];
  for (const searchTerm of searchTerms) {
    const url = `https://de1.api.radio-browser.info/json/stations/search?name=${encodeURIComponent(searchTerm)}&limit=8&hidebroken=true&order=clickcount&reverse=true`;
    const response = await mediaFetch(url, { headers: { 'User-Agent': 'FutureAI-Music-Player' } });
    if (!response.ok) continue;
    data = await response.json();
    if (Array.isArray(data) && data.length) break;
  }
  if (!Array.isArray(data)) return [];
  return data.filter(item => item.url_resolved || item.url).map(item => ({
    id: trackId('radio', item.stationuuid || item.url_resolved || item.url),
    title: String(item.name || '在线电台').slice(0, 120),
    artist: String(item.country || item.language || '在线电台').slice(0, 80),
    source: '在线音乐电台',
    license: '公开电台流，适合工作时播放',
    year: '',
    url: item.url_resolved || item.url,
    pageUrl: item.homepage || 'https://www.radio-browser.info/',
    fileName: '',
    size: 0,
    relevance: 50,
    downloadAllowed: false,
    exportAllowed: false,
    rights: platformStreamRights('Radio Browser', 'https://www.radio-browser.info/')
  }));
}

function plainText(value = '') {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function mediaFetch(url, options = {}, timeoutMs = MEDIA_SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

function withMediaJobTimeout(run, timeoutMs = 9000) {
  return Promise.race([
    Promise.resolve().then(run),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`media source timed out after ${timeoutMs}ms`)), timeoutMs))
  ]);
}

async function searchWikimediaAudio(profile, query = '', strictLiteralSearch = false) {
  const terms = (profile?.terms || []).filter(term => /^[a-z0-9 -]+$/i.test(term)).slice(0, 4);
  const searchText = terms.join(' ') || String(query || 'instrumental music').trim() || 'instrumental music';
  const searches = strictLiteralSearch
    ? musicSearchVariants(query).map(value => `${value} filetype:audio`)
    : [`${searchText} filetype:audio`, `${terms[0] || 'instrumental'} music filetype:audio`, 'music filetype:audio'];
  let pages = [];
  for (const value of [...new Set(searches)]) {
    const search = encodeURIComponent(value);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${search}&gsrlimit=18&prop=imageinfo&iiprop=url|mime|extmetadata&format=json&origin=*`;
    const response = await mediaFetch(url, {headers: {'User-Agent': 'FutureAI-Media-Center/1.0'}});
    if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);
    const data = await response.json();
    pages = Object.values(data?.query?.pages || {});
    if (pages.length >= 4) break;
  }
  return pages.map(page => {
    const info = page.imageinfo?.[0];
    if (!info?.url || (!/^(?:audio\/|application\/ogg)/i.test(info.mime || '') && !/\.(?:mp3|ogg|oga|opus|wav|flac)(?:$|[?#])/i.test(info.url))) return null;
    const meta = info.extmetadata || {};
    const title = plainText(meta.ObjectName?.value || page.title || '').replace(/^File:/i, '');
    const artist = plainText(meta.Artist?.value || meta.Credit?.value || 'Wikimedia Commons');
    const license = plainText(meta.LicenseShortName?.value || meta.UsageTerms?.value || 'Open license - verify on source page');
    const licenseUrl = plainText(meta.LicenseUrl?.value || '');
    const rights = openMusicRights(license, licenseUrl);
    if (!rights) return null;
    return {
      id: trackId('commons-audio', info.url),
      title: (title || 'Wikimedia open audio').slice(0, 120),
      artist: artist.slice(0, 80),
      source: 'Wikimedia Commons',
      license: license.slice(0, 180),
      url: info.url,
      pageUrl: info.descriptionurl || info.descriptionshorturl || 'https://commons.wikimedia.org/',
      fileName: decodeURIComponent(new URL(info.url).pathname.split('/').pop() || ''),
      size: 0,
      relevance: 70,
      rights,
      downloadAllowed: false,
      exportAllowed: false
    };
  }).filter(Boolean).slice(0, MUSIC_SEARCH_LIMIT);
}

async function archivePlayableVideoFile(identifier) {
  const response = await mediaFetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, { headers: { 'User-Agent': 'FutureAI-Media-Center' } });
  if (!response.ok) return null;
  const data = await response.json();
  const files = Array.isArray(data.files) ? data.files : [];
  return files.find(file => /\.(mp4|webm|ogv)$/i.test(file.name || '') && !/thumb|sample|metadata/i.test(file.name || '')) || null;
}

async function searchWikimediaVideos(query = '') {
  const search = encodeURIComponent(`${String(query || 'nature').trim() || 'nature'} filetype:video`);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${search}&gsrlimit=12&prop=imageinfo&iiprop=url|mime|extmetadata&format=json&origin=*`; 
  const response = await mediaFetch(url, { headers: { 'User-Agent': 'FutureAI-Media-Center' } });
  if (!response.ok) return [];
  const data = await response.json();
  const pages = Object.values(data?.query?.pages || {});
  return pages.map(page => {
    const info = page.imageinfo?.[0];
    if (!info?.url || !/^video\//i.test(info.mime || '') && !/\.ogv$/i.test(info.url)) return null;
    const meta = info.extmetadata || {};
    const title = plainText(meta.ObjectName?.value || page.title || '').replace(/^File:/i, '');
    const artist = plainText(meta.Artist?.value || meta.Credit?.value || 'Wikimedia Commons');
    const license = plainText(meta.LicenseShortName?.value || meta.UsageTerms?.value || '请打开来源确认授权');
    return {
      id: trackId('commons-video', info.url),
      title: title || 'Wikimedia 免费视频',
      artist: artist.slice(0, 80),
      source: 'Wikimedia Commons 免费视频',
      license: license.slice(0, 180),
      url: info.url,
      pageUrl: info.descriptionurl || info.descriptionshorturl || 'https://commons.wikimedia.org/',
      relevance: 80
    };
  }).filter(Boolean);
}

async function searchArchiveVideos(query = '') {
  const q = encodeURIComponent(`${String(query || 'nature').trim() || 'nature'} AND mediatype:(movies)`);
  const url = `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=description&rows=12&output=json`; 
  const response = await mediaFetch(url, { headers: { 'User-Agent': 'FutureAI-Media-Center' } });
  if (!response.ok) return [];
  const data = await response.json();
  const docs = (data?.response?.docs || []).filter(doc => doc?.identifier).slice(0, 8);
  const files = await Promise.allSettled(docs.map(doc => archivePlayableVideoFile(doc.identifier)));
  return docs.map((doc, index) => {
    const file = files[index]?.status === 'fulfilled' ? files[index].value : null;
    if (!file) return null;
    const rights = openMusicRights(doc.licenseurl, doc.licenseurl);
    if (!rights) return null;
    return {
      id: trackId('archive-video', `${doc.identifier}-${file.name}`),
      title: String(doc.title || file.name || 'Internet Archive 公开视频').slice(0, 120),
      artist: String(Array.isArray(doc.creator) ? doc.creator.join(' / ') : doc.creator || 'Internet Archive').slice(0, 80),
      source: 'Internet Archive 公开视频',
      license: '公开公开视频，使用前请打开来源确认授权',
      url: archiveDownloadUrl(doc.identifier, file.name),
      pageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      relevance: 60
    };
  }).filter(Boolean);
}

async function searchOpenRadioStations(payload = {}) {
  const query = String(payload.query || '').trim().slice(0, 80) || 'lofi';
  const enabledSources = normalizeMusicSourceIds(payload.sourceIds, ['radio']);
  if (!enabledSources.includes('radio')) return { query, source: 'Radio Browser disabled', tracks: [], total: 0 };
  const url = `https://de1.api.radio-browser.info/json/stations/search?name=${encodeURIComponent(query)}&limit=30&hidebroken=true&order=clickcount&reverse=true`; 
  const response = await mediaFetch(url, { headers: { 'User-Agent': 'FutureAI-Media-Center' } });
  if (!response.ok) return { query, source: 'Radio Browser 开源电台目录', tracks: [], total: 0 };
  const data = await response.json();
  const tracks = (Array.isArray(data) ? data : []).filter(item => item.url_resolved || item.url).map(item => ({
    id: trackId('open-radio', item.stationuuid || item.url_resolved || item.url),
    title: String(item.name || '在线电台').slice(0, 120),
    artist: String([item.country, item.language, item.tags].filter(Boolean).join(' · ') || '在线电台').slice(0, 120),
    source: 'Radio Browser 开源电台目录',
    license: '公开电台流，适合工作时长时间播放',
    year: '',
    url: item.url_resolved || item.url,
    pageUrl: item.homepage || 'https://www.radio-browser.info/',
    fileName: '',
    size: 0,
    relevance: Number(item.clickcount || 0)
  })).slice(0, MUSIC_SEARCH_LIMIT);
  return { query, source: 'Radio Browser 开源电台目录', tracks, total: tracks.length };
}

async function searchFreeVideos(payload = {}) {
  const rawQuery = String(payload.query || '').trim().slice(0, 80) || 'nature';
  const query = normalizedVideoSearchQuery(rawQuery);
  const jobs = [
    {source: 'Wikimedia Commons', run: () => searchWikimediaVideos(query)},
    {source: 'Internet Archive', run: () => searchArchiveVideos(query)}
  ];
  const settled = await Promise.allSettled(jobs.map(job => withMediaJobTimeout(job.run)));
  const diagnostics = settled.map((result, index) => ({source: jobs[index].source, status: result.status, count: result.status === 'fulfilled' ? result.value.length : 0, error: result.status === 'rejected' ? String(result.reason?.message || result.reason).slice(0, 180) : ''}));
  const tracks = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .filter((track, index, list) => list.findIndex(item => item.url === track.url) === index)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 16);
  return { query: rawQuery, normalizedQuery: query, source: diagnostics.filter(item => item.count).map(item => item.source).join(' + ') || 'Open media sources', tracks, total: tracks.length, diagnostics };
}

async function searchFreeMusicV2(payload = {}) {
  const query = String(payload.query || '').trim().slice(0, 80);
  const page = Math.max(1, Number(payload.page || 1) || 1);
  const profile = musicQueryProfile(query);
  const literalTerms = musicRequiresLiteralMatch(query) ? musicLiteralTerms(query) : [];
  const enabledSources = normalizeMusicSourceIds(payload.sourceIds);
  const ccmixterTracks = enabledSources.includes('ccmixter') ? await searchCcmixterMusic(profile, query).catch(() => []) : [];
  const radioTracks = enabledSources.includes('radio') ? await searchRadioMusic(query, profile).catch(() => []) : [];
  const webTracks = enabledSources.includes('web') ? await searchWebFreeMusic(query, profile).catch(() => []) : [];
  const playableSeedCount = ccmixterTracks.length + radioTracks.length;
  const mergedWebTracks = playableSeedCount ? webTracks.filter(track => track.url) : webTracks;
  if (ccmixterTracks.length >= MUSIC_SEARCH_LIMIT) {
    return { query, page, source: 'ccMixter 免费音乐库', tracks: ccmixterTracks, total: ccmixterTracks.length };
  }
  const allDocs = new Map();
  let total = 0;
  for (const collection of enabledSources.includes('archive') ? MUSIC_COLLECTIONS : []) {
    const q = encodeURIComponent(`collection:(${collection}) AND mediatype:(audio) AND (${profile.phrase})`);
    const url = `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=date&fl[]=description&fl[]=subject&rows=30&page=${page}&output=json`; 
    const response = await fetch(url, { headers: { 'User-Agent': 'FutureAI-Music-Player' } });
    if (!response.ok) continue;
    const data = await response.json();
    total += Number(data?.response?.numFound || 0);
    for (const doc of data?.response?.docs || []) {
      if (!doc?.identifier || allDocs.has(doc.identifier)) continue;
      const score = musicRelevanceScore(doc, profile);
      if (literalTerms.length && !musicMatchesLiteralTerms(musicDocText(doc), literalTerms)) continue;
      if (score < 8) continue;
      allDocs.set(doc.identifier, { ...doc, score, collection });
    }
  }
  const docs = [...allDocs.values()].sort((a, b) => b.score - a.score).slice(0, 24);
  const tracks = [...ccmixterTracks, ...radioTracks, ...mergedWebTracks].filter((track, index, list) => list.findIndex(item => item.url === track.url || (item.title === track.title && item.artist === track.artist)) === index).slice(0, MUSIC_SEARCH_LIMIT);
  for (const doc of docs) {
    if (tracks.length >= MUSIC_SEARCH_LIMIT) break;
    const file = await archivePlayableFile(doc.identifier, profile, doc).catch(() => null);
    if (!file) continue;
    const finalScore = musicRelevanceScore(doc, profile, file.name || '');
    if (literalTerms.length && !musicMatchesLiteralTerms(musicDocText(doc, file.name || ''), literalTerms)) continue;
    if (finalScore < 8) continue;
    const creator = Array.isArray(doc.creator) ? doc.creator.join(' / ') : doc.creator;
    tracks.push({
      id: `archive-${doc.identifier}-${file.name}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120),
      title: String(doc.title || file.name || '免费音乐').slice(0, 120),
      artist: String(creator || '未知作者').slice(0, 80),
      source: '公开免费音乐库',
      license: String(doc.licenseurl || '请打开来源页面确认授权').slice(0, 180),
      year: String(doc.date || '').slice(0, 10),
      url: archiveDownloadUrl(doc.identifier, file.name),
      pageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      fileName: file.name,
      size: Number(file.size || 0),
      relevance: finalScore
    });
  }
  return { query, page, source: enabledSources.join(' + '), tracks: tracks.sort((a, b) => b.relevance - a.relevance), total };
}

async function searchArchiveMusicTracks(profile, page, literalTerms) {
  const primaryTerms = (profile?.terms || []).filter(term => /^[a-z0-9 -]+$/i.test(term)).slice(0, 5).map(term => `"${term}"`).join(' OR ') || 'music OR instrumental';
  const scopes = [null, ...MUSIC_COLLECTIONS];
  const requests = scopes.map(async collection => {
    const scope = collection ? `collection:(${collection}) AND ` : '';
    const q = encodeURIComponent(`${scope}mediatype:(audio) AND (${primaryTerms})`);
    const url = `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=date&fl[]=description&fl[]=subject&rows=18&page=${page}&output=json`;
    const response = await mediaFetch(url, {headers: {'User-Agent': 'FutureAI-Music-Player'}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data?.response?.docs || [];
  });
  const settled = await Promise.allSettled(requests);
  const docs = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .filter((doc, index, list) => doc?.identifier && list.findIndex(item => item.identifier === doc.identifier) === index)
    .map(doc => ({...doc, score: musicRelevanceScore(doc, profile)}))
    .filter(doc => doc.score >= -8 && (!literalTerms.length || musicMatchesLiteralTerms(musicDocText(doc), literalTerms)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const files = await Promise.allSettled(docs.map(doc => archivePlayableFile(doc.identifier, profile, doc)));
  return docs.map((doc, index) => {
    const file = files[index]?.status === 'fulfilled' ? files[index].value : null;
    if (!file) return null;
    const creator = Array.isArray(doc.creator) ? doc.creator.join(' / ') : doc.creator;
    return {
      id: trackId('archive-audio', `${doc.identifier}-${file.name}`),
      title: String(doc.title || file.name || 'Internet Archive open audio').slice(0, 120),
      artist: String(creator || 'Unknown creator').slice(0, 80),
      source: 'Internet Archive',
      license: String(doc.licenseurl || 'Open source archive - verify on source page').slice(0, 180),
      year: String(doc.date || '').slice(0, 10),
      url: archiveDownloadUrl(doc.identifier, file.name),
      pageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      fileName: file.name,
      size: Number(file.size || 0),
      relevance: musicRelevanceScore(doc, profile, file.name || ''),
      rights,
      downloadAllowed: false,
      exportAllowed: false
    };
  }).filter(Boolean);
}

async function searchFreeMusicV3(payload = {}) {
  const query = String(payload.query || '').trim().slice(0, 80) || 'cinematic';
  const page = Math.max(1, Number(payload.page || 1) || 1);
  const normalizedQuery = normalizedMusicSearchQuery(query);
  const profile = musicQueryProfile(normalizedQuery);
  const literalTerms = musicRequiresLiteralMatch(query) ? musicLiteralTerms(query) : [];
  const strictLiteralSearch = literalTerms.length > 0;
  const enabledSources = normalizeMusicSourceIds(payload.sourceIds);
  const jobs = [];
  const addJob = (id, run) => { if (enabledSources.includes(id)) jobs.push({id, run}); };
  addJob('audius', () => searchAudiusMusic(query));
  addJob('ccmixter', () => searchCcmixterMusic(profile, query));
  addJob('archive', () => searchArchiveMusicTracks(profile, page, literalTerms));
  addJob('wikimedia', () => searchWikimediaAudio(profile, query, strictLiteralSearch));
  addJob('radio', () => searchRadioMusic(query, profile));
  const settled = await Promise.allSettled(jobs.map(job => withMediaJobTimeout(job.run)));
  const sourceTracks = settled.map((result, index) => {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return [];
    const matched = strictLiteralSearch ? result.value.filter(track => musicTrackMatchesLiteralTerms(track, literalTerms)) : result.value;
    return matched.map(track => ({...track, sourceId: jobs[index].id}));
  });
  const diagnostics = settled.map((result, index) => ({
    source: jobs[index].id,
    status: result.status,
    count: sourceTracks[index].length,
    error: result.status === 'rejected' ? String(result.reason?.message || result.reason).slice(0, 180) : ''
  }));
  const tracks = sourceTracks.flat()
    .filter(track => track?.url)
    .map(track => ({
      ...track,
      source: MUSIC_SOURCE_PLUGINS.find(plugin => plugin.id === track.sourceId)?.name || track.source,
      loginRequired: false,
      downloadAllowed: false,
      exportAllowed: false
    }))
    .filter(track => track.rights?.mode === 'platform-stream' || track.rights?.mode === 'open-license')
    .filter((track, index, list) => list.findIndex(item => (track.url && item.url === track.url) || item.id === track.id) === index)
    .sort((a, b) => Number(b.relevance || 0) - Number(a.relevance || 0))
    .slice(0, MUSIC_SEARCH_LIMIT)
    .map(track => musicSourcePolicy.issue(track))
    .filter(Boolean);
  const sources = diagnostics.filter(item => item.count > 0).map(item => item.source);
  return {query, normalizedQuery, strictLiteralSearch, page, source: sources.join(' + ') || enabledSources.join(' + '), tracks, total: tracks.length, diagnostics};
}

function manjuFfmpegCommand() {
  const candidates = [
    path.join(packagedBaseDir(), 'ffmpeg', 'ffmpeg.exe'),
    path.join(__dirname, '..', 'ffmpeg', 'ffmpeg.exe'),
    path.join(path.dirname(app.getPath('exe')), 'resources', 'ffmpeg', 'ffmpeg.exe')
  ];
  const command = candidates.find(file => fsSync.existsSync(file) && fsSync.statSync(file).size > 1024);
  if (!command) throw new Error('未找到 FFmpeg 运行时，请重新安装应用的 ffmpeg 资源');
  return command;
}

function sendManjuExportProgress(sender, payload) {
  if (!sender || sender.isDestroyed()) return;
  sender.send('manju:export-progress', payload);
}

function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const command = manjuFfmpegCommand();
    const child = spawn(command, ['-hide_banner', '-loglevel', 'error', ...args], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('FFmpeg 合成超时，请减少镜头数量或检查素材文件'));
    }, MANJU_EXPORT_TIMEOUT_MS);
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-24000);
      onProgress?.(text);
    });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(true);
      else reject(new Error(`FFmpeg 退出码 ${code}\n${stderr.trim() || '未返回错误详情'}`));
    });
  });
}

function mediaProcessExtension(payload) {
  if (payload.operation.startsWith('extract-') || payload.operation.startsWith('image-')) return payload.format === 'jpg' || payload.format === 'webp' ? payload.format : 'png';
  if (payload.operation === 'audio-extract' || payload.operation === 'audio-volume' || payload.operation === 'audio-mix' || payload.operation === 'audio-align') return 'm4a';
  if (payload.operation.startsWith('subtitle-') && payload.operation !== 'subtitle-burn') return payload.format === 'vtt' ? 'vtt' : 'srt';
  return 'mp4';
}

function subtitleTimestampToSeconds(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000 : null;
}

function subtitleSecondsToTimestamp(seconds, separator = ',') {
  const safe = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

function shiftSubtitleText(text, seconds, format = 'srt') {
  const separator = format === 'vtt' ? '.' : ',';
  return String(text || '').replace(/(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/g, (_full, start, end) => {
    const startSeconds = subtitleTimestampToSeconds(start);
    const endSeconds = subtitleTimestampToSeconds(end);
    if (startSeconds == null || endSeconds == null) return _full;
    return `${subtitleSecondsToTimestamp(startSeconds + seconds, separator)} --> ${subtitleSecondsToTimestamp(endSeconds + seconds, separator)}`;
  });
}

function subtitleFilterPath(file) {
  return path.resolve(file).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function processLocalMedia(payload = {}) {
  const request = MediaProcessContract.normalize(payload);
  const root = await ensureStorageRootAllowed(request.storageDir);
  if (!request.sourceUrl) throw new Error('媒体工具缺少源文件');
  const source = await safeExistingMediaPathReal(request.sourceUrl);
  const secondSource = request.secondSourceUrl ? await safeExistingMediaPathReal(request.secondSourceUrl) : '';
  if (MediaProcessContract.requiresSecondSource(request.operation) && !secondSource) throw new Error('该操作需要连接第二个源文件');
  const outputDir = safeStoragePath(root, 'media', 'processed');
  await ensureDir(outputDir);
  const ext = mediaProcessExtension(request);
  const outputFile = path.join(outputDir, `${request.operation}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`);
  const color = request.background.replace('#', '0x');
  let tempSubtitle = '';
  try {
    switch (request.operation) {
      case 'extract-first-frame':
        await runFfmpeg(['-y', '-i', source, '-frames:v', '1', outputFile]);
        break;
      case 'extract-last-frame':
        await runFfmpeg(['-y', '-sseof', '-0.15', '-i', source, '-frames:v', '1', outputFile]);
        break;
      case 'extract-frame':
        await runFfmpeg(['-y', '-ss', String(request.time), '-i', source, '-frames:v', '1', outputFile]);
        break;
      case 'image-resize':
        await runFfmpeg(['-y', '-i', source, '-vf', `scale=${request.width}:${request.height}:flags=lanczos`, outputFile]);
        break;
      case 'image-format':
        await runFfmpeg(['-y', '-i', source, '-frames:v', '1', outputFile]);
        break;
      case 'image-canvas':
        await runFfmpeg(['-y', '-i', source, '-vf', `scale=${request.width}:${request.height}:force_original_aspect_ratio=decrease,pad=${request.width}:${request.height}:(ow-iw)/2:(oh-ih)/2:${color}`, '-frames:v', '1', outputFile]);
        break;
      case 'video-trim':
        await runManjuH264Encode(['-y', '-ss', String(request.start), '-i', source, '-t', String(request.duration)], ['-c:a', 'aac', '-movflags', '+faststart', outputFile]);
        break;
      case 'video-concat': {
        const listFile = path.join(outputDir, `concat-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.txt`);
        await fs.writeFile(listFile, [concatFileLine(source), concatFileLine(secondSource)].join('\n'), 'utf8');
        try { await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outputFile]); }
        finally { await fs.rm(listFile, {force: true}).catch(() => {}); }
        break;
      }
      case 'video-speed':
        await runManjuH264Encode(['-y', '-i', source, '-filter:v', `setpts=${(1 / request.speed).toFixed(6)}*PTS`, '-filter:a', `atempo=${request.speed}`], ['-c:a', 'aac', '-movflags', '+faststart', outputFile]);
        break;
      case 'video-loop':
        await runManjuH264Encode(['-y', '-stream_loop', String(request.loops - 1), '-i', source, '-t', String(request.duration)], ['-c:a', 'aac', '-movflags', '+faststart', outputFile]);
        break;
      case 'audio-extract':
        await runFfmpeg(['-y', '-i', source, '-vn', '-c:a', 'aac', '-b:a', '192k', outputFile]);
        break;
      case 'audio-volume':
        await runFfmpeg(['-y', '-i', source, '-vn', '-filter:a', `volume=${request.volume}`, '-c:a', 'aac', '-b:a', '192k', outputFile]);
        break;
      case 'audio-mix':
        await runFfmpeg(['-y', '-i', source, '-i', secondSource, '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[a]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', outputFile]);
        break;
      case 'video-mute':
        await runFfmpeg(['-y', '-i', source, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', outputFile]);
        break;
      case 'audio-align':
        await runFfmpeg(['-y', '-i', source, '-filter:a', `apad,atrim=0:${request.duration}`, '-c:a', 'aac', '-b:a', '192k', outputFile]);
        break;
      case 'subtitle-burn': {
        tempSubtitle = path.join(outputDir, `subtitle-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.srt`);
        const subtitleText = request.subtitleText || (secondSource ? await fs.readFile(secondSource, 'utf8') : '');
        if (!subtitleText.trim()) throw new Error('字幕烧录缺少字幕内容或字幕文件');
        await fs.writeFile(tempSubtitle, subtitleText, 'utf8');
        await runManjuH264Encode(['-y', '-i', source, '-vf', `subtitles='${subtitleFilterPath(tempSubtitle)}'`], ['-c:a', 'copy', '-movflags', '+faststart', outputFile]);
        break;
      }
      case 'subtitle-convert':
      case 'subtitle-shift': {
        const input = request.subtitleText || await fs.readFile(source, 'utf8');
        const shifted = shiftSubtitleText(input, request.operation === 'subtitle-shift' ? request.shiftSeconds : 0, ext);
        const converted = ext === 'vtt' && !/^WEBVTT/m.test(shifted) ? `WEBVTT\n\n${shifted.replace(/,/g, '.')}` : shifted.replace(/^WEBVTT\s*/m, '');
        await fs.writeFile(outputFile, converted, 'utf8');
        break;
      }
      default:
        throw new Error('不支持的媒体处理操作');
    }
    const stats = await fs.stat(outputFile);
    return {outputFile, url: pathToFileURL(outputFile).toString(), size: stats.size, operation: request.operation, requested: request};
  } finally {
    if (tempSubtitle) await fs.rm(tempSubtitle, {force: true}).catch(() => {});
  }
}

function probeManjuH264Strategy(strategy) {
  return new Promise(resolve => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.2:r=5',
      '-frames:v', '1', '-an', ...strategy.args, '-f', 'null', '-'
    ];
    const child = spawn(manjuFfmpegCommand(), args, {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
    let settled = false;
    const finish = available => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(available);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 15000);
    child.on('error', () => finish(false));
    child.on('close', code => finish(code === 0));
  });
}

async function manjuH264Strategies() {
  if (!manjuH264StrategiesPromise) {
    manjuH264StrategiesPromise = (async () => {
      const available = [];
      for (const strategy of MANJU_H264_STRATEGIES) {
        if (await probeManjuH264Strategy(strategy)) available.push(strategy);
      }
      if (!available.length) throw new Error('当前设备没有可用的 H.264 编码器，请修复或重新安装视频运行时');
      return available;
    })().catch(error => {
      manjuH264StrategiesPromise = null;
      throw error;
    });
  }
  return manjuH264StrategiesPromise;
}

async function runManjuH264Encode(beforeEncoderArgs, afterEncoderArgs, onProgress) {
  const strategies = await manjuH264Strategies();
  const failures = [];
  for (const strategy of strategies) {
    try {
      await runFfmpeg([...beforeEncoderArgs, ...strategy.args, ...afterEncoderArgs], onProgress);
      return strategy.id;
    } catch (error) {
      failures.push(`${strategy.id}: ${String(error?.message || error).slice(0, 300)}`);
      await appendAppLog('warn', 'manju H.264 encoder failed; trying fallback', {
        encoder: strategy.id,
        error: String(error?.message || error).slice(0, 600)
      });
    }
  }
  throw new Error(`视频编码失败，已尝试 ${strategies.map(item => item.id).join('、')}\n${failures.join('\n')}`);
}

function probeVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(manjuFfmpegCommand(), ['-hide_banner', '-i', file], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('视频信息读取超时'));
    }, 30000);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-48000); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
      if (!match) return reject(new Error('无法读取视频时长，请检查文件是否完整'));
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
  });
}

async function extractVideoUnderstandingFrames(source, requestedCount = 8) {
  const durationSeconds = await probeVideoDuration(source);
  const frameCount = Math.max(1, Math.min(Number(requestedCount) || 8, 12, Math.ceil(durationSeconds || 1)));
  const tempDir = await fs.mkdtemp(path.join(app.getPath('temp'), 'future-ai-video-'));
  const frames = [];
  try {
    for (let index = 0; index < frameCount; index += 1) {
      const timeSeconds = Math.max(0, Math.min(durationSeconds - 0.05, durationSeconds * ((index + 0.5) / frameCount)));
      const output = path.join(tempDir, `frame-${String(index + 1).padStart(2, '0')}.jpg`);
      await runFfmpeg([
        '-y', '-ss', timeSeconds.toFixed(3), '-i', source,
        '-frames:v', '1', '-vf', 'scale=1280:-2:force_original_aspect_ratio=decrease', '-q:v', '3', output
      ]);
      const data = await fs.readFile(output);
      frames.push({timeSeconds, dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`});
    }
    return {durationSeconds, frames};
  } finally {
    await fs.rm(tempDir, {recursive: true, force: true}).catch(() => {});
  }
}

function exportMediaExtension(value, fallback) {
  try {
    const ext = path.extname(new URL(value).pathname).replace(/^\./, '').toLowerCase();
    return /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
  } catch {
    return fallback;
  }
}

function isPrivateNetworkAddress(address) {
  const normalized = String(address || '').toLowerCase().replace(/^::ffff:/, '');
  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      parts[0] === 169 && parts[1] === 254 ||
      parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 ||
      parts[0] === 192 && parts[1] === 168 || parts[0] >= 224;
  }
  if (net.isIPv6(normalized)) return normalized === '::1' || normalized === '::' || /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized);
  return true;
}

async function assertPublicMediaUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('远程媒体只支持 HTTP/HTTPS');
  if (url.username || url.password) throw new Error('远程媒体地址不能包含登录凭据');
  const records = await dns.lookup(url.hostname, {all: true, verbatim: true});
  if (!records.length || records.some(record => isPrivateNetworkAddress(record.address))) throw new Error('为安全起见，导出器拒绝访问本机或内网媒体地址');
  return url;
}

async function fetchPublicMedia(source, signal) {
  let current = String(source);
  for (let redirect = 0; redirect <= 5; redirect++) {
    await assertPublicMediaUrl(current);
    const response = await fetch(current, {signal, redirect: 'manual'});
    if (![301, 302, 303, 307, 308].includes(response.status)) return {response, finalUrl: current};
    const location = response.headers.get('location');
    if (!location) throw new Error('远程媒体重定向缺少 Location');
    current = new URL(location, current).toString();
  }
  throw new Error('远程媒体重定向次数过多');
}

async function safeExistingMediaPathReal(target) {
  const realFile = await fs.realpath(safeExistingMediaPath(target));
  for (const root of allowedStorageRoots) {
    const realRoot = await fs.realpath(root).catch(() => '');
    if (realRoot && pathInside(realRoot, realFile)) return realFile;
  }
  throw new Error('媒体文件通过链接指向了授权目录之外');
}

async function materializeExportMedia(value, tempDir, stem, fallbackExt, budget = {used: 0}) {
  const source = String(value || '').trim();
  if (!source) return '';
  if (source.startsWith('file:') || path.isAbsolute(source)) {
    const file = await safeExistingMediaPathReal(source);
    await fs.access(file);
    return file;
  }
  if (!/^https?:/i.test(source)) throw new Error(`不支持的导出媒体地址：${source.slice(0, 80)}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  let file = '';
  let handle = null;
  try {
    const {response, finalUrl} = await fetchPublicMedia(source, controller.signal);
    if (!response.ok) throw new Error(`下载导出素材失败：HTTP ${response.status}`);
    const size = Number(response.headers.get('content-length') || 0);
    if (size > MANJU_MEDIA_LIMIT || budget.used + size > MANJU_EXPORT_TOTAL_MEDIA_LIMIT) throw new Error('导出素材超过大小限制');
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (/mpegurl|text\/html/.test(contentType) || /\.m3u8?(?:$|[?#])/i.test(finalUrl)) throw new Error('导出器不接受播放列表或网页作为镜头素材');
    if (size > 800 * 1024 * 1024) throw new Error('单个导出素材超过 800MB 限制');
    const ext = exportMediaExtension(finalUrl, fallbackExt);
    file = path.join(tempDir, `${stem}.${ext}`);
    handle = await fs.open(file, 'wx');
    let received = 0;
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > MANJU_MEDIA_LIMIT || budget.used + received > MANJU_EXPORT_TOTAL_MEDIA_LIMIT) {
        controller.abort();
        throw new Error('远程素材实际下载大小超过导出限制');
      }
      await handle.write(Buffer.from(chunk));
    }
    budget.used += received;
    await handle.close();
    handle = null;
    return file;
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    if (file) await fs.rm(file, {force: true}).catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function concatFileLine(file) {
  const value = path.resolve(file).replace(/\\/g, '/').replace(/'/g, "'\\''");
  return `file '${value}'`;
}

async function exportManjuVideo(event, payload = {}) {
  const root = await ensureStorageRootAllowed(payload.storageDir);
  const clips = Array.isArray(payload.clips) ? payload.clips.slice(0, MANJU_EXPORT_LIMIT) : [];
  const totalDuration = clips.reduce((sum, clip) => sum + Math.max(.5, Math.min(180, Number(clip?.duration || 5))), 0);
  if (totalDuration > 7200) throw new Error('单次导出总时长不能超过 2 小时');
  if (!clips.length) throw new Error('时间线没有可导出的镜头');
  const match = String(payload.size || '720x1280').match(/^(\d{2,4})x(\d{2,4})$/);
  if (!match) throw new Error('导出画幅无效');
  const width = Math.max(240, Math.min(3840, Number(match[1])));
  const height = Math.max(240, Math.min(3840, Number(match[2])));
  const exportsDir = safeStoragePath(root, 'exports');
  await ensureDir(exportsDir);
  const save = E2E_CONFIG.enabled && payload.e2e === true
    ? {canceled: false, filePath: safeStoragePath(root, 'exports', 'e2e-manju-output.mp4')}
    : await dialog.showSaveDialog({
    title: '导出 AI 漫剧成片',
    defaultPath: path.join(exportsDir, `${String(payload.name || 'AI漫剧成片').replace(/[\\/:*?"<>|]+/g, '_')}.mp4`),
    filters: [{name: 'MP4 视频', extensions: ['mp4']}]
  });
  if (save.canceled || !save.filePath) return {canceled: true};
  const outputFile = save.filePath.toLowerCase().endsWith('.mp4') ? save.filePath : `${save.filePath}.mp4`;
  const tempDir = safeStoragePath(root, 'tmp-manju-export', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  await ensureDir(tempDir);
  const normalized = [];
  const mediaBudget = {used: 0};
  try {
    for (let index = 0; index < clips.length; index++) {
      const clip = clips[index] || {};
      sendManjuExportProgress(event.sender, {stage: 'clip', index, total: clips.length, text: `正在处理镜头 ${index + 1}/${clips.length}`});
      const videoFile = await materializeExportMedia(clip.videoUrl, tempDir, `source-video-${index + 1}`, 'mp4', mediaBudget);
      if (!videoFile) throw new Error(`镜头 ${index + 1} 缺少视频素材`);
      const audioFile = clip.audioUrl ? await materializeExportMedia(clip.audioUrl, tempDir, `source-audio-${index + 1}`, 'mp3', mediaBudget) : '';
      const trimIn = Math.max(0, Math.min(120, Number(clip.trimIn || 0)));
      const trimOut = Math.max(0, Math.min(120, Number(clip.trimOut || 0)));
      const sourceDuration = Math.max(0.5, Math.min(180, Number(clip.duration || 5)));
      const duration = Math.max(0.5, sourceDuration - trimIn - trimOut);
      const clipFile = path.join(tempDir, `clip-${String(index + 1).padStart(4, '0')}.mp4`);
      const audioArgs = audioFile ? ['-protocol_whitelist', 'file,pipe,crypto,data', '-i', audioFile] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];
      const filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p[v];[1:a]aresample=48000,apad[a]`;
      await runManjuH264Encode([
        '-y', '-ss', String(trimIn), '-protocol_whitelist', 'file,pipe,crypto,data', '-i', videoFile, ...audioArgs,
        '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-t', String(duration),
      ], [
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', clipFile
      ]);
      normalized.push(clipFile);
    }
    const concatFile = path.join(tempDir, 'concat.txt');
    await fs.writeFile(concatFile, normalized.map(concatFileLine).join('\n'), 'utf8');
    sendManjuExportProgress(event.sender, {stage: 'concat', index: clips.length, total: clips.length, text: '正在拼接成片'});
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', '-movflags', '+faststart', outputFile]);
    let subtitleFile = '';
    if (String(payload.srt || '').trim()) {
      subtitleFile = outputFile.replace(/\.mp4$/i, '.srt');
      await fs.writeFile(subtitleFile, String(payload.srt), 'utf8');
    }
    sendManjuExportProgress(event.sender, {stage: 'done', index: clips.length, total: clips.length, text: '成片导出完成'});
    await appendAppLog('info', 'manju video exported', {outputFile, subtitleFile, clips: clips.length, size: `${width}x${height}`});
    return {canceled: false, outputFile, subtitleFile, clips: clips.length};
  } finally {
    await fs.rm(tempDir, {recursive: true, force: true}).catch(() => {});
  }
}

function joinRemoteApiPath(base, endpoint) {
  const value = String(base || '').replace(/\/$/, '');
  const suffix = String(endpoint || '').startsWith('/') ? endpoint : `/${endpoint || ''}`;
  return value + suffix;
}

async function responseBufferLimited(response, limit = MANJU_TTS_LIMIT) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw new Error('音频响应超过 50MB 限制');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) throw new Error('音频响应实际大小超过 50MB 限制');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

function assertLocalTtsEndpoint(value) {
  const url = new URL(String(value || ''));
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('本地 TTS 仅允许 localhost / 127.0.0.1 接口');
  return url.toString();
}

async function withManjuTtsTimeout(run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MANJU_TTS_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`配音请求超时：${Math.round(MANJU_TTS_TIMEOUT_MS / 1000)} 秒内未完成`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function synthesizeManjuVoice(payload = {}) {
  const engine = ['relay', 'cosyvoice', 'custom'].includes(payload.engine) ? payload.engine : 'relay';
  const input = String(payload.input || '').trim();
  if (!input || input.length > 4000) throw new Error('配音文本为空或超过 4000 字');
  const speed = Math.max(.5, Math.min(2, Number(payload.speed || 1)));
  return await withManjuTtsTimeout(async signal => {
    let response;
    if (engine === 'relay') {
      const apiUrl = new URL(String(payload.apiUrl || ''));
      if (!['http:', 'https:'].includes(apiUrl.protocol)) throw new Error('TTS API 地址无效');
      response = await fetch(joinRemoteApiPath(apiUrl.toString(), '/audio/speech'), {
        signal,
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${String(payload.apiKey || '')}`},
        body: JSON.stringify({model: String(payload.model || 'gpt-4o-mini-tts'), input, voice: String(payload.voice || 'alloy'), speed, response_format: 'mp3'})
      });
    } else if (engine === 'cosyvoice') {
      const endpoint = assertLocalTtsEndpoint(payload.endpoint);
      const reference = await safeExistingMediaPathReal(payload.referenceUrl);
      const form = new FormData();
      form.append('tts_text', input);
      form.append('prompt_text', String(payload.promptText || '').trim());
      form.append('prompt_wav', new Blob([await fs.readFile(reference)], {type: mimeFromPath(reference)}), path.basename(reference));
      response = await fetch(endpoint, {signal, method: 'POST', body: form});
    } else {
      const endpoint = assertLocalTtsEndpoint(payload.endpoint);
      response = await fetch(endpoint, {
        signal,
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: input, input, model: String(payload.model || ''), voice: String(payload.voice || ''), speed, reference_audio: String(payload.referenceUrl || ''), prompt_text: String(payload.promptText || '')})
      });
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      throw new Error(detail || `TTS HTTP ${response.status}`);
    }
    const contentType = String(response.headers.get('content-type') || 'audio/mpeg').split(';')[0];
    if (contentType.includes('json')) {
      const data = await response.json();
      const dataUrl = String(data.dataUrl || data.audioUrl || data.audio || '');
      if (!/^data:audio\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) throw new Error('自定义 TTS JSON 未返回 dataUrl 音频');
      if (Buffer.byteLength(dataUrl, 'utf8') > MANJU_TTS_LIMIT * 1.5) throw new Error('音频响应超过大小限制');
      return {dataUrl};
    }
    if (!/^audio\//i.test(contentType) && contentType !== 'application/octet-stream') throw new Error(`TTS 返回了非音频内容：${contentType}`);
    const buffer = await responseBufferLimited(response);
    if (!buffer.length) throw new Error('TTS 没有返回音频内容');
    const mime = /^audio\//i.test(contentType) ? contentType : 'audio/mpeg';
    return {dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, mime};
  });
}

async function exportProviderConformanceEvidence(payload = {}) {
  if (E2E_CONFIG.enabled) throw new Error('内部 E2E 模式不能导出商业验收证据');
  await assertPublicMediaUrl(String(payload.apiUrl || ''));
  const appAsarSha256 = await packagedAppAsarSha256();
  const candidate = {
    ...(payload.evidence && typeof payload.evidence === 'object' ? payload.evidence : {}),
    appVersion: String(APP_PACKAGE_METADATA.version || ''),
    runtime: {releaseChannel: RELEASE_CHANNEL, testMode: false, appAsarSha256}
  };
  const evidence = ProviderConformanceEvidence.validateCommercialEvidence(candidate);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const save = await dialog.showSaveDialog({
    title: '导出 API 商业验收证据',
    defaultPath: path.join(app.getPath('documents'), `FutureAI-provider-validation-${stamp}.json`),
    filters: [{name: 'JSON', extensions: ['json']}]
  });
  if (save.canceled || !save.filePath) return {canceled: true};
  const file = save.filePath.toLowerCase().endsWith('.json') ? save.filePath : `${save.filePath}.json`;
  const bytes = Buffer.from(JSON.stringify(evidence, null, 2), 'utf8');
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, bytes);
  await fs.rename(tempFile, file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  await shell.showItemInFolder(file);
  return {canceled: false, file, sha256};
}

function isTrustedRendererUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === path.resolve(path.join(__dirname, 'index.html'));
  } catch {
    return false;
  }
}

function isAllowedAppPageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'file:') return false;
    const resolved = path.resolve(fileURLToPath(url));
    return [
      path.resolve(path.join(__dirname, 'index.html')),
      path.resolve(path.join(__dirname, 'director-desk', 'index.html'))
    ].includes(resolved);
  } catch {
    return false;
  }
}

function isTopLevelWebFrame(frame) {
  return Boolean(frame) && frame.parent === null;
}

function assertTrustedRenderer(event) {
  const senderFrame = event?.senderFrame;
  if (!isTopLevelWebFrame(senderFrame) || !isTrustedRendererUrl(senderFrame?.url)) throw new Error('拒绝来自非应用主页面的敏感操作');
}

const createWindow = () => {
  const win = new BrowserWindow({
    show: !(INTERNAL_TEST_CHANNELS_ALLOWED && process.env.FUTURE_AI_LICENSE_E2E === '1'),
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b1020',
    title: '∞未来 AI',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b1020',
      symbolColor: '#eef1f7',
      height: 34
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  if (process.platform === 'win32' && typeof win.setTitleBarOverlay === 'function') {
    win.setTitleBarOverlay({
      color: '#090b0f',
      symbolColor: '#f2f4f7',
      height: 34
    });
  }
  win.setMenuBarVisibility(false);
  win.setAutoHideMenuBar(true);
  Menu.setApplicationMenu(null);

  win.loadFile(path.join(__dirname, 'index.html'));

  const blockUnexpectedNavigation = (event, url) => {
    if (!isAllowedAppPageUrl(url)) event.preventDefault();
  };
  win.webContents.on('will-navigate', blockUnexpectedNavigation);
  win.webContents.on('will-redirect', blockUnexpectedNavigation);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
};

ipcMain.handle('storage:chooseDir', async event => {
  assertTrustedRenderer(event);
  const result = await dialog.showOpenDialog({
    title: '选择本地存储文件夹',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return '';
  const root = await rememberStorageRoot(result.filePaths[0]);
  await ensureDir(safeStoragePath(root, 'media'));
  return root;
});

ipcMain.handle('storage:findProjectRoot', event => {
  assertTrustedRenderer(event);
  return findProjectRoot();
});

ipcMain.handle('storage:openDir', async (event, dir) => {
  assertTrustedRenderer(event);
  if (!dir) return false;
  const root = await ensureStorageRootAllowed(dir);
  await ensureDir(root);
  await shell.openPath(root);
  return true;
});

ipcMain.handle('storage:checkWritable', async (event, dir) => {
  assertTrustedRenderer(event);
  const root = await ensureStorageRootAllowed(dir);
  const probeDir = safeStoragePath(root, '.future-ai');
  const probe = path.join(probeDir, `.write-test-${process.pid}-${Date.now()}.tmp`);
  await ensureDir(probeDir);
  await fs.writeFile(probe, 'ok', 'utf8');
  await fs.rm(probe, {force: true});
  return {ok: true};
});

ipcMain.handle('storage:readJson', async (event, dir, name) => {
  assertTrustedRenderer(event);
  if (!dir) return null;
  await ensureStorageRootAllowed(dir);
  safeStoreFile(name);
  const result = await readStoreWithRecovery(dir, name);
  if (result.recovered) {
    event.sender.send('storage:recovery', {store: name, backup: path.basename(result.backupFile), corrupt: path.basename(result.corruptFile)});
    await appendAppLog('warn', 'json store automatically recovered', {store: name, backup: path.basename(result.backupFile), corrupt: path.basename(result.corruptFile)});
  }
  return result.value;
});

ipcMain.handle('storage:writeJson', async (event, dir, name, data) => {
  assertTrustedRenderer(event);
  if (!dir) return false;
  await ensureStorageRootAllowed(dir);
  await ensureDir(path.resolve(dir));
  const file = safeStoragePath(dir, safeStoreFile(name));
  assertStoreValue(data);
  return await enqueueStorageWrite(file, async () => {
    await backupStoreFile(dir, name, file);
    const tempFile = `${file}.${process.pid}.${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tempFile, file);
      return true;
    } finally {
      await fs.rm(tempFile, {force: true}).catch(() => {});
    }
  });
});

ipcMain.handle('storage:saveMedia', async (event, dir, payload) => {
  assertTrustedRenderer(event);
  if (!dir || !payload?.dataUrl) return '';
  await ensureStorageRootAllowed(dir);
  const mediaDir = safeStoragePath(dir, 'media');
  await ensureDir(mediaDir);
  const match = String(payload.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('素材不是可保存的数据格式');
  const mime = match[1];
  const defaultExt = mime.includes('video') ? 'mp4' : mime.includes('jpeg') ? 'jpg' : 'png';
  const requestedExt = String(payload.ext || '').trim().toLowerCase().replace(/^\./, '');
  const ext = /^[a-z0-9]{1,12}$/.test(requestedExt) ? requestedExt : defaultExt;
  const safeName = String(payload.name || 'media').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  const file = path.join(mediaDir, `${Date.now()}_${safeName}.${ext}`);
  await fs.writeFile(file, Buffer.from(match[2], 'base64'));
  return pathToFileURL(file).href;
});

ipcMain.handle('media:downloadRemoteImage', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  let url;
  try { url = new URL(String(payload.url || '')); } catch { throw new Error('图片地址无效'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持下载 HTTP/HTTPS 图片');

  const response = await fetch(url.href, {
    redirect: 'follow',
    signal: AbortSignal.timeout(45000),
    headers: {Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}
  });
  if (!response.ok) throw new Error(`图片服务器返回 ${response.status}`);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  const maxSize = 100 * 1024 * 1024;
  if (declaredSize > maxSize) throw new Error('图片超过 100 MB 下载限制');
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (received > maxSize) throw new Error('图片超过 100 MB 下载限制');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks, received);
  if (!bytes.length) throw new Error('图片内容为空');

  const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isGif = bytes.subarray(0, 6).toString('ascii').startsWith('GIF8');
  const isWebp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  const isAvif = bytes.subarray(4, 12).toString('ascii').includes('ftypavif') || bytes.subarray(4, 12).toString('ascii').includes('ftypavis');
  const ext = isPng ? 'png' : isJpeg ? 'jpg' : isGif ? 'gif' : isWebp ? 'webp' : isAvif ? 'avif' : '';
  if (!ext || (!mime.startsWith('image/') && mime !== 'application/octet-stream')) {
    throw new Error(mime.includes('json') ? '图片服务器返回了 JSON 错误内容，请检查图片链接是否已过期' : '服务器返回的内容不是受支持的图片格式');
  }

  const requestedName = path.basename(String(payload.name || 'future_canvas_image')).replace(/[\\/:*?"<>|]+/g, '_').replace(/\.[^.]+$/, '').slice(0, 100) || 'future_canvas_image';
  const save = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: '保存图片',
    defaultPath: path.join(app.getPath('downloads'), `${requestedName}.${ext}`),
    filters: [{name: `${ext.toUpperCase()} 图片`, extensions: [ext]}]
  });
  if (save.canceled || !save.filePath) return {canceled: true};
  const target = path.extname(save.filePath).toLowerCase() === `.${ext}` ? save.filePath : `${save.filePath}.${ext}`;
  await fs.writeFile(target, bytes, {flag: 'w'});
  return {canceled: false, filePath: target, ext, bytes: bytes.length};
});

ipcMain.handle('storage:readMedia', async (event, target) => {
  assertTrustedRenderer(event);
  if (!target) return '';
  const file = safeExistingMediaPath(target);
  const data = await fs.readFile(file);
  return `data:${mimeFromPath(file)};base64,${data.toString('base64')}`;
});

ipcMain.handle('media:index', async (event, payload) => {
  assertTrustedRenderer(event);
  return await buildMediaLibraryIndex(payload || {});
});

ipcMain.handle('storage:listProjectBackups', async (event, dir) => {
  assertTrustedRenderer(event);
  if (!dir) return [];
  return await listProjectBackups(dir);
});

ipcMain.handle('storage:restoreProjectBackup', async (event, dir, fileName) => {
  assertTrustedRenderer(event);
  if (!dir || !fileName) return false;
  return await restoreProjectBackup(dir, fileName);
});

ipcMain.handle('secret:getApiKey', async event => {
  assertTrustedRenderer(event);
  return await readApiKeySecret();
});

ipcMain.handle('secret:setApiKey', async (event, apiKey) => {
  assertTrustedRenderer(event);
  return await writeApiKeySecret(apiKey);
});

ipcMain.handle('secret:clearApiKey', async event => {
  assertTrustedRenderer(event);
  await fs.rm(apiKeyFile(), { force: true });
  return true;
});

ipcMain.handle('secret:getProviderApiKey', async (event, providerId) => {
  assertTrustedRenderer(event);
  return await readProviderApiKey(providerId);
});

ipcMain.handle('secret:getProviderApiKeyForKey', async (event, providerId, keyId) => {
  assertTrustedRenderer(event);
  return await readProviderApiKey(providerId, keyId);
});

ipcMain.handle('secret:listProviderApiKeys', async (event, providerId) => {
  assertTrustedRenderer(event);
  return await listProviderApiKeys(providerId);
});

ipcMain.handle('secret:setProviderApiKey', async (event, providerId, apiKey, keyId, label, scope) => {
  assertTrustedRenderer(event);
  return await writeProviderApiKey(providerId, apiKey, keyId, label, scope);
});

ipcMain.handle('secret:updateProviderApiKeyMetadata', async (event, providerId, keyId, metadata) => {
  assertTrustedRenderer(event);
  return await updateProviderApiKeyMetadata(providerId, keyId, metadata);
});

ipcMain.handle('secret:removeProviderApiKey', async (event, providerId, keyId) => {
  assertTrustedRenderer(event);
  return await removeProviderApiKey(providerId, keyId);
});

ipcMain.handle('secret:clearProviderApiKey', async (event, providerId) => {
  assertTrustedRenderer(event);
  return await clearProviderApiKey(providerId);
});

ipcMain.handle('license:getStatus', async event => {
  assertTrustedRenderer(event);
  await appendAppLog('info', 'license status requested');
  const status = await licenseService.getStatus();
  await appendAppLog('info', 'license status returned', { status: status.status });
  return status;
});

ipcMain.handle('license:redeem', async (event, redemptionCode) => {
  assertTrustedRenderer(event);
  const result = await licenseService.redeem(redemptionCode);
  await appendAppLog('info', 'license redeemed', {status: result.status, generation: result.generation});
  return result;
});

ipcMain.handle('license:release', async event => {
  assertTrustedRenderer(event);
  const result = await licenseService.release();
  await appendAppLog('info', 'license released', {deactivated: result.deactivated});
  return result;
});

ipcMain.handle('license:createActivationRequest', async (event, payload) => {
  assertTrustedRenderer(event);
  const result = await licenseService.createActivationRequest(payload || {});
  await appendAppLog('info', 'license activation request created');
  return result;
});

ipcMain.handle('license:importActivation', async (event, activationCode) => {
  assertTrustedRenderer(event);
  const result = await licenseService.importActivation(activationCode);
  await appendAppLog('info', 'license activation imported', { status: result.status, generation: result.generation });
  return result;
});

ipcMain.handle('license:deactivate', async event => {
  assertTrustedRenderer(event);
  const receipt = await licenseService.deactivate();
  await appendAppLog('info', 'license deactivated');
  return receipt;
});

ipcMain.handle('e2e:getConfig', async event => {
  assertTrustedRenderer(event);
  return E2E_CONFIG;
});

ipcMain.handle('e2e:focusWindow', async event => {
  assertTrustedRenderer(event);
  if (!E2E_CONFIG.enabled) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win.isFocused();
});

ipcMain.handle('e2e:writeReport', async (event, report) => {
  assertTrustedRenderer(event);
  if (!E2E_CONFIG.enabled) return false;
  return await writeE2EReport(report);
});

ipcMain.handle('e2e:quit', async (event, code) => {
  assertTrustedRenderer(event);
  if (!E2E_CONFIG.enabled) return false;
  const exitCode = Number.isFinite(Number(code)) ? Number(code) : 0;
  setTimeout(() => app.exit(exitCode), 50);
  return true;
});

ipcMain.handle('diagnostics:export', async (event, payload) => {
  assertTrustedRenderer(event);
  return await exportDiagnosticsPackage(payload);
});

ipcMain.handle('diagnostics:logRendererError', async (event, payload) => {
  assertTrustedRenderer(event);
  await appendAppLog('renderer-error', 'renderer error', payload || {});
  return true;
});

ipcMain.handle('support:getInfo', async event => {
  assertTrustedRenderer(event);
  return await buildSupportInfo({
    legalRoot: supportLegalRoot(),
    version: app.getVersion(),
    releaseChannel: releaseChannel(),
    packaged: app.isPackaged
  });
});

ipcMain.handle('support:readDocument', async (event, id) => {
  assertTrustedRenderer(event);
  return await readSupportDocument(supportLegalRoot(), String(id || ''));
});

ipcMain.handle('export:projectPackage', async (event, payload) => {
  assertTrustedRenderer(event);
  return await exportProjectPackage(payload || {});
});

ipcMain.handle('review:export', async (event, payload) => {
  assertTrustedRenderer(event);
  return await exportReviewPackage(payload || {});
});

ipcMain.handle('media:process', async (event, payload) => {
  assertTrustedRenderer(event);
  return await processLocalMedia(payload || {});
});

ipcMain.handle('backup:exportWorkspace', async (event, payload) => {
  assertTrustedRenderer(event);
  return await exportWorkspaceBackup(payload || {});
});

ipcMain.handle('backup:restoreWorkspace', async (event, payload) => {
  assertTrustedRenderer(event);
  return await restoreWorkspaceBackup(payload || {});
});

ipcMain.handle('manju:exportVideo', async (event, payload) => {
  assertTrustedRenderer(event);
  if (manjuExportActive) throw new Error('已有成片导出任务正在运行，请等待完成');
  manjuExportActive = true;
  try {
    return await exportManjuVideo(event, payload || {});
  } finally {
    manjuExportActive = false;
  }
});

ipcMain.handle('manju:synthesizeVoice', async (event, payload) => {
  assertTrustedRenderer(event);
  if (manjuVoiceActive) throw new Error('已有配音任务正在运行，请等待完成');
  manjuVoiceActive = true;
  try {
    return await synthesizeManjuVoice(payload || {});
  } finally {
    manjuVoiceActive = false;
  }
});

ipcMain.handle('provider:exportConformanceEvidence', async (event, payload) => {
  assertTrustedRenderer(event);
  return await exportProviderConformanceEvidence(payload || {});
});

ipcMain.handle('cleanup:scan', async (event, payload) => {
  assertTrustedRenderer(event);
  return await scanCleanupTargets(payload || {});
});

ipcMain.handle('cleanup:execute', async (event, payload) => {
  assertTrustedRenderer(event);
  return await executeCleanupTargets(payload || {});
});

ipcMain.handle('update:check', async (event, payload) => {
  assertTrustedRenderer(event);
  return await checkForLocalUpdate(payload || {});
});

ipcMain.handle('update:capabilities', event => {
  assertTrustedRenderer(event);
  return {
    mode: 'signed-nsis-installer',
    asarIntegrityPreserved: true,
    publisherManifestRequired: true,
    authenticodeRequired: true,
    workspaceBackupRequired: true,
    healthCheckRequired: true,
    automaticRollback: true,
    protected: UPDATE_PROTECTED_FILES,
    runtimeData: LOCAL_RUNTIME_PATHS.root
  };
});

ipcMain.handle('update:apply', async (event, payload) => {
  assertTrustedRenderer(event);
  return await applyLocalUpdatePackage(payload || {});
});

ipcMain.handle('update:rollback', async (event, payload) => {
  assertTrustedRenderer(event);
  return await rollbackLastUpdate(payload || {});
});

ipcMain.handle('update:healthReady', async event => {
  assertTrustedRenderer(event);
  return await reportInstallerUpdateHealth();
});

ipcMain.handle('update:getOutcome', async event => {
  assertTrustedRenderer(event);
  return await readInstallerUpdateOutcome();
});

ipcMain.handle('update:acknowledgeOutcome', async (event, payload) => {
  assertTrustedRenderer(event);
  return await acknowledgeInstallerUpdateOutcome(payload || {});
});

ipcMain.handle('codex:check', async (event, payload) => {
  assertTrustedRenderer(event);
  return await runCodexCheck(payload?.command);
});

ipcMain.handle('codex:chooseCommand', async event => {
  assertTrustedRenderer(event);
  if (!INTERNAL_TEST_CHANNELS_ALLOWED) return '';
  const result = await dialog.showOpenDialog({
    title: '选择 Codex CLI 程序',
    properties: ['openFile'],
    filters: [
      { name: '可执行程序', extensions: ['exe', 'cmd', 'bat', 'ps1'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return '';
  return result.filePaths[0];
});

ipcMain.handle('codex:saveAttachment', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  const cwd = payload.storageDir ? await ensureStorageRootAllowed(payload.storageDir) : packagedBaseDir();
  const sourcePath = String(payload.sourcePath || '').trim();
  const sourceStats = sourcePath ? await fs.stat(sourcePath) : null;
  if (sourceStats && !sourceStats.isFile()) throw new Error('附件不是可读取文件');
  const rawBytes = payload.bytes;
  const bytes = sourcePath ? null : rawBytes instanceof ArrayBuffer
    ? Buffer.from(new Uint8Array(rawBytes))
    : ArrayBuffer.isView(rawBytes)
      ? Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
      : Buffer.from(rawBytes || []);
  const byteLength = sourceStats?.size || bytes?.length || 0;
  if (!byteLength) throw new Error('附件内容为空');
  const isVideo = String(payload.mime || '').startsWith('video/');
  const maximumBytes = isVideo ? 2 * 1024 * 1024 * 1024 : 100 * 1024 * 1024;
  if (byteLength > maximumBytes) throw new Error(isVideo ? '单个视频不能超过 2 GB' : '单个附件不能超过 100 MB');

  const originalName = path.basename(String(payload.name || '附件'));
  const safeName = originalName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/^\.+/, '') || '附件';
  const attachmentDir = path.join(cwd, '.future-ai', 'attachments');
  await ensureDir(attachmentDir);
  const ext = path.extname(safeName);
  const stem = path.basename(safeName, ext).slice(0, 100) || '附件';
  const target = path.join(attachmentDir, `${stem}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  if (!pathInside(cwd, target)) throw new Error('附件路径超出当前工作目录');
  if (sourcePath) await fs.copyFile(sourcePath, target);
  else await fs.writeFile(target, bytes);
  return {
    path: target,
    name: originalName,
    mime: String(payload.mime || ''),
    size: byteLength
  };
});

ipcMain.handle('codex:videoFrames', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  const cwd = payload.storageDir ? await ensureStorageRootAllowed(payload.storageDir) : packagedBaseDir();
  const source = path.resolve(String(payload.path || ''));
  if (!pathInside(cwd, source)) throw new Error('视频路径超出当前工作目录');
  const stats = await fs.stat(source);
  if (!stats.isFile()) throw new Error('找不到可分析的视频文件');
  return await extractVideoUnderstandingFrames(source, payload.frameCount);
});

ipcMain.handle('codex:readTextAttachment', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  const cwd = payload.storageDir ? await ensureStorageRootAllowed(payload.storageDir) : packagedBaseDir();
  const source = path.resolve(String(payload.path || ''));
  if (!pathInside(cwd, source)) throw new Error('附件路径超出当前工作目录');
  const stats = await fs.stat(source);
  if (!stats.isFile()) throw new Error('找不到附件文件');
  if (stats.size > 100 * 1024 * 1024) throw new Error('附件超过 100 MB');
  const extension = path.extname(source).toLowerCase();
  if (extension === '.docx') {
    const entries = readZipEntries(await fs.readFile(source), {maxEntries: 512, maxUncompressedBytes: 32 * 1024 * 1024});
    const documentEntry = entries.find(entry => entry.name === 'word/document.xml');
    if (!documentEntry) throw new Error('DOCX 中缺少 word/document.xml');
    const xml = documentEntry.data.toString('utf8');
    const text = xml.replace(/<w:tab\s*\/>/gi, '\t').replace(/<w:br\s*\/>/gi, '\n').replace(/<\/w:p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
    return {text: text.slice(0, 60000), size: stats.size, truncated: text.length > 60000, format: 'docx'};
  }
  if (extension === '.zip') {
    const text = readZipTextSummary(await fs.readFile(source));
    return {text, size: stats.size, truncated: text.length >= 60000};
  }
  const readableExtensions = new Set(['.md', '.mdx', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.csv', '.tsv', '.xml', '.html', '.htm', '.css', '.scss', '.less', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.sh', '.ps1', '.bat', '.cmd', '.sql', '.vue', '.svelte', '.log']);
  if (!readableExtensions.has(path.extname(source).toLowerCase())) throw new Error('该附件不是可直接读取的文本格式');
  if (stats.size > 2 * 1024 * 1024) throw new Error('文本附件超过 2 MB，请缩小后重试');
  const buffer = await fs.readFile(source);
  if (buffer.includes(0)) throw new Error('附件包含二进制内容，无法按文本读取');
  const fullText = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const limit = 60000;
  return {text: fullText.slice(0, limit), size: stats.size, truncated: fullText.length > limit};
});

ipcMain.handle('short:readScriptImport', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  return ShortImports.readScriptImport(payload);
});
ipcMain.handle('short:importSkillPackage', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  return await ShortImports.storeSkillImport(path.join(app.getPath('userData'), 'short-skill-packages'), payload);
});
ipcMain.handle('short:readSkillPackage', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  return await ShortImports.readSkillPackage(path.join(app.getPath('userData'), 'short-skill-packages'), payload.packageId, payload.context);
});

ipcMain.handle('codex:run', async (event, payload) => {
  assertTrustedRenderer(event);
  return await startCodexRun(event, payload || {});
});

ipcMain.handle('codex:extensions', async event => {
  assertTrustedRenderer(event);
  const catalog = await sharedCodexExtensionCatalog();
  return { root: catalog.root, skills: catalog.skills, plugins: catalog.plugins };
});

ipcMain.handle('codex:chooseExtension', async (event, kind = 'skill') => {
  assertTrustedRenderer(event);
  const normalizedKind = extensionImportKind(kind);
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: normalizedKind === 'plugin' ? '导入本地插件' : '导入本地 Skill',
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: '扩展 ZIP', extensions: ['zip'] }, { name: '所有文件', extensions: ['*'] }]
  });
  return result.canceled || !result.filePaths[0] ? '' : result.filePaths[0];
});

ipcMain.handle('codex:importExtension', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  return await importCodexExtension(payload.kind, payload.source);
});

ipcMain.handle('codex:update', async (event, payload) => {
  assertTrustedRenderer(event);
  return await runCodexUpdate(event, payload || {});
});

ipcMain.handle('codex:cancel', async (event, sessionId) => {
  assertTrustedRenderer(event);
  return cancelCodexRun(sessionId);
});

ipcMain.handle('skillMarket:search', async (event, payload) => {
  assertTrustedRenderer(event);
  return await searchSkillMarket(payload || {});
});

ipcMain.handle('music:search', async (event, payload) => {
  assertTrustedRenderer(event);
  return await searchFreeMusicV3(payload || {});
});

ipcMain.handle('music:plugins', async event => {
  assertTrustedRenderer(event);
  return { plugins: musicPluginCatalog() };
});

ipcMain.handle('music:pluginRegistry', async event => {
  assertTrustedRenderer(event);
  return musicFreeCompatibleRegistry();
});

ipcMain.handle('music:resolveTrack', async (event, payload) => {
  assertTrustedRenderer(event);
  return musicFreeCompatibleResolveTrack(payload || {});
});

ipcMain.handle('media:searchVideo', async (event, payload) => {
  assertTrustedRenderer(event);
  return await searchFreeVideos(payload || {});
});

ipcMain.handle('media:searchRadio', async (event, payload) => {
  assertTrustedRenderer(event);
  return await searchOpenRadioStations(payload || {});
});

process.on('uncaughtException', err => {
  appendAppLog('fatal', 'uncaughtException', {
    name: err?.name,
    message: err?.message,
    stack: err?.stack
  });
});

process.on('unhandledRejection', reason => {
  appendAppLog('fatal', 'unhandledRejection', {
    message: reason?.message || String(reason),
    stack: reason?.stack
  });
});

app.whenReady().then(async () => {
  for (const root of allowedStorageRoots) {
    try {
      const recovery = await recoverWorkspaceRestore(root);
      if (recovery.recovered) await appendAppLog('warn', 'workspace restore transaction recovered', {root, action: recovery.action});
    } catch (error) {
      await appendAppLog('error', 'workspace restore recovery failed', {root, message: error?.message || String(error)});
    }
  }
  appendAppLog('info', 'app ready', { version: app.getVersion(), releaseChannel: RELEASE_CHANNEL || 'development', runtimePaths: LOCAL_RUNTIME_PATHS });
  // Non-blocking: keep only the latest Codex/update binary backups
  pruneRuntimeDiskFootprint();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
