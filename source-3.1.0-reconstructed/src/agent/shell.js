'use strict';

// One long-lived shell per agent session: cwd, variables and env persist between commands.
// Commands are framed with a sentinel line carrying the exit code and the new cwd. A timeout or
// interrupt kills the process tree; the next command starts a fresh shell in the last known cwd.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

const SENTINEL = '__FAI_SHELL_DONE__';

const POWERSHELL_HOST = [
  '$ErrorActionPreference = "Continue"',
  '$ProgressPreference = "SilentlyContinue"',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  '  $parts = $line.Split(" ", 2)',
  '  $code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))',
  '  $global:LASTEXITCODE = 0',
  '  $failed = $false',
  '  $errorsBefore = $Error.Count',
  '  try { . ([ScriptBlock]::Create($code)) 2>&1 | Out-String -Stream -Width 220 | ForEach-Object { [Console]::Out.WriteLine($_) } }',
  '  catch { [Console]::Out.WriteLine(($_ | Out-String)); $failed = $true }',
  '  if ($Error.Count -gt $errorsBefore) { $failed = $true }',
  '  $exit = if ($LASTEXITCODE) { $LASTEXITCODE } elseif ($failed) { 1 } else { 0 }',
  `  [Console]::Out.WriteLine("${SENTINEL} $($parts[0]) $exit $((Get-Location).Path)")`,
  '  [Console]::Out.Flush()',
  '}'
].join('\n');

function hostCommand(platform) {
  if (platform === 'win32') {
    const encoded = Buffer.from(POWERSHELL_HOST, 'utf16le').toString('base64');
    return { cmd: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded] };
  }
  return { cmd: '/bin/bash', args: ['--noprofile', '--norc'] };
}

function frame(platform, id, command) {
  const encoded = Buffer.from(command, 'utf8').toString('base64');
  if (platform === 'win32') return `${id} ${encoded}\n`;
  return `eval "$(printf %s '${encoded}' | base64 -d)" </dev/null; printf '\\n${SENTINEL} ${id} %s %s\\n' "$?" "$PWD"\n`;
}

function killTree(child, platform) {
  if (!child || child.exitCode !== null) return;
  if (platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (_err) { child.kill('SIGKILL'); }
  }
}

function createShellSession({ cwd, platform = process.platform, env = process.env, maxOutput = 24_000 } = {}) {
  let child = null;
  let currentCwd = cwd;
  let buffer = '';
  let pending = null;
  let queue = Promise.resolve();
  let restarted = false;

  function start() {
    const { cmd, args } = hostCommand(platform);
    child = spawn(cmd, args, {
      cwd: currentCwd,
      env: { ...env, NO_COLOR: '1', TERM: 'dumb' },
      windowsHide: true,
      detached: platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (platform !== 'win32') child.stdin.write('exec 2>&1\n');
    const onData = chunk => {
      buffer += chunk.toString('utf8');
      if (pending) drain();
    };
    child.stdin.on('error', () => {});
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const dead = child;
    child.on('exit', () => {
      if (child === dead) child = null;
      if (pending?.child === dead) pending.finish({ exited: true });
    });
    child.on('error', err => pending?.child === dead && pending.finish({ error: err }));
  }

  // Moves complete output lines into the pending command, emitting them as they arrive.
  function drain() {
    const marker = `${SENTINEL} ${pending.id} `;
    const at = buffer.indexOf(marker);
    const visible = at === -1 ? buffer.slice(0, buffer.lastIndexOf('\n') + 1) : buffer.slice(0, at);
    if (visible) {
      pending.append(visible);
      buffer = buffer.slice(visible.length);
    }
    if (at === -1) return;
    const end = buffer.indexOf('\n');
    if (end === -1) return;
    const [code, ...cwdParts] = buffer.slice(marker.length, end).trim().split(' ');
    buffer = buffer.slice(end + 1);
    currentCwd = cwdParts.join(' ').trim() || currentCwd;
    pending.finish({ code: Number(code) });
  }

  function execute(command, { timeoutMs = 120_000, signal, onOutput } = {}) {
    const run = () => new Promise(resolve => {
      const notice = !child && restarted ? `（终端已重启，目录：${currentCwd}；之前设置的变量已丢失）\n` : '';
      if (!child) start();
      restarted = false;
      let output = '';
      const id = crypto.randomBytes(6).toString('hex');
      const own = child;
      const timer = setTimeout(() => interrupt('timeout'), timeoutMs);
      const onAbort = () => interrupt('interrupted');
      signal?.addEventListener('abort', onAbort, { once: true });
      function interrupt(reason) {
        pending?.finish({ [reason]: true });
        if (child === own) child = null;
        killTree(own, platform);
      }
      pending = {
        id,
        child: own,
        append(text) {
          output = (output + text).slice(-maxOutput);
          onOutput?.(text);
        },
        finish(result) {
          if (pending?.id !== id) return;
          pending = null;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (!result.code && result.code !== 0) {
            restarted = true;
            buffer = '';
          }
          resolve({
            code: result.code ?? null,
            output: output.replace(/\s+$/, ''),
            cwd: currentCwd,
            ...(result.timeout ? { timedOut: true, note: `超时（${Math.round(timeoutMs / 1000)} 秒）已中断；长任务请用 run_script background` } : {}),
            ...(result.interrupted ? { interrupted: true } : {}),
            ...(result.exited ? { note: '终端进程已退出' } : {}),
            ...(result.error ? { note: result.error.message } : {})
          });
        }
      };
      if (notice) pending.append(notice);
      own.stdin.write(frame(platform, id, command));
      if (signal?.aborted) onAbort();
    });
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }

  function dispose() {
    if (child) {
      child.stdin.end();
      killTree(child, platform);
    }
    child = null;
  }

  return { execute, dispose, get cwd() { return currentCwd; } };
}

module.exports = { createShellSession };
