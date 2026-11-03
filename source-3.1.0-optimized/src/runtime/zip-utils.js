'use strict';

const path = require('path');
const zlib = require('zlib');

const ZIP_TEXT_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini',
  '.csv', '.tsv', '.xml', '.html', '.htm', '.css', '.scss', '.less', '.js',
  '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.c', '.h', '.cpp',
  '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.sh', '.ps1', '.bat', '.cmd',
  '.sql', '.vue', '.svelte', '.log'
]);

function crc32Buffer(buffer) {
  let crc = ~0;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return {time, day};
}

function zipEntry(name, input, date = new Date()) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'utf8');
  const compressed = zlib.deflateRawSync(data);
  const nameBuffer = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
  const crc = crc32Buffer(data);
  const {time, day} = dosDateTime(date);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  return {nameBuffer, local: Buffer.concat([local, nameBuffer, compressed]), compressedSize: compressed.length, size: data.length, crc, time, day};
}

function buildZip(entries, date = new Date()) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const item = zipEntry(entry.name, entry.data, date);
    locals.push(item.local);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(item.time, 12);
    header.writeUInt16LE(item.day, 14);
    header.writeUInt32LE(item.crc, 16);
    header.writeUInt32LE(item.compressedSize, 20);
    header.writeUInt32LE(item.size, 24);
    header.writeUInt16LE(item.nameBuffer.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, item.nameBuffer]));
    offset += item.local.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

function isSafeZipEntryName(name) {
  const normalized = String(name || '').replace(/\\/g, '/');
  return Boolean(normalized) && !normalized.startsWith('/') && !/^[a-zA-Z]:\//.test(normalized)
    && !normalized.split('/').some(part => part === '..');
}

function readZipTextSummary(buffer) {
  const maxEntries = 256;
  const maxUncompressedBytes = 8 * 1024 * 1024;
  const maxTextBytes = 120 * 1024;
  const minEocdOffset = Math.max(0, buffer.length - (0xffff + 22));
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minEocdOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('ZIP 压缩包目录损坏或格式不受支持');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > maxEntries || centralOffset + centralSize > buffer.length) {
    throw new Error('ZIP 压缩包条目过多或目录越界');
  }

  let cursor = centralOffset;
  let totalUncompressed = 0;
  let textBytes = 0;
  const sections = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('ZIP 压缩包中央目录损坏');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    cursor = nameStart + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || !isSafeZipEntryName(name)) continue;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxUncompressedBytes) throw new Error('ZIP 解压内容超过 8 MB 限制');
    if (flags & 0x1) throw new Error('ZIP 加密压缩包暂不支持');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('ZIP 压缩包文件头损坏');
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error('ZIP 压缩包数据越界');
    if (!ZIP_TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      sections.push(`[非文本文件] ${name} (${uncompressedSize} bytes)`);
      continue;
    }
    if (uncompressedSize > 2 * 1024 * 1024) {
      sections.push(`[文本文件过大，未展开] ${name} (${uncompressedSize} bytes)`);
      continue;
    }
    const compressed = buffer.subarray(dataStart, dataEnd);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = zlib.inflateRawSync(compressed);
    else throw new Error(`ZIP 压缩方法 ${method} 暂不支持`);
    const text = content.toString('utf8').replace(/^\uFEFF/, '');
    const remaining = Math.max(0, maxTextBytes - textBytes);
    if (remaining > 0) {
      const excerpt = text.slice(0, remaining);
      sections.push(`--- ${name} ---\n${excerpt}${excerpt.length < text.length ? '\n[内容已截取]' : ''}`);
      textBytes += Buffer.byteLength(excerpt, 'utf8');
    }
  }
  if (!sections.length) throw new Error('ZIP 中没有可读取的文本文件');
  return `ZIP 文件目录（${entryCount} 个条目）\n\n${sections.join('\n\n')}`.slice(0, 60000);
}

function readZipEntries(buffer, options = {}) {
  const maxEntries = Number(options.maxEntries || 512);
  const maxUncompressedBytes = Number(options.maxUncompressedBytes || 128 * 1024 * 1024);
  const minEocdOffset = Math.max(0, buffer.length - (0xffff + 22));
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minEocdOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocdOffset = offset; break; }
  }
  if (eocdOffset < 0) throw new Error('ZIP 压缩包目录损坏或格式不受支持');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > maxEntries || centralOffset + centralSize > buffer.length) throw new Error('ZIP 压缩包条目过多或目录越界');
  const entries = [];
  let cursor = centralOffset;
  let total = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 压缩包中央目录损坏');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    cursor = nameStart + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (!isSafeZipEntryName(name)) throw new Error(`ZIP 条目路径不安全：${name}`);
    if (flags & 0x1) throw new Error('ZIP 加密压缩包暂不支持');
    total += uncompressedSize;
    if (total > maxUncompressedBytes) throw new Error('ZIP 解压内容超过限制');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP 压缩包文件头损坏');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error('ZIP 压缩包数据越界');
    const compressed = buffer.subarray(dataStart, dataEnd);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed, {maxOutputLength: Math.max(1, Math.min(uncompressedSize, maxUncompressedBytes))});
    else throw new Error(`ZIP 压缩方法 ${method} 暂不支持`);
    if (data.length !== uncompressedSize || crc32Buffer(data) !== buffer.readUInt32LE(cursor - commentLength - extraLength - nameLength - 46 + 16)) {
      // CRC/size mismatches indicate a broken archive; do not silently accept it.
      throw new Error(`ZIP 条目校验失败：${name}`);
    }
    entries.push({name, data});
  }
  return entries;
}

module.exports = {
  buildZip,
  crc32Buffer,
  dosDateTime,
  isSafeZipEntryName,
  readZipTextSummary,
  readZipEntries,
  zipEntry
};
