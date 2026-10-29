'use strict';

const fs = require('fs/promises');
const path = require('path');
const { inflateRawSync } = require('zlib');
const { readZipEntries } = require('../runtime/zip-utils');

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(xml) {
  return decodeXmlEntities(String(xml || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractDocxText(buffer, maxChars = 60_000) {
  const entries = readZipEntries(buffer, { maxEntries: 256, maxUncompressedBytes: 32 * 1024 * 1024 });
  const doc = entries.find(item => item.name === 'word/document.xml');
  if (!doc) throw new Error('DOCX 缺少 document.xml');
  const xml = doc.data.toString('utf8');
  const parts = [];
  const re = /<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
  let match;
  while ((match = re.exec(xml))) {
    if (match[0].startsWith('<w:t')) parts.push(decodeXmlEntities(match[1]));
    else parts.push('\n');
  }
  const text = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  return { format: 'docx', chars: text.length, truncated: text.length > maxChars, text: text.slice(0, maxChars) };
}

function colLettersToIndex(letters) {
  let n = 0;
  for (const ch of String(letters || '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function extractXlsxText(buffer, maxChars = 60_000) {
  const entries = readZipEntries(buffer, { maxEntries: 512, maxUncompressedBytes: 64 * 1024 * 1024 });
  const byName = Object.fromEntries(entries.map(item => [item.name, item.data]));
  const shared = [];
  if (byName['xl/sharedStrings.xml']) {
    const xml = byName['xl/sharedStrings.xml'].toString('utf8');
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let si;
    while ((si = siRe.exec(xml))) {
      const parts = [];
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRe.exec(si[1]))) parts.push(decodeXmlEntities(t[1]));
      shared.push(parts.join(''));
    }
  }
  const sheetNames = Object.keys(byName).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort();
  const lines = [];
  for (const sheet of sheetNames.slice(0, 8)) {
    lines.push(`# ${sheet}`);
    const xml = byName[sheet].toString('utf8');
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let row;
    let rowCount = 0;
    while ((row = rowRe.exec(xml)) && rowCount < 200) {
      const cells = [];
      const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
      let c;
      while ((c = cRe.exec(row[1]))) {
        const attrs = c[1] || c[3] || '';
        const ref = /r="([A-Z]+)(\d+)"/.exec(attrs);
        const type = /t="([^"]+)"/.exec(attrs);
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] || '');
        const is = /<is>([\s\S]*?)<\/is>/.exec(c[2] || '');
        let value = '';
        if (type && type[1] === 's' && v) value = shared[Number(v[1])] || '';
        else if (type && type[1] === 'inlineStr' && is) value = stripTags(is[1]);
        else if (v) value = decodeXmlEntities(v[1]);
        const col = ref ? colLettersToIndex(ref[1]) : cells.length;
        cells[col] = value;
      }
      lines.push(cells.map(item => item == null ? '' : String(item)).join('\t'));
      rowCount += 1;
    }
  }
  const text = lines.join('\n').trim();
  return { format: 'xlsx', chars: text.length, truncated: text.length > maxChars, text: text.slice(0, maxChars) };
}

function extractPdfText(buffer, maxChars = 60_000) {
  const raw = buffer.toString('latin1');
  const chunks = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRe.exec(raw))) {
    const payload = Buffer.from(match[1], 'latin1');
    let text = '';
    try { text = inflateRawSync(payload).toString('latin1'); } catch (_err) { text = payload.toString('latin1'); }
    const tj = /(?:\((?:\\.|[^\\)])*\)|<[^>]+>)\s*Tj|\[([\s\S]*?)\]\s*TJ/g;
    let m;
    while ((m = tj.exec(text))) {
      if (m[1] != null) {
        const parts = m[1].match(/\((?:\\.|[^\\)])*\)|<[^>]+>/g) || [];
        for (const part of parts) {
          if (part.startsWith('(')) chunks.push(unescapePdfString(part.slice(1, -1)));
          else chunks.push(hexToString(part.slice(1, -1)));
        }
        chunks.push(' ');
      } else {
        const lit = /\((?:\\.|[^\\)])*\)|<[^>]+>/.exec(m[0]);
        if (!lit) continue;
        if (lit[0].startsWith('(')) chunks.push(unescapePdfString(lit[0].slice(1, -1)));
        else chunks.push(hexToString(lit[0].slice(1, -1)));
        chunks.push(' ');
      }
    }
  }
  const text = chunks.join('').replace(/[ \t]+\n/g, '\n').replace(/\s{2,}/g, ' ').trim();
  if (!text) throw new Error('未能从 PDF 提取文本（可能是扫描件或加密）');
  return { format: 'pdf', chars: text.length, truncated: text.length > maxChars, text: text.slice(0, maxChars) };
}

function unescapePdfString(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function hexToString(hex) {
  const clean = String(hex || '').replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(String.fromCharCode(parseInt(clean.slice(i, i + 2), 16)));
  return out.join('');
}

async function readDocument(filePath, { maxChars = 60_000 } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);
  if (ext === '.docx') return extractDocxText(buffer, maxChars);
  if (ext === '.xlsx' || ext === '.xlsm') return extractXlsxText(buffer, maxChars);
  if (ext === '.pdf') return extractPdfText(buffer, maxChars);
  throw new Error(`不支持的文档格式：${ext || '(无扩展名)'}`);
}

function buildDocx(text) {
  // Minimal writable DOCX for agent write_document.
  const body = String(text || '').split(/\r?\n/).map(line => {
    const safe = String(line).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<w:p><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
  }).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const { buildZip } = require('../runtime/zip-utils');
  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: documentXml }
  ]);
}

module.exports = {
  readDocument,
  extractDocxText,
  extractXlsxText,
  extractPdfText,
  buildDocx,
  stripTags
};
