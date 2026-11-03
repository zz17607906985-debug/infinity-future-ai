'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const {TextDecoder} = require('node:util');
const {readZipEntries} = require('../runtime/zip-utils');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SCRIPT_CHARS = 2000000;
const SKILL_IDS = ['script-to-asset-ledger', 'visual-prompt-engineer', 'seedance2-director-prompts'];
function inputBuffer(payload) {
  if (!payload || typeof payload.name !== 'string' || !payload.name.trim()) throw new Error('缺少文件名');
  if (!(payload.bytes instanceof Uint8Array) && !Buffer.isBuffer(payload.bytes)) throw new Error('无效文件数据');
  if (!payload.bytes.byteLength || payload.bytes.byteLength > MAX_FILE_BYTES) throw new Error('单个文件必须大于 0 且不超过 25 MB');
  return Buffer.from(payload.bytes);
}
function decodeText(buffer) {
  let encoding = 'utf-8';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'utf-16le';
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'utf-16be';
  let text;
  try { text = new TextDecoder(encoding, {fatal: true}).decode(buffer); }
  catch {
    if (encoding !== 'utf-8') throw new Error('文本编码损坏，请另存为 UTF-8');
    try { text = new TextDecoder('gb18030', {fatal: true}).decode(buffer); encoding = 'gb18030'; }
    catch { throw new Error('无法识别文本编码，请另存为 UTF-8'); }
  }
  text = text.replace(/^\uFEFF/, '');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('文件包含二进制或异常控制字符，不能按文本导入');
  return {text, encoding};
}
function structuredScript(value, depth = 0) {
  if (depth > 30) throw new Error('JSON 剧本嵌套过深');
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(item => structuredScript(item, depth + 1)).filter(Boolean).join('\n\n');
  if (!value || typeof value !== 'object') throw new Error('JSON 必须包含剧本文本，不支持任意数据对象');
  const key = ['story', 'script', 'content', 'text', 'episodes', 'scenes'].find(field => value[field] !== undefined);
  if (!key) throw new Error('JSON 未找到 story / script / content / text / episodes / scenes 字段');
  const body = structuredScript(value[key], depth + 1);
  const title = typeof value.title === 'string' ? value.title : value.episode !== undefined ? '第' + String(value.episode) + '集' : '';
  return [title, body].filter(Boolean).join('\n');
}
function xmlText(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DOCX 包含不支持的 XML 实体声明');
  return xml.replace(/<w:del[\s>][\s\S]*?<\/w:del>/g, '').replace(/<w:(?:instrText|delText)[\s>][\s\S]*?<\/w:(?:instrText|delText)>/g, '')
    .replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n').replace(/<\/w:tc>/g, '\t').replace(/<\/w:(?:p|tr)>/g, '\n')
    .replace(/<[^>]+>/g, '').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (whole, entity) => {
      const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
      if (named[entity]) return named[entity];
      const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }).replace(/\n{3,}/g, '\n\n').trim();
}
function readScriptImport(payload) {
  const buffer = inputBuffer(payload);
  const extension = path.extname(payload.name).toLowerCase();
  if (!['.txt', '.md', '.markdown', '.json', '.docx'].includes(extension)) throw new Error('剧本支持 TXT、MD、MARKDOWN、JSON、DOCX；DOC/PDF/扫描件请先转换为文本或 DOCX');
  let text;
  let encoding = 'docx-xml';
  if (extension === '.docx') {
    const entries = readZipEntries(buffer, {maxEntries: 2000, maxUncompressedBytes: 64 * 1024 * 1024});
    const entry = entries.find(item => item.name === 'word/document.xml');
    if (!entry) throw new Error('DOCX 中缺少 word/document.xml，请确认不是改名的 DOC 或加密文件');
    text = xmlText(entry.data.toString('utf8'));
  } else {
    const decoded = decodeText(buffer);
    encoding = decoded.encoding;
    text = extension === '.json' ? structuredScript(JSON.parse(decoded.text)) : decoded.text;
  }
  text = text.trim();
  if (text.length < 20) throw new Error('剧本正文不足 20 个字符，可能为空文档或扫描图片');
  if (text.length > MAX_SCRIPT_CHARS) throw new Error('剧本超过 200 万字符，请拆分后导入；未截断正文');
  return {name: path.basename(payload.name), text, characters: text.length, bytes: buffer.length, format: extension.slice(1), encoding, truncated: false};
}
function parseSkillImport(payload) {
  if (!SKILL_IDS.includes(payload.skillId)) throw new Error('未知的 Skill 槽位');
  const buffer = inputBuffer(payload);
  const extension = path.extname(payload.name).toLowerCase();
  if (!['.md', '.txt', '.zip'].includes(extension)) throw new Error('Skill 支持 MD、TXT 或包含唯一 SKILL.md 的 ZIP；不支持 RAR/7Z');
  let files;
  let entryPath;
  if (extension === '.zip') {
    files = readZipEntries(buffer, {maxEntries: 2000, maxUncompressedBytes: 64 * 1024 * 1024});
    const names = new Set();
    for (const file of files) {
      const name = file.name.toLowerCase();
      if (names.has(name)) throw new Error('ZIP 包含重复路径：' + file.name);
      names.add(name);
    }
    const entries = files.filter(file => /(?:^|\/)SKILL\.md$/i.test(file.name) && !/(?:^|\/)(?:__MACOSX|node_modules)\//.test(file.name));
    if (entries.length !== 1) throw new Error('ZIP 必须包含且只包含一个 SKILL.md；多个 Skill 请分别打包导入');
    entryPath = entries[0].name;
  } else { entryPath = 'SKILL.md'; files = [{name: entryPath, data: buffer}]; }
  const content = decodeText(files.find(file => file.name === entryPath).data).text.trim();
  if (content.length < 80) throw new Error('Skill 正文不足 80 个字符，未替换');
  if (content.length > 300000) throw new Error('SKILL.md 正文超过 30 万字符，请将资料拆入 references');
  const declaredName = content.match(/^---\s*\r?\n[\s\S]*?^name:\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
  if (declaredName && SKILL_IDS.includes(declaredName) && declaredName !== payload.skillId) throw new Error('此包属于 ' + declaredName + '，请先切换到对应 Skill 槽位');
  const base = path.posix.dirname(entryPath);
  const references = files.filter(file => file.name !== entryPath && /\.(md|txt|json|ya?ml|toml|csv)$/i.test(file.name) && !/(?:^|\/)(?:scripts|node_modules|__MACOSX)\//i.test(file.name))
    .map(file => ({path: file.name, text: decodeText(file.data).text}));
  const missingReferences = [];
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1].split('#')[0];
    if (!link || /^(?:[a-z]+:|#)/i.test(link)) continue;
    let resolved;
    try { resolved = path.posix.normalize(path.posix.join(base, decodeURIComponent(link))); } catch { continue; }
    if (!files.some(file => file.name === resolved)) missingReferences.push(link);
  }
  const packageId = crypto.createHash('sha256').update(payload.skillId).update(buffer).digest('hex');
  return {packageId, skillId: payload.skillId, content, entryPath, fileName: path.basename(payload.name), declaredName: declaredName || '', files: files.map(file => ({path: file.name, bytes: file.data.length})), references, missingReferences: [...new Set(missingReferences)], original: buffer, extension};
}
async function storeSkillImport(directory, payload) {
  const parsed = parseSkillImport(payload);
  const {original, extension, ...record} = parsed;
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(path.join(directory, parsed.packageId + extension), original, {flag: 'w'});
  await fs.writeFile(path.join(directory, parsed.packageId + '.json'), JSON.stringify(record));
  const {references, ...metadata} = record;
  return {...metadata, referenceCount: references.length};
}
async function readSkillPackage(directory, packageId, context = '') {
  if (!/^[a-f0-9]{64}$/.test(String(packageId))) throw new Error('无效 Skill 包标识');
  const record = JSON.parse(await fs.readFile(path.join(directory, packageId + '.json'), 'utf8'));
  const query = String(context).slice(0, 200000).toLowerCase();
  const terms = [...new Set(query.match(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,6}/g) || [])];
  const ranked = record.references.map(file => ({...file, score: (record.content.includes(path.posix.basename(file.path)) ? 5 : 0) + terms.reduce((score, term) => score + (file.path.toLowerCase().includes(term) ? 4 : file.text.toLowerCase().includes(term) ? 1 : 0), 0)})).sort((first, second) => second.score - first.score || first.path.localeCompare(second.path));
  let remaining = 100000;
  const selected = [];
  for (const file of ranked) {
    if (file.text.length > remaining) continue;
    selected.push(file); remaining -= file.text.length;
  }
  const text = record.content + '\n\n包内资料目录（脚本不自动执行；未展开的资料不代表已读取）：\n' + record.files.map(file => file.path).join('\n') + '\n\n本次展开 ' + selected.length + '/' + record.references.length + ' 份文本资料：\n' + selected.map(file => '--- ' + file.path + ' ---\n' + file.text).join('\n\n');
  return {text, selectedPaths: selected.map(file => file.path), totalReferences: record.references.length};
}
module.exports = {readScriptImport, parseSkillImport, storeSkillImport, readSkillPackage, decodeText, structuredScript, MAX_FILE_BYTES, MAX_SCRIPT_CHARS};
