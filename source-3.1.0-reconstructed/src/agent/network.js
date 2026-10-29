'use strict';

const fs = require('fs/promises');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal']);

function assertPublicUrl(raw) {
  let parsed;
  try { parsed = new URL(String(raw || '')); } catch (_err) { throw new Error('URL 无效'); }
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error('仅支持 http/https');
  const host = parsed.hostname.toLowerCase();
  // Opt-in for eval/harness fixtures that listen on loopback (not set in normal installs).
  const allowLoopback = process.env.FUTURE_AI_ALLOW_LOOPBACK === '1' && BLOCKED_HOSTS.has(host);
  if (!allowLoopback && (BLOCKED_HOSTS.has(host) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(host))) {
    throw new Error('禁止访问本机或内网地址');
  }
  return parsed;
}

function requestBuffer(url, { method = 'GET', headers = {}, body, timeoutMs = 60_000, maxBytes = 20 * 1024 * 1024, redirectLeft = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = assertPublicUrl(url);
    const lib = parsed.protocol === 'http:' ? http : https;
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'User-Agent': 'FutureAI-Agent/2',
        Accept: '*/*',
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...headers
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, parsed).toString();
        resolve(requestBuffer(next, { method: 'GET', headers, timeoutMs, maxBytes, redirectLeft: redirectLeft - 1 }));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error(`响应超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: res.headers,
        url: parsed.toString(),
        buffer: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('网络请求超时')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function fetch_url({ url, method = 'GET', body = '', headers = {}, max_chars = 20000 } = {}) {
  const verb = String(method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)) throw new Error('不支持的 HTTP 方法');
  const response = await requestBuffer(url, {
    method: verb,
    headers: headers && typeof headers === 'object' ? headers : {},
    body: verb === 'GET' || verb === 'DELETE' ? undefined : body,
    maxBytes: 2 * 1024 * 1024
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = String(response.headers['content-type'] || '');
  const text = response.buffer.toString('utf8');
  const stripped = /html/i.test(contentType)
    ? text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : text;
  const limit = Math.min(Math.max(Number(max_chars) || 20000, 200), 200_000);
  return {
    url: response.url,
    status: response.status,
    contentType,
    truncated: stripped.length > limit,
    text: stripped.slice(0, limit)
  };
}

async function download_file({ url, path: dest, checkPath } = {}) {
  if (!dest) throw new Error('请提供保存路径');
  const checked = checkPath(dest);
  const response = await requestBuffer(url, { maxBytes: 50 * 1024 * 1024 });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await fs.mkdir(path.dirname(checked.path), { recursive: true });
  await fs.writeFile(checked.path, response.buffer);
  return { path: checked.path, bytes: response.buffer.length, status: response.status, url: response.url, outside: checked.outside };
}

async function web_search({ query, max_results = 5 } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('搜索词为空');
  const limit = Math.min(Math.max(Number(max_results) || 5, 1), 10);
  // DuckDuckGo HTML is dependency-free; parse first result links.
  const response = await requestBuffer(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxBytes: 1_500_000
  });
  if (!response.ok) throw new Error(`搜索失败 HTTP ${response.status}`);
  const html = response.buffer.toString('utf8');
  const results = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/gi;
  let match;
  while ((match = re.exec(html)) && results.length < limit) {
    let href = match[1];
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.pathname === '/l/' && u.searchParams.get('uddg')) href = decodeURIComponent(u.searchParams.get('uddg'));
    } catch (_err) { /* keep */ }
    results.push({
      url: href,
      title: match[2].replace(/<[^>]+>/g, '').trim(),
      snippet: match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    });
  }
  if (!results.length) {
    // Fallback looser parse
    const loose = /href="(https?:\/\/[^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = loose.exec(html)) && results.length < limit) {
      results.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim(), snippet: '' });
    }
  }
  return { query: q, results };
}

module.exports = {
  assertPublicUrl,
  download_file,
  fetch_url,
  requestBuffer,
  web_search
};
