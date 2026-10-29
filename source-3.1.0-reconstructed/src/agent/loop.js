'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const Permissions = require('./permissions');
const { createTools, TOOL_SPECS } = require('./tools');
const Model = require('./model');
const AgentMemory = require('./memory');
const TaskRouter = require('./task-router');
const Verify = require('./verify');
const Delegate = require('./delegate');

const DEFAULT_MAX_STEPS = Permissions.DEFAULT_STEPS;
// Compaction: once the (pruned) history nears the context budget, older turns are summarized by
// the main model; the prompt, plan, touched files and the most recent turns are kept verbatim.
const CONTEXT_BUDGET_CHARS = 160_000;
const COMPACT_MAX_MESSAGES = 160;
const COMPACT_KEEP_TURNS = 6;
const COMPACT_INPUT_LIMIT = 40_000;
const SUMMARY_MARK = '【上下文压缩摘要】';
const MAX_CONSECUTIVE_MODEL_ERRORS = 3;
// Relay flakes (502/503/504/429) are retried with backoff inside a step and do not count toward
// the consecutive-error abort until those retries are exhausted.
const TRANSIENT_STEP_RETRIES = 10;
const TRANSIENT_STEP_BUDGET_MS = 10 * 60_000;
const MAX_TOOL_RETRIES = 2;

const TOOL_RESULT_LIMIT = 8000;
const OLD_TOOL_RESULT_LIMIT = 600;
const KEEP_FULL_RECENT = 6;
const OUTPUT_EVENT_INTERVAL_MS = 300;
const DISPLAY_DIFF_LIMIT = 6000;
const VERIFY_TIMEOUT_MS = 5 * 60_000;
const EDIT_TOOLS = new Set(['edit_file', 'write_file']);

const SYSTEM_PROMPT = [
  '你是 ∞未来 AI 的内置电脑智能体，可在用户工作区读写文件、运行命令，并按需使用网页、浏览器、桌面与画布工具。',
  '工具失败时根据错误换做法，不要重复同一失败调用；不要编造没看到的内容；不要读取或泄露密钥、密码或凭证。',
  '未完成全部要求前不要结束；全部做完并用命令或测试核对后，再用一两句简短中文说明结果。'
].join('\n');
const FILES_PROMPT = '本地文件任务：用 list_dir / glob / grep / read_file 了解现状后，用 edit_file（精确替换）或 shell 完成；多文件改动要全部覆盖，不要只改一两个就停。';
const CODING_PROMPT = [
  '改代码前先用 glob / grep / read_file（大文件用 offset/limit）定位，再用 edit_file 做最小替换（old_str 须与文件逐字一致，不含行号）；不要用 write_file 重写已有文件。',
  '命令行参数：`--top 3` 里的 `--top` 是选项、`3` 是它的值，后面的才是文件路径。解析 argv 时跳过选项及其取值，再取文件；禁止把 `--top` 传给 readFile/open。写完立刻用 `node 工具.js 文件 --top N` 和 `node 工具.js --top N 文件` 两种写法自测。',
  'shell 会保留工作目录与变量；改完后跑项目自带测试（含新增参数的用例）。出错先读报错再改，不要削弱检查。'
].join('\n');
const COMPLEX_PROMPT = [
  '多步骤/跨文件任务：先用 update_plan 列出可核对的步骤，逐步把状态标成 done；计划未完成时不要给出最终结论。',
  '重构或迁移要改到每一个相关文件，并用项目自带命令验证输出/测试通过后再结束。',
  '网页表单：先读页面说明，用 shell（curl / Invoke-WebRequest）或浏览器提交；必须读到响应正文里的确认信息后再写入结果文件。',
  '截图后结合图像决策；画布用 canvas_action / canvas_batch；偏好可用 remember / forget / list_memory。'
].join('\n');
const SIMPLE_PROMPT = '单步本地任务：直接调用一个最合适的工具完成（Windows 下建目录/移动/删除/重命名可用 shell），不要列计划，不要额外验证。';

function buildSystemPrompt({ simple, memoryBlock, groups = [] }) {
  const parts = [SYSTEM_PROMPT];
  if (simple) parts.push(SIMPLE_PROMPT);
  else {
    if (groups.includes('scripts')) parts.push(CODING_PROMPT);
    else if (groups.includes('files')) parts.push(FILES_PROMPT);
    if (groups.includes('plan') || groups.includes('canvas') || groups.includes('desktop') || groups.includes('browser') || groups.includes('memory')) {
      parts.push(COMPLEX_PROMPT);
    }
  }
  if (memoryBlock) parts.push(memoryBlock);
  return parts.filter(Boolean).join('\n\n');
}

