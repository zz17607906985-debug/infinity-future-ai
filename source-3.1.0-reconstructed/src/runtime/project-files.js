const crypto = require('crypto');
const {writeFileAtomic} = require('./atomic-write');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Projects are stored as one file per project under <storageDir>/projects:
//   index.json            ordered list of project ids
//   <id>.json             project data without undo history
//   <id>.history.json     undo snapshots (rewritten only when they change)
// A legacy single projects.json is migrated on read and kept as projects.json.migrated.
const PROJECTS_DIR = 'projects';
const INDEX_FILE = 'index.json';
const LEGACY_FILE = 'projects.json';
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function projectsDir(root) {
  return path.join(root, PROJECTS_DIR);
}

function hasSplitProjects(root) {
  return fs.existsSync(path.join(projectsDir(root), INDEX_FILE));
}

function hasLegacyProjects(root) {
  return fs.existsSync(path.join(root, LEGACY_FILE));
}

function assertProjectId(id) {
  const value = String(id || '');
  if (!SAFE_ID.test(value)) {
    const error = new Error(`项目 ID 无效：${value.slice(0, 40)}`);
    error.code = 'PROJECT_INVALID_ID';
    throw error;
  }
  return value;
}

function splitProject(project) {
  const {history, ...data} = project;
  return {data, history: Array.isArray(history) ? history : []};
}

function digest(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function writeAtomic(file, text) {
  await writeFileAtomic(file, text);
}

// Remembers what was last written per file so unchanged projects are not rewritten.
const writtenDigests = new Map();

async function writeIfChanged(file, value) {
  const text = JSON.stringify(value);
  const hash = digest(text);
  if (!writtenDigests.has(file)) {
    try { writtenDigests.set(file, digest(await fsp.readFile(file, 'utf8'))); } catch {}
  }
  if (writtenDigests.get(file) === hash) return false;
  await writeAtomic(file, text);
  writtenDigests.set(file, hash);
  return true;
}

async function removeFile(file) {
  writtenDigests.delete(file);
  await fsp.rm(file, {force: true});
}

async function writeSplitProjects(root, projects) {
  const dir = projectsDir(root);
  await fsp.mkdir(dir, {recursive: true});
  const ids = [];
  let written = 0;
  for (const project of projects) {
    const id = assertProjectId(project?.id);
    if (ids.includes(id)) throw new Error(`项目 ID 重复：${id}`);
    ids.push(id);
    const {data, history} = splitProject(project);
    if (await writeIfChanged(path.join(dir, `${id}.json`), data)) written += 1;
    const historyFile = path.join(dir, `${id}.history.json`);
    if (history.length) {
      if (await writeIfChanged(historyFile, history)) written += 1;
    } else {
      await removeFile(historyFile);
    }
  }
  await writeIfChanged(path.join(dir, INDEX_FILE), {version: 1, ids});
  const keep = new Set([INDEX_FILE, ...ids.flatMap(id => [`${id}.json`, `${id}.history.json`])]);
  let removed = 0;
  for (const name of await fsp.readdir(dir)) {
    if (keep.has(name) || !/\.json$/.test(name)) continue;
    await removeFile(path.join(dir, name));
    removed += 1;
  }
  return {written, removed};
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

// `recoverProject(id)` returns a replacement for an unreadable project file (or null).
async function readSplitProjects(root, {recoverProject = async () => null} = {}) {
  const dir = projectsDir(root);
  const index = await readJson(path.join(dir, INDEX_FILE));
  if (!Array.isArray(index?.ids)) throw new Error('项目索引结构无效');
  const projects = [];
  const recovered = [];
  for (const rawId of index.ids) {
    const id = assertProjectId(rawId);
    let data;
    try {
      data = await readJson(path.join(dir, `${id}.json`));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('项目文件结构无效');
    } catch (error) {
      const replacement = await recoverProject(id);
      if (!replacement) throw new Error(`项目文件损坏且没有可用备份：${id}.json（${error.message}）`);
      recovered.push(id);
      projects.push(replacement);
      continue;
    }
    let history = [];
    try { history = await readJson(path.join(dir, `${id}.history.json`)); } catch {}
    projects.push(Array.isArray(history) && history.length ? {...data, history} : data);
  }
  return {projects, recovered};
}

// Renames a legacy projects.json out of the way (kept as projects.json.migrated).
async function retireLegacyProjects(root) {
  const legacy = path.join(root, LEGACY_FILE);
  if (!fs.existsSync(legacy)) return '';
  let target = `${legacy}.migrated`;
  if (fs.existsSync(target)) target = `${legacy}.${Date.now()}.migrated`;
  await fsp.rename(legacy, target);
  return target;
}

// Moves a legacy projects.json into the split layout. `legacyProjects` is the
// already-validated content of projects.json.
async function migrateLegacyProjects(root, legacyProjects) {
  await writeSplitProjects(root, legacyProjects);
  return await retireLegacyProjects(root);
}

function forgetWrittenFiles() {
  writtenDigests.clear();
}

function projectsWithoutHistory(projects) {
  return projects.map(project => splitProject(project).data);
}

module.exports = {
  LEGACY_FILE,
  PROJECTS_DIR,
  forgetWrittenFiles,
  hasLegacyProjects,
  hasSplitProjects,
  migrateLegacyProjects,
  projectsWithoutHistory,
  readSplitProjects,
  retireLegacyProjects,
  writeSplitProjects
};
