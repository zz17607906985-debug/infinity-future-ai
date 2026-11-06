'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');

const {verifySignedUpdateManifest} = require('./update-signature');

const API_ROOT = 'https://api.github.com';
const MAX_RELEASE_BYTES = 1024 * 1024;
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
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function requestHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'InfinityFutureAI-Updater',
    ...(token ? {Authorization: `Bearer ${token}`} : {})
  };
}

async function responseBytes(response, limit, description) {
  if (!response.ok) throw new Error(`${description}请求失败（HTTP ${response.status}）`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > limit) throw new Error(`${description}超过大小限制`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error(`${description}超过大小限制`);
  return bytes;
}

async function requestLatestRelease({owner, repo, token = '', fetchImpl = fetch, signal}) {
  const repoPath = repositoryPath(owner, repo);
  const response = await fetchImpl(`${API_ROOT}${repoPath}/releases/latest`, {
    headers: requestHeaders(token),
    signal: signal || AbortSignal.timeout(30_000),
    redirect: 'error'
  });
  if (response.status === 404 && !token) {
    throw new Error('无法访问 GitHub 更新仓库。若仓库为私密仓库，请为本次进程配置 FUTURE_AI_GITHUB_TOKEN；公开发布后无需令牌。');
  }
  const bytes = await responseBytes(response, MAX_RELEASE_BYTES, 'GitHub Release');
  let release;
  try {
    release = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('GitHub Release 响应格式无效');
  }
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) {
    throw new Error('没有可用的正式版 GitHub Release');
  }
  return {repoPath, release};
}

async function requestReleaseByTag({owner, repo, version, token = '', fetchImpl = fetch}) {
  const repoPath = repositoryPath(owner, repo);
  const response = await fetchImpl(`${API_ROOT}${repoPath}/releases/tags/v${encodeURIComponent(version)}`, {
    headers: requestHeaders(token),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`当前版本 ${version} 的回滚安装包未发布（HTTP ${response.status}）`);
  const bytes = await responseBytes(response, MAX_RELEASE_BYTES, 'GitHub Release');
  let release;
  try {
    release = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('GitHub Release 响应格式无效');
  }
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) {
    throw new Error(`当前版本 ${version} 没有可用的正式版回滚安装包`);
  }
  return {repoPath, release};
}

function findReleaseAsset(release, name) {
  const matches = release.assets.filter(asset => asset?.name === name);
  if (matches.length !== 1) throw new Error(`GitHub Release 必须且只能包含一个 ${name}`);
  return matches[0];
}

function validateAssetUrl(value, owner, repo, assetId) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('GitHub Release 附件地址无效');
  }
  const expectedPath = `/repos/${owner}/${repo}/releases/assets/${assetId}`;
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com'
    || url.pathname !== expectedPath || url.username || url.password) {
    throw new Error('GitHub Release 附件地址不受信任');
  }
  return url.toString();
}

async function downloadAsset({asset, owner, repo, token, fetchImpl, target, limit}) {
  if (!asset || !Number.isSafeInteger(asset.id) || asset.id < 1
    || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > limit) {
    throw new Error('GitHub Release 附件元数据无效');
  }
  const url = validateAssetUrl(asset.url, owner, repo, asset.id);
  const response = await fetchImpl(url, {
    headers: requestHeaders(token, 'application/octet-stream'),
    signal: AbortSignal.timeout(10 * 60_000),
    redirect: 'follow'
  });
  if (!response.ok || !response.body) throw new Error(`GitHub Release 附件下载失败（HTTP ${response.status}）`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength && contentLength !== asset.size) throw new Error('GitHub Release 附件大小与元数据不一致');
  const temporary = `${target}.${process.pid}.${Date.now()}.download`;
  let bytes = 0;
  try {
    const limiter = new (require('node:stream').Transform)({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > limit || bytes > asset.size) return callback(new Error('GitHub Release 附件超过声明大小'));
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), limiter, require('node:fs').createWriteStream(temporary, {flags: 'wx'}));
    if (bytes !== asset.size) throw new Error('GitHub Release 附件下载不完整');
    await fs.rename(temporary, target);
    return target;
  } catch (error) {
    await fs.rm(temporary, {force: true}).catch(() => {});
    throw error;
  }
}

