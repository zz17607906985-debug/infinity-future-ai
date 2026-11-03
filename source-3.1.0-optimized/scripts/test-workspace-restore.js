'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  RESTORE_JOURNAL_FORMAT,
  restoreJournalFile,
  recoverWorkspaceRestore,
  writeRestoreJournal
} = require('../src/runtime/workspace-restore');

async function makeRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'future-ai-restore-test-'));
}

function restoreEntry(target, id) {
  return {target, old: `${target}.restore-old-${id}`, id, hadOriginal: true};
}

(async () => {
  const root = await makeRoot();
  try {
    const id = crypto.randomUUID();
    const stageRoot = `.future-ai-restore-${id}`;
    await fs.mkdir(path.join(root, stageRoot), {recursive: true});
    await fs.writeFile(path.join(root, 'projects.json'), '{"version":"new"}', 'utf8');
    await fs.writeFile(path.join(root, 'projects.json.restore-old-' + id), '{"version":"old"}', 'utf8');
    await writeRestoreJournal(root, {
      format: RESTORE_JOURNAL_FORMAT,
      version: 1,
      phase: 'committing',
      stageRoot,
      entries: [restoreEntry('projects.json', id)]
    });
    const rollback = await recoverWorkspaceRestore(root);
    assert.deepEqual(rollback, {recovered: true, action: 'rolled-back'});
    assert.equal(await fs.readFile(path.join(root, 'projects.json'), 'utf8'), '{"version":"old"}');
    await assert.rejects(fs.access(restoreJournalFile(root)));
    await assert.rejects(fs.access(path.join(root, stageRoot)));

    const committedId = crypto.randomUUID();
    const committedStage = `.future-ai-restore-${committedId}`;
    await fs.mkdir(path.join(root, committedStage), {recursive: true});
    await fs.writeFile(path.join(root, 'projects.json'), '{"version":"committed"}', 'utf8');
    await fs.writeFile(path.join(root, 'projects.json.restore-old-' + committedId), '{"version":"old"}', 'utf8');
    await writeRestoreJournal(root, {
      format: RESTORE_JOURNAL_FORMAT,
      version: 1,
      phase: 'committed',
      stageRoot: committedStage,
      entries: [restoreEntry('projects.json', committedId)]
    });
    const finalized = await recoverWorkspaceRestore(root);
    assert.deepEqual(finalized, {recovered: true, action: 'finalized'});
    assert.equal(await fs.readFile(path.join(root, 'projects.json'), 'utf8'), '{"version":"committed"}');
    await assert.rejects(fs.access(path.join(root, 'projects.json.restore-old-' + committedId)));

    await assert.rejects(() => writeRestoreJournal(root, {
      format: RESTORE_JOURNAL_FORMAT,
      version: 1,
      phase: 'committing',
      stageRoot: '../outside',
      entries: [restoreEntry('projects.json', crypto.randomUUID())]
    }), /暂存目录|stage|越界/);
    console.log('Workspace restore tests passed: interrupted commit rollback, committed cleanup, and path validation.');
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
