'use strict';

const fs = require('fs/promises');
const { writeFileAtomic } = require('../runtime/atomic-write');
const fsSync = require('fs');
const path = require('path');
const Permissions = require('./permissions');
const { createComputer } = require('./computer');
const { createBrowser } = require('./browser');
const Documents = require('./documents');
const Network = require('./network');
const { createProcessTools } = require('./process');
const AgentMemory = require('./memory');
const GuiLock = require('./gui-lock');
const Explore = require('./explore');
const { applyEdits, unifiedDiff, diffStats } = require('./edit');
const { createShellSession } = require('./shell');

const TOOL_SPECS = [
  { name: 'read_file', description: '读取文本文件（带行号；前缀「N|」不是文件内容）。大文件用 offset/limit', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: '起始行（1 开始）' }, limit: { type: 'integer', description: '最多读取行数，默认 2000' } }, required: ['path'] } },
  { name: 'edit_file', description: '精确修改已有文件：old_str 须逐字唯一匹配（含缩进），可多处；优先于 write_file', parameters: { type: 'object', properties: { path: { type: 'string' }, edits: { type: 'array', items: { type: 'object', properties: { old_str: { type: 'string' }, new_str: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['old_str', 'new_str'] } } }, required: ['path', 'edits'] } },
  { name: 'write_file', description: '新建文件（或整体重写很小的文件）；覆盖前备份', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'list_dir', description: '树形列出目录（跳过 node_modules/.git 与 .gitignore）', parameters: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'integer', description: '层数，默认 2' }, max_entries: { type: 'integer' } }, required: [] } },
  { name: 'grep', description: '按正则或 literal 搜索内容，返回文件:行号:内容；可用 glob 过滤', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, literal: { type: 'boolean' }, case_sensitive: { type: 'boolean' }, context: { type: 'integer' }, max_matches: { type: 'integer' } }, required: ['pattern'] } },
  { name: 'glob', description: '按 glob 查找文件，如 **/*.test.js', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'integer' } }, required: ['pattern'] } },
  { name: 'shell', description: '常驻终端（Windows 为 PowerShell）：cwd/变量保留；返回 code 与输出；超时中断并重启。跑 CLI 时把选项（如 --top 3）和文件参数分开传，不要把选项当成文件名', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout_ms: { type: 'integer' } }, required: ['command'] } },
  { name: 'run_script', description: '运行多行脚本（powershell / python / node / bash），可后台执行', parameters: { type: 'object', properties: { script: { type: 'string' }, language: { type: 'string' }, timeout_ms: { type: 'integer' }, background: { type: 'boolean' } }, required: ['script'] } },
  { name: 'process_status', description: '查询后台脚本/命令状态与输出', parameters: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] } },
  { name: 'process_kill', description: '终止后台脚本/命令', parameters: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] } },
  { name: 'read_document', description: '读取 docx / xlsx / pdf 的文本内容', parameters: { type: 'object', properties: { path: { type: 'string' }, max_chars: { type: 'integer' } }, required: ['path'] } },
  { name: 'write_document', description: '把纯文本写成简易 docx', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'download_file', description: '从公网 URL 下载文件到工作区', parameters: { type: 'object', properties: { url: { type: 'string' }, path: { type: 'string' } }, required: ['url', 'path'] } },
  { name: 'web_search', description: '搜索网页，返回标题/链接/摘要', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] } },
  { name: 'fetch_url', description: '抓取网页或接口文本；可 POST 表单（method/body/headers），务必根据响应正文确认结果', parameters: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' }, body: { type: 'string' }, headers: { type: 'object' }, max_chars: { type: 'integer' } }, required: ['url'] } },
  { name: 'screenshot', description: '截取整个虚拟屏幕，返回图片供视觉模型查看', parameters: { type: 'object', properties: { max_side: { type: 'integer' } }, required: [] } },
  { name: 'screenshot_marked', description: '截屏并为可点击控件叠加编号（Set-of-Marks），配合 ui_click/ui_type 使用', parameters: { type: 'object', properties: { hwnd: { type: 'string' }, max_elements: { type: 'integer' } }, required: [] } },
  { name: 'ui_click', description: '按 screenshot_marked 返回的元素编号点击', parameters: { type: 'object', properties: { id: { type: 'integer' }, button: { type: 'string' }, clicks: { type: 'integer' } }, required: ['id'] } },
  { name: 'ui_type', description: '按元素编号点击后输入文字', parameters: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['id', 'text'] } },
  { name: 'list_ui_elements', description: '列出最近一次 screenshot_marked 的控件编号', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mouse_move', description: '移动鼠标到屏幕坐标', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
  { name: 'mouse_click', description: '鼠标单击/双击', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string' }, clicks: { type: 'integer' } }, required: [] } },
  { name: 'mouse_drag', description: '鼠标拖拽', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } }, required: ['x', 'y', 'x2', 'y2'] } },
  { name: 'mouse_scroll', description: '鼠标滚轮，delta 负值向上', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, delta: { type: 'integer' } }, required: [] } },
  { name: 'keyboard_type', description: '键盘输入文字', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'keyboard_hotkey', description: '组合键，例如 ctrl+c / alt+tab / enter', parameters: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'] } },
  { name: 'list_windows', description: '列出可见窗口标题', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'focus_window', description: '按 hwnd 激活窗口', parameters: { type: 'object', properties: { hwnd: { type: 'string' } }, required: ['hwnd'] } },
  { name: 'browser_navigate', description: '用本机 Chrome/Edge 打开网址', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'browser_click', description: '在页面上按 CSS 选择器或文字点击', parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: [] } },
  { name: 'browser_type', description: '在页面输入框输入文字', parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['selector', 'text'] } },
  { name: 'browser_extract', description: '提取页面文本', parameters: { type: 'object', properties: { selector: { type: 'string' }, max_chars: { type: 'integer' } }, required: [] } },
  { name: 'browser_screenshot', description: '截取当前浏览器页面', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'browser_screenshot_marked', description: '截取页面并为可交互 DOM 元素叠加编号', parameters: { type: 'object', properties: { max_elements: { type: 'integer' } }, required: [] } },
  { name: 'browser_element_click', description: '按 browser_screenshot_marked 的编号点击', parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  { name: 'browser_element_type', description: '按编号向页面元素输入文字', parameters: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['id', 'text'] } },
  { name: 'canvas_action', description: '画布操作：新建镜头、整理节点、导出媒体或导出画布快照 PNG', parameters: { type: 'object', properties: { request: { type: 'string' }, selection: { type: 'array', items: { type: 'string' } } }, required: ['request'] } },
  { name: 'update_plan', description: '更新任务计划步骤列表（供界面展示）', parameters: { type: 'object', properties: { steps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' } } } }, note: { type: 'string' } }, required: ['steps'] } },
  { name: 'remember', description: '记住用户偏好或事实（常用文件夹、风格偏好等），写入本地存储，之后会注入提示词', parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['key', 'value'] } },
  { name: 'forget', description: '删除一条长期记忆（按 id、key 或模糊 query）', parameters: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, query: { type: 'string' } }, required: [] } },
  { name: 'list_memory', description: '列出已保存的用户记忆/偏好', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'canvas_batch', description: '画布批量操作：batch_generate（为选中/指定数量图片排队生成变体）、arrange（自动排版）、export（批量导出媒体）。一条指令完成。', parameters: { type: 'object', properties: { op: { type: 'string', description: 'batch_generate|arrange|export|snapshot' }, count: { type: 'integer', description: '变体数量，默认 2' }, selection: { type: 'array', items: { type: 'string' } }, layout: { type: 'string' }, format: { type: 'string' }, request: { type: 'string' } }, required: ['op'] } }
];

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.mp4', '.webm', '.mov', '.mkv', '.mp3', '.wav', '.zip', '.7z', '.rar', '.exe', '.dll', '.node', '.wasm', '.woff', '.woff2', '.ttf', '.otf']);

