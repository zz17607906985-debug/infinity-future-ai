const path = require('path');

// The app no longer ships Codex: it uses a Codex CLI the user installed.
const CODEX_INSTALL_URL = 'https://github.com/openai/codex';
// Flags startCodexRun passes to `codex exec`. Older CLIs lack some of them.
const REQUIRED_EXEC_FLAGS = ['--json', '--output-last-message', '--skip-git-repo-check', '--sandbox', '--model'];

function codexCandidates({ env = {}, homedir = '', whereOutput = '' } = {}) {
  const fromPath = String(whereOutput || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const appData = env.APPDATA || '';
  const localAppData = env.LOCALAPPDATA || '';
  const codexHome = userCodexHome({ env, homedir });
  const listed = [
    ...fromPath,
    appData && path.join(appData, 'npm', 'codex.cmd'),
    localAppData && path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'codex.exe'),
    localAppData && path.join(localAppData, 'Programs', 'codex', 'codex.exe'),
    homedir && path.join(homedir, 'scoop', 'shims', 'codex.exe'),
    homedir && path.join(homedir, '.cargo', 'bin', 'codex.exe'),
    // The Codex desktop app keeps runnable CLI copies in the user's Codex home
    // (its WindowsApps package itself cannot be executed directly).
    path.join(codexHome, '.sandbox-bin', 'codex.exe'),
    path.join(codexHome, 'plugins', '.plugin-appserver', 'codex.exe')
  ].filter(Boolean);
  return [...new Set(listed.map(item => path.resolve(item)))];
}

function userCodexHome({ env = {}, homedir = '' } = {}) {
  return path.resolve(env.CODEX_HOME || path.join(homedir, '.codex'));
}

function findFile(dir, name, depth, fsApi) {
  if (depth < 0) return '';
  let entries = [];
  try {
    entries = fsApi.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return '';
  }
  const direct = entries.find(entry => entry.isFile() && entry.name.toLowerCase() === name);
  if (direct) return path.join(dir, direct.name);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findFile(path.join(dir, entry.name), name, depth - 1, fsApi);
    if (found) return found;
  }
  return '';
}

/**
 * Turn a detected path into something spawn() can run without a shell.
 * npm installs a codex.cmd shim; batch files cannot be spawned safely with an
 * arbitrary prompt argument, so use the native binary from the package or, as a
 * fallback, run the package's JS entry with Electron's built-in Node.
 */
function codexLaunch(file, { fsApi, execPath = process.execPath } = {}) {
  const resolved = path.resolve(String(file || ''));
  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.exe' || (process.platform !== 'win32' && !ext)) return { command: resolved, prefixArgs: [], env: {} };
  const packageDir = path.join(path.dirname(resolved), 'node_modules', '@openai', 'codex');
  if (!fsApi.existsSync(packageDir)) throw new Error(`无法直接运行 ${path.basename(resolved)}，请选择 codex.exe`);
  const native = findFile(path.join(path.dirname(resolved), 'node_modules', '@openai'), 'codex.exe', 6, fsApi);
  if (native) return { command: native, prefixArgs: [], env: {} };
  const script = path.join(packageDir, 'bin', 'codex.js');
  if (!fsApi.existsSync(script)) throw new Error('Codex npm 安装不完整，请重新安装');
  return { command: execPath, prefixArgs: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function parseCodexVersion(output) {
  const match = String(output || '').match(/(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)/);
  return match ? match[1] : '';
}

function missingExecFlags(helpText) {
  const text = String(helpText || '');
  return REQUIRED_EXEC_FLAGS.filter(flag => !text.includes(flag));
}

/**
 * Find the first working Codex CLI. `run(launch, args)` resolves {ok, output}.
 * A path the user picked is tried first and reported if it fails.
 */
async function detectCodexCli({ override = '', candidates = [], fsApi, run, execPath } = {}) {
  const tried = [];
  const ordered = [...new Set([override, ...candidates].filter(Boolean).map(item => path.resolve(item)))];
  for (const file of ordered) {
    if (!fsApi.existsSync(file)) {
      if (file === path.resolve(override || '')) tried.push(`${file}：文件不存在`);
      continue;
    }
    let launch;
    try {
      launch = codexLaunch(file, { fsApi, execPath });
    } catch (err) {
      tried.push(`${file}：${err.message}`);
      continue;
    }
    const version = await run(launch, ['--version']);
    if (!version.ok) {
      tried.push(`${file}：${version.error || '无法运行'}`);
      continue;
    }
    const help = await run(launch, ['exec', '--help']);
    const missing = help.ok ? missingExecFlags(help.output) : ['exec'];
    const versionText = parseCodexVersion(version.output) || version.output.trim();
    if (missing.length) {
      tried.push(`${file}：Codex ${versionText} 不支持 ${missing.join(' ')}，请升级 Codex`);
      continue;
    }
    return { ok: true, path: file, version: versionText, launch, overridden: !!override && file === path.resolve(override), tried };
  }
  return {
    ok: false,
    path: '',
    version: '',
    error: tried.length ? `未找到可用的 Codex：\n${tried.join('\n')}` : '未找到 Codex',
    installUrl: CODEX_INSTALL_URL,
    tried
  };
}

module.exports = {
  CODEX_INSTALL_URL,
  REQUIRED_EXEC_FLAGS,
  codexCandidates,
  codexLaunch,
  detectCodexCli,
  missingExecFlags,
  parseCodexVersion,
  userCodexHome
};
