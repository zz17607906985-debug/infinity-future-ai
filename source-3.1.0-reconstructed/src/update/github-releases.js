'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');

const {verifySignedUpdateManifest} = require('./update-signature');

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_INSTALLER_BYTES = 4 * 1024 * 1024 * 1024;

function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function repositoryPath(owner, repo) {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw new Error('GitHub 更新仓库配置无效');
  }
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function releaseFileUrl(owner, repo, version, filename) {
  const base = repositoryPath(owner, repo);
  if (filename !== 'update-manifest.json'
    && !/^FutureAI-Setup-\d{1,3}\.\d{1,3}\.\d{1,3}-(?:x64|arm64|ia32)\.exe$/i.test(filename)) {
    throw new Error('GitHub Release 附件名称无效');
  }
  if (version === 'latest') {
    if (filename !== 'update-manifest.json') throw new Error('latest 仅允许读取更新清单');
    return `${base}/releases/latest/download/${filename}`;
  }
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(version || ''))) {
    throw new Error('GitHub Release 版本无效');
  }
  return `${base}/releases/download/v${version}/${filename}`;
}

async function responseBytes(response, limit, description) {
  if (!response.ok) throw new Error(`${description}请求失败（HTTP ${response.status}）`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > limit) throw new Error(`${description}超过大小限制`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error(`${description}超过大小限制`);
  return bytes;
}

async function fetchManifest({owner, repo, version, keyRing, fetchImpl}) {
  const response = await fetchImpl(releaseFileUrl(owner, repo, version, 'update-manifest.json'), {
    signal: AbortSignal.timeout(30_000),
    redirect: 'follow'
  });
  const bytes = await responseBytes(response, MAX_MANIFEST_BYTES, '更新清单');
  const manifest = verifySignedUpdateManifest(bytes.toString('utf8'), keyRing);
  if (version !== 'latest' && manifest.version !== version) {
    throw new Error('回滚 Release 与签名更新版本不一致');
  }
  return {bytes, manifest};
}

async function downloadInstaller({owner, repo, manifest, fetchImpl, target}) {
  if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > MAX_INSTALLER_BYTES) {
    throw new Error('GitHub Release 安装包大小无效');
  }
  const response = await fetchImpl(
    releaseFileUrl(owner, repo, manifest.version, manifest.artifact),
    {signal: AbortSignal.timeout(10 * 60_000), redirect: 'follow'}
  );
  if (!response.ok || !response.body) {
    throw new Error(`GitHub Release 安装包下载失败（HTTP ${response.status}）`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength && contentLength !== manifest.bytes) {
    throw new Error('GitHub Release 安装包大小与签名清单不一致');
  }
  const temporary = `${target}.${process.pid}.${Date.now()}.download`;
  let bytes = 0;
  const hash = crypto.createHash('sha256');
  try {
    const limiter = new (require('node:stream').Transform)({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > manifest.bytes || bytes > MAX_INSTALLER_BYTES) {
          return callback(new Error('GitHub Release 安装包超过签名声明大小'));
        }
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      require('node:fs').createWriteStream(temporary, {flags: 'wx'})
    );
    if (bytes !== manifest.bytes) throw new Error('GitHub Release 安装包下载不完整');
    if (hash.digest('hex') !== manifest.sha256) throw new Error('GitHub Release 安装包 SHA-256 校验失败');
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, {force: true}).catch(() => {});
    throw error;
  }
}

async function cacheVerifiedInstaller({owner, repo, manifest, manifestBytes, cacheDir, fetchImpl}) {
  const packageDir = path.join(path.resolve(cacheDir), `github-${manifest.version}`);
  const manifestFile = path.join(packageDir, 'update-manifest.json');
  const installerPath = path.join(packageDir, manifest.artifact);
  await fs.mkdir(packageDir, {recursive: true});
  if (await fs.stat(installerPath).then(() => true, () => false)
    && await fs.stat(manifestFile).then(() => true, () => false)) {
    return Object.freeze({packageDir, installerPath, version: manifest.version, cached: true});
  }
  const manifestTemp = `${manifestFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(manifestTemp, manifestBytes, {flag: 'wx'});
    await fs.rename(manifestTemp, manifestFile);
    await downloadInstaller({owner, repo, manifest, fetchImpl, target: installerPath});
  } catch (error) {
    await fs.rm(manifestTemp, {force: true}).catch(() => {});
    await fs.rm(installerPath, {force: true}).catch(() => {});
    throw error;
  }
  return Object.freeze({packageDir, installerPath, version: manifest.version, cached: false});
}

async function checkLatestGitHubUpdate(options = {}) {
  const {
    owner,
    repo,
    currentVersion,
    keyRing,
    cacheDir,
    fetchImpl = fetch
  } = options;
  const {bytes, manifest} = await fetchManifest({
    owner, repo, version: 'latest', keyRing, fetchImpl
  });
  if (compareVersions(manifest.version, currentVersion) <= 0) {
    return Object.freeze({
      currentVersion,
      availableVersion: manifest.version,
      updateAvailable: false
    });
  }
  if (!cacheDir) throw new Error('更新缓存目录未配置');
  const cached = await cacheVerifiedInstaller({
    owner, repo, manifest, manifestBytes: bytes, cacheDir, fetchImpl
  });
  return Object.freeze({
    currentVersion,
    availableVersion: manifest.version,
    updateAvailable: true,
    compatible: compareVersions(currentVersion, manifest.minimumVersion) >= 0,
    packageDir: cached.packageDir,
    installerPath: cached.installerPath,
    bytes: manifest.bytes,
    notes: manifest.notes,
    signatureVerified: true,
    source: 'github-release'
  });
}

async function cacheGitHubReleaseInstaller(options = {}) {
  const {owner, repo, version, keyRing, cacheDir, fetchImpl = fetch} = options;
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(version || ''))) {
    throw new Error('回滚安装包版本无效');
  }
  if (!cacheDir) throw new Error('更新缓存目录未配置');
  const {bytes, manifest} = await fetchManifest({owner, repo, version, keyRing, fetchImpl});
  return cacheVerifiedInstaller({
    owner, repo, manifest, manifestBytes: bytes, cacheDir, fetchImpl
  });
}

module.exports = {
  cacheGitHubReleaseInstaller,
  checkLatestGitHubUpdate,
  compareVersions,
  releaseFileUrl,
  repositoryPath
};