const READ_TOOLS = new Set(['read_file', 'list_dir', 'grep', 'glob', 'read_document']);
const READ_FILE_MAX_LINES = 2000;
const READ_FILE_MAX_CHARS = 100_000;
const DIFF_PREVIEW_MAX_BYTES = 1_000_000;

function toolCategories(name, args = {}, outside = false) {
  if (name === 'shell') return Permissions.commandCategories(args.command);
  if (name === 'run_script') return Permissions.commandCategories(args.script, { background: !!args.background });
  if (name === 'process_kill') return ['background', 'command'];
  if (name === 'process_status') return [];
  if (name === 'edit_file') return ['write', 'overwrite', ...(outside ? ['outside'] : [])];
  if (name === 'write_file' || name === 'write_document') return ['write', ...(args.willOverwrite ? ['overwrite'] : []), ...(outside ? ['outside'] : [])];
  if (name === 'download_file') return ['network', 'write', ...(args.willOverwrite ? ['overwrite'] : []), ...(outside ? ['outside'] : [])];
  if (name === 'web_search' || name === 'fetch_url') return ['network'];
  if (name === 'screenshot' || name === 'screenshot_marked' || name === 'list_windows' || name === 'list_ui_elements' || name === 'browser_screenshot' || name === 'browser_screenshot_marked') return ['screenshot'];
  if (name === 'mouse_move' || name === 'mouse_click' || name === 'mouse_drag' || name === 'mouse_scroll' || name === 'keyboard_type' || name === 'keyboard_hotkey' || name === 'focus_window' || name === 'ui_click' || name === 'ui_type') return ['gui'];
  if (name === 'browser_navigate' || name === 'browser_click' || name === 'browser_type' || name === 'browser_extract' || name === 'browser_element_click' || name === 'browser_element_type') return ['browser', ...(name === 'browser_navigate' ? ['network'] : [])];
  if (name === 'remember' || name === 'forget') return ['write', 'memory'];
  if (name === 'list_memory') return ['memory'];
  if (name === 'canvas_batch') return ['canvas'];
  if (outside && READ_TOOLS.has(name)) return ['outside'];
  return [];
}