async function checkLatestGitHubUpdate(options = {}) {
  const {
    owner,
    repo,
    currentVersion,
    keyRing,
    token = '',
    cacheDir,
    fetchImpl = fetch
  } = options;
  const {release} = await requestLatestRelease({owner, repo, token, fetchImpl});
  const tagMatch = /^v?(\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(String(release.tag_name || ''));
  if (!tagMatch) throw new Error('GitHub Release 标签必须使用三段版本号');
  const version = tagMatch[1];
  const manifestAsset = findReleaseAsset(release, 'update-manifest.json');
  const manifestUrl = validateAssetUrl(manifestAsset.url, owner, repo, manifestAsset.id);
  const manifestResponse = await fetchImpl(manifestUrl, {
    headers: requestHeaders(token, 'application/octet-stream'),
    signal: AbortSignal.timeout(30_000),
    redirect: 'follow'
  });
  const manifestBytes = await responseBytes(manifestResponse, MAX_MANIFEST_BYTES, '更新清单');
  const manifest = verifySignedUpdateManifest(manifestBytes.toString('utf8'), keyRing);
  if (manifest.version !== version) throw new Error('GitHub Release 标签与签名更新版本不一致');
  if (compareVersions(version, currentVersion) <= 0) {
    return Object.freeze({currentVersion, availableVersion: version, updateAvailable: false});
  }
  if (!cacheDir) throw new Error('更新缓存目录未配置');
  const artifact = findReleaseAsset(release, manifest.artifact);
  if (artifact.size !== manifest.bytes) throw new Error('GitHub Release 安装包大小与签名清单不一致');
  const packageDir = path.join(path.resolve(cacheDir), `github-${version}`);
  await fs.mkdir(packageDir, {recursive: true});
  const manifestFile = path.join(packageDir, 'update-manifest.json');
  const installerPath = path.join(packageDir, manifest.artifact);
  const manifestTemp = `${manifestFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(manifestTemp, manifestBytes, {flag: 'wx'});
    await fs.rename(manifestTemp, manifestFile);
    await downloadAsset({
      asset: artifact,
      owner,
      repo,
      token,
      fetchImpl,
      target: installerPath,
      limit: Math.min(MAX_INSTALLER_BYTES, manifest.bytes)
    });
  } catch (error) {
    await fs.rm(manifestTemp, {force: true}).catch(() => {});
    throw error;
  }
  return Object.freeze({
    currentVersion,
    availableVersion: version,
    updateAvailable: true,
    compatible: true,
    packageDir,
    installerPath,
    bytes: manifest.bytes,
    notes: manifest.notes,
    signatureVerified: true,
    source: 'github-release'
  });
}

async function cacheGitHubReleaseInstaller(options = {}) {
  const {owner, repo, version, keyRing, token = '', cacheDir, fetchImpl = fetch} = options;
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(version || ''))) {
    throw new Error('回滚安装包版本无效');
  }
  if (!cacheDir) throw new Error('更新缓存目录未配置');
  const {release} = await requestReleaseByTag({owner, repo, version, token, fetchImpl});
  const tagMatch = /^v?(\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(String(release.tag_name || ''));
  if (!tagMatch || tagMatch[1] !== version) throw new Error('回滚 Release 标签与版本不一致');
  const manifestAsset = findReleaseAsset(release, 'update-manifest.json');
  const manifestUrl = validateAssetUrl(manifestAsset.url, owner, repo, manifestAsset.id);
  const manifestResponse = await fetchImpl(manifestUrl, {
    headers: requestHeaders(token, 'application/octet-stream'),
    signal: AbortSignal.timeout(30_000),
    redirect: 'follow'
  });
  const manifestBytes = await responseBytes(manifestResponse, MAX_MANIFEST_BYTES, '更新清单');
  const manifest = verifySignedUpdateManifest(manifestBytes.toString('utf8'), keyRing);
  if (manifest.version !== version) throw new Error('回滚 Release 与签名更新版本不一致');
  const artifact = findReleaseAsset(release, manifest.artifact);
  if (artifact.size !== manifest.bytes) throw new Error('回滚安装包大小与签名清单不一致');
  const packageDir = path.join(path.resolve(cacheDir), `github-${version}`);
  const manifestFile = path.join(packageDir, 'update-manifest.json');
  const installerPath = path.join(packageDir, manifest.artifact);
  await fs.mkdir(packageDir, {recursive: true});
  if (await fs.stat(installerPath).then(() => true, () => false)
    && await fs.stat(manifestFile).then(() => true, () => false)) {
    return Object.freeze({packageDir, installerPath, version, cached: true});
  }
  const manifestTemp = `${manifestFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(manifestTemp, manifestBytes, {flag: 'wx'});
    await fs.rename(manifestTemp, manifestFile);
    await downloadAsset({
      asset: artifact,
      owner,
      repo,
      token,
      fetchImpl,
      target: installerPath,
      limit: Math.min(MAX_INSTALLER_BYTES, manifest.bytes)
    });
  } catch (error) {
    await fs.rm(manifestTemp, {force: true}).catch(() => {});
    await fs.rm(installerPath, {force: true}).catch(() => {});
    throw error;
  }
  return Object.freeze({packageDir, installerPath, version, cached: false});
}

module.exports = {
  cacheGitHubReleaseInstaller,
  checkLatestGitHubUpdate,
  compareVersions,
  repositoryPath,
  validateAssetUrl
};
