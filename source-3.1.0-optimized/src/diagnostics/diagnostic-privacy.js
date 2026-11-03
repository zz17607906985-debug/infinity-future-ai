'use strict';

const SECRET_KEY = /api[_-]?key|apikey|secret|token|authorization|password|credential|private[_-]?key/i;
const PRIVATE_KEY = /prompt|content|attachment|file(?:name)?|path|url|project[_-]?id|currentProjectId|stack|source/i;

function redactSecrets(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redactSecrets(child)
    ]));
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
}

function safeText(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '[LOCAL_PATH]')
    .replace(/(?:file:\/\/|\\\\)[^\s"']+/gi, '[LOCAL_PATH]')
    .slice(0, 160);
}

function safeLogEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { level: 'unknown', category: 'unstructured-log-redacted' };
  }
  const rawCategory = String(entry.category || entry.message || entry.type || '').toLowerCase();
  const category = [
    ['renderer', 'renderer-error'],
    ['license', 'license'],
    ['activation', 'license'],
    ['update', 'update'],
    ['rollback', 'update'],
    ['diagnostic', 'diagnostics'],
    ['storage', 'storage'],
    ['backup', 'backup'],
    ['media', 'media'],
    ['music', 'media'],
    ['codex', 'codex'],
    ['export', 'export']
  ].find(([token]) => rawCategory.includes(token))?.[1] || 'application-event';
  return {
    ...(entry.time ? { time: String(entry.time).slice(0, 40) } : {}),
    level: safeText(entry.level, 'info').slice(0, 24),
    category
  };
}

function sanitizeDiagnosticValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticValue);
  if (typeof value !== 'object') return typeof value === 'string' ? safeText(redactSecrets(value)) : value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      output[key] = '[REDACTED]';
    } else if (PRIVATE_KEY.test(key)) {
      output[key] = '[PRIVATE_DATA_REMOVED]';
    } else {
      output[key] = sanitizeDiagnosticValue(child);
    }
  }
  return output;
}

function sanitizeDiagnosticReport(report = {}) {
  const safe = sanitizeDiagnosticValue(report);
  safe.logs = Array.isArray(report.logs) ? report.logs.map(safeLogEntry) : [];
  return safe;
}

module.exports = {
  redactSecrets,
  safeLogEntry,
  sanitizeDiagnosticReport,
  sanitizeDiagnosticValue
};