function createTools({
  workspace,
  checkPath,
  backupDir,
  canvasPlan,
  onPlan,
  blocked = [],
  commandTimeoutMs = 120_000,
  maxOutput = 24_000,
  platform = process.platform,
  mediaDir,
  storageDir = '',
  sessionId = '',
  memoryRoot = ''
} = {}) {
  if (!workspace) throw new Error('未设置工作区');
  const rawComputer = createComputer({ platform, mediaDir: mediaDir || path.join(backupDir || workspace, 'shots') });
  const computer = GuiLock.wrapComputer(rawComputer, sessionId);
  const browser = createBrowser({ platform });
  const processes = createProcessTools({ workspace, platform, maxOutput });
  const terminal = createShellSession({ cwd: workspace, platform, maxOutput });
  const memRoot = memoryRoot || storageDir || workspace;

  async function resolve(rel, { mustExist = false } = {}) {
    const checked = checkPath(rel || '.');
    if (mustExist && !fsSync.existsSync(checked.path)) throw new Error(`不存在：${rel}`);
    return checked;
  }

  async function read_file({ path: rel, offset = 1, limit = READ_FILE_MAX_LINES } = {}) {
    const { path: file } = await resolve(rel, { mustExist: true });
    const stats = await fs.stat(file);
    if (!stats.isFile()) throw new Error('不是文件');
    if (BINARY_EXT.has(path.extname(file).toLowerCase())) throw new Error('不支持读取二进制文件；文档请用 read_document，图片请用 screenshot');
    const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/);
    const start = Math.min(Math.max(Number(offset) || 1, 1), Math.max(lines.length, 1));
    const count = Math.min(Math.max(Number(limit) || READ_FILE_MAX_LINES, 1), READ_FILE_MAX_LINES);
    let content = '';
    let end = start - 1;
    while (end < Math.min(lines.length, start - 1 + count)) {
      const next = `${end + 1}|${lines[end]}\n`;
      if (content.length + next.length > READ_FILE_MAX_CHARS) break;
      content += next;
      end += 1;
    }
    return {
      path: file,
      totalLines: lines.length,
      lines: `${start}-${end}`,
      ...(end < lines.length ? { more: `还有 ${lines.length - end} 行；用 offset: ${end + 1} 继续读取` } : {}),
      content
    };
  }

  async function backupFile(file) {
    await fs.mkdir(backupDir, { recursive: true });
    const backup = path.join(backupDir, `${Date.now()}-${path.basename(file)}.bak`);
    await fs.copyFile(file, backup);
    return backup;
  }

  async function plannedEdit({ path: rel, edits } = {}) {
    const { path: file, outside } = await resolve(rel, { mustExist: true });
    if (!(await fs.stat(file)).isFile()) throw new Error('目标不是文件');
    const original = await fs.readFile(file, 'utf8');
    const { text, hunks } = applyEdits(original, edits);
    return { file, outside, text, hunks, diff: unifiedDiff(original, text, { label: path.basename(file) }) };
  }

  async function edit_file(args = {}) {
    const plan = await plannedEdit(args);
    const backup = await backupFile(plan.file);
    await writeFileAtomic(plan.file, plan.text);
    return { path: plan.file, hunks: plan.hunks, ...diffStats(plan.diff), backup, outside: plan.outside, __display: { diff: plan.diff } };
  }

  async function write_file({ path: rel, content = '' } = {}) {
    const { path: file, outside } = await resolve(rel);
    const existed = fsSync.existsSync(file);
    if (existed && !(await fs.stat(file)).isFile()) throw new Error('目标不是文件');
    const backup = existed ? await backupFile(file) : '';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, String(content ?? ''));
    return { path: file, bytes: Buffer.byteLength(String(content ?? ''), 'utf8'), overwritten: existed, backup, outside };
  }

  // Searches stay relative to the workspace when inside it, otherwise to the requested folder.
  async function searchRoot(rel) {
    const { path: start } = await resolve(rel || '.', { mustExist: true });
    if (!(await fs.stat(start)).isDirectory()) throw new Error('不是目录');
    const inside = !path.relative(workspace, start).startsWith('..') && !path.isAbsolute(path.relative(workspace, start));
    return { root: inside ? workspace : start, start };
  }

  async function list_dir({ path: rel = '.', depth = 2, max_entries } = {}) {
    const { root, start } = await searchRoot(rel);
    return { path: start, ...(await Explore.tree(root, start, { depth, maxEntries: max_entries })) };
  }

  async function grep({ pattern, path: rel = '.', glob, literal, case_sensitive, context, max_matches } = {}) {
    const { root, start } = await searchRoot(rel);
    return Explore.grep(root, start, { pattern, glob, literal: !!literal, caseSensitive: !!case_sensitive, context, maxMatches: max_matches });
  }

  async function glob({ pattern, path: rel = '.', max_results } = {}) {
    const { root, start } = await searchRoot(rel);
    return Explore.glob(root, start, { pattern, maxResults: max_results });
  }

  function rejectBlockedCommand(text) {
    const hit = Permissions.commandTouchesBlocked(text, blocked, platform);
    if (hit) throw new Error(`命令触及受保护位置：${hit}`);
  }

  async function shell({ command, timeout_ms } = {}, { signal, onOutput } = {}) {
    const text = String(command || '').trim();
    if (!text) throw new Error('命令为空');
    rejectBlockedCommand(text);
    const timeoutMs = Math.min(Math.max(Number(timeout_ms) || commandTimeoutMs, 1000), 30 * 60_000);
    return terminal.execute(text, { timeoutMs, signal, onOutput });
  }

  async function read_document({ path: rel, max_chars = 60_000 } = {}) {
    const { path: file } = await resolve(rel, { mustExist: true });
    return Documents.readDocument(file, { maxChars: max_chars });
  }

  async function write_document({ path: rel, content = '' } = {}) {
    const { path: file, outside } = await resolve(rel);
    if (path.extname(file).toLowerCase() !== '.docx') throw new Error('目前仅支持写入 .docx');
    const existed = fsSync.existsSync(file);
    const backup = existed ? await backupFile(file) : '';
    const buffer = Documents.buildDocx(content);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    return { path: file, bytes: buffer.length, overwritten: existed, backup, outside };
  }

  async function update_plan({ steps = [], note = '' } = {}) {
    const normalized = (Array.isArray(steps) ? steps : []).slice(0, 80).map((item, index) => ({
      id: String(item.id || index + 1),
      title: String(item.title || item.text || `步骤 ${index + 1}`).slice(0, 200),
      status: ['pending', 'running', 'done', 'error', 'skipped'].includes(item.status) ? item.status : 'pending'
    }));
    if (typeof onPlan === 'function') await onPlan({ steps: normalized, note: String(note || '') });
    return { steps: normalized, note: String(note || '') };
  }

  async function canvas_action({ request, selection = [] } = {}) {
    if (typeof canvasPlan !== 'function') throw new Error('画布操作不可用');
    return canvasPlan({ request: String(request || ''), selection: Array.isArray(selection) ? selection.map(String) : [] });
  }

  async function remember({ key, value, tags } = {}) {
    return AgentMemory.upsertMemory(memRoot, { key, value, tags });
  }

  async function forget(args = {}) {
    return AgentMemory.forgetMemory(memRoot, args);
  }

  async function list_memory() {
    const entries = await AgentMemory.listMemory(memRoot);
    return { count: entries.length, entries };
  }

  async function canvas_batch({ op, count = 2, selection = [], layout = 'grid', format = 'folder', request = '' } = {}) {
    if (typeof canvasPlan !== 'function') throw new Error('画布操作不可用');
    const operation = String(op || '').trim().toLowerCase();
    if (!['batch_generate', 'arrange', 'export', 'snapshot'].includes(operation)) {
      throw new Error('op 须为 batch_generate | arrange | export | snapshot');
    }
    const n = Math.min(Math.max(Number(count) || 2, 1), 8);
    const sel = Array.isArray(selection) ? selection.map(String) : [];
    let text = String(request || '').trim();
    if (!text) {
      if (operation === 'batch_generate') text = `批量生成变体 ${n} 张`;
      else if (operation === 'arrange') text = `整理画布 ${layout || 'grid'}`;
      else if (operation === 'export') text = format === 'zip' ? '批量导出打包 zip' : '批量导出媒体到文件夹';
      else text = '导出画布快照 PNG';
    }
    return canvasPlan({
      request: text,
      selection: sel,
      batch: { op: operation, count: n, layout: String(layout || 'grid'), format: format === 'zip' ? 'zip' : 'folder' }
    });
  }

  async function screenshot(args) {
    const result = await computer.screenshot(args);
    return { ...result, __vision: { mime: result.mime, base64: result.base64 } };
  }

  async function screenshot_marked(args) {
    const result = await computer.screenshot_marked(args);
    return { ...result, __vision: { mime: result.mime, base64: result.base64 } };
  }

  async function browser_screenshot() {
    const result = await browser.screenshot();
    return { ...result, __vision: { mime: result.mime, base64: result.base64 } };
  }

  async function browser_screenshot_marked(args) {
    const result = await browser.screenshot_marked(args);
    return { ...result, __vision: { mime: result.mime, base64: result.base64 } };
  }

  const handlers = {
    read_file,
    edit_file,
    write_file,
    list_dir,
    grep,
    glob,
    shell,
    run_script: args => {
      rejectBlockedCommand(String(args?.script || ''));
      return processes.run_script(args);
    },
    process_status: args => processes.process_status(args),
    process_kill: args => processes.process_kill(args),
    read_document,
    write_document,
    download_file: args => Network.download_file({ ...args, checkPath }),
    web_search: args => Network.web_search(args),
    fetch_url: args => Network.fetch_url(args),
    screenshot,
    screenshot_marked,
    list_ui_elements: () => computer.list_ui_elements(),
    ui_click: args => computer.ui_click(args),
    ui_type: args => computer.ui_type(args),
    mouse_move: args => computer.mouse_move(args),
    mouse_click: args => computer.mouse_click(args),
    mouse_drag: args => computer.mouse_drag(args),
    mouse_scroll: args => computer.mouse_scroll(args),
    keyboard_type: args => computer.keyboard_type(args),
    keyboard_hotkey: args => computer.keyboard_hotkey(args),
    list_windows: () => computer.list_windows(),
    focus_window: args => computer.focus_window(args),
    browser_navigate: args => browser.navigate(args),
    browser_click: args => browser.click(args),
    browser_type: args => browser.type(args),
    browser_extract: args => browser.extract(args),
    browser_screenshot,
    browser_screenshot_marked,
    browser_element_click: args => browser.element_click(args),
    browser_element_type: args => browser.element_type(args),
    canvas_action,
    canvas_batch,
    remember,
    forget,
    list_memory,
    update_plan
  };

  // context: { signal, onOutput } for tools that stream (shell).
  async function invoke(name, args = {}, context = {}) {
    const handler = handlers[name];
    if (!handler) throw new Error(`未知工具：${name}`);
    return handler(args || {}, context);
  }

  async function overwriteDiff(file, content) {
    try {
      const stats = await fs.stat(file);
      if (!stats.isFile() || stats.size > DIFF_PREVIEW_MAX_BYTES || BINARY_EXT.has(path.extname(file).toLowerCase())) return '';
      return unifiedDiff(await fs.readFile(file, 'utf8'), String(content ?? ''), { label: path.basename(file) });
    } catch (_err) {
      return unifiedDiff('', String(content ?? ''), { label: path.basename(file) });
    }
  }

  async function preview(name, args = {}) {
    if (name === 'edit_file') {
      const plan = await plannedEdit(args);
      return { outside: plan.outside, categories: toolCategories(name, args, plan.outside), diff: plan.diff };
    }
    if (name === 'write_file') {
      const checked = await resolve(args.path);
      const willOverwrite = fsSync.existsSync(checked.path);
      return { outside: checked.outside, willOverwrite, categories: toolCategories(name, { ...args, willOverwrite }, checked.outside), diff: await overwriteDiff(checked.path, args.content) };
    }
    if (name === 'write_document') {
      const checked = await resolve(args.path);
      const willOverwrite = fsSync.existsSync(checked.path);
      return { outside: checked.outside, willOverwrite, categories: toolCategories(name, { ...args, willOverwrite }, checked.outside) };
    }
    if (name === 'download_file') {
      const checked = await resolve(args.path);
      const willOverwrite = fsSync.existsSync(checked.path);
      return { outside: checked.outside, willOverwrite, categories: toolCategories(name, { ...args, willOverwrite }, checked.outside) };
    }
    if (name === 'shell' || name === 'run_script' || name === 'process_kill') return { outside: false, categories: toolCategories(name, args) };
    if (READ_TOOLS.has(name)) {
      const checked = await resolve(args.path || '.');
      return { outside: checked.outside, categories: toolCategories(name, args, checked.outside) };
    }
    return { outside: false, categories: toolCategories(name, args) };
  }

  async function dispose() {
    try { await browser.close(); } catch (_err) { /* ignore */ }
    terminal.dispose();
    processes._resetForTests();
  }

  return { specs: TOOL_SPECS, invoke, preview, handlers, dispose, browser, computer, processes };
}

module.exports = { TOOL_SPECS, createTools, toolCategories };
