const nodePath = require('path');
const fs = require('fs');
const RuleDefaults = require('./rule-defaults');

const MODES = RuleDefaults.MODES;
const MODE_LABELS = RuleDefaults.MODE_LABELS;
// Action types a tool call can fall into. What each one may do follows from the mode alone.
const CATEGORIES = RuleDefaults.CATEGORIES;
const CATEGORY_LABELS = RuleDefaults.CATEGORY_LABELS;
const READ_ONLY_FORBIDDEN = new Set(RuleDefaults.READ_ONLY_FORBIDDEN);
const MIN_STEPS = 1;
const MAX_STEPS = 1000;
const DEFAULT_STEPS = 300;

const NETWORK_COMMAND = /\b(curl|wget|requests\.|urllib|http\.get|https\.get|fetch|WebClient|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|Start-BitsTransfer|ssh|scp|ftp|git\s+(clone|pull|push|fetch)|npm\s+(i|install|publish|add)|pnpm\s+(i|install|add)|yarn\s+add|pip\s+install|winget|choco)\b/i;
const DESTRUCTIVE_COMMAND = /\b(Remove-Item|rm|rmdir|rd|del|erase|Move-Item|mv|Rename-Item|ren|Clear-Content|Set-Content|Out-File|Copy-Item|format)\b|>\s*[^&|]/i;


function modeRank(mode) {
  return { readonly: 0, workspace: 1, full: 2 }[mode] ?? 1;
}

function minMode(a, b) {
  return modeRank(a) <= modeRank(b) ? a : b;
}

function normalizeSettings(raw = {}) {
  const mode = MODES.includes(raw.mode) ? raw.mode : 'workspace';
  // Per-category overrides from older versions are ignored on purpose: the mode is the whole setting.
  const rules = RuleDefaults.modeRules(mode);
  const steps = Math.round(Number(raw.maxSteps));
  const maxSteps = Number.isFinite(steps) && steps >= MIN_STEPS ? Math.min(steps, MAX_STEPS) : DEFAULT_STEPS;
  // Timed runs use their own mode/rules, never higher privilege than interactive mode.
  const scheduleMode = minMode(MODES.includes(raw.scheduleMode) ? raw.scheduleMode : 'workspace', mode);
  const scheduleRules = RuleDefaults.modeRules(scheduleMode);
  const emergencyHotkey = String(raw.emergencyHotkey || 'CommandOrControl+Alt+Shift+S').slice(0, 80);
  const concurrent = Math.round(Number(raw.maxConcurrent));
  const maxConcurrent = Number.isFinite(concurrent) && concurrent >= 1 ? Math.min(concurrent, 8) : 3;
  return { mode, rules, maxSteps, scheduleMode, scheduleRules, emergencyHotkey, maxConcurrent };
}

/** Settings effective for one run. Unattended (scheduled) skips ask → deny+log. */
function effectiveRunSettings(settings = {}, { scheduled = false, scheduleMode } = {}) {
  const base = normalizeSettings(settings);
  if (!scheduled) return { ...base, scheduled: false, unattended: false };
  const mode = minMode(scheduleMode && MODES.includes(scheduleMode) ? scheduleMode : base.scheduleMode, base.mode);
  return {
    ...base,
    mode,
    rules: RuleDefaults.modeRules(mode),
    scheduled: true,
    unattended: true
  };
}

function commandCategories(command, { background = false } = {}) {
  const text = String(command || '');
  return ['command', ...(background ? ['background'] : []), ...(NETWORK_COMMAND.test(text) ? ['network'] : []), ...(DESTRUCTIVE_COMMAND.test(text) ? ['overwrite'] : [])];
}

/**
 * Decide one tool call. `categories` lists the action types it touches (empty = plain
 * read inside the workspace). Deny rules always win; 完全访问 skips prompts; 只读 never writes.
 */
function decide({ mode, rules, categories = [], sessionAllowed = new Set(), unattended = false } = {}) {
  for (const category of categories) {
    if (mode === 'readonly' && READ_ONLY_FORBIDDEN.has(category)) return { verdict: 'deny', reason: `${MODE_LABELS.readonly}模式不允许${CATEGORY_LABELS[category]}` };
    if (rules[category] === 'deny') return { verdict: 'deny', reason: `规则禁止${CATEGORY_LABELS[category]}` };
  }
  if (mode === 'full' && !unattended) return { verdict: 'allow', reason: MODE_LABELS.full };
  // Unattended full still auto-allows non-ask? For full+unattended: allow without ask.
  if (mode === 'full' && unattended) return { verdict: 'allow', reason: `${MODE_LABELS.full}（定时）` };
  const pending = categories.filter(category => rules[category] === 'ask' && !sessionAllowed.has(category));
  if (pending.length) {
    if (unattended) {
      return {
        verdict: 'pause',
        reason: `定时任务等待确认：${pending.map(category => CATEGORY_LABELS[category]).join('、')}`,
        needsApproval: true,
        categories: pending
      };
    }
    return { verdict: 'ask', categories: pending, reason: pending.map(category => CATEGORY_LABELS[category]).join('、') };
  }
  return { verdict: 'allow', reason: categories.length ? '规则允许' : '工作区内读取' };
}

