const path = require('path');

const ISOLATED_PROFILE_FLAG = '--isolated-profile=';

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

// Test copies (eval, e2e) must never share the real profile. Isolation is opt-in through an explicit
// command-line flag that carries its own profile path; nothing is isolated or test-enabled by default.
function resolveIsolatedProfile(argv = [], defaultRoot = '') {
  const arg = argv.find(item => String(item).startsWith(ISOLATED_PROFILE_FLAG));
  if (!arg) return { enabled: false, root: '' };
  const root = String(arg).slice(ISOLATED_PROFILE_FLAG.length).replace(/^"|"$/g, '');
  if (!root || !path.isAbsolute(root)) throw new Error(`${ISOLATED_PROFILE_FLAG} 需要绝对路径`);
  const resolved = path.resolve(root);
  const real = defaultRoot ? path.resolve(defaultRoot) : '';
  if (real && (isInside(resolved, real) || isInside(real, resolved))) {
    throw new Error(`隔离配置目录不能与正式配置目录重叠：${resolved}`);
  }
  return { enabled: true, root: resolved };
}

// Inside an isolated profile the OS user folders (Documents, Downloads, Desktop, temp) also live under
// the profile root, so a first run never creates or writes anything in the real user's folders.
const ISOLATED_USER_FOLDERS = ['documents', 'downloads', 'desktop', 'temp'];

function isolatedUserFolders(root) {
  const base = path.join(path.resolve(root), 'user-folders');
  return Object.fromEntries(ISOLATED_USER_FOLDERS.map(name => [name, path.join(base, name)]));
}

module.exports = { ISOLATED_PROFILE_FLAG, ISOLATED_USER_FOLDERS, isolatedUserFolders, resolveIsolatedProfile };