// Older tool output is shortened and only the latest screenshot is resent, so long runs stay cheap.
function pruneHistory(messages) {
  const cutoff = messages.length - KEEP_FULL_RECENT;
  let lastImageIndex = -1;
  messages.forEach((item, index) => { if (item.images?.length) lastImageIndex = index; });
  return messages.map((item, index) => {
    if (item.role !== 'tool') return item;
    let next = item;
    if (index < cutoff && String(item.content || '').length > OLD_TOOL_RESULT_LIMIT) {
      next = { ...next, content: `${String(item.content).slice(0, OLD_TOOL_RESULT_LIMIT)}…（早期结果已截断）` };
    }
    if (next.images?.length && index !== lastImageIndex) next = { ...next, images: undefined };
    return next;
  });
}

function truncateToolResult(text) {
  return text.length > TOOL_RESULT_LIMIT ? `${text.slice(0, TOOL_RESULT_LIMIT)}…（结果过长已截断，共 ${text.length} 字符）` : text;
}

function simpleSummary(calls) {
  return calls.map(call => {
    const target = call.arguments?.path || call.arguments?.command || '';
    if (call.name === 'write_file' || call.name === 'write_document') return `已写入 ${target}`;
    if (call.name === 'shell') return `已执行：${String(target).slice(0, 120)}`;
    return `已完成 ${call.name}`;
  }).join('；') + '。';
}

