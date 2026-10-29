'use strict';

// Detects how to check a project after the agent edits it (tests, then lint/build), so the loop
// can run the checks, feed failures back and stop after a bounded number of repair rounds.
const fs = require('fs');
const path = require('path');

const MAX_VERIFY_ROUNDS = 2;
const PLACEHOLDER_TEST = /no test specified/i;
const CODE_EXT = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.py', '.go', '.rs', '.java', '.cs', '.c', '.cc', '.cpp', '.h', '.hpp', '.rb', '.php', '.vue', '.svelte', '.css', '.scss', '.html', '.toml', '.yaml', '.yml']);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_err) { return null; }
}

function exists(root, name) {
  return fs.existsSync(path.join(root, name));
}

function onPath(command, env = process.env, platform = process.platform) {
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.PS1').split(';').concat(['']) : [''];
  return dirs.some(dir => exts.some(ext => fs.existsSync(path.join(dir, command + ext.toLowerCase())) || fs.existsSync(path.join(dir, command + ext))));
}

/**
 * Commands to run from the project root, in order. Tools missing from PATH are skipped; package
 * scripts run directly when the package manager itself is missing.
 * @returns {{label: string, command: string}[]}
 */
function detectChecks(root, { env = process.env, platform = process.platform } = {}) {
  const has = command => onPath(command, env, platform);
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg) {
    const scripts = pkg.scripts || {};
    const manager = exists(root, 'pnpm-lock.yaml') ? 'pnpm' : exists(root, 'yarn.lock') ? 'yarn' : 'npm';
    const runner = has(manager) ? manager : '';
    const run = name => (!runner ? scripts[name] : runner === 'npm' ? `npm run ${name} --silent` : `${runner} ${name}`);
    const checks = [];
    if (scripts.test && !PLACEHOLDER_TEST.test(scripts.test)) checks.push({ label: 'test', command: !runner ? scripts.test : runner === 'npm' ? 'npm test --silent' : `${runner} test` });
    if (scripts.lint) checks.push({ label: 'lint', command: run('lint') });
    if (!checks.length && scripts.build) checks.push({ label: 'build', command: run('build') });
    return checks;
  }
  const pythonTests = exists(root, 'tests') && fs.readdirSync(path.join(root, 'tests')).some(name => name.endsWith('.py'));
  if ((exists(root, 'pyproject.toml') || exists(root, 'pytest.ini') || pythonTests) && has('python')) return [{ label: 'test', command: 'python -m pytest -q' }];
  if (exists(root, 'Cargo.toml') && has('cargo')) return [{ label: 'test', command: 'cargo test --quiet' }];
  if (exists(root, 'go.mod') && has('go')) return [{ label: 'test', command: 'go test ./...' }];
  // Small script folders: a top-level test.js is the de-facto test command.
  if (exists(root, 'test.js') && has('node')) return [{ label: 'test', command: 'node test.js' }];
  return [];
}

function isCodePath(file) {
  return CODE_EXT.has(path.extname(String(file || '')).toLowerCase());
}

/** One shell command that runs every check and stops at the first failure (never `exit`s the session). */
function checkCommand(checks, platform = process.platform) {
  const commands = checks.map(item => item.command);
  if (platform !== 'win32') return commands.join(' && ');
  return commands.reduceRight((rest, command) => (rest ? `${command}; if (-not $LASTEXITCODE) { ${rest} }` : command), '');
}

function reflectionPrompt({ checks, output, round }) {
  return [
    `【自动验证失败（第 ${round}/${MAX_VERIFY_ROUNDS} 轮）】已运行：${checks.map(item => item.command).join(' → ')}`,
    String(output || '').slice(-4000),
    '请先指出导致失败的具体错误（文件:行 与报错原文）并判断根因，再用 edit_file 做最小修改。',
    '不要删除或放宽测试/检查来让它通过；如果失败与本次修改无关，请在结论中说明。'
  ].join('\n');
}

module.exports = { MAX_VERIFY_ROUNDS, detectChecks, isCodePath, checkCommand, reflectionPrompt };
