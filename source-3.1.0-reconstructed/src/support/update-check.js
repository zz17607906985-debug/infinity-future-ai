'use strict';

/**
 * 检查更新：只读取用户（或分发者）配置的“更新地址”里的一份很小的 JSON，不下载、不安装任何东西。
 * 更新地址可以是 http(s) 链接，也可以是本机/共享文件夹里的 version.json（或其所在文件夹）。
 * JSON 格式：{"version": "3.1.1", "build": "可选", "notes": "可选更新说明", "download": "可选下载链接或文件路径"}
 */
const fs = require('fs/promises');
const path = require('path');

const MAX_FEED_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 8000;

function compareVersions(a, b) {
  const left = String(a || '0').replace(/^v/i, '').split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
  const right = String(b || '0').replace(/^v/i, '').split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length, 3); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

function parseFeed(raw) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw.replace(/^\uFEFF/, '')) : raw;
  } catch {
    throw new Error('更新信息不是有效的 JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('更新信息格式不对');
  const version = cleanText(data.version, 40).replace(/^v/i, '');
  if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error('更新信息里缺少有效的版本号（version）');
  return {
    version,
    build: cleanText(data.build, 40),
    notes: cleanText(data.notes, 2000),
    download: cleanText(data.download, 1000),
    date: cleanText(data.date, 40)
  };
}

function evaluateUpdate(feed, current = {}) {
  const versionDiff = compareVersions(feed.version, current.version);
  let newer = versionDiff > 0;
  if (versionDiff === 0 && feed.build && current.build && feed.build !== current.build) {
    newer = feed.build.localeCompare(current.build, 'en', {numeric: true}) > 0;
  }
  return {status: newer ? 'update' : 'latest', current: {version: String(current.version || ''), build: String(current.build || '')}, latest: feed};
}

function isHttpUrl(value) {
  try {
    const {protocol} = new URL(String(value || ''));
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function localFeedPath(source) {
  let value = String(source || '').trim().replace(/^"|"$/g, '');
  if (/^file:/i.test(value)) value = require('url').fileURLToPath(value);
  if (!path.isAbsolute(value)) throw new Error('更新地址需要是 http(s) 链接，或完整的文件夹 / version.json 路径');
  return path.normalize(value);
}

async function readLocalFeed(source) {
  let file = localFeedPath(source);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) throw new Error('找不到更新地址里的文件或文件夹');
  if (stat.isDirectory()) file = path.join(file, 'version.json');
  if (!/\.json$/i.test(file)) throw new Error('本地更新地址需要指向 version.json 或它所在的文件夹');
  const fileStat = await fs.stat(file).catch(() => null);
  if (!fileStat?.isFile()) throw new Error('文件夹里没有 version.json');
  if (fileStat.size > MAX_FEED_BYTES) throw new Error('更新信息文件太大');
  return {text: await fs.readFile(file, 'utf8'), baseDir: path.dirname(file)};
}

async function readRemoteFeed(source, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(source, {signal: controller.signal, headers: {Accept: 'application/json'}, cache: 'no-store', redirect: 'follow'});
    if (!res.ok) throw new Error(`更新地址返回 HTTP ${res.status}`);
    const length = Number(res.headers?.get?.('content-length') || 0);
    if (length > MAX_FEED_BYTES) throw new Error('更新信息文件太大');
    const text = await res.text();
    if (text.length > MAX_FEED_BYTES) throw new Error('更新信息文件太大');
    return {text, baseDir: ''};
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('连接更新地址超时，请检查网络后再试');
    if (/^(更新|连接)/.test(String(err?.message || ''))) throw err;
    throw new Error('无法连接更新地址：' + (err?.cause?.code || err?.message || err));
  } finally {
    clearTimeout(timer);
  }
}

function resolveDownload(download, baseDir) {
  if (!download) return '';
  if (isHttpUrl(download)) return download;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(download) && !/^file:/i.test(download)) return '';
  try {
    const value = /^file:/i.test(download) ? require('url').fileURLToPath(download) : download;
    if (path.isAbsolute(value)) return path.normalize(value);
    return baseDir ? path.join(baseDir, value) : '';
  } catch {
    return '';
  }
}

async function checkForUpdate({source, current, fetchImpl = globalThis.fetch} = {}) {
  const value = String(source || '').trim();
  if (!value) return {status: 'unconfigured', current};
  const {text, baseDir} = isHttpUrl(value) ? await readRemoteFeed(value, fetchImpl) : await readLocalFeed(value);
  const feed = parseFeed(text);
  feed.download = resolveDownload(feed.download, baseDir);
  return evaluateUpdate(feed, current);
}

async function readDefaultSource(appDir) {
  if (!appDir) return '';
  try {
    const text = await fs.readFile(path.join(appDir, 'update-source.txt'), 'utf8');
    return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#')) || '';
  } catch {
    return '';
  }
}

module.exports = {MAX_FEED_BYTES, compareVersions, parseFeed, evaluateUpdate, isHttpUrl, resolveDownload, checkForUpdate, readDefaultSource};