function blockedRoots({ platform = process.platform, env = process.env, homedir = '', installDir = '', extra = [] } = {}) {
  const p = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const home = homedir || env.USERPROFILE || env.HOME || '';
  const appData = env.APPDATA || (home && p.join(home, 'AppData', 'Roaming'));
  const localAppData = env.LOCALAPPDATA || (home && p.join(home, 'AppData', 'Local'));
  const roots = platform === 'win32'
    ? [
      env.SystemRoot || env.windir || 'C:\\Windows',
      env.ProgramFiles || 'C:\\Program Files',
      env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      env.ProgramData && p.join(env.ProgramData, 'Microsoft'),
      appData && p.join(appData, 'Microsoft', 'Credentials'),
      appData && p.join(appData, 'Microsoft', 'Protect'),
      appData && p.join(appData, 'Microsoft', 'Vault'),
      localAppData && p.join(localAppData, 'Microsoft', 'Credentials'),
      localAppData && p.join(localAppData, 'Microsoft', 'Vault'),
      localAppData && p.join(localAppData, 'Google', 'Chrome', 'User Data'),
      localAppData && p.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      appData && p.join(appData, 'Mozilla', 'Firefox', 'Profiles')
    ]
    : ['/etc', '/bin', '/sbin', '/usr', '/boot', '/System', '/Library', '/private/etc'];
  const credentialFiles = home ? ['.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.git-credentials', '.npmrc', '.netrc', p.join('.codex', 'auth.json'), p.join('.config', 'gh')].map(name => p.join(home, name)) : [];
  return [...roots, ...credentialFiles, installDir, ...extra].filter(Boolean).map(root => p.resolve(root));
}

function insideOrSame(p, root, target, platform) {
  const norm = value => (platform === 'win32' ? value.toLowerCase() : value);
  const relative = p.relative(norm(root), norm(target));
  return relative === '' || (!!relative && !relative.startsWith('..') && !p.isAbsolute(relative));
}

// Resolve symlinks/junctions of the deepest existing ancestor so a link cannot escape a check.
function realPathOf(p, target, realpath) {
  let current = target;
  const rest = [];
  for (;;) {
    try {
      return p.join(realpath(current), ...rest.reverse());
    } catch (_err) {
      const parent = p.dirname(current);
      if (parent === current) return target;
      rest.push(p.basename(current));
      current = parent;
    }
  }
}

/** Validate a tool path. Throws for hard-blocked locations; reports whether it leaves the workspace. */
function checkPath(input, { workspace, blocked = [], platform = process.platform, realpath = fs.realpathSync.native } = {}) {
  const p = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const raw = String(input ?? '').trim();
  if (!raw || /\0/.test(raw)) throw new Error('路径无效');
  if (platform === 'win32' && /^\\\\[?.]\\/.test(raw)) throw new Error('不支持设备路径');
  const lexical = p.resolve(workspace, raw);
  const real = realPathOf(p, lexical, realpath);
  const realWorkspace = realPathOf(p, p.resolve(workspace), realpath);
  for (const root of blocked) {
    if ([lexical, real].some(candidate => insideOrSame(p, root, candidate, platform))) throw new Error(`禁止访问受保护位置：${root}`);
  }
  return { path: real, outside: !insideOrSame(p, realWorkspace, real, platform) };
}

function commandTouchesBlocked(command, blocked, platform = process.platform) {
  const text = platform === 'win32' ? String(command || '').toLowerCase().replace(/\//g, '\\') : String(command || '');
  return blocked.find(root => text.includes(platform === 'win32' ? root.toLowerCase() : root)) || '';
}

module.exports = {
  CATEGORIES,
  CATEGORY_LABELS,
  DEFAULT_STEPS,
  MIN_STEPS,
  MAX_STEPS,
  MODES,
  MODE_LABELS,
  blockedRoots,
  checkPath,
  commandCategories,
  commandTouchesBlocked,
  decide,
  effectiveRunSettings,
  minMode,
  modeRank,
  modeRules: RuleDefaults.modeRules,
  normalizeSettings
};