function createSessionId() {
  return `agent_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function isTransientRelayFailure(err) {
  const detail = String(err?.message || err || '');
  return /\b(408|429|500|502|503|504)\b/.test(detail)
    || /rate.?limit|中转站暂时不可用|网络不稳定|请求超时|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(detail);
}

function estimateChars(messages) {
  try { return JSON.stringify(messages).length; } catch (_err) { return messages.length * 200; }
}

// Index of the first message kept verbatim: the start of the Nth-last assistant turn, so every
// kept tool result still follows the assistant call that produced it.
function recentCut(messages, keepTurns) {
  let turns = 0;
  for (let index = messages.length - 1; index > 1; index -= 1) {
    if (messages[index].role !== 'assistant') continue;
    turns += 1;
    if (turns >= keepTurns) return index;
  }
  return -1;
}

function describeForSummary(item) {
  if (item.role === 'tool') return `工具结果 ${item.toolCallId}: ${String(item.content || '').slice(0, 600)}`;
  if (item.toolCalls?.length) {
    const calls = item.toolCalls.map(call => `${call.name}(${JSON.stringify(call.arguments || {}).slice(0, 200)})`).join('; ');
    return `助手: ${String(item.content || '').slice(0, 300)} 调用: ${calls}`;
  }
  return `${item.role === 'assistant' ? '助手' : '用户'}: ${String(item.content || '').slice(0, 800)}`;
}

function stateBlock({ plan = [], files = [] }) {
  const lines = [];
  if (plan.length) lines.push('【当前计划】', ...plan.map((item, index) => `${index + 1}. [${item.status}] ${item.title}`));
  if (files.length) lines.push('【已改动文件】', ...files.slice(-60));
  return lines.join('\n');
}

function needsCompaction(messages, budgetChars = CONTEXT_BUDGET_CHARS) {
  return messages.length > COMPACT_MAX_MESSAGES || estimateChars(pruneHistory(messages)) > budgetChars;
}

/**
 * Summarizes older turns into the first user message. Returns the original array when there is
 * nothing old enough to fold. The summary always uses the main model.
 */
async function compactMessages(messages, { prompt, chat, modelConfig, signal, plan = [], files = [], keepTurns = COMPACT_KEEP_TURNS } = {}) {
  const cut = recentCut(messages, keepTurns);
  if (cut <= 1) return messages;
  const task = String(prompt || messages[0].content || '');
  const head = String(messages[0].content || '');
  const previous = head.includes(SUMMARY_MARK) ? head.slice(head.indexOf(SUMMARY_MARK)) : '';
  const middle = messages.slice(1, cut);
  const input = [previous && `此前摘要：\n${previous}`, ...middle.map(describeForSummary)].filter(Boolean).join('\n').slice(-COMPACT_INPUT_LIMIT);
  let summary;
  try {
    const reply = await chat({
      format: Model.detectFormat(modelConfig?.format || modelConfig?.type || '', modelConfig?.baseUrl || ''),
      baseUrl: modelConfig?.baseUrl,
      apiKey: modelConfig?.apiKey,
      model: modelConfig?.model,
      system: '把以下智能体执行记录压缩成简洁中文摘要：保留已完成的步骤与结果、关键文件路径、已确认的结论、失败过的做法及原因、尚未完成的事项。不要输出密钥。',
      messages: [{ role: 'user', content: `原任务：${task.slice(0, 2000)}\n\n${input}` }],
      tools: [],
      maxTokens: 1200,
      signal
    });
    summary = String(reply.content || '').trim().slice(0, 6000);
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  if (!summary) {
    summary = middle.filter(item => item.role === 'assistant' && item.content).map(item => String(item.content).slice(0, 160)).join(' / ').slice(0, 2500) || '（早期步骤细节已省略）';
  }
  const state = stateBlock({ plan, files });
  return [
    { role: 'user', content: `${task}\n\n${SUMMARY_MARK}\n${summary}${state ? `\n\n${state}` : ''}\n\n（以上为早期步骤摘要，请在此基础上继续，不要重复已完成的工作。）` },
    ...messages.slice(cut)
  ];
}

// Assistant tool calls at the end of a snapshot that never got a result (crash mid-step or an
// approval that was pending): they are re-run on resume, through the normal permission path.
function unansweredCalls(messages) {
  const lastAssistant = messages.map(item => item.role).lastIndexOf('assistant');
  if (lastAssistant < 0 || !messages[lastAssistant].toolCalls?.length) return [];
  const answered = new Set(messages.slice(lastAssistant + 1).filter(item => item.role === 'tool').map(item => item.toolCallId));
  return messages[lastAssistant].toolCalls.filter(call => !answered.has(call.id));
}

/**
 * Run one agent session. All tool calls go through `approve`.
 */
async function runAgent({
  prompt,
  workspace,
  settings,
  modelConfig,
  maxSteps,
  chat = Model.chat,
  createToolsFn = createTools,
  checkPath,
  canvasPlan,
  approve,
  waitForApproval,
  onEvent = () => {},
  signal,
  logDir,
  backupRoot,
  storageDir = '',
  sessionId: forcedSessionId = '',
  parentSessionId = '',
  memoryRoot = '',
  resume = null,
  sessionStore = null,
  contextBudgetChars = CONTEXT_BUDGET_CHARS,
  transientStepRetries = TRANSIENT_STEP_RETRIES,
  transientStepBudgetMs = TRANSIENT_STEP_BUDGET_MS
} = {}) {
  if (!String(prompt || '').trim()) throw new Error('请先输入任务');
  if (!workspace) throw new Error('请先选择工作区');
  const sessionId = resume?.sessionId || forcedSessionId || createSessionId();
  const startedAt = Date.now();
  const permission = Permissions.effectiveRunSettings(settings, {
    scheduled: !!(settings?.scheduled || settings?.unattended),
    scheduleMode: settings?.scheduleMode
  });
  const sessionAllowed = new Set([
    ...(Array.isArray(settings?.sessionAllowed) ? settings.sessionAllowed : []),
    ...(Array.isArray(resume?.sessionAllowed) ? resume.sessionAllowed : [])
  ]);
  const limit = Math.min(Math.max(Number(maxSteps) || permission.maxSteps || DEFAULT_MAX_STEPS, Permissions.MIN_STEPS || 1), Permissions.MAX_STEPS || 500);
  const backupDir = path.join(backupRoot || path.join(workspace, '.futureai-agent-backups'), sessionId);
  let plan = Array.isArray(resume?.plan) ? resume.plan : [];
  const blocked = Permissions.blockedRoots({
    platform: process.platform,
    env: process.env,
    homedir: require('os').homedir()
  });
  const tools = createToolsFn({
    workspace,
    checkPath,
    backupDir,
    blocked,
    canvasPlan,
    storageDir: storageDir || workspace,
    sessionId,
    memoryRoot: memoryRoot || storageDir || workspace,
    onPlan: async payload => {
      plan = payload.steps || [];
      await emit('plan', { steps: plan, note: payload.note || '' });
    }
  });
  const route = TaskRouter.classifyTask(prompt);
  // Children never see `delegate`: delegation is one level deep.
  const toolSpecs = [...TOOL_SPECS, Delegate.SPEC].filter(spec => route.toolNames.includes(spec.name) && !(parentSessionId && spec.name === Delegate.SPEC.name));
  const memoryBlock = await AgentMemory.promptBlock(memoryRoot || storageDir || workspace);
  const systemPrompt = buildSystemPrompt({ simple: route.simple, memoryBlock, groups: route.groups });
  const format = Model.detectFormat(modelConfig?.format || modelConfig?.type || '', modelConfig?.baseUrl || '');
  const mainModel = modelConfig?.model;
  const fastModel = String(modelConfig?.fastModel || '').trim();
  let modelCalls = Number(resume?.modelCalls) || 0;
  // Main model understands, plans and handles failures/screenshots; the optional fast model runs routine tool steps.
  function pickModel({ step, lastStepFailed, messages: history }) {
    if (!fastModel || fastModel === mainModel) return mainModel;
    if (route.simple) return fastModel;
    if (step === 1 || lastStepFailed || history.at(-1)?.images?.length) return mainModel;
    return fastModel;
  }
  const logPath = logDir ? path.join(logDir, `${sessionId}.jsonl`) : '';
  const steps = [];
  const tokens = { input: Number(resume?.tokens?.input) || 0, output: Number(resume?.tokens?.output) || 0 };
  let cancelled = false;
  let messages = Array.isArray(resume?.messages) && resume.messages.length ? resume.messages : [{ role: 'user', content: String(prompt).trim() }];
  const touchedFiles = new Set(Array.isArray(resume?.files) ? resume.files : []);
  const recentFailures = new Map();
  const delegations = { ...(resume?.delegations || {}) };
  const firstStep = (Number(resume?.step) || 0) + 1;
  let currentStep = firstStep - 1;

  // Snapshot after every step (and while waiting for approval); a failed write never stops the run.
  async function saveState(status, extra = {}) {
    if (!sessionStore) return;
    try {
      await sessionStore.save({
        sessionId,
        status,
        prompt: String(prompt).trim(),
        workspace,
        storageDir,
        settings: { ...settings, sessionAllowed: undefined },
        sessionAllowed: [...sessionAllowed],
        messages,
        plan,
        files: [...touchedFiles],
        step: currentStep,
        tokens,
        modelCalls,
        startedAt: Number(resume?.startedAt) || startedAt,
        pendingApproval: null,
        delegations,
        ...(parentSessionId ? { parentSessionId } : {}),
        ...extra
      });
    } catch (_err) { /* snapshot is best effort */ }
  }

  async function emit(type, payload = {}) {
    const event = { sessionId, type, at: Date.now(), ...payload };
    steps.push(event);
    if (logPath) {
      await fs.mkdir(path.dirname(logPath), { recursive: true }).catch(() => {});
      await fs.appendFile(logPath, `${JSON.stringify(Model.redact(event))}\n`, 'utf8').catch(() => {});
    }
    onEvent(event);
  }

  await emit('start', { prompt: String(prompt).trim(), workspace, mode: permission.mode, maxSteps: limit, scheduled: !!permission.scheduled, ...(resume ? { resumedFrom: firstStep - 1 } : {}) });
  await saveState('running');

  // Streams shell output to the UI, throttled; the full output still goes to the model in the result.
  function outputStream(step, call) {
    let tail = '';
    let last = 0;
    return text => {
      tail = (tail + text).slice(-1500);
      const now = Date.now();
      if (now - last < OUTPUT_EVENT_INTERVAL_MS) return;
      last = now;
      onEvent({ sessionId, type: 'tool', at: now, step, callId: call.id, name: call.name, status: 'output', output: tail });
    };
  }

  // Child runs inherit everything that bounds the parent: workspace, permission settings (plus
  // categories already allowed this session), approval path, model and abort signal.
  function runChild({ task, sessionId: childId, onEvent: childEvent }) {
    const store = sessionStore?.child?.(childId) || null;
    return (store ? store.load().catch(() => null) : Promise.resolve(null)).then(childResume => runAgent({
      prompt: task.prompt,
      workspace,
      settings: { ...settings, sessionAllowed: [...sessionAllowed] },
      modelConfig,
      maxSteps: Math.min(limit, Delegate.CHILD_MAX_STEPS),
      chat,
      createToolsFn,
      checkPath,
      canvasPlan,
      approve,
      waitForApproval,
      onEvent: childEvent,
      signal,
      logDir,
      backupRoot,
      storageDir,
      sessionId: childId,
      parentSessionId: sessionId,
      memoryRoot,
      resume: childResume,
      sessionStore: store,
      contextBudgetChars,
      transientStepRetries,
      transientStepBudgetMs
    }));
  }

  async function runDelegateCall(call, step) {
    await emit('tool', { step, callId: call.id, name: call.name, arguments: Model.redact(call.arguments), status: 'running' });
    try {
      if (parentSessionId) throw new Error('子智能体不能再委派子任务');
      const outcome = await Delegate.runDelegation({
        parentSessionId: sessionId,
        tasks: call.arguments?.tasks,
        completed: delegations,
        signal,
        parallel: Math.min(Delegate.MAX_PARALLEL, Number(permission.maxConcurrent) || Delegate.MAX_PARALLEL),
        runChild,
        onRecord: async record => {
          delegations[record.childSessionId] = record;
          await saveState('running');
        },
        onEvent: async ({ event: childEvent, ...info }) => {
          const line = childEvent ? Delegate.progressLine(childEvent) : '';
          if (childEvent && !line) return;
          await emit('subagent', { step, callId: call.id, ...info, ...(line ? { line } : {}) });
        }
      });
      // Stopped mid-delegation: leave the call unanswered so a resume re-runs it, reusing finished children.
      if (signal?.aborted) {
        cancelled = true;
        await emit('tool', { step, callId: call.id, name: call.name, status: 'skipped', reason: '任务已停止，子任务结果已保存' });
        return { status: 'denied' };
      }
      const done = outcome.results.filter(item => item.status === 'done').length;
      await emit('tool', { step, callId: call.id, name: call.name, status: 'ok', summary: `子任务完成 ${done}/${outcome.results.length}` });
      messages.push({ role: 'tool', toolCallId: call.id, content: truncateToolResult(JSON.stringify(Model.redact(outcome))) });
      return { status: 'ok', result: outcome };
    } catch (err) {
      await emit('tool', { step, callId: call.id, name: call.name, status: 'error', error: err.message });
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: err.message }) });
      return { status: 'error' };
    }
  }

  // Runs one tool call through preview → permission → approval → invoke.
  // Returns { status: ok|error|denied, result }.
  async function runToolCall(call, step) {
    if (call.name === Delegate.SPEC.name) return await runDelegateCall(call, step);
    const failKey = `${call.name}:${JSON.stringify(Model.redact(call.arguments) || {}).slice(0, 120)}`;
    let preview;
    try {
      preview = await tools.preview(call.name, call.arguments);
    } catch (err) {
      await emit('tool', { step, callId: call.id, name: call.name, arguments: Model.redact(call.arguments), status: 'error', error: err.message });
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: err.message }) });
      return { status: 'error' };
    }
    const diff = String(preview.diff || '').slice(0, DISPLAY_DIFF_LIMIT);
    const decision = Permissions.decide({ mode: permission.mode, rules: permission.rules, categories: preview.categories, sessionAllowed, unattended: !!permission.unattended });
    let approval = decision.verdict;
    if (decision.verdict === 'ask') {
      await emit('approval', { step, callId: call.id, name: call.name, arguments: Model.redact(call.arguments), categories: decision.categories, reason: decision.reason, diff });
      await saveState('awaiting_approval', { pendingApproval: { name: call.name, reason: decision.reason } });
      const answer = await approve({ sessionId, name: call.name, arguments: call.arguments, categories: decision.categories, reason: decision.reason, diff });
      if (answer === 'always') decision.categories.forEach(category => sessionAllowed.add(category));
      approval = answer === 'deny' || answer === 'reject' ? 'deny' : 'allow';
    } else if (decision.verdict === 'pause') {
      await emit('approval_queued', {
        step,
        callId: call.id,
        name: call.name,
        arguments: Model.redact(call.arguments),
        categories: decision.categories,
        reason: decision.reason
      });
      await saveState('awaiting_approval', { pendingApproval: { name: call.name, reason: decision.reason } });
      if (typeof waitForApproval !== 'function') {
        approval = 'deny';
        decision.reason = `${decision.reason}（审批队列不可用）`;
      } else {
        const answer = await waitForApproval({
          sessionId,
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
          categories: decision.categories,
          reason: decision.reason,
          step
        });
        if (answer === 'always') {
          decision.categories.forEach(category => sessionAllowed.add(category));
          approval = 'allow';
        } else if (answer === 'allow' || answer === 'approve') {
          approval = 'allow';
        } else if (answer === 'expire') {
          approval = 'deny';
          decision.reason = '审批已过期，已拒绝该操作';
        } else if (answer === 'cancel') {
          cancelled = true;
          approval = 'deny';
          decision.reason = '任务已停止，审批取消';
        } else {
          approval = 'deny';
          decision.reason = decision.reason || '已拒绝';
        }
      }
    }
    if (approval === 'deny' || decision.verdict === 'deny') {
      await emit('tool', {
        step,
        callId: call.id,
        name: call.name,
        arguments: Model.redact(call.arguments),
        status: 'denied',
        reason: decision.reason
      });
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: `已拒绝：${decision.reason}` }) });
      return { status: 'denied' };
    }
    await emit('tool', { step, callId: call.id, name: call.name, arguments: Model.redact(call.arguments), status: 'running', categories: preview.categories });
    try {
      if ((recentFailures.get(failKey) || 0) >= MAX_TOOL_RETRIES) {
        throw new Error(`同一调用已连续失败 ${MAX_TOOL_RETRIES} 次，请改用其他工具或参数`);
      }
      const result = await tools.invoke(call.name, call.arguments, { signal, onOutput: outputStream(step, call) });
      recentFailures.delete(failKey);
      if ((EDIT_TOOLS.has(call.name) || call.name === 'write_document') && call.arguments?.path) touchedFiles.add(String(call.arguments.path));
      if (result?.backup && result?.path && logPath) await rememberRestore(logPath, { backup: result.backup, path: result.path });
      const vision = result?.__vision;
      const shownDiff = String(result?.__display?.diff || '').slice(0, DISPLAY_DIFF_LIMIT);
      const safeResult = Model.redact(result);
      if (safeResult) { delete safeResult.__vision; delete safeResult.__display; }
      if (safeResult && safeResult.base64 && String(safeResult.base64).length > 200) {
        safeResult.base64 = `[base64 ${String(result.base64).length} chars omitted from tool JSON; image attached for vision]`;
      }
      await emit('tool', { step, callId: call.id, name: call.name, status: 'ok', summary: Model.summarizeResult(safeResult), backup: result?.backup || '', ...(shownDiff ? { diff: shownDiff } : {}) });
      const toolMessage = { role: 'tool', toolCallId: call.id, content: truncateToolResult(JSON.stringify(safeResult)) };
      if (vision?.base64) toolMessage.images = [{ mime: vision.mime || 'image/png', base64: vision.base64 }];
      messages.push(toolMessage);
      return { status: 'ok', result };
    } catch (err) {
      recentFailures.set(failKey, (recentFailures.get(failKey) || 0) + 1);
      await emit('tool', { step, callId: call.id, name: call.name, status: 'error', error: err.message, retries: recentFailures.get(failKey) });
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify({
          error: err.message,
          hint: recentFailures.get(failKey) >= MAX_TOOL_RETRIES
            ? '请换工具或改参数，不要重复同一失败调用'
            : '可修正参数后重试，或改用其他办法'
        })
      });
      return { status: 'error' };
    }
  }

  // The shortcut never overwrites: an existing (or unresolvable) target goes to the model.
  const isNewFile = target => {
    try { return !fsSync.existsSync(checkPath(target).path); } catch (_err) { return false; }
  };
  // Self-correction: after code edits, run the project's own checks before accepting a final answer.
  const checks = route.simple ? [] : Verify.detectChecks(workspace);
  let editedSinceCheck = false;
  let verifyRounds = 0;
  async function autoVerify(step, content) {
    if (!checks.length || !editedSinceCheck) return { note: '' };
    editedSinceCheck = false;
    const labels = checks.map(item => item.label).join(' / ');
    const call = { id: `verify_${step}`, name: 'shell', arguments: { command: Verify.checkCommand(checks, process.platform), timeout_ms: VERIFY_TIMEOUT_MS } };
    await emit('model', { step, status: 'verify', toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments }] });
    messages.push({ role: 'assistant', content, toolCalls: [call] });
    const { status, result } = await runToolCall(call, step);
    if (status !== 'ok') return { note: '' };
    if (result.code === 0) return { note: `\n\n（已自动验证：${labels} 通过）` };
    if (verifyRounds >= Verify.MAX_VERIFY_ROUNDS) return { note: `\n\n（自动验证仍未通过：${labels}，已达自动修复上限 ${Verify.MAX_VERIFY_ROUNDS} 轮，请查看输出）` };
    verifyRounds += 1;
    const toolMessage = messages[messages.length - 1];
    toolMessage.content = `${toolMessage.content}\n${Verify.reflectionPrompt({ checks, output: result.output, round: verifyRounds })}`;
    return { retry: true };
  }

  const finish = async (content, stepCount) => {
    if (sessionStore) await sessionStore.clear().catch(() => {});
    await emit('done', { content, steps: stepCount, tokens, cancelled: false, plan, backupDir, logPath, durationMs: Date.now() - startedAt, modelCalls });
    await tools.dispose?.();
    return { ok: true, sessionId, content, steps, tokens, plan, backupDir, logPath };
  };

  try {
    // Unambiguous "create text file X in folder Y": no model call; still permission-gated.
    const direct = resume ? null : TaskRouter.directFileAction(prompt);
    if (direct && isNewFile(direct.arguments.path)) {
      const call = { id: 'direct_1', ...direct };
      await emit('model', { step: 1, status: 'direct', toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments }] });
      messages.push({ role: 'assistant', content: '', toolCalls: [call] });
      const { status: outcome } = await runToolCall(call, 1);
      if (outcome === 'ok') {
        return await finish(`已在 ${path.win32.dirname(call.arguments.path)} 创建文本文档：${path.win32.basename(call.arguments.path)}。`, 1);
      }
      if (outcome === 'denied' || cancelled) {
        return await finish('已按你的选择取消创建文件。', 1);
      }
      // Tool error: let the model see it and recover.
    }
    let lastStepFailed = false;
    let lastStepHadError = false;
    let modelErrors = 0;
    // Resume: finish the tool calls the snapshot left unanswered before asking the model again.
    for (const call of resume ? unansweredCalls(messages) : []) {
      if (signal?.aborted) { cancelled = true; break; }
      await runToolCall(call, currentStep);
    }
    const lastStep = firstStep + limit - 1;
    for (let step = firstStep; step <= lastStep && !cancelled; step += 1) {
      currentStep = step;
      if (signal?.aborted) { cancelled = true; break; }
      if (needsCompaction(messages, contextBudgetChars)) {
        const before = messages.length;
        try {
          messages = await compactMessages(messages, { prompt, chat, modelConfig, signal, plan, files: [...touchedFiles] });
        } catch (err) {
          if (signal?.aborted) { cancelled = true; break; }
          throw err;
        }
        if (messages.length < before) await emit('compact', { step, before, after: messages.length });
      }
      const model = pickModel({ step, lastStepFailed, messages });
      await emit('model', { step, status: 'asking', model });
      let reply;
      let stepFailed = null;
      const stepStartedAt = Date.now();
      for (let attempt = 0; ; attempt += 1) {
        try {
          modelCalls += 1;
          // No onDelta: tool rounds use non-streaming requests. Streaming is reserved for
          // product UX elsewhere; here idle SSE cutoffs on reasoning models dominate wall time.
          reply = await chat({
            format,
            baseUrl: modelConfig?.baseUrl,
            apiKey: modelConfig?.apiKey,
            model,
            system: systemPrompt,
            messages: pruneHistory(messages),
            tools: toolSpecs,
            maxTokens: route.simple ? 1024 : 4096,
            signal
          });
          stepFailed = null;
          break;
        } catch (err) {
          if (signal?.aborted) { cancelled = true; break; }
          const transient = isTransientRelayFailure(err);
          const withinBudget = (Date.now() - stepStartedAt) < transientStepBudgetMs && attempt < transientStepRetries;
          // Relay flakes: keep retrying this step without counting a strike until the budget runs out.
          if (transient && withinBudget) {
            const delayMs = transientStepBudgetMs <= 1000
              ? Math.min(20 * (attempt + 1), 50)
              : Math.min(3000 * (2 ** Math.min(attempt, 4)), 30000);
            await emit('model', { step, status: 'retry', error: err.message, attempt: attempt + 1, delayMs });
            await new Promise(resolve => setTimeout(resolve, delayMs));
            if (signal?.aborted) { cancelled = true; break; }
            continue;
          }
          stepFailed = err;
          break;
        }
      }
      if (cancelled) break;
      if (stepFailed) {
        await emit('model', { step, status: 'error', error: stepFailed.message });
        // Relay flakes already spent the step retry budget. End once as resumable — do not burn
        // three strikes on the same outage (that produced 0-tool evals during 502 storms).
        if (isTransientRelayFailure(stepFailed)) {
          throw new Error(`中转站持续不可用（已重试）：${stepFailed.message}`);
        }
        modelErrors += 1;
        if (step >= lastStep || modelErrors >= MAX_CONSECUTIVE_MODEL_ERRORS) {
          throw new Error(modelErrors > 1 ? `模型连续 ${modelErrors} 次调用失败：${stepFailed.message}` : stepFailed.message);
        }
        lastStepFailed = true;
        messages.push({ role: 'user', content: `模型调用失败：${stepFailed.message}。请换一种方式继续，或给出当前结论。` });
        continue;
      }
      modelErrors = 0;
      tokens.input += reply.usage.input;
      tokens.output += reply.usage.output;
      await emit('model', {
        step,
        status: 'answered',
        model,
        content: reply.content,
        toolCalls: reply.toolCalls.map(call => ({ id: call.id, name: call.name, arguments: Model.redact(call.arguments) })),
        usage: reply.usage
      });

      if (!reply.toolCalls.length) {
        if (lastStepHadError) {
          await emit('model', { step, status: 'continue', reason: 'last_step_error' });
          messages.push({ role: 'user', content: '上一步工具报错尚未解决。请根据报错继续修复并验证，不要现在结束。' });
          lastStepHadError = false;
          continue;
        }
        const planOpen = plan.some(item => !['done', 'skipped'].includes(item.status));
        // Coding/refactor tasks must touch files before a final answer; plain Q&A may end with text only.
        const codingWithoutEdits = route.groups.includes('scripts') && touchedFiles.size === 0 && step < Math.min(8, limit);
        if (planOpen || codingWithoutEdits) {
          await emit('model', { step, status: 'continue', reason: planOpen ? 'plan_open' : 'no_edits_yet' });
          messages.push({
            role: 'user',
            content: planOpen
              ? '计划尚未全部完成。请继续执行未完成步骤，不要现在结束。'
              : '代码改动尚未写入文件。请继续修改并用项目命令验证，不要现在结束。'
          });
          lastStepFailed = true;
          continue;
        }
        const verdict = await autoVerify(step, reply.content);
        if (cancelled || signal?.aborted) { cancelled = true; break; }
        if (verdict.retry) { lastStepFailed = true; continue; }
        return await finish(`${reply.content}${verdict.note}`, step);
      }

      messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });
      const outcomes = [];
      for (const call of reply.toolCalls) {
        if (signal?.aborted) { cancelled = true; break; }
        outcomes.push({ call, ...(await runToolCall(call, step)) });
      }
      if (cancelled) break;
      lastStepFailed = outcomes.some(item => item.status !== 'ok');
      lastStepHadError = outcomes.some(item => item.status === 'error');
      if (outcomes.some(item => item.status === 'ok' && EDIT_TOOLS.has(item.call.name) && Verify.isCodePath(item.call.arguments?.path))) editedSinceCheck = true;
      // Simple single-action task: once its tool calls succeed there is nothing left to verify.
      if (route.simple && !lastStepFailed) {
        return await finish(reply.content.trim() || simpleSummary(outcomes.map(item => item.call)), step);
      }
      await saveState('running');
    }
    if (cancelled) {
      await saveState('stopped');
      await emit('done', { content: '任务已停止。可在“会话”中点“继续”接着做；已写入的文件可用“恢复备份”撤回。', steps: steps.filter(item => item.type === 'tool').length, tokens, cancelled: true, plan, backupDir, logPath, durationMs: Date.now() - startedAt });
      await tools.dispose?.();
      return { ok: false, cancelled: true, sessionId, content: '任务已停止。', steps, tokens, plan, backupDir, logPath };
    }
    await saveState('truncated');
    await emit('done', { content: '已达到步数上限。可在“会话”中点“继续”再执行一轮，或提高设置中的步数上限。', steps: limit, tokens, cancelled: false, truncated: true, plan, backupDir, logPath, durationMs: Date.now() - startedAt });
    await tools.dispose?.();
    return { ok: false, truncated: true, sessionId, content: '已达到步数上限。', steps, tokens, plan, backupDir, logPath };
  } catch (err) {
    await saveState('error', { error: err.message || String(err) });
    await emit('error', { error: err.message || String(err), tokens, backupDir, logPath, resumable: !!sessionStore });
    await tools.dispose?.();
    throw err;
  }
}

async function restoreFromLog(logPath) {
  const mapFile = `${logPath}.restore.json`;
  let map = [];
  try { map = JSON.parse(await fs.readFile(mapFile, 'utf8')); } catch (_err) { map = []; }
  if (!map.length) throw new Error('本次运行没有可恢复的文件备份');
  const restored = [];
  for (const item of map) {
    if (!item?.backup || !item?.path) continue;
    await fs.copyFile(item.backup, item.path);
    restored.push(item.path);
  }
  if (!restored.length) throw new Error('本次运行没有可恢复的文件备份');
  return { restored };
}

async function rememberRestore(logPath, entry) {
  if (!logPath || !entry?.backup || !entry?.path) return;
  const file = `${logPath}.restore.json`;
  let list = [];
  try { list = JSON.parse(await fs.readFile(file, 'utf8')); } catch (_err) { list = []; }
  list.push({ backup: entry.backup, path: entry.path, at: Date.now() });
  await fs.writeFile(file, JSON.stringify(list, null, 2), 'utf8');
}

module.exports = {
  DEFAULT_MAX_STEPS,
  SYSTEM_PROMPT,
  buildSystemPrompt,
  pruneHistory,
  needsCompaction,
  compactMessages,
  isTransientRelayFailure,
  unansweredCalls,
  createSessionId,
  rememberRestore,
  restoreFromLog,
  runAgent
};
