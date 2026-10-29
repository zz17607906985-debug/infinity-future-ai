'use strict';

const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const jobs = new Map();

function truncate(text, limit = 24_000) {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit)}\n…(已截断，共 ${value.length} 字符)` : value;
}

function createJobId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 7)}`;
}

function shellFor(script, language, platform, workspace, scriptFile) {
  const lang = String(language || 'powershell').toLowerCase();
  if (lang === 'powershell' || lang === 'ps1') {
    if (platform !== 'win32') return { cmd: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-File', scriptFile], fallback: { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-File', scriptFile] } };
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile] };
  }
  if (lang === 'python' || lang === 'py') return { cmd: platform === 'win32' ? 'python' : 'python3', args: [scriptFile] };
  // Inside Electron, execPath is the app itself: run it as plain Node instead of a second app window.
  if (lang === 'node' || lang === 'javascript' || lang === 'js') return { cmd: process.execPath, args: [scriptFile], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
  if (lang === 'bash' || lang === 'sh') return { cmd: '/bin/bash', args: [scriptFile] };
  throw new Error(`不支持的脚本语言：${language}`);
}

function createProcessTools({ workspace, platform = process.platform, maxOutput = 24_000 } = {}) {
  async function writeTempScript(script, language) {
    const dir = path.join(workspace, '.futureai-agent-scripts');
    await fs.mkdir(dir, { recursive: true });
    const ext = ({ powershell: '.ps1', ps1: '.ps1', python: '.py', py: '.py', node: '.js', javascript: '.js', js: '.js', bash: '.sh', sh: '.sh' })[String(language || 'powershell').toLowerCase()] || '.txt';
    const file = path.join(dir, `script-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    await fs.writeFile(file, String(script ?? ''), 'utf8');
    return file;
  }

  function attach(child, { timeoutMs, background = false } = {}) {
    const jobId = createJobId();
    const job = {
      id: jobId,
      pid: child.pid,
      startedAt: Date.now(),
      status: 'running',
      code: null,
      output: '',
      background: !!background,
      child
    };
    jobs.set(jobId, job);
    const append = chunk => { job.output = truncate(job.output + chunk.toString(), maxOutput); };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    let timer = null;
    if (!background && timeoutMs) {
      timer = setTimeout(() => {
        try { child.kill(); } catch (_err) { /* ignore */ }
        job.status = 'timeout';
      }, timeoutMs);
    }
    const done = new Promise(resolve => {
      child.on('error', err => {
        if (timer) clearTimeout(timer);
        job.status = 'error';
        job.error = err.message;
        resolve(job);
      });
      child.on('close', code => {
        if (timer) clearTimeout(timer);
        if (job.status === 'running') job.status = code === 0 ? 'exited' : 'failed';
        job.code = code;
        job.finishedAt = Date.now();
        resolve(job);
      });
    });
    job.done = done;
    return job;
  }

  async function run_script({ script, language = 'powershell', timeout_ms = 120_000, background = false } = {}) {
    const text = String(script || '');
    if (!text.trim()) throw new Error('脚本为空');
    if (text.length > 200_000) throw new Error('脚本过长');
    const file = await writeTempScript(text, language);
    const shell = shellFor(text, language, platform, workspace, file);
    let child;
    try {
      child = spawn(shell.cmd, shell.args, {
        cwd: workspace,
        windowsHide: true,
        env: { ...process.env, ...shell.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      if (shell.fallback) {
        child = spawn(shell.fallback.cmd, shell.fallback.args, {
          cwd: workspace,
          windowsHide: true,
          env: { ...process.env, NO_COLOR: '1' },
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } else throw err;
    }
    const timeout = Math.min(Math.max(Number(timeout_ms) || 120_000, 1000), 30 * 60_000);
    const job = attach(child, { timeoutMs: background ? 0 : timeout, background });
    if (background) return { jobId: job.id, pid: job.pid, status: 'running', scriptFile: file };
    await job.done;
    return { jobId: job.id, code: job.code, status: job.status, output: job.output, scriptFile: file };
  }

  function process_status({ jobId } = {}) {
    const job = jobs.get(String(jobId || ''));
    if (!job) throw new Error('找不到后台任务');
    return {
      jobId: job.id,
      pid: job.pid,
      status: job.status,
      code: job.code,
      output: job.output,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt || null,
      error: job.error || ''
    };
  }

  function process_kill({ jobId } = {}) {
    const job = jobs.get(String(jobId || ''));
    if (!job) throw new Error('找不到后台任务');
    try { job.child.kill(); } catch (_err) { /* ignore */ }
    job.status = 'killed';
    job.finishedAt = Date.now();
    return { jobId: job.id, status: 'killed' };
  }

  function _resetForTests() {
    for (const job of jobs.values()) {
      try { job.child.kill(); } catch (_err) { /* ignore */ }
    }
    jobs.clear();
  }

  return { run_script, process_status, process_kill, _resetForTests, jobs };
}

function killAllJobs() {
  const killed = [];
  for (const job of jobs.values()) {
    try { job.child.kill(); } catch (_err) { /* ignore */ }
    job.status = 'killed';
    job.finishedAt = Date.now();
    killed.push(job.id);
  }
  return killed;
}

module.exports = { createProcessTools, truncate, killAllJobs, jobs };

