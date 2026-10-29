'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');

/**
 * Drive the user's installed Chrome / Edge via CDP. No bundled browser,
 * no playwright. One shared session per agent run.
 */

function findBrowserExecutable(platform = process.platform, env = process.env) {
  const candidates = [];
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || '';
    const pf = env.ProgramFiles || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return candidates.find(file => file && fs.existsSync(file)) || '';
}

function httpGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (err) { reject(err); return; }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.get(parsed, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('CDP 探测超时')); });
  });
}

function createWsClient(url) {
  // Prefer the Electron/Chromium WebSocket if present; fall back to a tiny raw client.
  try {
    // eslint-disable-next-line global-require
    const WS = require('ws');
    return new WS(url);
  } catch (_err) {
    return createRawWebSocket(url);
  }
}

function createRawWebSocket(urlString) {
  const { EventEmitter } = require('events');
  const net = require('net');
  const crypto = require('crypto');
  const parsed = new URL(urlString);
  const emitter = new EventEmitter();
  const key = crypto.randomBytes(16).toString('base64');
  const socket = net.connect(Number(parsed.port) || 80, parsed.hostname, () => {
    const pathPart = parsed.pathname + (parsed.search || '');
    socket.write(
      `GET ${pathPart} HTTP/1.1\r\nHost: ${parsed.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    );
  });
  let buffer = Buffer.alloc(0);
  let open = false;
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!open) {
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const header = buffer.subarray(0, idx).toString('utf8');
      buffer = buffer.subarray(idx + 4);
      if (!/101/.test(header)) {
        emitter.emit('error', new Error(`WebSocket 握手失败：${header.split('\r\n')[0]}`));
        socket.destroy();
        return;
      }
      open = true;
      emitter.emit('open');
    }
    while (open && buffer.length >= 2) {
      const b0 = buffer[0];
      const b1 = buffer[1];
      const opcode = b0 & 0xf;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        len = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (buffer.length < offset + len) return;
      const payload = buffer.subarray(offset, offset + len);
      buffer = buffer.subarray(offset + len);
      if (opcode === 0x8) { emitter.emit('close'); socket.end(); return; }
      if (opcode === 0x1 || opcode === 0x2) emitter.emit('message', payload.toString('utf8'));
    }
  });
  socket.on('error', err => emitter.emit('error', err));
  socket.on('close', () => emitter.emit('close'));
  emitter.send = data => {
    const payload = Buffer.from(String(data), 'utf8');
    const mask = crypto.randomBytes(4);
    const header = Buffer.alloc(payload.length < 126 ? 6 : 8);
    header[0] = 0x81;
    if (payload.length < 126) {
      header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
    socket.write(Buffer.concat([header, masked]));
  };
  emitter.close = () => socket.end();
  emitter.readyState = 0;
  emitter.on('open', () => { emitter.readyState = 1; });
  emitter.on('close', () => { emitter.readyState = 3; });
  return emitter;
}

function createCdpSession(wsUrl) {
  const ws = createWsClient(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP 连接超时')), 10_000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', err => { clearTimeout(timer); reject(err); });
  });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch (_err) { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result || {});
    }
  });
  async function send(method, params = {}, timeoutMs = 30_000) {
    await ready;
    const id = nextId++;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: err => { clearTimeout(timer); reject(err); }
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  function close() {
    try { ws.close(); } catch (_err) { /* ignore */ }
  }
  return { send, close, ready };
}

function createBrowser({
  platform = process.platform,
  env = process.env,
  profileDir,
  findExecutable = findBrowserExecutable,
  getJson = httpGetJson
} = {}) {
  let child = null;
  let session = null;
  let port = 0;
  let userDataDir = '';

  async function ensureSession() {
    if (session) return session;
    const exe = findExecutable(platform, env);
    if (!exe) throw new Error('未找到 Chrome 或 Edge，请先安装浏览器');
    port = 9222 + Math.floor(Math.random() * 1000);
    userDataDir = profileDir || path.join(os.tmpdir(), `futureai-agent-browser-${process.pid}-${Date.now()}`);
    await fsp.mkdir(userDataDir, { recursive: true });
    child = spawn(exe, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.on('exit', () => { session = null; child = null; });
    let lastErr;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const version = await getJson(`http://127.0.0.1:${port}/json/version`);
        const wsUrl = version.webSocketDebuggerUrl;
        if (!wsUrl) throw new Error('浏览器未返回调试地址');
        // Prefer a page target
        const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
        const page = (targets || []).find(item => item.type === 'page' && item.webSocketDebuggerUrl) || { webSocketDebuggerUrl: wsUrl };
        session = createCdpSession(page.webSocketDebuggerUrl);
        await session.ready;
        await session.send('Page.enable');
        await session.send('Runtime.enable');
        return session;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('无法连接浏览器调试端口');
  }

  async function navigate({ url }) {
    const target = String(url || '').trim();
    if (!/^(https?:\/\/|about:blank$)/i.test(target)) throw new Error('仅支持 http/https 地址或 about:blank');
    const cdp = await ensureSession();
    await cdp.send('Page.navigate', { url: target });
    for (let i = 0; i < 60; i += 1) {
      const state = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (state.result?.value === 'complete' || state.result?.value === 'interactive') break;
      await new Promise(r => setTimeout(r, 250));
    }
    const title = await evaluate('document.title');
    return { url: target, title: typeof title?.result === 'string' ? title.result : '' };
  }

  async function evaluate(expression) {
    const cdp = await ensureSession();
    const result = await cdp.send('Runtime.evaluate', {
      expression: String(expression),
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
    return { result: result.result?.value };
  }

  async function click({ selector, text } = {}) {
    if (selector) {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('未找到元素'); el.click(); return true; })()`);
      return { ok: true, selector };
    }
    if (text) {
      await evaluate(`(() => {
        const needle = ${JSON.stringify(String(text))};
        const nodes = Array.from(document.querySelectorAll('a,button,input[type=button],input[type=submit],[role=button]'));
        const el = nodes.find(n => (n.innerText || n.value || '').includes(needle));
        if (!el) throw new Error('未找到含该文字的可点击元素');
        el.click();
        return true;
      })()`);
      return { ok: true, text };
    }
    throw new Error('请提供 selector 或 text');
  }

  async function type({ selector, text, submit = false } = {}) {
    if (!selector) throw new Error('请提供 selector');
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('未找到输入框');
      el.focus();
      el.value = ${JSON.stringify(String(text ?? ''))};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      ${submit ? "el.form && el.form.requestSubmit ? el.form.requestSubmit() : el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));" : ''}
      return true;
    })()`);
    return { ok: true, selector };
  }

  async function extract({ selector = 'body', max_chars = 12000 } = {}) {
    const limit = Math.min(Math.max(Number(max_chars) || 12000, 200), 100_000);
    const out = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)}) || document.body;
      const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      return text.slice(0, ${limit});
    })()`);
    return { text: out.result || '', truncated: String(out.result || '').length >= limit };
  }

  async function screenshot({ path: outPath } = {}) {
    const cdp = await ensureSession();
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = outPath || path.join(os.tmpdir(), `browser-${Date.now()}.png`);
    await fsp.writeFile(file, Buffer.from(shot.data, 'base64'));
    return { path: file, mime: 'image/png', base64: shot.data, bytes: Buffer.byteLength(shot.data, 'base64') };
  }

  let lastMarks = [];

  async function screenshot_marked({ max_elements = 80 } = {}) {
    const limit = Math.min(Math.max(Number(max_elements) || 80, 1), 200);
    const marked = await evaluate(`(() => {
      const old = document.getElementById('__futureai_agent_marks');
      if (old) old.remove();
      const root = document.createElement('div');
      root.id = '__futureai_agent_marks';
      root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      const sel = 'a,button,input,textarea,select,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[contenteditable="true"]';
      const nodes = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return r.width >= 8 && r.height >= 8 && style.visibility !== 'hidden' && style.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      }).slice(0, ${limit});
      const elements = nodes.map((el, index) => {
        const r = el.getBoundingClientRect();
        const id = index + 1;
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;border:2px solid rgba(220,40,40,.9);box-sizing:border-box;';
        const tag = document.createElement('div');
        tag.textContent = String(id);
        tag.style.cssText = 'position:absolute;left:0;top:-18px;background:rgba(220,40,40,.9);color:#fff;font:12px/16px sans-serif;padding:0 4px;border-radius:3px;';
        box.appendChild(tag);
        root.appendChild(box);
        const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.tagName || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        return { id, name, type: (el.tagName || '').toLowerCase(), x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
      });
      document.documentElement.appendChild(root);
      return elements;
    })()`);
    lastMarks = Array.isArray(marked.result) ? marked.result : [];
    try {
      const shot = await screenshot();
      return { ...shot, elements: lastMarks, count: lastMarks.length, note: '红框编号为页面可交互元素；请用 browser_element_click / browser_element_type 按 id 操作' };
    } finally {
      await evaluate(`(() => { const old = document.getElementById('__futureai_agent_marks'); if (old) old.remove(); return true; })()`).catch(() => {});
    }
  }

  function markById(id) {
    const item = lastMarks.find(entry => Number(entry.id) === Number(id));
    if (!item) throw new Error('找不到元素 #' + id + '，请先调用 browser_screenshot_marked');
    return item;
  }

  async function element_click({ id } = {}) {
    const item = markById(id);
    await evaluate(`(() => {
      const marks = ${JSON.stringify(lastMarks)};
      const target = marks.find(entry => entry.id === ${Number(id)});
      if (!target) throw new Error('元素已失效');
      const el = document.elementFromPoint(target.cx, target.cy);
      if (!el) throw new Error('点击位置无元素');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: target.cx, clientY: target.cy }));
      if (typeof el.click === 'function') el.click();
      return true;
    })()`);
    return { ok: true, id: Number(id), name: item.name };
  }

  async function element_type({ id, text = '', submit = false } = {}) {
    markById(id);
    await evaluate(`(() => {
      const marks = ${JSON.stringify(lastMarks)};
      const target = marks.find(entry => entry.id === ${Number(id)});
      if (!target) throw new Error('元素已失效');
      let el = document.elementFromPoint(target.cx, target.cy);
      if (el && !('value' in el)) el = el.closest('input,textarea,[contenteditable="true"]') || el;
      if (!el) throw new Error('未找到输入目标');
      el.focus();
      if ('value' in el) {
        el.value = ${JSON.stringify(String(text ?? ''))};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.textContent = ${JSON.stringify(String(text ?? ''))};
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      ${submit ? "el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); if (el.form && el.form.requestSubmit) el.form.requestSubmit();" : ''}
      return true;
    })()`);
    return { ok: true, id: Number(id), typed: String(text ?? '').length };
  }

  async function close() {
    try { session?.close(); } catch (_err) { /* ignore */ }
    session = null;
    lastMarks = [];
    if (child && !child.killed) {
      try { child.kill(); } catch (_err) { /* ignore */ }
    }
    child = null;
  }

  return {
    navigate, click, type, extract, screenshot, screenshot_marked,
    element_click, element_type, list_elements: () => ({ elements: lastMarks.slice(), count: lastMarks.length }),
    evaluate, close, findExecutable: () => findExecutable(platform, env)
  };
}

module.exports = {
  createBrowser,
  findBrowserExecutable,
  createCdpSession
};
