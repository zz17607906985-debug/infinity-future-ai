const fs = require('fs');
const path = require('path');
const { uniqueTempPath } = require('./atomic-write');

const RUNTIME_MIGRATION_VERSION = 1;
const MIGRATION_MARKER = 'runtime-migration-v1.json';

const USER_DATA_FILES = [
  'allowed-storage-roots.json',
  'api-key.json',
  'provider-api-keys.json'
];

const USER_DATA_DIRECTORIES = [
  'update-backups'
];

const SESSION_DATA_FILES = [
  'Local State',
  'Preferences'
];

const SESSION_DATA_DIRECTORIES = [
  'Local Storage',
  'Session Storage',
  'Partitions',
  'IndexedDB'
];

function runtimePathsFromRoot(root) {
  const runtimeRoot = path.resolve(root);
  return {
    root: runtimeRoot,
    userData: path.join(runtimeRoot, 'user-data'),
    sessionData: path.join(runtimeRoot, 'session-data'),
    logs: path.join(runtimeRoot, 'logs'),
    crashDumps: path.join(runtimeRoot, 'crash-dumps')
  };
}

function ensureRuntimeDirectories(paths) {
  for (const dir of [paths.root, paths.userData, paths.sessionData, paths.logs, paths.crashDumps]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

function copyFileMissing(source, target, copied) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  const stats = fs.statSync(source);
  if (!stats.isFile()) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = uniqueTempPath(target, 'migration.tmp');
  fs.copyFileSync(source, temp);
  fs.renameSync(temp, target);
  copied.push({ source, target, size: stats.size });
}

function copyDirectoryMissing(sourceRoot, targetRoot, copied) {
  if (!fs.existsSync(sourceRoot)) return;
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) copyDirectoryMissing(source, target, copied);
    else if (entry.isFile()) copyFileMissing(source, target, copied);
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = uniqueTempPath(file);
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function hasLegacyRuntimeData(legacyPaths) {
  return [...USER_DATA_FILES, ...USER_DATA_DIRECTORIES].some(name => fs.existsSync(path.join(legacyPaths.userData, name)))
    || [...SESSION_DATA_FILES, ...SESSION_DATA_DIRECTORIES].some(name => fs.existsSync(path.join(legacyPaths.sessionData, name)));
}

function migrateLegacyRuntime(legacyRoot, targetRoot) {
  const legacyPaths = runtimePathsFromRoot(legacyRoot);
  const targetPaths = ensureRuntimeDirectories(runtimePathsFromRoot(targetRoot));
  const markerFile = path.join(targetPaths.root, MIGRATION_MARKER);
  if (fs.existsSync(markerFile) || !hasLegacyRuntimeData(legacyPaths)) {
    return { migrated: false, complete: true, paths: targetPaths, markerFile, copied: [] };
  }

  const copied = [];
  for (const name of USER_DATA_FILES) {
    copyFileMissing(path.join(legacyPaths.userData, name), path.join(targetPaths.userData, name), copied);
  }
  for (const name of USER_DATA_DIRECTORIES) {
    copyDirectoryMissing(path.join(legacyPaths.userData, name), path.join(targetPaths.userData, name), copied);
  }
  for (const name of SESSION_DATA_FILES) {
    copyFileMissing(path.join(legacyPaths.sessionData, name), path.join(targetPaths.sessionData, name), copied);
  }
  for (const name of SESSION_DATA_DIRECTORIES) {
    copyDirectoryMissing(path.join(legacyPaths.sessionData, name), path.join(targetPaths.sessionData, name), copied);
  }

  writeJsonAtomic(markerFile, {
    version: RUNTIME_MIGRATION_VERSION,
    migratedAt: new Date().toISOString(),
    legacyRoot: legacyPaths.root,
    targetRoot: targetPaths.root,
    copiedFiles: copied.length,
    copiedBytes: copied.reduce((sum, item) => sum + item.size, 0),
    excluded: ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'codex', 'codex-backups', 'codex-home']
  });
  return { migrated: copied.length > 0, complete: true, paths: targetPaths, markerFile, copied };
}

function selectRuntimePaths({ legacyRoot, targetRoot }) {
  try {
    return { ...migrateLegacyRuntime(legacyRoot, targetRoot), usingLegacy: false };
  } catch (error) {
    const paths = ensureRuntimeDirectories(runtimePathsFromRoot(legacyRoot));
    return { migrated: false, complete: false, usingLegacy: true, paths, copied: [], error };
  }
}

module.exports = {
  MIGRATION_MARKER,
  RUNTIME_MIGRATION_VERSION,
  runtimePathsFromRoot,
  ensureRuntimeDirectories,
  hasLegacyRuntimeData,
  migrateLegacyRuntime,
  selectRuntimePaths
};
