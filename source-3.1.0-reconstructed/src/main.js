const { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage, globalShortcut } = require('electron');
const { uniqueTempPath, writeFileAtomic, writeFileAtomicUnlocked, writeJsonAtomic } = require('./runtime/atomic-write');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const os = require('os');
const APP_PACKAGE_METADATA = require('../package.json');
const { internalTestChannelsAllowed, readReleaseChannel } = require('./runtime/release-channel');
const { isolatedUserFolders, resolveIsolatedProfile } = require('./runtime/test-isolation');
const { resolveMovedStorageRoot } = require('./runtime/storage-relocate');
const { normalizeCodexPermission } = require('./runtime/codex-security');
const CodexCli = require('./runtime/codex-cli');
const UpdateCheck = require('./support/update-check');
const AgentPermissions = require('./agent/permissions');
const AgentLoop = require('./agent/loop');
const AgentSessionStore = require('./agent/session-store');
const AgentDocuments = require('./agent/documents');
const AgentModel = require('./agent/model');
const AgentTemplates = require('./agent/templates');
const AgentScheduler = require('./agent/scheduler');
const AgentAudit = require('./agent/audit');
const AgentMemory = require('./agent/memory');
const AgentGuiLock = require('./agent/gui-lock');
const AgentProcess = require('./agent/process');
const { createApprovalHub } = require('./agent/approval-queue');
const agentApprovalHub = createApprovalHub();
const { ensureRuntimeDirectories, runtimePathsFromRoot, selectRuntimePaths } = require('./runtime/runtime-paths');
const { RESTORE_JOURNAL_FORMAT, recoverWorkspaceRestore, restoreJournalFile, writeRestoreJournal } = require('./runtime/workspace-restore');
const { assertStoreValue, backupStoreSnapshot, backupValidStore, enforceBackupSizeCap, readValidStore, recoverStoreFromBackup } = require('./runtime/json-store-recovery');
const ProjectFiles = require('./runtime/project-files');
const MediaResolver = require('./runtime/media-resolver');
const { redactSecrets, safeLogEntry, sanitizeDiagnosticReport } = require('./diagnostics/diagnostic-privacy');
const { buildSupportInfo, readSupportDocument, resolveLegalRoot } = require('./support/support-service');
const {
  createMusicSourcePolicy,
  openMusicRights,
  platformStreamRights
} = require('./media/music-source-policy');
const { searchSkillMarket } = require('./skills/skill-market');
const { buildZip, readZipTextSummary, readZipEntries } = require('./runtime/zip-utils');
const ShortImports = require('./media/short-import-service');
const MediaProcessContract = require('./media/media-process-contract');
const ReviewPackage = require('./review/review-package');
const WallpaperStore = require('./runtime/wallpaper-store');
const TemplateStore = require('./runtime/template-store');
const PromptStore = require('./runtime/prompt-store');
const PortableLibrary = require('./runtime/portable-library');
const ProviderBalance = require('./runtime/provider-balance');
const { buildOfflineReviewEntries } = require('./review/review-export');

app.setName('∞未来 AI');

const RELEASE_CHANNEL = readReleaseChannel(APP_PACKAGE_METADATA);
const INTERNAL_TEST_CHANNELS_ALLOWED = internalTestChannelsAllowed(APP_PACKAGE_METADATA);
const DEFAULT_RUNTIME_ROOT = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'InfinityFutureAI');
// Exits early (via throw) when the flag is malformed or points at the real profile.
const ISOLATED_PROFILE = resolveIsolatedProfile(process.argv, DEFAULT_RUNTIME_ROOT);
// Test hooks (eval, e2e) run only inside an explicitly isolated profile, regardless of release channel.
const TEST_HOOKS_ALLOWED = ISOLATED_PROFILE.enabled;

const LOCAL_RUNTIME_DIR = 'runtime-data';
const STORAGE_ROOTS_FILE = 'allowed-storage-roots.json';
const API_KEY_FILE = 'api-key.json';
const PROVIDER_KEYS_FILE = 'provider-api-keys.json';
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
const allowedStorageRoots = new Set();
const cleanupScans = new Map();
const storageWriteQueues = new Map();
const codexSessions = new Map();
const agentSessions = new Map();
const agentCanvasJobs = new Map();
let agentScheduleTimer = null;
let agentEmergencyArmed = false;
let agentLastEmergencyAt = 0;
const agentScheduleInflight = new Set();

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
  },
  {
    id: 'libx264',
    args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']
  }
];

function packagedBaseDir() {
  return process.resourcesPath || path.dirname(app.getPath('exe'));
}

function configureLocalRuntimePaths(baseDir = packagedBaseDir()) {
  const legacyRoot = path.join(baseDir, LOCAL_RUNTIME_DIR);
  // An isolated profile never migrates from or falls back to any other location.
  const selection = ISOLATED_PROFILE.enabled
    ? { migrated: false, usingLegacy: false, paths: ensureRuntimeDirectories(runtimePathsFromRoot(ISOLATED_PROFILE.root)) }
    : selectRuntimePaths({ legacyRoot, targetRoot: DEFAULT_RUNTIME_ROOT });
  const paths = selection.paths;

  app.setPath('userData', paths.userData);
  app.setPath('sessionData', paths.sessionData);
  app.setAppLogsPath(paths.logs);
  app.setPath('crashDumps', paths.crashDumps);
  if (ISOLATED_PROFILE.enabled) {
    for (const [name, dir] of Object.entries(isolatedUserFolders(ISOLATED_PROFILE.root))) {
      fsSync.mkdirSync(dir, { recursive: true });
      app.setPath(name, dir);
    }
  }
  return { ...paths, legacyRoot, migration: selection };
}

const LOCAL_RUNTIME_PATHS = configureLocalRuntimePaths();

// One running copy per profile: a second launch (double-click, shortcut, 启动.cmd) focuses the open window
// instead of starting a second process that would fight over the same settings, keys and project files.
const SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
if (!SINGLE_INSTANCE_LOCK) app.exit(0);
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows().find(item => !item.isDestroyed());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
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
    const projects = await readProjectsForScan(root);
    if (!projects.length) continue;
    const updatedAt = projects.reduce((latest, project) => Math.max(latest, Number(project?.updatedAt || project?.createdAt || 0)), 0);
    candidates.push({root, updatedAt, count: projects.length});
  }
  candidates.sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt || a.root.localeCompare(b.root));
  return candidates[0]?.root || '';
}

async function persistAllowedStorageRoots() {
  const file = storageRootsFile();
  // Serialized + unique temp names: concurrent agent IPC calls used to collide on the same temp file.
  await writeJsonAtomic(file, [...allowedStorageRoots].sort());
}

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasExistingStoreFiles(root) {
  return ProjectFiles.hasSplitProjects(root) || Object.values(STORE_FILES).some(file => fsSync.existsSync(path.join(root, file)));
}

async function rememberStorageRoot(dir) {
  const root = path.resolve(String(dir || ''));
  if (!root) throw new Error('存储目录无效');
  if (allowedStorageRoots.has(root)) return root;
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

const RELATIVE_MEDIA_REF = /^media\/[^/\\:*?"<>|]+$/;

// Project/history JSON stores keep media as `media/<file>` relative to the
// storage root so a moved or restored workspace keeps working; the renderer
// always works with absolute file:// URLs.
function mapStoreStrings(value, mapString) {
  if (typeof value === 'string') return mapString(value);
  if (Array.isArray(value)) return value.map(item => mapStoreStrings(item, mapString));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStoreStrings(item, mapString)]));
  }
  return value;
}

function relativizeStoreMedia(dir, value) {
  const mediaDir = path.resolve(dir, 'media');
  return mapStoreStrings(value, text => {
    if (!text.startsWith('file:')) return text;
    let file;
    try { file = fileURLToPath(text); } catch { return text; }
    return path.relative(mediaDir, path.dirname(file)) === '' ? `media/${path.basename(file)}` : text;
  });
}

function absolutizeStoreMedia(dir, value) {
  return mapStoreStrings(value, text => RELATIVE_MEDIA_REF.test(text)
    ? pathToFileURL(path.join(path.resolve(dir), 'media', text.slice('media/'.length))).href
    : text);
}

// Every place an image may have ended up before the folder moved: the current
// media folder, other known storage roots, the default folder, the old in-app
// 数据 folder and the portable library/wallpaper folders.
function mediaResolverFor(dir) {
  const roots = [path.resolve(dir), ...allowedStorageRoots];
  let extra = [];
  try { extra = [path.join(defaultStorageDir(), 'media'), path.join(installDir(), '数据', 'media')]; } catch {}
  return MediaResolver.createResolver({
    mediaDirs: [...roots.map(root => path.join(root, 'media')), ...extra],
    libraryDirs: (() => { try { return libraryDirs(); } catch { return []; } })(),
    wallpaperDirs: (() => { try { return wallpaperDirs(); } catch { return []; } })()
  });
}

async function repairStoreMediaRefs(dir, value) {
  if (value == null) return {value, repaired: 0, imported: 0, missing: []};
  return await MediaResolver.repairStoreRefs(value, {mediaDir: path.join(path.resolve(dir), 'media'), resolver: mediaResolverFor(dir)});
}

// Store values are written with every media file inside <dir>/media so they can
// be stored relative to the folder (portable when the folder is moved/copied).
async function prepareStoreValueForWrite(dir, value, {importForeign = true} = {}) {
  if (!importForeign) return relativizeStoreMedia(dir, value);
  const {value: localized} = await MediaResolver.importForeignRefs(value, {mediaDir: path.join(path.resolve(dir), 'media')});
  return relativizeStoreMedia(dir, localized);
}

// Before the first automatic ref repair rewrites projects, keep the original files.
async function backupProjectsBeforeRepair(dir) {
  const source = safeStoragePath(dir, ProjectFiles.PROJECTS_DIR);
  const target = safeStoragePath(dir, 'backups', `pre-media-repair-${timestampForBackup()}`);
  let entries = [];
  try { entries = await fs.readdir(source, {withFileTypes: true}); } catch { return ''; }
  await ensureDir(target);
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) await fs.copyFile(path.join(source, entry.name), path.join(target, entry.name));
  }
  return target;
}

// Used until the user picks their own folder, so results still persist locally.
function defaultStorageDir() {
  return path.join(app.getPath('documents'), '∞未来AI');
}

async function copyStorageMedia(fromDir, toDir) {
  const from = safeStoragePath(await ensureStorageRootAllowed(fromDir), 'media');
  const to = safeStoragePath(await ensureStorageRootAllowed(toDir), 'media');
  await ensureDir(to);
  let copied = 0;
  let entries = [];
  try { entries = await fs.readdir(from, {withFileTypes: true}); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith('.tmp')) continue;
    const target = path.join(to, entry.name);
    if (fsSync.existsSync(target)) continue;
    await fs.copyFile(path.join(from, entry.name), target);
    copied += 1;
  }
  return {copied, fromPrefix: `${pathToFileURL(from).href}/`, toPrefix: `${pathToFileURL(to).href}/`};
}

function installDir() {
  return path.dirname(app.getPath('exe'));
}

function storageDirInsideInstallDir(dir) {
  return app.isPackaged && pathInside(installDir(), path.resolve(String(dir || '')));
}

const STALE_TEMP_AGE_MS = 60 * 1000;

