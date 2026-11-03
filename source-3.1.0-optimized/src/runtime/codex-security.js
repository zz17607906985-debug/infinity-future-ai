const path = require('path');

function normalizeCodexPermission(mode, { internal = false, scheduled = false } = {}) {
  const requested = String(mode || 'project');
  if (requested === 'readonly') return 'readonly';
  if (requested === 'full' && internal && !scheduled) return 'full';
  return 'project';
}

function resolveCodexCommandPolicy({
  command = '',
  environmentOverride = '',
  internal = false,
  bundled,
  writable,
  existsSync = () => false
} = {}) {
  const value = String(command || (internal ? environmentOverride : '') || 'codex').trim();
  if (!value) return 'codex';
  if (/[\r\n]/.test(value)) throw new Error('Codex 路径无效');
  if (internal) return value;

  const bundledPath = path.resolve(String(bundled || ''));
  const writablePath = path.resolve(String(writable || ''));
  if (value === 'codex') return existsSync(writablePath) ? writablePath : bundledPath;

  const resolved = path.resolve(value);
  if (resolved !== bundledPath && resolved !== writablePath) throw new Error('正式版仅允许使用软件管理的 Codex');
  return resolved;
}

function codexSelfUpdateAllowed({ internal = false } = {}) {
  return internal;
}

module.exports = {
  codexSelfUpdateAllowed,
  normalizeCodexPermission,
  resolveCodexCommandPolicy
};
