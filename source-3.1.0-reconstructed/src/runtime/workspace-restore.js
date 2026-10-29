const fs = require('fs');
const {writeJsonAtomic} = require('./atomic-write');
const fsp = fs.promises;
const path = require('path');

const RESTORE_JOURNAL_FORMAT = 'future-ai-workspace-restore/v1';
const RESTORE_JOURNAL_RELATIVE = '.future-ai/restore-transaction.json';
const ALLOWED_TARGETS = new Set([
  'projects.json',
  'history.json',
  'assets.json',
  'asset-folders.json',
  'models.json',
  'media',
  '.future-ai/attachments'
]);

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function restoreJournalFile(storageDir) {
  return path.join(path.resolve(storageDir), ...RESTORE_JOURNAL_RELATIVE.split('/'));
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function validateRestoreJournal(storageDir, journal) {
  const root = path.resolve(storageDir);
  if (journal?.format !== RESTORE_JOURNAL_FORMAT || journal?.version !== 1) throw new Error('恢复事务日志格式无效');
  if (!['committing', 'committed'].includes(journal.phase)) throw new Error('恢复事务阶段无效');
  if (!Array.isArray(journal.entries) || !journal.entries.length || journal.entries.length > ALLOWED_TARGETS.size) throw new Error('恢复事务条目无效');

  const stageRelative = normalizeRelative(journal.stageRoot);
  if (!/^\.future-ai-restore-[0-9a-f-]{36}$/i.test(stageRelative)) throw new Error('恢复暂存目录无效');
  const stageRoot = path.resolve(root, ...stageRelative.split('/'));
  if (!pathInside(root, stageRoot)) throw new Error('恢复暂存目录越界');

  const seen = new Set();
  const entries = journal.entries.map(entry => {
    const targetRelative = normalizeRelative(entry?.target);
    const oldRelative = normalizeRelative(entry?.old);
    if (!ALLOWED_TARGETS.has(targetRelative) || seen.has(targetRelative)) throw new Error('恢复事务目标无效');
    if (oldRelative !== `${targetRelative}.restore-old-${entry.id}` || !/^[0-9a-f-]{36}$/i.test(String(entry.id || ''))) throw new Error('恢复事务旧文件路径无效');
    const target = path.resolve(root, ...targetRelative.split('/'));
    const old = path.resolve(root, ...oldRelative.split('/'));
    if (!pathInside(root, target) || !pathInside(root, old)) throw new Error('恢复事务路径越界');
    seen.add(targetRelative);
    return {target, old, hadOriginal: entry.hadOriginal === true};
  });
  return {root, stageRoot, entries, phase: journal.phase};
}

async function writeRestoreJournal(storageDir, journal) {
  validateRestoreJournal(storageDir, journal);
  const file = restoreJournalFile(storageDir);
  await fsp.mkdir(path.dirname(file), {recursive: true});
  await writeJsonAtomic(file, journal);
  return file;
}

async function recoverWorkspaceRestore(storageDir) {
  const file = restoreJournalFile(storageDir);
  if (!fs.existsSync(file)) return {recovered: false};
  const journal = JSON.parse(await fsp.readFile(file, 'utf8'));
  const state = validateRestoreJournal(storageDir, journal);

  if (state.phase === 'committing') {
    for (const entry of [...state.entries].reverse()) {
      if (entry.hadOriginal && fs.existsSync(entry.old)) {
        await fsp.rm(entry.target, {recursive: true, force: true});
        await fsp.rename(entry.old, entry.target);
      } else if (!entry.hadOriginal) {
        await fsp.rm(entry.target, {recursive: true, force: true});
      }
    }
  } else {
    for (const entry of state.entries) await fsp.rm(entry.old, {recursive: true, force: true});
  }

  await fsp.rm(state.stageRoot, {recursive: true, force: true});
  await fsp.rm(file, {force: true});
  return {recovered: true, action: state.phase === 'committing' ? 'rolled-back' : 'finalized'};
}

module.exports = {
  RESTORE_JOURNAL_FORMAT,
  RESTORE_JOURNAL_RELATIVE,
  recoverWorkspaceRestore,
  restoreJournalFile,
  validateRestoreJournal,
  writeRestoreJournal
};
