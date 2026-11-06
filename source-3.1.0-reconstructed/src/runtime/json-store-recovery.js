const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function assertStoreValue(value) {
  if (!Array.isArray(value)) {
    const error = new Error('存储文件顶层结构必须是数组');
    error.code = 'STORE_INVALID_SHAPE';
    throw error;
  }
  return value;
}

async function readValidStore(file) {
  return assertStoreValue(JSON.parse(await fsp.readFile(file, 'utf8')));
}

async function backupValidStore({file, backupDir, backupName, limit = 20}) {
  try {
    await readValidStore(file);
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    if (error instanceof SyntaxError || error.code === 'STORE_INVALID_SHAPE') return '';
    throw error;
  }
  await fsp.mkdir(backupDir, {recursive: true});
  const backupFile = path.join(backupDir, backupName);
  await fsp.copyFile(file, backupFile);
  const suffix = `-${path.basename(file)}`;
  const entries = (await fsp.readdir(backupDir, {withFileTypes: true}))
    .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a));
  await Promise.all(entries.slice(limit).map(name => fsp.rm(path.join(backupDir, name), {force: true})));
  return backupFile;
}

async function recoverStoreFromBackup({file, backupDir, corruptDir}) {
  try {
    return {value: await readValidStore(file), recovered: false};
  } catch (error) {
    if (error.code === 'ENOENT') return {value: null, recovered: false};
    const suffix = `-${path.basename(file)}`;
    let candidates = [];
    try {
      candidates = (await fsp.readdir(backupDir, {withFileTypes: true}))
        .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
        .map(entry => path.join(backupDir, entry.name))
        .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
    } catch (readError) {
      if (readError.code !== 'ENOENT') throw readError;
    }
    for (const backupFile of candidates) {
      let value;
      try {
        value = await readValidStore(backupFile);
      } catch (_invalidBackup) {
        continue;
      }
      await fsp.mkdir(corruptDir, {recursive: true});
      const corruptFile = path.join(corruptDir, `${Date.now()}-${path.basename(file)}.corrupt`);
      const tempFile = `${file}.${process.pid}.${Date.now()}.recovery.tmp`;
      await fsp.copyFile(backupFile, tempFile);
      await fsp.rename(file, corruptFile);
      try {
        await fsp.rename(tempFile, file);
      } catch (commitError) {
        await fsp.rename(corruptFile, file).catch(() => {});
        await fsp.rm(tempFile, {force: true}).catch(() => {});
        throw commitError;
      }
      return {value, recovered: true, backupFile, corruptFile};
    }
    const failure = new Error(`存储文件损坏且没有可用备份：${path.basename(file)}`);
    failure.code = 'STORE_CORRUPT_NO_BACKUP';
    failure.cause = error;
    throw failure;
  }
}

module.exports = {
  assertStoreValue,
  backupValidStore,
  readValidStore,
  recoverStoreFromBackup
};
