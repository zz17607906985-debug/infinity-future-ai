'use strict';

// Workspace exploration: ripgrep-style content search, glob listing and directory trees.
// Pure Node so it works on every machine; honours built-in skip dirs and the root .gitignore.
const fs = require('fs/promises');
const path = require('path');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.codex', 'dist', 'out', 'build', 'coverage', '.cache', '__pycache__', '.venv', 'venv', '.next', '.futureai-agent-scripts', '.futureai-agent-backups']);
const MAX_SEARCH_FILE_BYTES = 2_000_000;
const UNREADABLE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.mp4', '.webm', '.mov', '.mkv', '.mp3', '.wav', '.zip', '.7z', '.rar', '.exe', '.dll', '.node', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.docx', '.xlsx']);

function globToRegExp(pattern) {
  const text = String(pattern || '*');
  const special = new Set(['.', '+', '^', '$', '(', ')', '[', ']', '{', '}', '|', '\\']);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith('**/', i)) { out += '(?:.*/)?'; i += 2; continue; }
    if (text[i] === '*' && text[i + 1] === '*') { out += '.*'; i += 1; continue; }
    if (text[i] === '*') { out += '[^/]*'; continue; }
    if (text[i] === '?') { out += '[^/]'; continue; }
    if (text[i] === '{') {
      const end = text.indexOf('}', i);
      if (end > i) {
        out += `(?:${text.slice(i + 1, end).split(',').map(part => part.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
        i = end;
        continue;
      }
    }
    if (special.has(text[i])) { out += '\\' + text[i]; continue; }
    out += text[i];
  }
  return new RegExp('^' + out + '$', 'i');
}

// A path glob without a slash matches at any depth, like ripgrep's -g.
function pathMatcher(glob) {
  if (!glob) return () => true;
  const anchored = glob.includes('/') ? glob.replace(/^\.?\//, '') : `**/${glob}`;
  const regex = globToRegExp(anchored);
  return relative => regex.test(relative);
}

async function loadIgnore(root) {
  let text = '';
  try { text = await fs.readFile(path.join(root, '.gitignore'), 'utf8'); } catch (_err) { return () => false; }
  const rules = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && !line.startsWith('!')).map(line => {
    const dirOnly = line.endsWith('/');
    const body = line.replace(/\/+$/, '');
    const anchored = body.startsWith('/') || body.slice(0, -1).includes('/');
    const regex = globToRegExp(anchored ? body.replace(/^\//, '') : `**/${body}`);
    return { regex, dirOnly };
  });
  return (relative, isDir) => rules.some(rule => (!rule.dirOnly || isDir) && rule.regex.test(relative));
}

/** Depth-first walk yielding {full, relative, isDir} for every non-ignored entry under `start`. */
async function* walk(root, start = root, { maxDepth = Infinity } = {}) {
  const ignored = await loadIgnore(root);
  async function* visit(dir, depth) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (_err) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      const isDir = entry.isDirectory();
      if (isDir && SKIP_DIRS.has(entry.name)) continue;
      if (ignored(relative, isDir)) continue;
      yield { full, relative, isDir, depth };
      if (isDir && depth < maxDepth) yield* visit(full, depth + 1);
    }
  }
  yield* visit(start, 1);
}

function isProbablyText(buffer) {
  return !buffer.subarray(0, 8000).includes(0);
}

function compilePattern(pattern, { literal = false, caseSensitive = false } = {}) {
  const source = literal ? String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : String(pattern);
  try {
    return new RegExp(source, caseSensitive ? '' : 'i');
  } catch (err) {
    throw new Error(`正则无效：${err.message}；纯文本请设 literal: true`);
  }
}

/** ripgrep-like search. Returns matches grouped per line with optional context lines. */
async function grep(root, start, { pattern, glob = '', literal = false, caseSensitive = false, context = 0, maxMatches = 100 } = {}) {
  if (!String(pattern || '')) throw new Error('pattern 不能为空');
  const regex = compilePattern(pattern, { literal, caseSensitive });
  const include = pathMatcher(glob);
  const around = Math.min(Math.max(Number(context) || 0, 0), 5);
  const limit = Math.min(Math.max(Number(maxMatches) || 100, 1), 500);
  const matches = [];
  let filesSearched = 0;
  for await (const entry of walk(root, start)) {
    if (entry.isDir || !include(entry.relative) || UNREADABLE_EXT.has(path.extname(entry.full).toLowerCase())) continue;
    let buffer;
    try {
      const stats = await fs.stat(entry.full);
      if (stats.size > MAX_SEARCH_FILE_BYTES) continue;
      buffer = await fs.readFile(entry.full);
    } catch (_err) { continue; }
    if (!isProbablyText(buffer)) continue;
    filesSearched += 1;
    const lines = buffer.toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!regex.test(lines[index])) continue;
      const match = { path: entry.relative, line: index + 1, text: lines[index].slice(0, 300) };
      if (around) {
        match.before = lines.slice(Math.max(0, index - around), index).map(line => line.slice(0, 300));
        match.after = lines.slice(index + 1, index + 1 + around).map(line => line.slice(0, 300));
      }
      matches.push(match);
      if (matches.length >= limit) return { matches, filesSearched, truncated: true };
    }
  }
  return { matches, filesSearched, truncated: false };
}

/** Files matching a glob (e.g. "**\/*.test.js"), ignore rules applied. */
async function glob(root, start, { pattern = '**/*', maxResults = 300 } = {}) {
  const include = pathMatcher(pattern);
  const limit = Math.min(Math.max(Number(maxResults) || 300, 1), 2000);
  const files = [];
  for await (const entry of walk(root, start)) {
    if (entry.isDir || !include(entry.relative)) continue;
    files.push(entry.relative);
    if (files.length >= limit) return { files, truncated: true };
  }
  return { files, truncated: false };
}

/** Indented tree text, directories suffixed with "/". */
async function tree(root, start, { depth = 2, maxEntries = 400 } = {}) {
  const limit = Math.min(Math.max(Number(maxEntries) || 400, 1), 2000);
  const lines = [];
  for await (const entry of walk(root, start, { maxDepth: Math.min(Math.max(Number(depth) || 1, 1), 8) })) {
    lines.push(`${'  '.repeat(entry.depth - 1)}${path.basename(entry.full)}${entry.isDir ? '/' : ''}`);
    if (lines.length >= limit) return { tree: lines.join('\n'), entries: lines.length, truncated: true };
  }
  return { tree: lines.join('\n'), entries: lines.length, truncated: false };
}

module.exports = { SKIP_DIRS, globToRegExp, grep, glob, tree };