async function removeStaleTempFiles(dir) {
  let entries;
  try { entries = await fs.readdir(dir, {withFileTypes: true}); } catch { return 0; }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.tmp')) continue;
    const file = path.join(dir, entry.name);
    try {
      const stats = await fs.stat(file);
      if (Date.now() - stats.mtimeMs < STALE_TEMP_AGE_MS) continue;
      await fs.rm(file, {force: true});
      removed += 1;
    } catch {}
  }
  return removed;
}

async function cleanStaleStorageTempFiles() {
  for (const root of allowedStorageRoots) {
    let removed = 0;
    const dirs = [root, path.join(root, 'media'), path.join(root, ProjectFiles.PROJECTS_DIR), path.join(root, 'backups', 'projects')];
    try {
      for (const entry of await fs.readdir(path.join(root, 'backups', 'stores'), {withFileTypes: true})) {
        if (entry.isDirectory()) dirs.push(path.join(root, 'backups', 'stores', entry.name));
      }
    } catch {}
    for (const dir of dirs) removed += await removeStaleTempFiles(dir);
    if (removed) await appendAppLog('info', 'removed stale storage temp files', {count: removed});
  }
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

// Project backups are history-free snapshots of all projects (undo history is excluded).
async function backupProjectsSnapshot(dir, projects, {force = false} = {}) {
  return await backupStoreSnapshot({
    value: ProjectFiles.projectsWithoutHistory(projects),
    ...(force ? {minIntervalMs: 0} : {}),
    backupDir: projectBackupsDir(dir),
    backupName: `${timestampForBackup()}-projects.json`,
    suffix: '-projects.json'
  });
}

async function backupStoreFile(dir, name, file) {
  return await backupValidStore({
    file,
    backupDir: storeBackupsDir(dir, name),
    backupName: `${timestampForBackup()}-${path.basename(file)}`
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

async function recoverProjectFromSnapshots(dir, id) {
  for (const backup of await listProjectBackups(dir)) {
    try {
      const project = (await readValidStore(safeProjectBackupPath(dir, backup.fileName))).find(item => item?.id === id);
      if (project) return project;
    } catch {}
  }
  return null;
}

// Single read path for projects: migrates a legacy projects.json, otherwise reads
// the per-project files (recovering unreadable ones from snapshots).
async function readProjectsStore(dir) {
  return await enqueueStorageWrite(safeStoragePath(dir, ProjectFiles.PROJECTS_DIR), async () => {
    if (ProjectFiles.hasLegacyProjects(dir)) {
      const legacy = await readStoreWithRecovery(dir, 'projects');
      const migratedTo = await ProjectFiles.migrateLegacyProjects(dir, legacy.value);
      await appendAppLog('info', 'projects.json migrated to per-project files', {projects: legacy.value.length, backup: path.basename(migratedTo)});
      return {value: legacy.value, recovery: legacy.recovered ? {backup: path.basename(legacy.backupFile), corrupt: path.basename(legacy.corruptFile)} : null};
    }
    if (!ProjectFiles.hasSplitProjects(dir)) return {value: null, recovery: null};
    const {projects, recovered} = await ProjectFiles.readSplitProjects(dir, {recoverProject: id => recoverProjectFromSnapshots(dir, id)});
    return {value: projects, recovery: recovered.length ? {backup: '项目快照备份', corrupt: recovered.join(', ')} : null};
  });
}

async function writeProjectsStore(dir, projects) {
  return await enqueueStorageWrite(safeStoragePath(dir, ProjectFiles.PROJECTS_DIR), async () => {
    await ProjectFiles.retireLegacyProjects(dir);
    await ProjectFiles.writeSplitProjects(dir, projects);
    await backupProjectsSnapshot(dir, projects);
    await enforceBackupSizeCap([projectBackupsDir(dir), safeStoragePath(dir, 'backups', 'stores')]);
    return true;
  });
}

// Tolerant read for scans/diagnostics: never migrates or throws.
async function readProjectsForScan(root) {
  try {
    if (ProjectFiles.hasSplitProjects(root)) return absolutizeStoreMedia(root, (await ProjectFiles.readSplitProjects(root)).projects);
    const legacy = JSON.parse(await fs.readFile(path.join(root, ProjectFiles.LEGACY_FILE), 'utf8'));
    return Array.isArray(legacy) ? absolutizeStoreMedia(root, legacy) : [];
  } catch {
    return [];
  }
}

async function restoreProjectBackup(dir, fileName) {
  await ensureStorageRootAllowed(dir);
  const restored = await readValidStore(safeProjectBackupPath(dir, fileName));
  const current = await readProjectsStore(dir);
  if (current.value) await backupProjectsSnapshot(dir, current.value, {force: true});
  await enqueueStorageWrite(safeStoragePath(dir, ProjectFiles.PROJECTS_DIR), () => ProjectFiles.writeSplitProjects(dir, restored));
  return true;
}

loadAllowedStorageRoots();

function e2eConfig() {
  if (!TEST_HOOKS_ALLOWED || process.env.FUTURE_CANVAS_E2E !== '1') return { enabled: false };
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
  await waitForSecretEncryption();
  try {
    const data = JSON.parse(await fs.readFile(apiKeyFile(), 'utf8'));
    if (data.format === 'safeStorage-v1' && typeof data.ciphertext === 'string') {
      requireSecretEncryption();
      try {
        return safeStorage.decryptString(Buffer.from(data.ciphertext, 'base64'));
      } catch (error) {
        // Ciphertext from an older Windows keyring cannot be decrypted; treat it as
        // "no saved key" so the user can simply re-enter it instead of seeing a
        // misleading "secure storage unavailable" warning on every launch.
        await appendAppLog('warn', 'stale global API key ciphertext ignored', { message: error?.message || String(error) });
        return '';
      }
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

// safeStorage can report unavailable for a short moment right after startup on
// Windows; poll briefly before concluding the system keyring is unusable.
async function waitForSecretEncryption(timeoutMs = 2000, intervalMs = 100) {
  await app.whenReady();
  const deadline = Date.now() + timeoutMs;
  while (!safeStorage.isEncryptionAvailable() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return safeStorage.isEncryptionAvailable();
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
  await writeJsonAtomic(file, record);
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
  await writeJsonAtomic(providerKeysFile(), store);
}

// Stored format is {format: 'safeStorage-pool-v1', keys: [...]}; older versions
// wrote a single safeStorage-v1 record or several pool entries. Only the first
// decryptable entry is used now.
function normalizeStoredProviderKeyEntries(record) {
  if (record && record.format === 'safeStorage-pool-v1' && Array.isArray(record.keys)) {
    return record.keys
      .map((item, index) => ({id: String(item?.id || `key-${index + 1}`).trim(), ciphertext: String(item?.ciphertext || '')}))
      .filter(item => item.id && item.ciphertext);
  }
  const value = decryptProviderKeyRecord(record);
  return value ? [{id: 'key-1', ciphertext: encryptProviderKeyRecord(value).ciphertext}] : [];
}

async function readProviderKeyEntries(providerId) {
  const id = sanitizeProviderKeyId(providerId);
  await waitForSecretEncryption();
  const store = await readProviderKeyStore();
  let entries = [];
  try {
    entries = normalizeStoredProviderKeyEntries(store[id]);
  } catch {
    // Undecryptable legacy ciphertext (e.g. after a Windows profile migration).
    entries = [];
  }
  const decrypted = entries.map(entry => {
    try {
      return {...entry, apiKey: decryptProviderKeyRecord({format: 'safeStorage-v1', ciphertext: entry.ciphertext})};
    } catch {
      return {...entry, apiKey: ''};
    }
  }).filter(entry => entry.apiKey);
  return decrypted;
}

async function readProviderApiKey(providerId) {
  const entries = await readProviderKeyEntries(providerId);
  return entries[0]?.apiKey || '';
}

async function writeProviderApiKey(providerId, apiKey) {
  // One Key per provider: saving replaces whatever was stored before (including
  // extra entries left by older multi-key versions).
  const id = sanitizeProviderKeyId(providerId);
  const store = await readProviderKeyStore();
  const record = encryptProviderKeyRecord(apiKey);
  if (!record) return false;
  store[id] = {format: 'safeStorage-pool-v1', keys: [{id: 'key-1', label: '主 Key', scope: 'all', ciphertext: record.ciphertext}]};
  await writeProviderKeyStore(store);
  return {id: 'key-1'};
}

async function clearProviderApiKey(providerId) {
  const id = sanitizeProviderKeyId(providerId);
  const store = await readProviderKeyStore();
  delete store[id];
  await writeProviderKeyStore(store);
  return true;
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
  const projects = storageDir ? await readProjectsForScan(storageDir) : [];
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

function exportFileName(item, index, source) {
  const title = String(item.title || item.mediaType || 'media').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 60) || 'media';
  return `${String(index + 1).padStart(3, '0')}-${title}${path.extname(source).toLowerCase()}`;
}

// Canvas assistant export: the user picks the folder or ZIP file; only local media inside storage roots is read.
async function exportCanvasMedia(event, payload = {}) {
  await ensureStorageRootAllowed(payload.storageDir);
  const items = (Array.isArray(payload.items) ? payload.items : []).slice(0, 2000);
  if (!items.length) throw new Error('没有可导出的媒体');
  const zip = payload.format === 'zip';
  const owner = BrowserWindow.fromWebContents(event.sender);
  const defaultPath = path.join(app.getPath('documents'), zip ? `画布导出-${timestampForBackup()}.zip` : '');
  const picked = zip
    ? await dialog.showSaveDialog(owner, { title: '导出为 ZIP', defaultPath, filters: [{ name: 'ZIP', extensions: ['zip'] }] })
    : await dialog.showOpenDialog(owner, { title: '选择导出文件夹', defaultPath: app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
  const target = zip ? picked.filePath : picked.filePaths?.[0];
  if (picked.canceled || !target) return null;
  const sources = [];
  let failed = 0;
  for (const [index, item] of items.entries()) {
    try {
      const source = await safeExistingMediaPathReal(item.sourceUrl);
      sources.push({ source, name: exportFileName(item, index, source) });
    } catch (_err) {
      failed += 1;
    }
  }
  if (zip) {
    const entries = await Promise.all(sources.map(async item => ({ name: item.name, data: await fs.readFile(item.source) })));
    await writeFileAtomic(target, buildZip(entries));
  } else {
    for (const item of sources) {
      // COPYFILE_EXCL: never overwrite a file already in the chosen folder.
      await fs.copyFile(item.source, path.join(target, item.name), fsSync.constants.COPYFILE_EXCL).catch(() => { failed += 1; item.skipped = true; });
    }
  }
  const count = sources.filter(item => !item.skipped).length;
  if (!E2E_CONFIG.enabled) shell.showItemInFolder(zip ? target : path.join(target, sources.find(item => !item.skipped)?.name || ''));
  await appendAppLog('info', 'canvas media exported', { format: zip ? 'zip' : 'folder', count, failed });
  return { target, count, failed };
}

async function exportSharePackage(event, payload = {}) {
  await ensureStorageRootAllowed(payload.storageDir);
  const items = (Array.isArray(payload.items) ? payload.items : []).slice(0, 500);
  if (!items.length) throw new Error('没有可导出的媒体');
  const owner = BrowserWindow.fromWebContents(event.sender);
  const stamp = timestampForBackup();
  const defaultName = `分享包-${stamp}.zip`;
  let target = '';
  // Isolated-profile / E2E smokes may pass e2eTarget to skip the save dialog.
  if (TEST_HOOKS_ALLOWED && payload.e2eTarget) {
    target = path.resolve(String(payload.e2eTarget));
  } else {
    const picked = await dialog.showSaveDialog(owner, {
      title: '导出分享包',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (picked.canceled || !picked.filePath) return null;
    target = picked.filePath;
  }
  if (!/\.zip$/i.test(target)) target += '.zip';

  const zipEntries = [];
  const manifestItems = [];
  let mediaCount = 0;
  let failed = 0;
  for (const [index, item] of items.entries()) {
    const title = String(item.title || ('素材' + (index + 1))).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() || ('素材' + (index + 1));
    const fileBase = String(item.fileBase || `${String(index + 1).padStart(3, '0')}-${title.slice(0, 48)}`);
    const prompt = String(item.prompt || '');
    try {
      let data;
      let ext = '.bin';
      const sourceUrl = String(item.sourceUrl || '');
      if (/^data:/i.test(sourceUrl)) {
        const match = sourceUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
        if (!match) throw new Error('无法解析内嵌图片');
        const mime = match[1] || 'application/octet-stream';
        const raw = match[3] || '';
        data = match[2] ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw));
        if (/png/i.test(mime)) ext = '.png';
        else if (/jpeg|jpg/i.test(mime)) ext = '.jpg';
        else if (/webp/i.test(mime)) ext = '.webp';
        else if (/gif/i.test(mime)) ext = '.gif';
        else if (/mp4/i.test(mime)) ext = '.mp4';
        else if (/webm/i.test(mime)) ext = '.webm';
      } else {
        const source = await safeExistingMediaPathReal(sourceUrl);
        data = await fs.readFile(source);
        ext = path.extname(source).toLowerCase() || (item.mediaType === 'video' ? '.mp4' : '.png');
      }
      const mediaName = `media/${fileBase}${ext}`;
      zipEntries.push({ name: mediaName, data });
      mediaCount += 1;
      manifestItems.push({
        title,
        mediaType: item.mediaType || 'image',
        model: item.model || '',
        size: item.size || '',
        prompt,
        file: mediaName,
        bytes: data.length
      });
    } catch (err) {
      failed += 1;
      manifestItems.push({
        title,
        mediaType: item.mediaType || 'image',
        prompt,
        error: String(err?.message || err || '导出失败')
      });
    }
  }
  if (!mediaCount) throw new Error('没有可复制到分享包的本地媒体（远程未保存的图请先下载或加入资产库）');

  const projectName = String(payload.projectName || '未命名项目');
  const scopeLabel = payload.scope === 'canvas' ? '整板' : '选中节点';
  const exportedAt = new Date().toISOString();
  const readmeLines = [
    '# ∞未来 AI 分享包',
    '',
    '这是用 ∞未来 AI 导出的分享包，可直接发给同事或客户。',
    '',
    `- 导出时间：${exportedAt}`,
    `- 项目：${projectName}`,
    `- 范围：${scopeLabel}`,
    `- 素材数：${mediaCount}`
  ];
  if (failed) readmeLines.push(`- 跳过：${failed}`);
  readmeLines.push(
    '',
    '## 文件夹说明',
    '- `media/`：图片和视频文件',
    '- `prompts.md`：每张图对应的提示词',
    '- `manifest.json`：机器可读清单',
    '',
    '## 使用建议',
    '- 直接打开 `media` 查看成品。',
    '- 需要复用提示词时，看 `prompts.md`。',
    '- 本包不含 API 密钥，也不含完整项目备份。',
    '',
    '## 素材列表',
    ...manifestItems.filter(item => item.file).map((item, index) => `${index + 1}. ${item.title}（${item.mediaType === 'video' ? '视频' : '图片'}）`),
    ''
  );
  const readme = readmeLines.join('\n');

  const promptLines = [
    '# 提示词清单',
    '',
    `项目：${projectName}`,
    `共 ${manifestItems.length} 项`,
    ''
  ];
  manifestItems.forEach((item, index) => {
    promptLines.push(`## ${index + 1}. ${item.title}`);
    promptLines.push(`- 类型：${item.mediaType === 'video' ? '视频' : '图片'}`);
    if (item.model) promptLines.push(`- 模型：${item.model}`);
    if (item.size) promptLines.push(`- 尺寸：${item.size}`);
    if (item.file) promptLines.push(`- 文件：${item.file}`);
    else promptLines.push(`- 状态：${item.error || '跳过'}`);
    promptLines.push('');
    promptLines.push(item.prompt || '（无提示词）');
    promptLines.push('');
  });
  const prompts = promptLines.join('\n');

  zipEntries.push({ name: '分享说明.md', data: Buffer.from(readme, 'utf8') });
  zipEntries.push({ name: 'prompts.md', data: Buffer.from(prompts, 'utf8') });
  zipEntries.push({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify({
      schemaVersion: 1,
      kind: 'futureai-share-package',
      exportedAt,
      projectName,
      scope: payload.scope || 'selection',
      mediaCount,
      failed,
      items: manifestItems
    }, null, 2), 'utf8')
  });

  await writeFileAtomic(target, buildZip(zipEntries));
  if (!E2E_CONFIG.enabled && !(TEST_HOOKS_ALLOWED && payload.e2eTarget)) shell.showItemInFolder(target);
  await appendAppLog('info', 'share package exported', { target, mediaCount, failed });
  return { target, mediaCount, failed, zipFile: target };
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
  for (const [name, fileName] of Object.entries(STORE_FILES)) {
    if (name === 'projects' && ProjectFiles.hasSplitProjects(storageDir)) {
      const {projects} = await ProjectFiles.readSplitProjects(storageDir);
      files.push({ content: Buffer.from(JSON.stringify(projects), 'utf8'), relative: `stores/${fileName}` });
      continue;
    }
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
      const size = item.content ? item.content.length : (await fs.stat(item.source)).size;
      totalBytes += size;
      if (totalBytes > WORKSPACE_BACKUP_TOTAL_LIMIT) throw new Error('工作区超过 20 GB，请先清理无用媒体后再备份');
      const destination = path.join(backupDir, ...backupRelativePath(item.relative).split('/'));
      if (!pathInside(backupDir, destination)) throw new Error('备份目标路径越界');
      await ensureDir(path.dirname(destination));
      if (item.content) await fs.writeFile(destination, item.content);
      else await fs.copyFile(item.source, destination);
      manifestFiles.push({ path: item.relative, size, sha256: await fileSha256(destination) });
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
    for (const [name, fileName] of Object.entries(STORE_FILES)) {
      if (name !== 'projects') addPlanned(path.join(stageRoot, 'stores', fileName), safeStoragePath(storageDir, fileName));
    }
    await ProjectFiles.writeSplitProjects(stageRoot, JSON.parse(await fs.readFile(path.join(stageRoot, 'stores', STORE_FILES.projects), 'utf8')));
    addPlanned(path.join(stageRoot, ProjectFiles.PROJECTS_DIR), safeStoragePath(storageDir, ProjectFiles.PROJECTS_DIR));
    await ProjectFiles.retireLegacyProjects(storageDir);
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
    ProjectFiles.forgetWrittenFiles();
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

function getCurrentAppVersion() {
  return app.getVersion();
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

async function buildMediaLibraryIndex(payload = {}) {
  const storageDir = await ensureStorageRootAllowed(payload.storageDir);
  const mediaDir = safeStoragePath(storageDir, 'media');
  const projects = await readProjectsForScan(storageDir);
  const history = absolutizeStoreMedia(storageDir, await readJsonIfExists(safeStoragePath(storageDir, 'history.json'), []));
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

// Earlier versions copied the bundled Codex (~300MB each) into user-data; nothing uses them now.
async function cleanupLegacyCodexCopies() {
  const entries = [];
  for (const [name, label] of [['codex', '旧版内置 Codex 副本'], ['codex-backups', '旧版 Codex 备份']]) {
    const file = path.join(LOCAL_RUNTIME_PATHS.userData, name);
    if (fsSync.existsSync(file)) entries.push(cleanupItem('codexBackup', file, label, await fileSizeIfExists(file)));
  }
  return entries;
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

// Media cleanup must never delete a file that anything may still point at:
// every JSON store and project backup is scanned, a file counts as referenced
// when its name appears in any string (relative, absolute or old-folder path),
// recent files are kept (a generation may not be saved yet), and the scan is
// aborted when the projects cannot be read.
const CLEANUP_MEDIA_MIN_AGE_MS = 24 * 60 * 60 * 1000;
function collectMediaNames(value, names = new Set(), depth = 0) {
  if (typeof value === 'string') {
    if (value.length < 4096 || !value.startsWith('data:')) {
      const re = /([0-9a-f]{16,}|[\w.-]+)\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|mp3|wav|m4a|ogg|flac)\b/ig;
      let m;
      while ((m = re.exec(value))) names.add(m[0].toLowerCase());
    }
    return names;
  }
  if (depth > 40 || !value || typeof value !== 'object') return names;
  for (const item of Array.isArray(value) ? value : Object.values(value)) collectMediaNames(item, names, depth + 1);
  return names;
}
async function collectStoreMediaNames(root) {
  const names = new Set();
  if (ProjectFiles.hasSplitProjects(root)) {
    collectMediaNames((await ProjectFiles.readSplitProjects(root)).projects, names);
  }
  const jsonDirs = [root, path.join(root, 'projects'), path.join(root, 'backups', 'projects')];
  try {
    for (const entry of await fs.readdir(path.join(root, 'backups'), { withFileTypes: true })) {
      if (entry.isDirectory()) jsonDirs.push(path.join(root, 'backups', entry.name));
    }
  } catch {}
  try {
    for (const entry of await fs.readdir(path.join(root, 'backups', 'stores'), { withFileTypes: true })) {
      if (entry.isDirectory()) jsonDirs.push(path.join(root, 'backups', 'stores', entry.name));
    }
  } catch {}
  for (const dir of jsonDirs) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.json(\.bak)?$/i.test(entry.name)) continue;
      try { collectMediaNames(JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf8')), names); }
      catch (err) {
        if (dir === root && /^projects/i.test(entry.name)) throw new Error(`无法读取 ${entry.name}，已停止清理媒体以免误删：${err.message}`);
      }
    }
  }
  return names;
}

async function cleanupUnreferencedMedia(storageDir) {
  if (!storageDir) return [];
  const root = await ensureStorageRootAllowed(storageDir);
  const mediaDir = safeStoragePath(root, 'media');
  const names = await collectStoreMediaNames(root);
  const items = [];
  const now = Date.now();
  try {
    for (const entry of await fs.readdir(mediaDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(mediaDir, entry.name);
      if (names.has(entry.name.toLowerCase())) continue;
      const stats = await fs.stat(file).catch(() => null);
      if (!stats || now - stats.mtimeMs < CLEANUP_MEDIA_MIN_AGE_MS) continue;
      items.push(cleanupItem('unreferencedMedia', file, entry.name, stats.size));
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
    ...await cleanupLegacyCodexCopies(),
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
      'resources/ffmpeg',
      'api-key.json',
      'provider-api-keys.json',
      'projects/',
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

function trimCodexOutput(output) {
  const text = String(output || '');
  return text.length > CODEX_OUTPUT_LIMIT ? text.slice(-CODEX_OUTPUT_LIMIT) : text;
}

function codexHomeDir() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, 'codex-home');
}

// A Codex CLI path the user picked in Settings. Only main writes it, after a file dialog.
function codexCommandFile() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, 'codex-command.json');
}

function savedCodexCommand() {
  try {
    return String(JSON.parse(fsSync.readFileSync(codexCommandFile(), 'utf8')).path || '');
  } catch (_err) {
    return '';
  }
}

function runCodexProbe(launch, args, timeoutMs = 10000) {
  return new Promise(resolve => {
    let child;
    let output = '';
    try {
      child = spawn(launch.command, [...launch.prefixArgs, ...args], { windowsHide: true, env: { ...process.env, ...launch.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, output: '', error: err?.message || String(err) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, output, error: '检测超时' });
    }, timeoutMs);
    child.stdout?.on('data', data => { output += data.toString(); });
    child.stderr?.on('data', data => { output += data.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, output, error: err?.message || String(err) });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: trimCodexOutput(output), error: code === 0 ? '' : `退出码 ${code}` });
    });
  });
}

function whereCodexOutput() {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(finder, process.platform === 'win32' ? ['codex'] : ['-a', 'codex'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
  return result.status === 0 ? result.stdout : '';
}

let codexDetection = null;

async function detectCodex({ force = false } = {}) {
  if (codexDetection && !force) return codexDetection;
  codexDetection = CodexCli.detectCodexCli({
    override: savedCodexCommand(),
    candidates: CodexCli.codexCandidates({ env: process.env, homedir: os.homedir(), whereOutput: whereCodexOutput() }),
    fsApi: fsSync,
    run: runCodexProbe
  });
  return codexDetection;
}

function codexStatusForRenderer(result) {
  return { ok: result.ok, path: result.path, version: result.version, overridden: !!result.overridden, error: result.error || '', installUrl: CodexCli.CODEX_INSTALL_URL };
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

/**
 * Which CODEX_HOME a run uses:
 * - With the app's text API configured, an app-managed home is written for each run,
 *   so the user's own ~/.codex config is never rewritten.
 * - Without it, the user's own Codex home is used as-is, so an existing `codex login`
 *   works and they do not have to sign in twice.
 */
async function codexLaunchEnv({ apiKey = '', baseUrl = '', model = '', useSharedExtensions = true, sharedPluginIds = null } = {}) {
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!normalizedBaseUrl || !apiKey) {
    const userHome = CodexCli.userCodexHome({ env: process.env, homedir: os.homedir() });
    if (!fsSync.existsSync(path.join(userHome, 'auth.json'))) {
      throw new Error('Codex 尚未登录：请在设置里配置文本 API 和密钥，或在终端运行 codex login 后重试');
    }
    const env = { ...process.env, CODEX_HOME: userHome, NO_COLOR: '1' };
    delete env.OPENAI_API_KEY;
    return env;
  }
  const home = codexHomeDir();
  await ensureDir(home);
  const configFile = path.join(home, 'config.toml');
  const extensions = useSharedExtensions ? await sharedCodexExtensionCatalog({ enabledPluginIds: sharedPluginIds }) : { config: '' };
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
  // Do not inherit a developer's global Codex home: its plugins and agent files
  // are unrelated to this application's assistant and can break every run.
  const env = { ...process.env, CODEX_HOME: home, NO_COLOR: '1' };
  delete env.OPENAI_BASE_URL;
  delete env.OPENAI_MODEL;
  env.OPENAI_API_KEY = String(apiKey);
  return env;
}

async function pruneRuntimeDiskFootprint() {
  try {
    const updateRemoved = await pruneUpdateAsarBackups();
    if (updateRemoved) {
      await appendAppLog('info', 'runtime disk footprint pruned', {
        updateAsarBackupsRemoved: updateRemoved,
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
  if (key === 'readonly') return { sandbox: 'read-only', label: '只读审查' };
  if (key === 'full') return { sandbox: 'danger-full-access', label: '完全开发' };
  return { sandbox: 'workspace-write', label: '项目内开发' };
}

// Codex never works inside the install directory: use the chosen storage folder, or the default one.
async function codexWorkingDir(storageDir) {
  if (storageDir) return await ensureStorageRootAllowed(storageDir);
  const root = await rememberStorageRoot(defaultStorageDir());
  await ensureDir(root);
  return root;
}

// `codex exec` is non-interactive, so any run that may write files is approved here, per run.
async function approveCodexRun(event, { cwd, permission, prompt }) {
  if (permission.sandbox === 'read-only') return;
  const full = permission.sandbox === 'danger-full-access';
  const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'warning',
    title: '确认 Codex 任务',
    message: full ? '本次 Codex 任务可以执行命令并修改工作目录之外的文件。' : `本次 Codex 任务可以执行命令并修改：${cwd}`,
    detail: `权限：${permission.label}\n任务：${prompt.length > 300 ? `${prompt.slice(0, 300)}…` : prompt}\n\n此确认只对本次运行有效。`,
    buttons: ['取消', '允许运行'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (result.response !== 1) throw new Error('已取消 Codex 任务');
}

async function startCodexRun(event, payload = {}) {
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) throw new Error('请先输入要交给 Codex 的任务');
  let cli = await detectCodex();
  if (!cli.ok) cli = await detectCodex({ force: true });
  if (!cli.ok) throw new Error(`安装 Codex 以启用电脑自动化：${CodexCli.CODEX_INSTALL_URL}`);
  if (prompt.length > CODEX_PROMPT_LIMIT) throw new Error('任务内容过长，请拆成更小的任务');
  const cwd = await codexWorkingDir(payload.storageDir);
  const sessionId = crypto.randomUUID();
  const requestedPermission = normalizeCodexPermission(payload.permission, { internal: INTERNAL_TEST_CHANNELS_ALLOWED, scheduled: payload.scheduled === true });
  const permission = codexPermissionConfig(requestedPermission);
  await approveCodexRun(event, { cwd, permission, prompt });
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
    child = spawn(cli.launch.command, [...cli.launch.prefixArgs, ...args], { cwd, env: { ...env, ...cli.launch.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
  sendCodexOutput(sender, { sessionId, type: 'start', text: `Codex：${cli.path}（${cli.version}）\n工作目录：${cwd}\n开发权限：${permission.label}\n模型：${model || 'Codex 默认'}\nAPI：${payload.baseUrl ? '已接入' : '使用 Codex 默认'}\n` });
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


function agentBlockedRoots() {
  return AgentPermissions.blockedRoots({
    platform: process.platform,
    env: process.env,
    homedir: require('os').homedir(),
    installDir: packagedBaseDir()
  });
}

function agentCheckPath(workspace, target) {
  return AgentPermissions.checkPath(target, {
    workspace,
    blocked: agentBlockedRoots(),
    platform: process.platform
  });
}

function sendAgentEvent(sender, payload) {
  if (!sender || sender.isDestroyed?.()) return;
  sender.send('agent:event', payload);
}


function agentStorageRoot(preferred = '') {
  const candidate = path.resolve(String(preferred || ''));
  if (candidate && allowedStorageRoots.has(candidate)) return candidate;
  for (const root of allowedStorageRoots) return root;
  return '';
}

async function agentAudit(storageDir, event) {
  const root = agentStorageRoot(storageDir);
  if (!root) return;
  try { await AgentAudit.appendAudit(root, event); } catch (_err) { /* ignore audit failures */ }
}

function emergencyStopAllAgents(reason = '紧急停止') {
  agentLastEmergencyAt = Date.now();
  let stopped = 0;
  for (const [sessionId, session] of agentSessions.entries()) {
    try { session.controller.abort(); } catch (_err) { /* ignore */ }
    stopped += 1;
    sendAgentEvent(session.sender, { sessionId, type: 'emergency', reason });
  }
  const killedJobs = AgentProcess.killAllJobs();
  try {
    for (const sessionId of [...codexSessions.keys()]) cancelCodexRun(sessionId);
  } catch (_err) { /* ignore */ }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('agent:event', { type: 'emergency', reason, stopped, killedJobs: killedJobs.length, at: agentLastEmergencyAt });
  }
  return { stopped, killedJobs: killedJobs.length, at: agentLastEmergencyAt };
}

function registerAgentEmergencyHotkey(accelerator) {
  const key = String(accelerator || 'CommandOrControl+Alt+Shift+S');
  try { globalShortcut.unregisterAll(); } catch (_err) { /* ignore */ }
  agentEmergencyArmed = false;
  try {
    agentEmergencyArmed = globalShortcut.register(key, () => {
      emergencyStopAllAgents('快捷键紧急停止');
    });
  } catch (_err) {
    agentEmergencyArmed = false;
  }
  return { ok: agentEmergencyArmed, accelerator: key };
}

const APPROVAL_DIFF_LINES = 40;

function approvalDiffPreview(diff) {
  const lines = String(diff).split('\n');
  return lines.length > APPROVAL_DIFF_LINES ? `${lines.slice(0, APPROVAL_DIFF_LINES).join('\n')}\n…（共 ${lines.length} 行改动预览）` : lines.join('\n');
}

async function agentApprove(event, request) {
  if (request?.unattended) return 'deny';
  const win = BrowserWindow.fromWebContents(event.sender);
  const labels = (request.categories || []).map(category => AgentPermissions.CATEGORY_LABELS[category] || category).join('、');
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['允许一次', '本次会话总是允许', '拒绝'],
    defaultId: 0,
    cancelId: 2,
    title: '确认智能体操作',
    message: `智能体请求：${request.name}`,
    detail: `${request.reason || labels}\n\n${request.diff ? approvalDiffPreview(request.diff) : AgentModel.summarizeResult(request.arguments || {})}`
  });
  return result.response === 0 ? 'allow' : result.response === 1 ? 'always' : 'deny';
}


async function agentCanvasPlan(event, sessionId, payload) {
  const jobId = crypto.randomUUID();
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      agentCanvasJobs.delete(jobId);
      reject(new Error('画布操作超时'));
    }, 120000);
    agentCanvasJobs.set(jobId, { resolve, reject, timer });
    sendAgentEvent(event.sender, { sessionId, type: 'canvas_request', jobId, request: payload.request, selection: payload.selection || [], batch: payload.batch || null });
  });
}

function agentSessionRoot() {
  return path.join(LOCAL_RUNTIME_PATHS.userData, 'agent-sessions');
}

// Resuming reuses the snapshot's task, workspace and history; permissions and the model come from
// the current settings, so a resumed run never gains rights the user has since taken away.
async function loadResumeSnapshot(sessionId) {
  const id = String(sessionId || '');
  if (agentSessions.has(id) && !agentSessions.get(id).done) throw new Error('该会话仍在运行');
  return await AgentSessionStore.loadSession(agentSessionRoot(), id);
}

async function startAgentRun(event, payload = {}) {
  const resume = payload.resumeSessionId ? await loadResumeSnapshot(payload.resumeSessionId) : null;
  const prompt = String(resume?.prompt || payload.prompt || '').trim();
  if (!prompt) throw new Error('请先输入任务');
  const workspace = path.resolve(String(resume?.workspace || payload.workspace || payload.storageDir || ''));
  if (!workspace) throw new Error('请先选择工作区');
  await rememberStorageRoot(workspace);
  const storageDir = path.resolve(String(resume?.storageDir || payload.storageDir || workspace));
  if (storageDir) await rememberStorageRoot(storageDir);
  const scheduled = !resume && payload.scheduled === true;
  const settings = AgentPermissions.effectiveRunSettings(payload.settings || {}, {
    scheduled,
    scheduleMode: payload.scheduleMode || payload.settings?.scheduleMode
  });
  if (settings.mode === 'full' && !scheduled) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const warn = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['继续完全访问', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: '完全访问',
      message: '完全访问不会再询问危险操作，可能修改工作区外的文件并运行命令。',
      detail: '系统目录、安装目录和凭证位置仍会硬性拦截。'
    });
    if (warn.response !== 0) throw new Error('已取消完全访问任务');
  }
  const modelConfig = {
    baseUrl: String(payload.baseUrl || '').trim(),
    apiKey: String(payload.apiKey || ''),
    model: String(payload.model || '').trim(),
    fastModel: String(payload.fastModel || '').trim(),
    format: String(payload.format || payload.providerType || '')
  };
  if (!modelConfig.baseUrl || !modelConfig.apiKey || !modelConfig.model) throw new Error('请先在设置中配置聊天供应商、模型和密钥');
  const maxConcurrent = Math.min(Math.max(Number(settings.maxConcurrent) || Number(payload.maxConcurrent) || 3, 1), 8);
  const runningCount = [...agentSessions.values()].filter(item => !item.done).length;
  if (runningCount >= maxConcurrent) {
    throw new Error(`已达并发上限（${maxConcurrent}）。请先停止一个会话，或在设置中提高上限。`);
  }
  const sessionId = resume?.sessionId || AgentLoop.createSessionId();
  const controller = new AbortController();
  agentSessions.set(sessionId, {
    controller,
    sender: event.sender,
    logPath: '',
    backupDir: '',
    storageDir,
    workspace,
    scheduled,
    scheduleId: payload.scheduleId || '',
    templateId: payload.templateId || '',
    prompt: prompt.slice(0, 200),
    plan: [],
    status: 'running',
    startedAt: Date.now(),
    done: false,
    mode: settings.mode
  });
  const logDir = path.join(LOCAL_RUNTIME_PATHS.logs, 'agent-runs');
  const backupRoot = path.join(LOCAL_RUNTIME_PATHS.userData, 'agent-backups');
  await agentAudit(storageDir, { type: 'start', sessionId, prompt, mode: settings.mode, scheduled, scheduleId: payload.scheduleId || '', templateId: payload.templateId || '' });
  const runPromise = AgentLoop.runAgent({
    prompt,
    workspace,
    settings,
    modelConfig,
    maxSteps: Math.min(Math.max(Number(payload.maxSteps) || settings.maxSteps || AgentLoop.DEFAULT_MAX_STEPS, 1), AgentPermissions.MAX_STEPS),
    sessionId,
    resume,
    sessionStore: {
      save: state => AgentSessionStore.saveSession(agentSessionRoot(), state),
      clear: () => AgentSessionStore.deleteSession(agentSessionRoot(), sessionId),
      child: childId => ({
        load: () => AgentSessionStore.loadSession(agentSessionRoot(), childId),
        save: state => AgentSessionStore.saveSession(agentSessionRoot(), state),
        clear: () => AgentSessionStore.deleteSession(agentSessionRoot(), childId)
      })
    },
    storageDir,
    memoryRoot: storageDir,
    checkPath: target => agentCheckPath(workspace, target),
    canvasPlan: request => agentCanvasPlan(event, sessionId, request),
    approve: request => agentApprove(event, { ...request, unattended: !!settings.unattended }),
    waitForApproval: async request => {
      const item = await agentApprovalHub.enqueue(storageDir, {
        ...request,
        scheduleId: payload.scheduleId || '',
        templateId: payload.templateId || '',
        ttlMs: Number(payload.approvalTtlMs || settings.approvalTtlMs || 0) || undefined
      });
      sendAgentEvent(event.sender, {
        sessionId,
        type: 'approval_queued',
        approvalId: item.id,
        name: item.name,
        reason: item.reason,
        categories: item.categories,
        expiresAt: item.expiresAt,
        pendingCount: await agentApprovalHub.pendingCount(storageDir)
      });
      // Broadcast badge update to all windows
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('agent:event', {
          type: 'approval_badge',
          pendingCount: await agentApprovalHub.pendingCount(storageDir),
          storageDir
        });
      }
      const ttlLeft = Math.max(1000, item.expiresAt - Date.now());
      const answer = await agentApprovalHub.wait(item.id, { signal: controller.signal, timeoutMs: ttlLeft });
      if (answer === 'expire') {
        try { await agentApprovalHub.resolve(storageDir, item.id, 'expire', { actor: 'system' }); } catch (_err) { /* already resolved */ }
      }
      sendAgentEvent(event.sender, {
        sessionId,
        type: 'approval_resolved',
        approvalId: item.id,
        answer,
        pendingCount: await agentApprovalHub.pendingCount(storageDir)
      });
      return answer;
    },
    onEvent: evt => {
      const session = agentSessions.get(sessionId);
      if (session) {
        if (evt.logPath) session.logPath = evt.logPath;
        if (evt.backupDir) session.backupDir = evt.backupDir;
        if (evt.type === 'plan' && Array.isArray(evt.steps)) session.plan = evt.steps;
        if (evt.type === 'start') session.status = evt.scheduled ? 'scheduled' : 'running';
        if (evt.type === 'approval' || evt.type === 'approval_queued') session.status = 'awaiting_approval';
        if (evt.type === 'done') { session.status = evt.cancelled ? 'stopped' : evt.truncated ? 'truncated' : 'done'; session.done = true; }
        if (evt.type === 'error') { session.status = 'error'; session.done = true; }
        if (evt.type === 'emergency') { session.status = 'emergency'; session.done = true; }
      }
      const audited = (evt.type === 'tool' && evt.status !== 'output') || evt.type === 'approval' || evt.type === 'done' || evt.type === 'error' || evt.type === 'plan';
      if (audited) {
        agentAudit(storageDir, { ...evt, sessionId: evt.sessionId || sessionId });
      }
      sendAgentEvent(event.sender, evt);
    },
    signal: controller.signal,
    logDir,
    backupRoot
  }).finally(() => {
    const session = agentSessions.get(sessionId);
    if (session) {
      session.done = true;
      if (session.status === 'running' || session.status === 'awaiting_approval' || session.status === 'scheduled') {
        session.status = 'done';
      }
      // Keep briefly for session list, then drop.
      setTimeout(() => { if (agentSessions.get(sessionId)?.done) agentSessions.delete(sessionId); }, 30_000);
    } else {
      agentSessions.delete(sessionId);
    }
  });
  runPromise.then(async result => {
    if (payload.scheduleId && storageDir) {
      await AgentScheduler.markScheduleRun(storageDir, payload.scheduleId, { status: result?.cancelled ? 'cancelled' : result?.ok ? 'ok' : 'failed' });
      await AgentScheduler.appendHistory(storageDir, {
        scheduleId: payload.scheduleId,
        templateId: payload.templateId || '',
        sessionId,
        status: result?.cancelled ? 'cancelled' : result?.ok ? 'ok' : 'failed',
        summary: String(result?.content || '').slice(0, 500)
      });
    }
  }).catch(err => sendAgentEvent(event.sender, { sessionId, type: 'error', error: err?.message || String(err) }));
  return { ok: true, sessionId };
}


async function listAgentSessions() {
  const live = [...agentSessions.entries()].map(([sessionId, session]) => ({
    sessionId,
    prompt: session.prompt || '',
    status: session.status || (session.done ? 'done' : 'running'),
    workspace: session.workspace || '',
    storageDir: session.storageDir || '',
    scheduled: !!session.scheduled,
    scheduleId: session.scheduleId || '',
    templateId: session.templateId || '',
    mode: session.mode || '',
    plan: Array.isArray(session.plan) ? session.plan : [],
    startedAt: session.startedAt || 0,
    logPath: session.logPath || '',
    backupDir: session.backupDir || '',
    done: !!session.done
  }));
  const liveIds = new Set(live.filter(item => !item.done).map(item => item.sessionId));
  const resumable = await AgentSessionStore.listResumable(agentSessionRoot(), liveIds);
  const resumableIds = new Set(resumable.map(item => item.sessionId));
  return [...live.filter(item => !resumableIds.has(item.sessionId)), ...resumable];
}

function cancelAgentRun(sessionId) {
  const session = agentSessions.get(String(sessionId || ''));
  if (!session) return false;
  session.controller.abort();
  return true;
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
    const rights = openMusicRights(doc.licenseurl, doc.licenseurl);
    if (!rights) return null;
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
  // Test-only: an isolated-profile copy driven by automation can ask to stay off-screen,
  // inactive and off the taskbar so it never appears on the user's desktop.
  const offscreen = TEST_HOOKS_ALLOWED && process.env.FUTURE_AI_TEST_OFFSCREEN === '1';
  const win = new BrowserWindow({
    ...(offscreen ? {x: -32000, y: -32000, show: false, skipTaskbar: true, focusable: false} : {}),
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b1020',
    title: '∞未来 AI',
    icon: path.join(__dirname, 'assets', 'app-icon.ico'),
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
  if (offscreen) {
    win.setPosition(-32000, -32000);
    win.showInactive();
  }
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
  installRendererRecovery(win, {quiet: offscreen});
  installCloseFlush(win);
};

// Closing the window first lets the page write its pending canvas save (the
// 300 ms debounce, the last generated image) and then waits for every queued
// store write in this process, so a close right after a result never loses it.
const CLOSE_FLUSH_TIMEOUT_MS = 6000;
let closeFlushSeq = 0;
async function drainStorageWrites(timeoutMs = CLOSE_FLUSH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (storageWriteQueues.size && Date.now() < deadline) {
    const pending = Promise.allSettled([...storageWriteQueues.values()]);
    await Promise.race([pending, new Promise(resolve => setTimeout(resolve, Math.max(10, deadline - Date.now())))]);
  }
  return storageWriteQueues.size === 0;
}
function requestRendererFlush(win, timeoutMs = CLOSE_FLUSH_TIMEOUT_MS) {
  return new Promise(resolve => {
    if (!win || win.isDestroyed() || win.webContents.isCrashed?.()) return resolve(false);
    const id = ++closeFlushSeq;
    let timer = null;
    const done = (event, replyId) => {
      if (replyId !== id || event.sender !== win.webContents) return;
      finish(true);
    };
    const finish = ok => {
      clearTimeout(timer);
      ipcMain.removeListener('app:flush-done', done);
      resolve(ok);
    };
    ipcMain.on('app:flush-done', done);
    timer = setTimeout(() => finish(false), timeoutMs);
    try { win.webContents.send('app:flush-request', id); } catch { finish(false); }
  });
}
function installCloseFlush(win) {
  let flushed = false;
  let flushing = false;
  win.on('close', event => {
    if (flushed || win.isDestroyed()) return;
    event.preventDefault();
    if (flushing) return;
    flushing = true;
    (async () => {
      const rendererOk = await requestRendererFlush(win);
      const writesOk = await drainStorageWrites();
      if (!rendererOk || !writesOk) await appendAppLog('warn', 'close flush incomplete', {rendererOk, writesOk}).catch(() => {});
    })().catch(() => {}).finally(() => {
      flushed = true;
      if (!win.isDestroyed()) win.close();
    });
  });
}

// 界面进程崩溃或卡死时自动恢复：崩溃后自动重新加载（5 分钟内最多 3 次），卡死时让用户选择等待或重新加载。
let pendingRecoveryNotice = null;
function installRendererRecovery(win, {quiet = false} = {}) {
  const recoveries = [];
  let hangDialogOpen = false;
  const reloadWindow = reason => {
    if (win.isDestroyed()) return;
    pendingRecoveryNotice = {reason, at: Date.now()};
    win.webContents.reload();
  };
  win.webContents.on('render-process-gone', (_event, details = {}) => {
    appendAppLog('error', 'renderer process gone', {reason: details.reason, exitCode: details.exitCode}).catch(() => {});
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    const now = Date.now();
    while (recoveries.length && now - recoveries[0] > 5 * 60 * 1000) recoveries.shift();
    if (recoveries.length < 3) {
      recoveries.push(now);
      setTimeout(() => reloadWindow(details.reason || 'crashed'), 300);
      return;
    }
    if (quiet) return;
    dialog.showMessageBox(win, {
      type: 'error',
      title: '∞未来 AI',
      message: '界面连续意外退出',
      detail: '5 分钟内已经自动恢复了 3 次，仍然出错。建议先关闭软件再重新打开；如果反复出现，请到「设置 → 本地存储 → 导出诊断包」并发给售后。',
      buttons: ['再试一次', '关闭软件'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(result => {
      if (result.response === 1) app.quit();
      else reloadWindow(details.reason || 'crashed');
    }).catch(() => {});
  });
  win.on('unresponsive', () => {
    appendAppLog('warn', 'window unresponsive', {}).catch(() => {});
    if (quiet || hangDialogOpen || win.isDestroyed()) return;
    hangDialogOpen = true;
    dialog.showMessageBox(win, {
      type: 'warning',
      title: '∞未来 AI',
      message: '软件暂时没有响应',
      detail: '可能正在处理很大的图片或项目，可以再等一会儿。如果一直卡住，选「重新加载界面」：项目会自动保存，但最近几秒的改动可能丢失。',
      buttons: ['继续等待', '重新加载界面'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(result => {
      hangDialogOpen = false;
      if (result.response === 1 && !win.isDestroyed()) {
        win.webContents.forcefullyCrashRenderer();
        reloadWindow('unresponsive');
      }
    }).catch(() => { hangDialogOpen = false; });
  });
  win.on('responsive', () => {
    appendAppLog('info', 'window responsive again', {}).catch(() => {});
  });
}

ipcMain.handle('storage:chooseDir', async event => {
  assertTrustedRenderer(event);
  const result = await dialog.showOpenDialog({
    title: '选择本地存储文件夹',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return '';
  const root = await rememberStorageRoot(result.filePaths[0]);
  await ensureDir(safeStoragePath(root, 'media'));
  return root;
});

ipcMain.handle('storage:defaultDir', async (event, {create = false} = {}) => {
  assertTrustedRenderer(event);
  const dir = defaultStorageDir();
  if (!create) return dir;
  await ensureDir(path.join(dir, 'media'));
  return await rememberStorageRoot(dir);
});

ipcMain.handle('storage:copyMedia', async (event, fromDir, toDir) => {
  assertTrustedRenderer(event);
  return await copyStorageMedia(fromDir, toDir);
});

ipcMain.handle('storage:inspectDir', (event, dir) => {
  assertTrustedRenderer(event);
  return {insideInstallDir: Boolean(dir) && storageDirInsideInstallDir(dir)};
});

// The saved storage folder no longer exists (app/project folder copied to another PC or drive):
// find the same folder under the current install dir, profile or Documents instead of recreating
// an empty store at the old path.
ipcMain.handle('storage:resolveMovedRoot', async (event, dir) => {
  assertTrustedRenderer(event);
  const bases = [];
  try { bases.push(installDir(), path.dirname(installDir())); } catch {}
  try { bases.push(app.getPath('documents'), path.dirname(app.getPath('documents'))); } catch {}
  try { bases.push(path.dirname(LOCAL_RUNTIME_PATHS.userData)); } catch {}
  try { bases.push(app.getPath('home')); } catch {}
  const extra = [defaultStorageDir()];
  try { const found = await findProjectRoot(); if (found) extra.push(found); } catch {}
  const result = await resolveMovedStorageRoot(dir, {
    bases,
    extra,
    exists: async target => fsSync.existsSync(target),
    hasStore: async target => fsSync.existsSync(target) && hasExistingStoreFiles(target)
  });
  if (result.moved) {
    await rememberStorageRoot(result.dir);
    await appendAppLog('info', 'storage folder moved, switched automatically', {from: result.from, to: result.dir});
  } else if (result.missing) {
    await appendAppLog('warn', 'storage folder missing', {dir: result.dir});
  }
  return result;
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
  const probe = uniqueTempPath(path.join(probeDir, '.write-test'));
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
  if (name === 'projects') {
    const {value, recovery} = await readProjectsStore(dir);
    if (recovery) {
      event.sender.send('storage:recovery', {store: name, ...recovery});
      await appendAppLog('warn', 'project store automatically recovered', recovery);
    }
    const absolute = absolutizeStoreMedia(dir, value);
    const repair = await repairStoreMediaRefs(dir, absolute);
    if (repair.repaired) {
      try {
        const backup = await backupProjectsBeforeRepair(dir);
        await writeProjectsStore(dir, await prepareStoreValueForWrite(dir, repair.value));
        await appendAppLog('info', 'project media references repaired', {repaired: repair.repaired, imported: repair.imported, missing: repair.missing.length, backup: backup ? path.basename(backup) : ''});
      } catch (err) {
        await appendAppLog('warn', 'project media repair write failed', {message: err?.message || String(err)});
      }
    } else if (repair.missing.length) {
      await appendAppLog('warn', 'project media files missing', {missing: repair.missing.length});
    }
    return repair.value;
  }
  const result = await readStoreWithRecovery(dir, name);
  if (result.recovered) {
    event.sender.send('storage:recovery', {store: name, backup: path.basename(result.backupFile), corrupt: path.basename(result.corruptFile)});
    await appendAppLog('warn', 'json store automatically recovered', {store: name, backup: path.basename(result.backupFile), corrupt: path.basename(result.corruptFile)});
  }
  return (await repairStoreMediaRefs(dir, absolutizeStoreMedia(dir, result.value))).value;
});

ipcMain.handle('storage:writeJson', async (event, dir, name, data) => {
  assertTrustedRenderer(event);
  if (!dir) return false;
  await ensureStorageRootAllowed(dir);
  await ensureDir(path.resolve(dir));
  const file = safeStoragePath(dir, safeStoreFile(name));
  assertStoreValue(data);
  const prepared = await prepareStoreValueForWrite(dir, data, {importForeign: name === 'projects'});
  if (name === 'projects') return await writeProjectsStore(dir, prepared);
  return await enqueueStorageWrite(file, async () => {
    await backupStoreFile(dir, name, file);
    await writeFileAtomicUnlocked(file, JSON.stringify(prepared, null, 2));
    return true;
  });
});

const REMOTE_MEDIA_LIMITS = {
  image: {maxBytes: 100 * 1024 * 1024, timeoutMs: 90 * 1000, label: '图片'},
  video: {maxBytes: 1024 * 1024 * 1024, timeoutMs: 10 * 60 * 1000, label: '视频'}
};

function sniffMediaExt(bytes) {
  const head = bytes.subarray(0, 16);
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return {ext: 'png', kind: 'image'};
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return {ext: 'jpg', kind: 'image'};
  if (head.subarray(0, 6).toString('ascii').startsWith('GIF8')) return {ext: 'gif', kind: 'image'};
  if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') return {ext: 'webp', kind: 'image'};
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return {ext: 'webm', kind: 'video'};
  if (head.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return {ext: 'avif', kind: 'image'};
    if (brand === 'qt  ') return {ext: 'mov', kind: 'video'};
    return {ext: 'mp4', kind: 'video'};
  }
  return {ext: '', kind: ''};
}

async function fetchRemoteMedia(rawUrl, kind = 'image') {
  const limits = REMOTE_MEDIA_LIMITS[kind] || REMOTE_MEDIA_LIMITS.image;
  let url;
  try { url = new URL(String(rawUrl || '')); } catch { throw new Error(`${limits.label}地址无效`); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`仅支持下载 HTTP/HTTPS ${limits.label}`);
  const tooLarge = `${limits.label}超过 ${Math.round(limits.maxBytes / 1024 / 1024)} MB 下载限制`;
  const response = await fetch(url.href, {redirect: 'follow', signal: AbortSignal.timeout(limits.timeoutMs)});
  if (!response.ok) throw new Error(`${limits.label}服务器返回 ${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > limits.maxBytes) throw new Error(tooLarge);
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (received > limits.maxBytes) throw new Error(tooLarge);
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks, received);
  if (!bytes.length) throw new Error(`${limits.label}内容为空`);
  const sniffed = sniffMediaExt(bytes);
  if (!sniffed.ext || (kind === 'image' && sniffed.kind !== 'image')) {
    const mime = String(response.headers.get('content-type') || '').toLowerCase();
    throw new Error(mime.includes('json') ? `${limits.label}服务器返回了 JSON 错误内容，请检查链接是否已过期` : `服务器返回的内容不是受支持的${limits.label}格式`);
  }
  return {bytes, ext: sniffed.ext};
}

// Content-addressed, atomic write into <storageDir>/media/<sha256>.<ext>.
async function writeStorageMedia(dir, bytes, ext) {
  await ensureStorageRootAllowed(dir);
  const mediaDir = safeStoragePath(dir, 'media');
  await ensureDir(mediaDir);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const file = safeStoragePath(dir, 'media', `${hash}.${ext}`);
  if (!fsSync.existsSync(file)) {
    await writeFileAtomic(file, bytes);
  }
  return pathToFileURL(file).href;
}

ipcMain.handle('storage:saveMedia', async (event, dir, payload) => {
  assertTrustedRenderer(event);
  if (!dir || !payload?.dataUrl) return '';
  const match = String(payload.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('素材不是可保存的数据格式');
  const mime = match[1];
  const defaultExt = mime.includes('video') ? 'mp4' : mime.includes('jpeg') ? 'jpg' : 'png';
  const requestedExt = String(payload.ext || '').trim().toLowerCase().replace(/^\./, '');
  const ext = /^[a-z0-9]{1,12}$/.test(requestedExt) ? requestedExt : defaultExt;
  return await writeStorageMedia(dir, Buffer.from(match[2], 'base64'), ext);
});

// Uploaded canvas wallpapers are copied next to the exe so they travel with a copied app folder.
// userData is the fallback when the install folder is read-only, and the only location in dev.
function wallpaperDirs() {
  const ownDir = path.join(app.getPath('userData'), 'wallpapers');
  return app.isPackaged ? [path.join(installDir(), 'wallpapers'), ownDir] : [ownDir];
}

function wallpaperInfo(file) {
  return file ? {url: pathToFileURL(file).href, dir: path.dirname(file)} : null;
}

ipcMain.handle('wallpaper:current', async event => {
  assertTrustedRenderer(event);
  return wallpaperInfo(await WallpaperStore.findWallpaper(wallpaperDirs()));
});

ipcMain.handle('wallpaper:import', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  const source = String(payload.sourcePath || '');
  if (!source || !path.isAbsolute(source)) throw new Error('请选择本地图片文件');
  const stats = await fs.stat(source);
  if (!stats.isFile()) throw new Error('请选择本地图片文件');
  WallpaperStore.assertWallpaperSize(stats.size);
  const bytes = await fs.readFile(source);
  return wallpaperInfo(await WallpaperStore.saveWallpaper(wallpaperDirs(), bytes, sniffMediaExt(bytes).ext));
});

ipcMain.handle('wallpaper:delete', async event => {
  assertTrustedRenderer(event);
  await WallpaperStore.deleteWallpapers(wallpaperDirs());
  return null;
});

// User workflow templates are JSON files next to the exe (templates/), same portability as wallpapers/.
function templateDirs() {
  const ownDir = path.join(app.getPath('userData'), 'templates');
  return app.isPackaged ? [path.join(installDir(), 'templates'), ownDir] : [ownDir];
}

function publicTemplate(item) {
  if (!item) return null;
  const copy = Object.assign({}, item);
  delete copy._file;
  delete copy._dir;
  return copy;
}

ipcMain.handle('templates:list', async event => {
  assertTrustedRenderer(event);
  return (await TemplateStore.listTemplates(templateDirs())).map(publicTemplate);
});

ipcMain.handle('templates:save', async (event, definition = {}) => {
  assertTrustedRenderer(event);
  return publicTemplate(await TemplateStore.saveTemplate(templateDirs(), definition));
});

ipcMain.handle('templates:delete', async (event, id) => {
  assertTrustedRenderer(event);
  await TemplateStore.deleteTemplate(templateDirs(), id);
  return true;
});

// User prompt snippets are JSON files next to the exe (prompts/), same portability as templates/.
function promptDirs() {
  const ownDir = path.join(app.getPath('userData'), 'prompts');
  return app.isPackaged ? [path.join(installDir(), 'prompts'), ownDir] : [ownDir];
}

function publicPromptSnippet(item) {
  if (!item) return null;
  const copy = Object.assign({}, item);
  delete copy._file;
  delete copy._dir;
  return copy;
}

ipcMain.handle('prompts:list', async event => {
  assertTrustedRenderer(event);
  return (await PromptStore.listSnippets(promptDirs())).map(publicPromptSnippet);
});

ipcMain.handle('prompts:save', async (event, definition = {}) => {
  assertTrustedRenderer(event);
  return publicPromptSnippet(await PromptStore.saveSnippet(promptDirs(), definition));
});

ipcMain.handle('prompts:delete', async (event, id) => {
  assertTrustedRenderer(event);
  await PromptStore.deleteSnippet(promptDirs(), id);
  return true;
});

// Portable media library next to the exe (library/). Travels when the app folder is copied.
function libraryDirs() {
  const ownDir = path.join(app.getPath('userData'), 'library');
  return app.isPackaged ? [path.join(installDir(), 'library'), ownDir] : [ownDir];
}

ipcMain.handle('library:list', async event => {
  assertTrustedRenderer(event);
  return await PortableLibrary.listItems(libraryDirs());
});

ipcMain.handle('library:save', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  let bytes = null;
  let ext = String(payload.ext || '').trim().toLowerCase().replace(/^\./, '');
  const kind = payload.kind === 'video' ? 'video' : 'image';
  if (payload.dataUrl) {
    const match = String(payload.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('素材不是可保存的数据格式');
    bytes = Buffer.from(match[2], 'base64');
    if (!ext) {
      const mime = match[1].toLowerCase();
      ext = mime.includes('video') ? 'mp4' : mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'png';
    }
  } else if (payload.url || payload.filePath) {
    const target = String(payload.filePath || payload.url || '');
    if (/^https?:\/\//i.test(target)) {
      const fetched = await fetchRemoteMedia(target, kind);
      bytes = fetched.bytes;
      ext = ext || fetched.ext;
    } else {
      let file;
      try {
        file = safeExistingMediaPath(target);
      } catch {
        const candidate = path.resolve(String(target || '').startsWith('file:') ? fileURLToPath(target) : String(target || ''));
        const roots = [...libraryDirs(), installDir(), app.getPath('userData')];
        if (!roots.some(root => pathInside(root, candidate))) throw new Error('未授权的媒体文件路径');
        file = candidate;
      }
      bytes = await fs.readFile(file);
      if (!ext) ext = path.extname(file).replace(/^\./, '').toLowerCase() || (kind === 'video' ? 'mp4' : 'png');
    }
  } else {
    throw new Error('请提供素材内容');
  }
  return await PortableLibrary.saveBytes(libraryDirs(), {
    id: payload.id,
    name: payload.name,
    kind,
    prompt: payload.prompt,
    tags: payload.tags,
    mime: payload.mime,
    size: payload.size,
    model: payload.model,
    time: payload.time,
    ext
  }, bytes);
});

ipcMain.handle('library:delete', async (event, id) => {
  assertTrustedRenderer(event);
  return await PortableLibrary.deleteItem(libraryDirs(), id);
});


ipcMain.handle('storage:saveRemoteMedia', async (event, dir, payload = {}) => {
  assertTrustedRenderer(event);
  if (!dir) throw new Error('请先选择本地存储文件夹');
  const {bytes, ext} = await fetchRemoteMedia(payload.url, payload.kind === 'video' ? 'video' : 'image');
  return await writeStorageMedia(dir, bytes, ext);
});

ipcMain.handle('media:downloadRemoteImage', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  const {bytes, ext} = await fetchRemoteMedia(payload.url, 'image');
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

ipcMain.handle('secret:setProviderApiKey', async (event, providerId, apiKey) => {
  assertTrustedRenderer(event);
  return await writeProviderApiKey(providerId, apiKey);
});

ipcMain.handle('secret:clearProviderApiKey', async (event, providerId) => {
  assertTrustedRenderer(event);
  return await clearProviderApiKey(providerId);
});

// Relay balance: the key is resolved here and never crosses IPC.
const providerBalance = ProviderBalance.createBalanceService({
  readKey: ({providerId, useGlobalKey}) => useGlobalKey ? readApiKeySecret() : readProviderApiKey(providerId)
});
ipcMain.handle('provider:balance', async (event, request = {}) => {
  assertTrustedRenderer(event);
  return await providerBalance.query({
    providerId: String(request?.providerId || ''),
    apiUrl: String(request?.apiUrl || ''),
    useGlobalKey: request?.useGlobalKey === true,
    force: request?.force === true
  });
});

// Agent benchmark mode (isolated profiles only): the renderer hands over the configured chat
// provider, the suite in FUTURE_AI_AGENT_EVAL_DIR runs against the real agent loop, then the app quits.
function agentEvalConfig() {
  const dir = TEST_HOOKS_ALLOWED ? String(process.env.FUTURE_AI_AGENT_EVAL_DIR || '') : '';
  return {
    enabled: !!dir,
    dir,
    outDir: String(process.env.FUTURE_AI_AGENT_EVAL_OUT || (dir && path.join(dir, 'results'))),
    only: String(process.env.FUTURE_AI_AGENT_EVAL_ONLY || '').split(',').map(item => item.trim()).filter(Boolean),
    concurrency: Number(process.env.FUTURE_AI_AGENT_EVAL_CONCURRENCY) || 3,
    build: String(process.env.FUTURE_AI_AGENT_EVAL_BUILD || '')
  };
}

ipcMain.handle('agent-eval:config', async event => {
  assertTrustedRenderer(event);
  return { enabled: agentEvalConfig().enabled };
});

// A renderer reload re-sends the request; the suite runs once per app launch.
let agentEvalStarted = false;

ipcMain.handle('agent-eval:run', async (event, api = {}) => {
  assertTrustedRenderer(event);
  const config = agentEvalConfig();
  if (!config.enabled) throw new Error('评测模式未启用');
  if (agentEvalStarted) return false;
  agentEvalStarted = true;
  // Programs the agent starts (e.g. the app exe as a script runtime) must not start another suite.
  Object.keys(process.env).filter(key => key.startsWith('FUTURE_AI_AGENT_EVAL_')).forEach(key => delete process.env[key]);
  const { runSuite } = require(path.join(config.dir, 'runner.js'));
  await fs.mkdir(config.outDir, { recursive: true });
  const progress = path.join(config.outDir, 'progress.log');
  try {
    await runSuite({
      agent: { runAgent: AgentLoop.runAgent, Permissions: AgentPermissions, SessionStore: AgentSessionStore },
      modelConfig: {
        baseUrl: String(api.baseUrl || ''),
        apiKey: String(api.apiKey || ''),
        model: String(api.model || ''),
        fastModel: String(api.fastModel || ''),
        format: String(api.format || api.providerType || '')
      },
      helpers: { buildZip, buildDocx: AgentDocuments.buildDocx },
      outDir: config.outDir,
      build: `${app.getVersion()} ${config.build}`.trim(),
      only: config.only,
      concurrency: config.concurrency,
      nodePath: process.execPath,
      nodeEnv: { ELECTRON_RUN_AS_NODE: '1' },
      log: line => fsSync.appendFileSync(progress, `${new Date().toISOString()} ${line}\n`)
    });
  } catch (err) {
    fsSync.appendFileSync(progress, `${new Date().toISOString()} FAILED ${err.message}\n`);
  }
  setTimeout(() => app.quit(), 500);
  return true;
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
    buildLabel: APP_PACKAGE_METADATA.buildLabel,
    releaseChannel: releaseChannel(),
    packaged: app.isPackaged
  });
});

ipcMain.handle('support:consumeRecoveryNotice', event => {
  assertTrustedRenderer(event);
  const notice = pendingRecoveryNotice;
  pendingRecoveryNotice = null;
  return notice && Date.now() - notice.at < 2 * 60 * 1000 ? notice : null;
});

function portableAppDir() {
  return app.isPackaged ? path.dirname(process.execPath) : '';
}

ipcMain.handle('support:updateSourceDefault', async event => {
  assertTrustedRenderer(event);
  return await UpdateCheck.readDefaultSource(portableAppDir());
});

ipcMain.handle('support:checkUpdate', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  const source = String(payload?.source || '').trim() || await UpdateCheck.readDefaultSource(portableAppDir());
  try {
    return await UpdateCheck.checkForUpdate({source, current: {version: app.getVersion(), build: APP_PACKAGE_METADATA.buildLabel || ''}});
  } catch (err) {
    await appendAppLog('warn', 'update check failed', {message: err?.message || String(err)});
    return {status: 'error', message: err?.message || String(err)};
  }
});

ipcMain.handle('support:openUpdateDownload', async (event, target) => {
  assertTrustedRenderer(event);
  const value = String(target || '').trim();
  if (UpdateCheck.isHttpUrl(value)) {
    await shell.openExternal(value);
    return true;
  }
  if (!value || !path.isAbsolute(value)) return false;
  const stat = await fs.stat(value).catch(() => null);
  if (!stat) return false;
  if (stat.isDirectory()) return (await shell.openPath(value)) === '';
  shell.showItemInFolder(value);
  return true;
});

ipcMain.handle('support:readDocument', async (event, id) => {
  assertTrustedRenderer(event);
  return await readSupportDocument(supportLegalRoot(), String(id || ''));
});

ipcMain.handle('export:projectPackage', async (event, payload) => {
  assertTrustedRenderer(event);
  return await exportProjectPackage(payload || {});
});

ipcMain.handle('export:canvasMedia', async (event, payload) => {
  assertTrustedRenderer(event);
  return await exportCanvasMedia(event, payload || {});
});

// 花费管理 → 导出表格：只写用户在保存对话框里选的 .csv（测试隔离模式可直接给目标路径）。
async function exportSpendCsv(event, payload = {}) {
  const csv = String(payload.csv || '');
  if (!csv || csv.length > 20 * 1024 * 1024) throw new Error('没有可导出的记录');
  let target = '';
  if (TEST_HOOKS_ALLOWED && payload.e2eTarget) {
    target = path.resolve(String(payload.e2eTarget));
  } else {
    const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '导出扣费记录',
      defaultPath: path.join(app.getPath('documents'), `扣费记录-${timestampForBackup()}.csv`),
      filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
    });
    if (picked.canceled || !picked.filePath) return null;
    target = picked.filePath;
  }
  if (!/\.csv$/i.test(target)) target += '.csv';
  await fs.writeFile(target, csv, 'utf8');
  return { path: target };
}

ipcMain.handle('export:spendCsv', async (event, payload) => {
  assertTrustedRenderer(event);
  return await exportSpendCsv(event, payload || {});
});

ipcMain.handle('export:sharePackage', async (event, payload) => {
  assertTrustedRenderer(event);
  return await exportSharePackage(event, payload || {});
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

ipcMain.handle('cleanup:scan', async (event, payload) => {
  assertTrustedRenderer(event);
  return await scanCleanupTargets(payload || {});
});

ipcMain.handle('cleanup:execute', async (event, payload) => {
  assertTrustedRenderer(event);
  return await executeCleanupTargets(payload || {});
});

ipcMain.handle('codex:status', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  return codexStatusForRenderer(await detectCodex({ force: payload.force === true }));
});

ipcMain.handle('codex:chooseCommand', async event => {
  assertTrustedRenderer(event);
  const result = await dialog.showOpenDialog({
    title: '选择 Codex CLI 程序',
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: 'Codex CLI', extensions: ['exe', 'cmd'] }, { name: '所有文件', extensions: ['*'] }]
      : [{ name: '所有文件', extensions: ['*'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const picked = await CodexCli.detectCodexCli({ override: result.filePaths[0], fsApi: fsSync, run: runCodexProbe });
  if (picked.ok) {
    await ensureDir(path.dirname(codexCommandFile()));
    await fs.writeFile(codexCommandFile(), JSON.stringify({ path: picked.path }, null, 2), 'utf8');
    codexDetection = Promise.resolve(picked);
  }
  return codexStatusForRenderer(picked);
});

ipcMain.handle('codex:saveAttachment', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  const cwd = await codexWorkingDir(payload.storageDir);
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
  const cwd = await codexWorkingDir(payload.storageDir);
  const source = path.resolve(String(payload.path || ''));
  if (!pathInside(cwd, source)) throw new Error('视频路径超出当前工作目录');
  const stats = await fs.stat(source);
  if (!stats.isFile()) throw new Error('找不到可分析的视频文件');
  return await extractVideoUnderstandingFrames(source, payload.frameCount);
});

ipcMain.handle('codex:readTextAttachment', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  const cwd = await codexWorkingDir(payload.storageDir);
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

ipcMain.handle('codex:cancel', async (event, sessionId) => {
  assertTrustedRenderer(event);
  return cancelCodexRun(sessionId);
});

ipcMain.handle('agent:start', async (event, payload) => {
  assertTrustedRenderer(event);
  return await startAgentRun(event, payload || {});
});

ipcMain.handle('agent:cancel', async (event, sessionId) => {
  assertTrustedRenderer(event);
  return cancelAgentRun(sessionId);
});

ipcMain.handle('agent:sessions', async event => {
  assertTrustedRenderer(event);
  return await listAgentSessions();
});

ipcMain.handle('agent:discardSession', async (event, sessionId) => {
  assertTrustedRenderer(event);
  if (agentSessions.has(String(sessionId || '')) && !agentSessions.get(String(sessionId)).done) throw new Error('该会话仍在运行');
  await AgentSessionStore.deleteSession(agentSessionRoot(), sessionId);
  return true;
});
ipcMain.handle('agent:memory:list', async (event, storageDir) => {
  assertTrustedRenderer(event);
  return AgentMemory.listMemory(await withAgentStorageReadOnly(event, storageDir));
});
ipcMain.handle('agent:memory:upsert', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  return AgentMemory.upsertMemory(await withAgentStorage(event, payload.storageDir), payload);
});
ipcMain.handle('agent:memory:delete', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  return AgentMemory.deleteMemory(await withAgentStorage(event, payload.storageDir), payload.id || payload.key);
});

ipcMain.handle('agent:restore', async (event, logPath) => {
  assertTrustedRenderer(event);
  return await AgentLoop.restoreFromLog(String(logPath || ''));
});

ipcMain.handle('agent:chooseWorkspace', async event => {
  assertTrustedRenderer(event);
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: '选择智能体工作区',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return '';
  const dir = path.resolve(result.filePaths[0]);
  await rememberStorageRoot(dir);
  return dir;
});

ipcMain.handle('agent:canvasResult', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  const job = agentCanvasJobs.get(String(payload.jobId || ''));
  if (!job) return false;
  clearTimeout(job.timer);
  agentCanvasJobs.delete(String(payload.jobId || ''));
  if (payload.error) job.reject(new Error(payload.error));
  else job.resolve(payload.result || {});
  return true;
});

async function withAgentStorage(event, storageDir) {
  assertTrustedRenderer(event);
  const root = path.resolve(String(storageDir || ''));
  if (!root) throw new Error('请先选择本地存储目录');
  await rememberStorageRoot(root);
  return root;
}

// Read-only agent IPC (list/history/count/read) must never write user-data files: it authorizes
// the root for this session in memory only. Write handlers persist it via withAgentStorage.
function withAgentStorageReadOnly(event, storageDir) {
  assertTrustedRenderer(event);
  const raw = String(storageDir || '').trim();
  if (!raw) throw new Error('请先选择本地存储目录');
  const root = path.resolve(raw);
  allowedStorageRoots.add(root);
  return root;
}

ipcMain.handle('agent:templates:list', async (event, storageDir) => AgentTemplates.listTemplates(await withAgentStorageReadOnly(event, storageDir)));
ipcMain.handle('agent:templates:upsert', async (event, payload = {}) => AgentTemplates.upsertTemplate(await withAgentStorage(event, payload.storageDir), payload));
ipcMain.handle('agent:templates:delete', async (event, payload = {}) => AgentTemplates.deleteTemplate(await withAgentStorage(event, payload.storageDir), payload.id));
ipcMain.handle('agent:templates:render', async (event, payload = {}) => {
  const root = await withAgentStorageReadOnly(event, payload.storageDir);
  const template = await AgentTemplates.getTemplate(root, payload.id);
  if (!template) throw new Error('模板不存在');
  return { template, prompt: AgentTemplates.renderPrompt(template, payload.values || {}) };
});

ipcMain.handle('agent:schedules:list', async (event, storageDir) => AgentScheduler.listSchedules(await withAgentStorageReadOnly(event, storageDir)));
ipcMain.handle('agent:schedules:upsert', async (event, payload = {}) => AgentScheduler.upsertSchedule(await withAgentStorage(event, payload.storageDir), payload));
ipcMain.handle('agent:schedules:delete', async (event, payload = {}) => AgentScheduler.deleteSchedule(await withAgentStorage(event, payload.storageDir), payload.id));
ipcMain.handle('agent:schedules:history', async (event, payload = {}) => AgentScheduler.listHistory(await withAgentStorageReadOnly(event, payload.storageDir), { limit: payload.limit || 50 }));

ipcMain.handle('agent:audit:months', async (event, storageDir) => AgentAudit.listAuditMonths(await withAgentStorageReadOnly(event, storageDir)));
ipcMain.handle('agent:audit:read', async (event, payload = {}) => AgentAudit.readAudit(await withAgentStorageReadOnly(event, payload.storageDir), payload));

ipcMain.handle('agent:emergencyStop', async event => {
  assertTrustedRenderer(event);
  return emergencyStopAllAgents('界面紧急停止');
});

ipcMain.handle('agent:emergencyHotkey', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  return registerAgentEmergencyHotkey(payload.accelerator);
});

ipcMain.handle('agent:approvals:list', async (event, payload = {}) => {
  const root = await withAgentStorageReadOnly(event, payload.storageDir);
  return agentApprovalHub.list(root, { includeResolved: !!payload.includeResolved });
});

ipcMain.handle('agent:approvals:resolve', async (event, payload = {}) => {
  const root = await withAgentStorage(event, payload.storageDir);
  const item = await agentApprovalHub.resolve(root, payload.id, payload.answer || 'deny', { actor: 'user' });
  const pendingCount = await agentApprovalHub.pendingCount(root);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('agent:event', {
      type: 'approval_badge',
      pendingCount,
      storageDir: root,
      resolvedId: item.id,
      resolution: item.resolution
    });
  }
  return { item, pendingCount };
});

ipcMain.handle('agent:approvals:count', async (event, storageDir) => {
  const root = await withAgentStorageReadOnly(event, storageDir);
  return { pendingCount: await agentApprovalHub.pendingCount(root) };
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

async function tickAgentSchedules() {
  for (const root of [...allowedStorageRoots]) {
    let schedules = [];
    try { schedules = await AgentScheduler.listSchedules(root); } catch (_err) { continue; }
    for (const schedule of AgentScheduler.dueSchedules(schedules)) {
      if (agentScheduleInflight.has(schedule.id)) continue;
      agentScheduleInflight.add(schedule.id);
      try {
        const template = await AgentTemplates.getTemplate(root, schedule.templateId);
        if (!template) {
          await AgentScheduler.markScheduleRun(root, schedule.id, { status: 'missing-template' });
          await AgentScheduler.appendHistory(root, { scheduleId: schedule.id, templateId: schedule.templateId, status: 'missing-template', summary: '模板不存在' });
          continue;
        }
        const prompt = AgentTemplates.renderPrompt(template, {});
        const wins = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
        if (!wins.length) {
          await AgentScheduler.markScheduleRun(root, schedule.id, { status: 'no-window' });
          await AgentScheduler.appendHistory(root, { scheduleId: schedule.id, templateId: template.id, status: 'no-window', summary: '应用无窗口，已跳过' });
          continue;
        }
        await AgentScheduler.markScheduleRun(root, schedule.id, { status: 'triggered' });
        wins[0].webContents.send('agent:event', {
          type: 'schedule_due',
          storageDir: root,
          schedule,
          template,
          prompt
        });
      } catch (err) {
        await AgentScheduler.appendHistory(root, { scheduleId: schedule.id, status: 'error', summary: err?.message || String(err) }).catch(() => {});
      } finally {
        agentScheduleInflight.delete(schedule.id);
      }
    }
  }
}

app.whenReady().then(async () => {
  cleanStaleStorageTempFiles().catch(() => {});
  for (const root of allowedStorageRoots) {
    try {
      const recovery = await recoverWorkspaceRestore(root);
      if (recovery.recovered) await appendAppLog('warn', 'workspace restore transaction recovered', {root, action: recovery.action});
    } catch (error) {
      await appendAppLog('error', 'workspace restore recovery failed', {root, message: error?.message || String(error)});
    }
  }
  appendAppLog('info', 'app ready', { version: app.getVersion(), buildLabel: APP_PACKAGE_METADATA.buildLabel || '', appPath: app.getAppPath(), releaseChannel: RELEASE_CHANNEL || 'development', runtimePaths: LOCAL_RUNTIME_PATHS });
  // Non-blocking: keep only the latest Codex/update binary backups
  pruneRuntimeDiskFootprint();
  registerAgentEmergencyHotkey('CommandOrControl+Alt+Shift+S');
  if (agentScheduleTimer) clearInterval(agentScheduleTimer);
  agentScheduleTimer = setInterval(() => { tickAgentSchedules().catch(() => {}); }, 30_000);
  setTimeout(() => { tickAgentSchedules().catch(() => {}); }, 5_000);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let quitDrained = false;
app.on('before-quit', event => {
  if (quitDrained || !storageWriteQueues.size) return;
  event.preventDefault();
  drainStorageWrites().finally(() => { quitDrained = true; app.quit(); });
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (_err) { /* ignore */ }
  if (agentScheduleTimer) clearInterval(agentScheduleTimer);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
