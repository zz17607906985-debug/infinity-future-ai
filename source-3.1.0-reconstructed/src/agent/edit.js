'use strict';

// Exact-match multi-hunk edits plus a compact unified diff for approvals and the chat card.
const MAX_DIFF_CELLS = 4_000_000;

function countOccurrences(text, needle) {
  let count = 0;
  for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + needle.length)) count += 1;
  return count;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Applies edits in order to `original`. Each old_str must match exactly once unless replace_all.
 * Line endings follow the file: LF snippets are converted when the file uses CRLF.
 */
function applyEdits(original, edits = []) {
  if (!Array.isArray(edits) || !edits.length) throw new Error('edits 不能为空');
  const crlf = original.includes('\r\n');
  const toFile = value => (crlf ? String(value ?? '').replace(/\r?\n/g, '\r\n') : String(value ?? ''));
  let text = original;
  const hunks = [];
  edits.forEach((edit, position) => {
    const label = edits.length > 1 ? `第 ${position + 1} 处修改` : '修改';
    const oldStr = toFile(edit?.old_str);
    const newStr = toFile(edit?.new_str);
    if (!oldStr) throw new Error(`${label}：old_str 为空；新建文件请用 write_file`);
    if (oldStr === newStr) throw new Error(`${label}：old_str 与 new_str 相同`);
    const count = countOccurrences(text, oldStr);
    if (!count) throw new Error(`${label}：old_str 在文件中找不到（须逐字匹配，含缩进与空格）；先用 read_file 查看当前内容`);
    if (count > 1 && !edit.replace_all) throw new Error(`${label}：old_str 匹配到 ${count} 处；请加入更多上下文使其唯一，或设 replace_all: true`);
    hunks.push({ line: lineOf(text, text.indexOf(oldStr)), replacements: count });
    text = edit.replace_all ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr);
  });
  return { text, hunks };
}

// Line LCS on the changed middle section; huge rewrites fall back to a single remove/add block.
function diffOps(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops = a.slice(0, start).map(line => [' ', line]);
  if ((midA.length + 1) * (midB.length + 1) > MAX_DIFF_CELLS) {
    ops.push(...midA.map(line => ['-', line]), ...midB.map(line => ['+', line]));
  } else {
    const table = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
    for (let i = midA.length - 1; i >= 0; i -= 1) {
      for (let j = midB.length - 1; j >= 0; j -= 1) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) { ops.push([' ', midA[i]]); i += 1; j += 1; }
      else if (i < midA.length && (j >= midB.length || table[i + 1][j] >= table[i][j + 1])) { ops.push(['-', midA[i]]); i += 1; }
      else { ops.push(['+', midB[j]]); j += 1; }
    }
  }
  ops.push(...a.slice(endA).map(line => [' ', line]));
  return ops;
}

/** Unified diff (3 context lines) between two texts; empty string when identical. */
function unifiedDiff(before, after, { label = 'file', context = 3, maxLines = 400 } = {}) {
  const a = String(before ?? '').replace(/\r\n/g, '\n').split('\n');
  const b = String(after ?? '').replace(/\r\n/g, '\n').split('\n');
  const ops = diffOps(a, b);
  const changed = ops.map((op, index) => (op[0] === ' ' ? -1 : index)).filter(index => index >= 0);
  if (!changed.length) return '';
  const groups = [];
  for (const index of changed) {
    const last = groups[groups.length - 1];
    if (last && index - last.end <= context * 2) last.end = index;
    else groups.push({ start: index, end: index });
  }
  const out = [`--- ${label}`, `+++ ${label}`];
  for (const group of groups) {
    const from = Math.max(0, group.start - context);
    const to = Math.min(ops.length - 1, group.end + context);
    let lineA = 1;
    let lineB = 1;
    for (let index = 0; index < from; index += 1) {
      if (ops[index][0] !== '+') lineA += 1;
      if (ops[index][0] !== '-') lineB += 1;
    }
    const slice = ops.slice(from, to + 1);
    const countA = slice.filter(op => op[0] !== '+').length;
    const countB = slice.filter(op => op[0] !== '-').length;
    out.push(`@@ -${lineA},${countA} +${lineB},${countB} @@`, ...slice.map(([mark, line]) => `${mark}${line}`));
  }
  if (out.length > maxLines) return `${out.slice(0, maxLines).join('\n')}\n…（diff 共 ${out.length} 行，已截断）`;
  return out.join('\n');
}

function diffStats(diff) {
  const lines = String(diff || '').split('\n');
  return {
    added: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
    removed: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length
  };
}

module.exports = { applyEdits, unifiedDiff, diffStats };
