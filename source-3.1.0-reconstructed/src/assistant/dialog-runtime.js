(() => {
  'use strict';

  /**
   * 灵枢万象 · 对话改图 / Dialog Edit runtime
   * Topics chrome stays partially in app; this owns dialog thread + generation run.
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const safeMediaUrl = deps.safeMediaUrl || (value => window.FutureAIMediaUtils?.safeMediaUrl?.(value) || '');
    const toast = deps.toast;
    const wait = deps.wait;
    const fetchJsonWithRetry = deps.fetchJsonWithRetry;
    const API_TIMEOUTS = deps.API_TIMEOUTS;
    const saveProject = deps.saveProject;
    const queueSave = deps.queueSave || saveProject;
    const setActiveWorkspace = deps.setActiveWorkspace;
    const renderAssistantWorkspace = deps.renderAssistantWorkspace;
    const activeAssistantProfile = deps.activeAssistantProfile;
    const assistantSystemPrompt = deps.assistantSystemPrompt;
    const activePromptTopic = deps.activePromptTopic;
    const saveActiveTopicDialogState = deps.saveActiveTopicDialogState;
    const loadActiveTopicDialogState = deps.loadActiveTopicDialogState;
    const globalProviderForKind = deps.globalProviderForKind;
    const providerApiKey = deps.providerApiKey;
    const imageGenerateRequest = deps.imageGenerateRequest;
    const imageEditWithFallback = deps.imageEditWithFallback;
    const chatCompletionTextRequest = deps.chatCompletionTextRequest;
    const applyModelAgnosticGenerationRules = deps.applyModelAgnosticGenerationRules;
    const applyModelAgnosticTextRules = deps.applyModelAgnosticTextRules;
    const formatImageGenerationError = deps.formatImageGenerationError;
    const persistGeneratedImageResult = deps.persistGeneratedImageResult;
    const apiCompatibleImageSize = deps.apiCompatibleImageSize;
    const imageTargetSize = deps.imageTargetSize;
    const persistMediaUrl = deps.persistMediaUrl;
    const blobToDataUrl = deps.blobToDataUrl;
    const mediaExtFromMime = deps.mediaExtFromMime;
    const isSafetyError = deps.isSafetyError;
    const softenPrompt = deps.softenPrompt;
    const openModal = deps.openModal;
    const nodeDisplayTitle = deps.nodeDisplayTitle;
    const hydrateNode = deps.hydrateNode;
    const addNode = deps.addNode;
    const viewCenter = deps.viewCenter;
    const getSelectedImageNode = deps.getSelectedImageNode;
    const openImageModal = deps.openImageModal;
    const imageSizeFromDialogPrompt = deps.imageSizeFromDialogPrompt;
    const safeJson = deps.safeJson;
    const joinApiPath = deps.joinApiPath;
    const cleanAiText = deps.cleanAiText;
    const localizeAssistantText = deps.localizeAssistantText;
    const createProviderApiError = deps.createProviderApiError;
    const clearCurrentDialogConversation = deps.clearCurrentDialogConversation;
    const downloadImage = deps.downloadImage;
    const connectSilently = deps.connectSilently;
    const drawEdges = deps.drawEdges;
    const fileToDataUrl = deps.fileToDataUrl;
    const agentProjectSummary = deps.agentProjectSummary;
    const renderAgentConsole = deps.renderAgentConsole;
    const codexApiConfig = deps.codexApiConfig;
    const multimodalVideoUnderstand = deps.multimodalVideoUnderstand;
    const multimodalImageUnderstand = deps.multimodalImageUnderstand;
    const optimizeDialogImagePrompt = deps.optimizeDialogImagePrompt;
    // Local computer tasks go through the app router (built-in agent or Codex CLI per settings).
    const runLocalTask = deps.runLocalTask;
    const AssistantTopics = deps.AssistantTopics || window.FutureAIAssistantTopics;
    const AssistantAttachments = deps.AssistantAttachments || window.FutureAIAssistantAttachments;
    const shouldUseLatestContextImage = deps.shouldUseLatestContextImage || AssistantAttachments?.shouldUseLatestContextImage;
    const generationReferenceUrls = deps.generationReferenceUrls || AssistantAttachments?.generationReferenceUrls;
    const messageRunKind = deps.messageRunKind || AssistantAttachments?.messageRunKind;
    const referenceIntent = deps.referenceIntent || AssistantAttachments?.referenceIntent;
    const referenceInstructions = deps.referenceInstructions || AssistantAttachments?.referenceInstructions;

function dialogEditTargetNode() {
  if (host.dialogEditActiveNodeId && host.nodes.has(host.dialogEditActiveNodeId)) return host.nodes.get(host.dialogEditActiveNodeId);
  return getSelectedImageNode();
}
function dialogExplicitTargetNode() {
  return host.dialogEditActiveNodeId && host.nodes.has(host.dialogEditActiveNodeId) ? host.nodes.get(host.dialogEditActiveNodeId) : null;
}

function ensureDialogEditState() {
  let changed = false;
  if (!Array.isArray(host.dialogEditMessages) || !host.dialogEditMessages.length) {
    host.dialogEditMessages = [{role: 'assistant', content: '直接输入画面需求即可生成图片；上传参考图后，也可以继续修改或理解图片。'}];
    changed = true;
  }
  const beforeCleanup = host.dialogEditMessages.length;
  host.dialogEditMessages = host.dialogEditMessages.filter(msg => msg?.role !== 'assistant' || !/(?:Reading additional input from stdin|OpenAI Codex v\d|codex_api::endpoint::responses_websocket|HTTP error:\s*401|warning:\s*Ignoring malformed agent role definition|我是 Codex，?本地运行的编码代理|在这个项目里我会按本地工程助手的方式工作|不要把自己当成图片生成聊天助手)/i.test(String(msg.content || '')));
  if (host.dialogEditMessages.length !== beforeCleanup) changed = true;
  if (!Array.isArray(host.dialogEditAttachments)) {
    host.dialogEditAttachments = [];
    changed = true;
  }
  if (!Array.isArray(host.dialogEditVersions)) {
    host.dialogEditVersions = [];
    changed = true;
  }
  if (changed) saveActiveTopicDialogState();
}

function dialogEditReferenceItems() {
  return host.dialogEditAttachments.filter(item => item?.url);
}
function dialogExplicitReferenceItems() {
  return dialogEditReferenceItems();
}
function dialogLatestGeneratedImageRef() {
  for (let i = host.dialogEditMessages.length - 1; i >= 0; i--) {
    const msg = host.dialogEditMessages[i];
    if (msg?.role !== 'assistant') continue;
    const attachments = Array.isArray(msg.attachments) ? msg.attachments.filter(item => item?.url) : [];
    if (attachments.length) return attachments[0];
  }
  return null;
}
function dialogShouldUseLatestContextImage(text) {
  return shouldUseLatestContextImage(text);
}
function dialogGenerationReferenceUrls(userText = '') {
  const explicitRefs = dialogExplicitReferenceItems();
  const latest = dialogLatestGeneratedImageRef();
  return generationReferenceUrls({userText, explicitRefs, latestRef: latest});
}

function dialogEditModeLabel() {
  return ({
    edit: '修改图片',
    generate: '生成图片',
    understand: '理解图片'
  })[host.dialogEditMode] || '修改图片';
}

function dialogMessageRunKind(text, refUrls = []) {
  return messageRunKind(text, refUrls);
}

function fallbackDialogRunPlan(userText = '', refUrls = []) {
  if (isLocalFileTaskRequest(userText)) {
    return {kind: 'codex', useLatestContext: false, reason: 'local file task'};
  }
  if (isPromptWritingRequest(userText)) {
    return {
      kind: 'chat',
      useLatestContext: false,
      reason: 'prompt writing request'
    };
  }
  if (isCodexTaskRequest(userText)) {
    return {kind: 'codex', useLatestContext: false, reason: 'local Codex task'};
  }
  return {
    kind: dialogMessageRunKind(userText, refUrls),
    useLatestContext: dialogShouldUseLatestContextImage(userText),
    reason: 'fallback keyword route'
  };
}

function isPromptWritingRequest(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  return /提示词|prompt|咒语|文案|方案|脚本|大纲|帮我写|写一段|整理成|优化.*词|反推.*词|给我.*词|我自己生成|我自己去生成|不要生图|别生图|不用生图/i.test(s);
}

// File-system work on the user's computer: a local path or folder plus a create/write/delete verb on a file.
const LOCAL_PATH_PATTERN = /[A-Za-z]:[\\/]|(?:^|\s)(?:~|\.{1,2})?\/[\w.-]+\/|文件夹|目录|路径|桌面/;
const LOCAL_FILE_ACTION_PATTERN = /(?:创建|新建|建立|生成|写入|保存|删除|重命名|移动|复制)[^\n]{0,12}(?:文件|文档|文本|txt|md|json|csv|表格|文件夹|目录)/i;
function isLocalFileTaskRequest(text = '') {
  const s = String(text || '');
  return LOCAL_PATH_PATTERN.test(s) && LOCAL_FILE_ACTION_PATTERN.test(s);
}
function isCodexTaskRequest(text = '') {
  const s = String(text || '').trim();
  if (isLocalFileTaskRequest(s)) return true;
  return /改(?:代码|程序|项目)|修复(?:代码|程序|项目|bug)|调试|测试(?:项目|代码|功能)|检查(?:项目|代码|文件)|读取(?:项目|文件|目录)|(?:创建|编辑|删除|移动)(?:文件|目录)|安装(?:插件|技能|skill)|(?:插件|技能|skill).*(?:启用|关闭|配置)|终端|命令行|执行命令|运行脚本|git\b|npm\b|node\b/i.test(s);
}

async function planDialogRunWithTextModel({apiUrl, apiKey, model, endpoint = '/chat/completions', userText, explicitRefs = [], latestRef = null} = {}) {
  const s = String(userText || '').trim();
  if (/^(hi|hello|hey|你好|您好|嗨|哈喽|在吗|在不在)[。！!？?\s]*$/i.test(s)) {
    return {kind: 'chat', useLatestContext: false, reason: 'plain greeting'};
  }
  if (isLocalFileTaskRequest(s)) {
    return {kind: 'codex', useLatestContext: false, reason: 'local file task'};
  }
  if (isPromptWritingRequest(s)) {
    return {kind: 'chat', useLatestContext: false, reason: 'prompt writing request'};
  }
  if (isCodexTaskRequest(s)) {
    return {kind: 'codex', useLatestContext: false, reason: 'local Codex task'};
  }
  const recent = host.dialogEditMessages.filter(msg => msg?.role === 'user').slice(-4).map(msg => String(msg.content || '').trim()).filter(Boolean).join('\n');
  const payload = {
    userText: s,
    hasExplicitRefs: explicitRefs.length > 0,
    explicitRefCount: explicitRefs.length,
    hasLatestGeneratedImage: Boolean(latestRef?.url || latestRef),
    recentDialog: recent
  };
  const messages = [
    {
      role: 'system',
      content: applyModelAgnosticTextRules('你是对话工作台的任务路由规划器。你只判断用户当前输入应该走 Codex 本地任务、文字交流、图片理解，还是图片生成/改图。不要执行任务，不要回答用户正文，只输出 JSON。\n\n输出 JSON 格式：{"kind":"codex|chat|understand|image","useLatestContext":true|false,"reason":"一句话理由"}\n\n判断规则：代码、项目、文件、目录、终端命令、测试、调试、插件或 Skill 操作 => codex。普通问候、闲聊、解释问题、需求澄清、软件使用问题 => chat。提示词写作、提示词优化、文案、方案、翻译、解释，必须判为 chat；例如“给我生成图片的提示词，我自己生成”是要求输出文本提示词，不是要求你调用图片模型。用户要求分析/理解/反推图片且有参考图或最新图上下文 => understand。只有用户明确要求现在生成图片、画图、设计并出图、改图、局部重绘、图生图、按风格生成新图、参考图出图，才判为 image。遇到不确定时优先 chat，向用户文字澄清，不要直接生图。', 'json')
    },
    {
      role: 'user',
      content: `请判断当前任务路由，只输出 JSON。\n\n上下文：\n${JSON.stringify(payload, null, 2)}`
    }
  ];
  try {
    const res = await fetchJsonWithRetry(joinApiPath(apiUrl, endpoint || '/chat/completions'), {timeoutMs: API_TIMEOUTS.text,
      retries: 2,
      retryUnsafe: true,
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey},
      body: JSON.stringify({model, messages, temperature: 0, max_tokens: 180})
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
    const raw = data.choices?.[0]?.message?.content || data.output_text || data.content || '';
    const parsed = parseFirstJsonObject(raw);
    const kind = ['codex', 'chat', 'understand', 'image'].includes(parsed?.kind) ? parsed.kind : '';
    if (!kind) throw new Error('invalid planner kind');
    return {
      kind,
      useLatestContext: Boolean(parsed.useLatestContext),
      reason: String(parsed.reason || 'text model planned route')
    };
  } catch (err) {
    console.warn('dialog route planner fallback', err);
    return fallbackDialogRunPlan(userText, generationReferenceUrls({userText, explicitRefs, latestRef}));
  }
}

function parseFirstJsonObject(text = '') {
  const raw = String(text || '').replace(/```json|```/gi, '').trim();
  try { return JSON.parse(raw); } catch (_) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}

function dialogReferenceIntent(text, refs = []) {
  return referenceIntent(text, refs);
}

function dialogReferenceInstructions(intent, refs = []) {
  return referenceInstructions(intent, refs);
}

function dialogReferenceDisplayItems(userText = '') {
  const refs = dialogExplicitReferenceItems();
  const latest = dialogLatestGeneratedImageRef();
  if (latest?.url && dialogShouldUseLatestContextImage(userText) && !refs.some(item => item.url === latest.url)) {
    return [...refs, {name: '最新生成图（隐式上下文）', url: latest.url}];
  }
  return refs;
}

function pushDialogMessage(role, content, attachments = [], extra = {}) {
  host.dialogEditMessages.push({role, content, attachments, ...extra});
  host.dialogEditMessages = host.dialogEditMessages.slice(-24);
}

function dialogAttachmentStripHtml() {
  if (!host.dialogEditAttachments.length) return '';
  return `<div class="assistant-attachment-strip">
    ${host.dialogEditAttachments.map((item, index) => `
      <span class="assistant-attachment-wrap">
      <button class="assistant-attachment-thumb ${item.kind === 'file' || item.kind === 'video' ? 'is-file' : ''}" type="button" data-dialog-attachment="${index}" title="${esc(item.path || item.name || '附件')}">
        ${item.kind === 'file' || item.kind === 'video'
          ? `<i class="fa-solid ${item.kind === 'video' ? 'fa-film' : 'fa-file-lines'}"></i><span class="assistant-attachment-meta"><b>${esc(item.name || '附件')}</b><small>${esc(item.recognitionStatus || (item.kind === 'video' ? '已识别为视频' : '已保存，发送时读取'))}</small></span>`
          : `<img src="${esc(safeMediaUrl(item.url))}" alt="${esc(item.name || '参考图')}">`}
      </button>
      <button class="assistant-attachment-remove" type="button" data-dialog-attachment-remove="${index}" title="移除附件"><i class="fa-solid fa-xmark"></i></button>
      </span>`).join('')}
  </div>`;
}

function dialogMessageAttachmentHtml(item) {
  if (item?.kind === 'file' || item?.kind === 'video' || (!item?.url && item?.path)) {
    return `<div class="dialog-file-attachment" title="${esc(item.path || item.name || '附件')}"><i class="fa-solid ${item.kind === 'video' ? 'fa-film' : 'fa-file-lines'}"></i><span>${esc(item.name || '附件')}</span><small>${esc(item.recognitionStatus || (item.kind === 'video' ? '已识别为视频' : '发送时由 Codex 读取'))}</small></div>`;
  }
  if (!item?.url) return '';
  const safeUrl = safeMediaUrl(item.url);
  if (!safeUrl) return '';
  return `<button type="button" data-dialog-message-image="${esc(safeUrl)}" title="放大查看"><img src="${esc(safeUrl)}" alt="${esc(item.name || '参考图')}"></button>`;
}

function startDialogRun(kind, status) {
  finishDialogRun();
  const run = {
    id: host.dialogRun.id + 1,
    kind: String(kind || 'request'),
    startedAt: Date.now(),
    status: String(status || '正在处理请求'),
    steps: [String(status || '正在处理请求')],
    cancelled: false,
    controller: new AbortController()
  };
  host.dialogRun = run;
  host.dialogEditRunning = true;
  if (host.dialogRunTimer) clearInterval(host.dialogRunTimer);
  host.dialogRunTimer = setInterval(() => {
    if (host.dialogRun !== run || run.cancelled) return finishDialogRun(run);
    renderDialogEditWorkbench();
  }, 1000);
  return run;
}

function dialogRunIsActive(run) {
  return Boolean(run && host.dialogRun === run && !run.cancelled && host.dialogEditRunning);
}

function assertDialogRunActive(run) {
  if (dialogRunIsActive(run)) return;
  const error = new Error('任务已停止');
  error.code = 'DIALOG_RUN_CANCELLED';
  throw error;
}

// `transient` updates (streamed model text) replace the status line without growing the step list.
// `detail` (diff or live command output) replaces the card's detail block; omit it to keep the current one.
function updateDialogRun(run, status, { transient = false, detail } = {}) {
  if (!dialogRunIsActive(run)) return;
  const next = String(status || '').trim();
  if (!next) return;
  run.status = next;
  if (detail !== undefined) run.detail = String(detail || '').slice(-4000);
  if (!transient && run.steps[run.steps.length - 1] !== next) run.steps = [...run.steps, next].slice(-4);
  renderDialogEditWorkbench();
}

function finishDialogRun(run = null) {
  if (run && host.dialogRun !== run) return;
  if (host.dialogRunTimer) clearInterval(host.dialogRunTimer);
  host.dialogRunTimer = 0;
  if (!run || host.dialogRun === run) {
    host.dialogRun = {id: host.dialogRun.id, kind: 'idle', startedAt: 0, status: '', steps: [], cancelled: false, controller: null};
    host.dialogEditRunning = false;
  }
}

function resetDialogRun() {
  const run = host.dialogRun;
  if (run?.controller && !run.cancelled) {
    run.cancelled = true;
    run.controller.abort();
  }
  if (run?.kind === 'codex' && host.codexSessionId) {
    window.codexBridge?.cancel?.(host.codexSessionId).catch(() => {});
    host.codexRunning = false;
  }
  if (host.codexDialogRun === run) host.codexDialogRun = null;
  finishDialogRun();
}

async function stopDialogRun() {
  const run = host.dialogRun;
  if (!dialogRunIsActive(run)) return;
  run.cancelled = true;
  run.controller?.abort();
  if (run.kind === 'codex') {
    if (host.codexDialogRun === run) host.codexDialogRun = null;
    if (host.codexSessionId) await window.codexBridge?.cancel?.(host.codexSessionId);
    host.codexRunning = false;
  }
  finishDialogRun(run);
  pushDialogMessage('assistant', '已停止当前任务。');
  saveProject();
  renderDialogEditWorkbench();
}

function dialogRunningCardHtml() {
  if (!host.dialogEditRunning) return '';
  const elapsedSeconds = host.dialogRun.startedAt ? Math.max(0, Math.floor((Date.now() - host.dialogRun.startedAt) / 1000)) : 0;
  const elapsed = elapsedSeconds >= 60 ? `${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒` : `${elapsedSeconds} 秒`;
  const steps = host.dialogRun.steps.slice(-4);
  return `<section class="codex-run-stream dialog-api-run">
    <div class="codex-run-meta"><span>处理中 ${elapsed}</span><button class="codex-stop-run" type="button" data-dialog-action="stop-run" title="停止当前任务"><i class="fa-solid fa-stop"></i></button></div>
    <div class="codex-run-divider"></div>
    <div class="codex-run-current"><i class="fa-solid fa-circle-notch fa-spin"></i><strong>${esc(host.dialogRun.status || '正在处理请求')}</strong></div>
    ${steps.length ? `<div class="codex-run-steps">${steps.map(step => codexStepRowHtml(step)).join('')}</div>` : ''}
    ${host.dialogRun.detail ? `<pre class="codex-run-detail">${dialogRunDetailHtml(host.dialogRun.detail)}</pre>` : ''}
  </section>`;
}

function dialogRunDetailHtml(detail) {
  return String(detail).split('\n').map(line => {
    const kind = /^\+(?!\+\+)/.test(line) ? 'add' : /^-(?!--)/.test(line) ? 'del' : /^@@/.test(line) ? 'hunk' : '';
    return kind ? `<span class="diff-${kind}">${esc(line)}</span>` : esc(line);
  }).join('\n');
}

function codexStepRowHtml(step = '') {
  const value = String(step || '');
  const icon = /命令|终端|shell/i.test(value) ? 'fa-terminal'
    : /修改|文件|patch/i.test(value) ? 'fa-pen'
    : /验证|完成|检查/i.test(value) ? 'fa-circle-check'
    : /计划|分析|上下文/i.test(value) ? 'fa-compass'
    : 'fa-ellipsis';
  return `<div class="codex-run-step"><i class="fa-solid ${icon}"></i><span>${esc(value)}</span></div>`;
}

function renderCodexInlineMarkdown(value = '') {
  return esc(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderCodexMessage(content = '', role = 'assistant') {
  const text = String(content || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  if (role !== 'assistant') return renderCodexInlineMarkdown(text).replace(/\n/g, '<br>');
  const parts = text.split(/```([^\n`]*)\n?([\s\S]*?)```/g);
  const html = [];
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i] || '';
    const lines = prose.split('\n');
    let list = [];
    const flushList = () => {
      if (!list.length) return;
      html.push(`<ul>${list.map(item => `<li>${renderCodexInlineMarkdown(item)}</li>`).join('')}</ul>`);
      list = [];
    };
    lines.forEach(line => {
      const value = line.trim();
      if (!value) { flushList(); return; }
      const heading = value.match(/^(#{1,3})\s+(.+)$/);
      const item = value.match(/^[-*]\s+(.+)$/);
      const numbered = value.match(/^\d+[.)]\s+(.+)$/);
      if (heading) {
        flushList();
        const level = Math.min(heading[1].length + 2, 5);
        html.push(`<h${level}>${renderCodexInlineMarkdown(heading[2])}</h${level}>`);
      } else if (item || numbered) {
        list.push((item || numbered)[1]);
      } else {
        flushList();
        html.push(`<p>${renderCodexInlineMarkdown(value)}</p>`);
      }
    });
    flushList();
    if (i + 2 < parts.length) {
      const language = String(parts[i + 1] || '').trim();
      const code = esc(parts[i + 2] || '');
      html.push(`<pre class="codex-code-block"><span class="codex-code-header"><b>${esc(language || 'text')}</b><button class="codex-code-copy" data-codex-code-copy type="button" title="复制此内容"><i class="fa-regular fa-copy"></i></button></span><code>${code}</code></pre>`);
    }
  }
  return html.join('');
}

function codexExecutionHtml(steps = []) {
  if (!Array.isArray(steps) || !steps.length) return '';
  return `<details class="codex-execution-details"><summary><i class="fa-solid fa-list-check"></i> 运行记录 · ${steps.length} 步</summary><div>${steps.map(step => codexStepRowHtml(step)).join('')}</div></details>`;
}

function dialogMessageImportButton(index) {
  const text = dialogMessageText(index);
  const seedance = isSeedancePromptText(text);
  const label = seedance ? '<span>发画布</span>' : '';
  const title = seedance ? '把 Seedance 2 提示词发送到画布' : '导入画板';
  return `<button class="dialog-msg-import ${seedance ? 'is-seedance' : ''}" data-dialog-import="${esc(String(index))}" type="button" title="${title}"><i class="fa-solid fa-arrow-up-right-from-square"></i>${label}</button>`;
}

function dialogMessageDownloadButton(index) {
  const attachments = dialogMessageAttachments(index).filter(item => item?.url && item.kind !== 'file');
  if (!attachments.length) return '';
  return `<button class="dialog-msg-action" data-dialog-download="${esc(String(index))}" type="button" title="下载图片"><i class="fa-solid fa-download"></i></button>`;
}

function dialogMessageText(index) {
  return String(host.dialogEditMessages[Number(index)]?.content || '').trim();
}

function dialogMessageWorkingPrompt(index) {
  const message = host.dialogEditMessages[Number(index)];
  return String(message?.generationPrompt || message?.content || '').trim();
}

function dialogMessageAttachments(index) {
  const attachments = host.dialogEditMessages[Number(index)]?.attachments;
  return Array.isArray(attachments) ? attachments.map(item => ({...item})).filter(item => item?.path || item?.url) : [];
}

function isSeedancePromptText(text) {
  return /Seedance\s*2|镜头目标|镜头运动|负向避免|关键帧建议/i.test(String(text || '')); 
}

function dialogMessageActionButtons(index) {
  const msg = host.dialogEditMessages[Number(index)];
  const value = esc(String(index));
  const hasMedia = dialogMessageAttachments(index).length > 0;
  const label = hasMedia ? '此图片' : (msg?.role === 'user' ? '此任务' : '此回复');
  return `<div class="dialog-msg-actions" aria-label="${label}操作">
    <span class="dialog-msg-action-label">${label}</span>
    <button class="dialog-msg-action" data-dialog-copy="${value}" type="button" title="复制内容"><i class="fa-regular fa-copy"></i></button>
    <button class="dialog-msg-action" data-dialog-edit="${value}" type="button" title="编辑到输入框"><i class="fa-regular fa-pen-to-square"></i></button>
    ${msg?.role === 'user' ? `<button class="dialog-msg-action" data-dialog-rerun="${value}" type="button" title="编辑并重新生成"><i class="fa-solid fa-rotate"></i></button>` : ''}
    ${dialogMessageDownloadButton(index)}
    ${dialogMessageImportButton(index)}
  </div>`;
}

function beginDialogMessageEdit(index) {
  const text = dialogMessageWorkingPrompt(index);
  if (!text) return toast('这条对话没有可编辑文字', 'warn');
  host.dialogEditEditingIndex = Number(index);
  host.dialogEditInput = text;
  host.dialogEditAttachments = dialogMessageAttachments(index);
  saveProject();
  renderDialogEditWorkbench();
  requestAnimationFrame(() => $('dialogEditWorkbenchPanel')?.querySelector('[data-dialog-field="input"]')?.focus());
}

function applyDialogMessageEdit(text, attachments) {
  if (host.dialogEditEditingIndex < 0 || !host.dialogEditMessages[host.dialogEditEditingIndex]) return false;
  host.dialogEditMessages = host.dialogEditMessages.slice(0, host.dialogEditEditingIndex);
  pushDialogMessage('user', text, attachments);
  host.dialogEditEditingIndex = -1;
  return true;
}

async function dialogTextChatReply({apiUrl, apiKey, model, endpoint = '/chat/completions', userText}) {
  const s = String(userText || '').trim();
  if (/^(hi|hello|hey|你好|您好|嗨|哈喽|在吗|在不在)[。！!？?\s]*$/i.test(s)) {
    return '你好，我在。有什么想生成、修改、分析或整理成提示词的内容，直接发给我就可以。';
  }
  const recent = host.dialogEditMessages.slice(-8).map(msg => `${msg.role === 'user' ? '用户' : '助手'}：${String(msg.content || '').trim()}`).filter(Boolean).join('\n');
  const messages = [
    {
      role: 'system',
      content: applyModelAgnosticTextRules('你是对话式创作助手。普通问候、问题、解释、需求澄清必须用文字回复；只有用户明确要求生成图片、改图、图生图、参考图出图或图片理解时，才进入相应图像任务。回答简洁、实用，不要擅自触发图片生成。', 'chat')
    },
    {
      role: 'user',
      content: [`最近对话\n${recent || '无'}`, `用户当前消息\n${s || '你好'}`].join('\n\n')
    }
  ];
  const res = await fetchJsonWithRetry(joinApiPath(apiUrl, endpoint || '/chat/completions'), {timeoutMs: API_TIMEOUTS.text,
    retries: 2,
    retryUnsafe: true,
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey},
    body: JSON.stringify({model, messages, temperature: 0.55})
  });
  const data = await safeJson(res);
  if (!res.ok) throw createProviderApiError(data, res);
  return cleanAiText(data.choices?.[0]?.message?.content || data.output_text || data.content || '我在。');
}

function dialogSubjectFramingConstraints(text = '') {
  const s = String(text || '').trim();
  if (!s) return '';
  const rules = ['用户最后一句指令优先级最高；如果它与助手人设、默认景别、历史对话或参考图构图冲突，必须服从用户最后一句。'];
  const asksFace = /脸部|面部|头部|五官|脸型|face|head/i.test(s);
  const asksTriView = /三视图|三视角|三面图|正面.*侧面.*背面|front.*side.*back/i.test(s);
  const asksClose = /特写|近景|局部|只.*脸|只.*头|close.?up/i.test(s);
  if (asksFace || asksClose) {
    rules.push('用户要求脸部/面部/头部/特写时，画面主体必须聚焦脸部和头部结构；不要把默认中景、半身、全身、服装展示、手部动作或环境构图作为主目标。');
  }
  if (asksFace && asksTriView) {
    rules.push('脸部三视图硬约束：生成同一角色的脸部特写三视图，从左到右固定为：正面脸部特写、侧面脸部特写、背面后脑勺特写。第三个视角必须是背向镜头的后脑勺、后发型和后头饰结构，不显示五官，不是左侧脸或右侧脸；禁止生成侧面、正面、侧面的排列，禁止用第二个侧脸替代背面。三个视角必须保持同一张脸、同一发型和同一头饰结构。只保留头部和少量颈部，不要生成半身、全身、服装展示或手部姿势，不要把身体和衣服细节作为主体。');
  } else if (asksTriView) {
    rules.push('三视图硬约束：必须清晰呈现正面、侧面、背面三个视角；背面必须是背向镜头的后方视角，不是另一张侧面。不要只生成一个角度，也不要把三视图理解成同一姿势的重复图。');
  }
  if (/16\s*[:：]\s*9|16x9|横版|横屏/i.test(s)) {
    rules.push('画幅硬约束：输出 16:9 横向画布，三视图应横向排布，留出清晰间距。');
  }
  return `用户指令解析与硬约束\n${rules.join('\n')}`;
}

function buildDialogImageBrief(attachments = host.dialogEditAttachments) {
  const instruction = String(host.dialogEditInput || '').trim();
  const refs = dialogReferenceDisplayItems(instruction);
  const profile = activeAssistantProfile();
  const referenceIntent = dialogReferenceIntent(instruction, refs);
  const sections = [];
  if (instruction) sections.push(instruction);
  const textAttachments = (attachments || []).filter(item => item?.kind === 'file' && String(item.textContent || '').trim());
  if (textAttachments.length) {
    const content = textAttachments.map(item => `--- ${item.name || '附件'} ---\n${String(item.textContent || '').slice(0, 10000)}`).join('\n\n');
    sections.push(`附件参考内容（用于理解创作规则与需求，不要在图片中直接绘制这些说明文字）\n${content}`);
  }
  if (refs.length) {
    const referenceNote = referenceIntent === 'edit' ? '将参考图视为需保留身份和构图的底稿。'
      : referenceIntent === 'style' ? '仅参考画面风格，不复制原主体身份与构图。'
        : '结合用户描述使用参考图。';
    sections.push(`参考图：${refs.map((ref, index) => `${index + 1}. ${ref.name || '参考图'}`).join('；')}。${referenceNote}`);
  }
  const framingConstraints = dialogSubjectFramingConstraints(instruction);
  if (framingConstraints) sections.push(framingConstraints);
  if (String(profile?.negativePrompt || '').trim()) sections.push(`避免：${String(profile.negativePrompt).trim()}`);
  return sections.join('\n\n');
}

function buildDialogImageTaskContext(displayBrief = buildDialogImageBrief()) {
  const recentUserMessages = host.dialogEditMessages
    .filter(msg => msg?.role === 'user')
    .slice(-4)
    .map(msg => String(msg.content || '').trim())
    .filter(Boolean);
  const profilePrompt = String(assistantSystemPrompt() || '').trim();
  return [
    '内部任务上下文，仅用于理解与生成，绝不能在输出中复述规则、历史或系统说明。',
    '模型应根据用户最后一句自然语言判断每张参考图的用途。只有用户明确要求改、修、去掉、替换、局部调整当前画面时，才把参考图当作需要保留身份和构图的底稿。',
    profilePrompt ? `创作约束\n${profilePrompt}` : '',
    recentUserMessages.length ? `近期用户需求\n${recentUserMessages.join('\n')}` : '',
    `本轮可见需求\n${displayBrief}`
  ].filter(Boolean).join('\n\n');
}

function buildDialogEditPrompt() {
  return buildDialogImageBrief();
}

function openDialogEditWorkbench(nodeId = '') {
  host.dialogEditActive = true;
  host.assistantActiveTab = 'dialog';
  ensureDialogEditState();
  if (nodeId) {
    const node = host.nodes.get(nodeId);
    if (node?.data?.url) host.dialogEditAttachments = [{name: nodeDisplayTitle(node), url: node.data.url}, ...host.dialogEditAttachments].filter(item => item?.url).slice(0, 6);
  }
  host.dialogEditActiveNodeId = '';
  setActiveWorkspace('assistant');
  saveProject();
  renderAssistantWorkspace();
}

function closeDialogEditWorkbench() {
  host.dialogEditActive = false;
  setActiveWorkspace('canvas');
}

function renderDialogEditWorkbench() {
  const panel = $('dialogEditWorkbenchPanel');
  if (!panel) return;
  ensureDialogEditState();
  const recentMessages = host.dialogEditMessages.map((msg, index) => ({...msg, index})).slice(-12);
  const provider = globalProviderForKind('chat');
  const activeModel = provider?.chatModel || FutureAIApiDefaults.get('chatModel') || '未选择模型';
  const permissionLabel = ({readonly: '只读', project: '项目内开发', full: '完全开发'})[host.codexPermission] || '项目内开发';
  panel.innerHTML = `
    <div class="dialog-chat-shell">
      <section class="dialog-chat-main">
        <div class="dialog-thread">
          ${recentMessages.length ? recentMessages.map(msg => `
            <div class="dialog-msg ${msg.role} ${msg.attachments?.length ? 'has-media-result' : ''} ${isSeedancePromptText(msg.content) ? 'has-seedance-prompt' : ''}">
              ${msg.attachments?.length ? `<div class="dialog-msg-assets">${msg.attachments.map(dialogMessageAttachmentHtml).join('')}</div>` : ''}
              <div class="dialog-msg-text codex-message-content">${renderCodexMessage(msg.content || '', msg.role)}</div>
              ${msg.role === 'assistant' ? codexExecutionHtml(msg.steps) : ''}
              ${dialogMessageActionButtons(msg.index)}
            </div>`).join('') : `<div class="dialog-empty assistant-empty-state">
            <i class="fa-solid fa-comments" aria-hidden="true"></i>
            <strong>把下一步工作交给灵枢万象</strong>
            <span>选择一个示例开始，或直接描述你想完成的任务。</span>
            <div class="dialog-suggestions">
              <button type="button" data-dialog-suggest="检查当前项目并列出最值得先修复的 UI 问题"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>检查项目</button>
              <button type="button" data-dialog-suggest="把当前创意拆成三镜头分镜"><i class="fa-solid fa-film" aria-hidden="true"></i>拆分分镜</button>
              <button type="button" data-dialog-suggest="为当前主题生成一张角色设定图"><i class="fa-solid fa-image" aria-hidden="true"></i>生成角色卡</button>
            </div>
          </div>`}
          ${dialogRunningCardHtml()}
        </div>
        <div class="dialog-compose assistant-compose-dock">
          <div class="assistant-compose-dropzone" data-dialog-dropzone>
            ${dialogAttachmentStripHtml()}
            <textarea data-dialog-field="input" placeholder="把要交给∞ 灵枢万象的任务写在这里...">${esc(host.dialogEditInput)}</textarea>
            ${host.dialogEditEditingIndex >= 0 ? `<div class="assistant-editing-banner"><span>正在编辑旧消息，发送后会重新生成后续结果</span><button type="button" data-dialog-action="cancel-edit">取消</button></div>` : ''}
            <div class="assistant-compose-tools">
              <span class="codex-compose-status"><i class="fa-solid fa-circle"></i>${esc(activeModel)}<b>${esc(permissionLabel)}</b></span>
              <button class="ghost-btn" data-dialog-action="use-selected" type="button" title="使用当前选中图" aria-label="使用当前选中图"><i class="fa-solid fa-crosshairs" aria-hidden="true"></i></button>
               <button class="ghost-btn" data-dialog-action="add-ref" type="button" title="添加附件" aria-label="添加附件"><i class="fa-solid fa-paperclip" aria-hidden="true"></i></button>
              <button class="ghost-btn" data-dialog-action="copy-prompt" type="button" title="复制指令" aria-label="复制指令"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
              <button class="ghost-btn" data-dialog-action="clear-conversation" type="button" title="清空当前对话" aria-label="清空当前对话"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
              <button class="primary-btn" data-dialog-action="generate" type="button" aria-label="发送任务"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
            </div>
          </div>
        </div>
      </section>
    </div>`;
  scrollDialogThreadToBottom();
}

function scrollDialogThreadToBottom() {
  requestAnimationFrame(() => {
    const thread = $('dialogEditWorkbenchPanel')?.querySelector('.dialog-thread');
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  });
}

async function onDialogEditWorkbenchClick(e) {
  const action = e.target.closest('[data-dialog-action]')?.dataset.dialogAction;
  if (action === 'use-selected') {
    const target = getSelectedImageNode();
    if (!target) return toast('请先选中一个图片节点', 'warn');
    host.dialogEditAttachments = [{name: nodeDisplayTitle(target), url: target.data.url}, ...host.dialogEditAttachments].filter(item => item?.url).slice(0, 6);
    host.dialogEditActiveNodeId = '';
    host.dialogEditActive = true;
    saveProject();
    renderDialogEditWorkbench();
    return;
  }
  if (action === 'add-ref') {
    $('dialogEditRefInput')?.click();
    return;
  }
  if (action === 'clear') {
    host.dialogEditInput = '';
    host.dialogEditEditingIndex = -1;
    saveProject();
    renderDialogEditWorkbench();
    return;
  }
  if (action === 'clear-conversation') {
    await clearCurrentDialogConversation();
    return;
  }
  if (action === 'cancel-edit') {
    host.dialogEditEditingIndex = -1;
    host.dialogEditInput = '';
    saveProject();
    renderDialogEditWorkbench();
    return;
  }
  if (action === 'copy-prompt') {
    await navigator.clipboard?.writeText(buildDialogEditPrompt());
    toast('已复制改图指令', 'success');
    return;
  }
  if (action === 'generate') {
    await runDialogEditGeneration();
    return;
  }
  if (action === 'stop-run') {
    await stopDialogRun();
    return;
  }
  const suggest = e.target.closest('[data-dialog-suggest]')?.dataset.dialogSuggest;
  if (suggest) {
    host.dialogEditInput = [host.dialogEditInput, suggest].filter(Boolean).join(host.dialogEditInput ? '\n' : '');
    saveProject();
    renderDialogEditWorkbench();
    return;
  }
  const removeAttachmentBtn = e.target.closest('[data-dialog-attachment-remove]');
  if (removeAttachmentBtn) {
    host.dialogEditAttachments.splice(Number(removeAttachmentBtn.dataset.dialogAttachmentRemove), 1);
    saveProject();
    renderDialogEditWorkbench();
    return;
  }
  const messageImageBtn = e.target.closest('[data-dialog-message-image]');
  if (messageImageBtn) {
    openImageModal(messageImageBtn.dataset.dialogMessageImage);
    return;
  }
  const attachmentBtn = e.target.closest('[data-dialog-attachment]');
  if (attachmentBtn) {
    const item = host.dialogEditAttachments[Number(attachmentBtn.dataset.dialogAttachment)];
    if (item?.url) openImageModal(item.url);
    return;
  }
  const copyBtn = e.target.closest('[data-dialog-copy]');
  if (copyBtn) {
    const text = dialogMessageWorkingPrompt(copyBtn.dataset.dialogCopy);
    if (!text) return toast('这条对话没有可复制文字', 'warn');
    await navigator.clipboard?.writeText(text);
    toast('已复制内容', 'success');
    return;
  }
  const codeCopyBtn = e.target.closest('[data-codex-code-copy]');
  if (codeCopyBtn) {
    const text = codeCopyBtn.closest('.codex-code-block')?.querySelector('code')?.textContent?.trim() || '';
    if (!text) return toast('此内容为空', 'warn');
    await navigator.clipboard?.writeText(text);
    toast('已复制此内容', 'success');
    return;
  }
  const editBtn = e.target.closest('[data-dialog-edit]');
  if (editBtn) {
    beginDialogMessageEdit(editBtn.dataset.dialogEdit);
    return;
  }
  const rerunBtn = e.target.closest('[data-dialog-rerun]');
  if (rerunBtn) {
    beginDialogMessageEdit(rerunBtn.dataset.dialogRerun);
    return;
  }
  const importBtn = e.target.closest('[data-dialog-import]');
  if (importBtn) {
    importDialogMessageToCanvas(Number(importBtn.dataset.dialogImport));
    return;
  }
  const downloadBtn = e.target.closest('[data-dialog-download]');
  if (downloadBtn) {
    downloadDialogMessageAttachment(Number(downloadBtn.dataset.dialogDownload));
  }
}

function downloadDialogMessageAttachment(index) {
  const attachments = dialogMessageAttachments(index).filter(item => item?.url && item.kind !== 'file');
  if (!attachments.length) return toast('这条对话没有可下载图片', 'warn');
  downloadImage(attachments[0].url);
}

function importDialogMessageToCanvas(index) {
  const msg = host.dialogEditMessages[index];
  if (!msg) return toast('找不到这条对话', 'warn');
  const text = String(msg.generationPrompt || msg.content || '').trim();
  const attachments = Array.isArray(msg.attachments) ? msg.attachments.filter(item => item?.url && item.kind !== 'file') : [];
  if (!text && !attachments.length) return toast('这条对话没有可导入内容', 'warn');
  const c = viewCenter();
  let promptNode = null;
  if (text) {
    const isSeedancePrompt = isSeedancePromptText(text);
    promptNode = addNode('prompt', c.x - 520, c.y - 90, {
      title: isSeedancePrompt ? 'Seedance 2 镜头提示词' : '对话提示词',
      prompt: text,
      tags: isSeedancePrompt ? ['Seedance 2', '技能', '镜头'] : []
    }, null, false);
  }
  attachments.slice(0, 6).forEach((item, i) => {
    const imageNode = addNode('image', c.x - 130 + i * 360, c.y - 180 + i * 36, {
      prompt: text,
      model: FutureAIApiDefaults.get('imageModel'),
      size: '1024x1024',
      resolution: '1K',
      url: item.url,
      urls: [item.url],
      refUrl: item.url,
      manualRefUrl: item.url
    }, null, false);
    if (promptNode) connectSilently(promptNode.id, 'text', imageNode.id, 'prompt');
  });
  saveProject();
  setActiveWorkspace('canvas');
  drawEdges();
  requestAnimationFrame(drawEdges);
  toast('已导入画板', 'success');
}

async function onDialogEditWorkbenchInput(e) {
  const field = e.target.closest('[data-dialog-field]')?.dataset.dialogField;
  if (!field) return;
  host.dialogEditInput = e.target.value;
  queueSave();
  const pre = $('dialogEditWorkbenchPanel')?.querySelector('.dialog-edit-preview-box pre');
  if (pre) pre.textContent = buildDialogEditPrompt();
}

async function handleDialogEditUploads(files) {
  const list = [...(files || [])].filter(file => file && file.size > 0).slice(0, 12);
  if (!list.length) return toast('没有可用的附件', 'warn');
  const uploads = [];
  for (const file of list) {
    try {
      const isImage = String(file.type || '').startsWith('image/');
      const isVideo = String(file.type || '').startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name || '');
      const isReadableText = /\.(md|mdx|txt|json|jsonl|ya?ml|toml|ini|csv|tsv|xml|html?|css|scss|less|jsx?|tsx?|mjs|cjs|py|java|c|h|cpp|hpp|cs|go|rs|php|rb|sh|ps1|bat|cmd|sql|vue|svelte|log)$/i.test(file.name || '') && file.size <= 2 * 1024 * 1024;
      const bytes = file.size <= 32 * 1024 * 1024 ? await file.arrayBuffer() : undefined;
      const persisted = await window.codexBridge?.saveAttachment?.(file, {
        storageDir: host.storageDir,
        name: file.name || '附件',
        mime: file.type || '',
        bytes
      });
      const url = isImage ? await fileToDataUrl(file) : '';
      const textContent = isReadableText ? (await file.text()).slice(0, 60000) : '';
      uploads.push({
        name: file.name || '附件',
        mime: file.type || '',
        size: file.size || persisted?.size || 0,
        kind: isVideo ? 'video' : isImage ? 'image' : 'file',
        path: persisted?.path || '',
        url,
        textContent,
        recognitionStatus: isVideo ? '已识别为视频' : isImage ? '已识别为图片' : textContent ? '内容已读取' : '已保存，发送时读取'
      });
    } catch (err) {
      toast(`${file.name || '附件'}：${err?.message || String(err)}`, 'error');
    }
  }
  if (!uploads.length) return;
  host.dialogEditAttachments = [...host.dialogEditAttachments, ...uploads].filter(item => item?.path || item?.url).slice(0, 12);
  saveProject();
  renderDialogEditWorkbench();
}

function buildCodexAssistantPrompt(userText, attachments = []) {
  const summary = agentProjectSummary();
  const selected = [...host.selectedNodes].map(id => host.nodes.get(id)).filter(Boolean).map(node => ({
    id: node.id,
    type: node.type,
    title: nodeDisplayTitle(node),
    prompt: node.data?.prompt || '',
    model: node.data?.model || '',
    url: node.data?.url || ''
  }));
  const attachmentLines = attachments.map((item, index) => {
    const details = [item.mime, item.size ? `${Math.ceil(item.size / 1024)} KB` : ''].filter(Boolean).join('，');
    return `${index + 1}. ${item.name || '附件'}${details ? `（${details}）` : ''}\n   路径：${item.path || '未持久化'}${item.url ? '\n   图像预览：已附加' : ''}`;
  }).join('\n');
  return [
    '【工作目录】',
    host.storageDir || '未选择',
    '【项目上下文】',
    JSON.stringify({
      project: summary.projectName,
      nodes: summary.nodeCount,
      edges: summary.edgeCount,
      assets: summary.assetCount,
      selected: summary.selectedNames,
      topic: summary.activeTopic
    }, null, 2),
    selected.length ? '【当前选中节点】\n' + JSON.stringify(selected, null, 2) : '',
    attachmentLines ? '【附件路径】\n' + attachmentLines : '',
    '【用户任务】',
    userText
  ].filter(Boolean).join('\n\n');
}

function isVideoUnderstandingRequest(text = '') {
  return !/\b(code|script|ffmpeg|api|bug|test)\b|\u4ee3\u7801|\u811a\u672c|\u7f16\u7a0b|\u8c03\u8bd5|\u4fee\u590d|\u63d2\u4ef6|\u547d\u4ee4\u884c|\u8f6c\u7801|\u526a\u8f91\u8f6f\u4ef6/i.test(String(text || ''));
}

function isExplicitImageExecutionRequest(text = '') {
  const value = String(text || '').trim();
  if (!value || isPromptWritingRequest(value)) return false;
  return /生成(?:一张|一幅|一个)?[^\n]{0,40}(?:图|图片|画面|海报|视觉)|出图|画(?:一张|一幅)|概念氛围图|概念图|发成图片/i.test(value);
}

async function hydrateDialogTextAttachments(attachments = []) {
  for (const attachment of attachments) {
    if (attachment?.kind !== 'file' || attachment.textContent || !attachment.path) continue;
    try {
      const result = await window.codexBridge?.readTextAttachment?.({storageDir: host.storageDir, path: attachment.path});
      if (result?.text) {
        attachment.textContent = result.text;
        attachment.recognitionStatus = result.truncated ? '内容已读取（过长已截取）' : '内容已读取';
      }
    } catch (err) {
      attachment.recognitionStatus = `内容读取失败：${err?.message || String(err)}`;
    }
  }
  return attachments;
}

async function runDialogCodexAssistant(options = {}) {
  if (!window.codexBridge?.run) return toast('当前应用环境不支持本地 Codex', 'warn');
  const userText = String(options.userText ?? host.dialogEditInput ?? '').trim();
  const attachments = Array.isArray(options.attachments)
    ? options.attachments.map(item => ({...item})).filter(item => item?.path || item?.url)
    : host.dialogEditAttachments.map(item => ({...item})).filter(item => item?.path || item?.url);
  if (!userText && !attachments.length) return toast('请先输入任务', 'warn');
  if (host.codexCli?.ok && !host.storageDir) return toast('请先选择本地存储目录，Codex 会在该目录内工作', 'warn');
  if (!options.alreadyRecorded) {
    if (host.dialogEditEditingIndex >= 0) applyDialogMessageEdit(userText || '请处理这些附件。', attachments);
    else pushDialogMessage('user', userText || '请处理这些附件。', attachments);
  }
  if (!host.codexCli?.ok) {
    // Computer automation needs a Codex CLI; canvas, generation and chat keep working without it.
    const url = host.codexCli?.installUrl || 'https://github.com/openai/codex';
    host.dialogEditInput = '';
    host.dialogEditAttachments = [];
    host.dialogEditEditingIndex = -1;
    pushDialogMessage('assistant', `这个任务需要电脑自动化。安装 Codex 以启用电脑自动化：[${url}](${url})\n\n安装后在 设置 → API → 电脑自动化 (Codex) 点击“重新检测”。画布、生成和对话功能不受影响。`);
    saveProject();
    renderDialogEditWorkbench();
    return;
  }
  host.dialogEditInput = '';
  host.dialogEditAttachments = [];
  host.dialogEditEditingIndex = -1;
  const run = startDialogRun('codex', 'Codex 正在读取项目上下文');
  run.output = '';
  run.error = '';
  host.codexDialogRun = run;
  host.codexExpanded = false;
  const prompt = buildCodexAssistantPrompt(userText || '请处理这些附件。', attachments);
  host.codexPromptDraft = prompt;
  host.codexOutput = `任务：${userText || '处理附件'}\n\n`;
  host.codexStatus = '运行中';
  host.codexRunning = true;
  saveProject();
  renderDialogEditWorkbench();
  renderAgentConsole();
  try {
    const apiConfig = await codexApiConfig();
    const result = await window.codexBridge.run({prompt, storageDir: host.storageDir, permission: host.codexPermission, ...apiConfig});
    host.codexSessionId = result?.sessionId || '';
  } catch (err) {
    host.codexRunning = false;
    if (host.codexDialogRun === run) host.codexDialogRun = null;
    finishDialogRun(run);
    const msg = err?.message || String(err);
    pushDialogMessage('assistant', 'Codex 启动失败：\n' + msg);
    renderDialogEditWorkbench();
    renderAgentConsole();
    toast(msg, 'error');
  }
}

async function stopDialogCodexRun() {
  if (host.codexSessionId) await window.codexBridge?.cancel?.(host.codexSessionId);
  host.codexRunning = false;
  host.codexDialogRun = null;
  await stopDialogRun();
  renderAgentConsole();
}

async function runDialogEditGeneration() {
  if (host.dialogEditRunning) return toast('当前任务仍在处理中，请先等待完成或停止任务', 'warn');
  const profile = activeAssistantProfile();
  const imageProvider = globalProviderForKind('image');
  const chatProvider = globalProviderForKind('chat');
  const imageApiUrl = imageProvider.apiUrl || FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '');
  const chatApiUrl = chatProvider.apiUrl || imageApiUrl;
  // The global image setting is the user's explicit choice; old provider/project data is only a fallback.
  const imageModel = FutureAIApiDefaults.get('imageModel').trim() || imageProvider.imageModel;
  const chatModel = chatProvider.chatModel || FutureAIApiDefaults.get('chatModel').trim() || profile?.model || 'gpt-4o-mini';
  let imageApiKey = '';
  const chatApiKey = await providerApiKey(chatProvider);
  let dialogKeysReleased = false;
  const finishDialogKeyLeases = (error = null, failedCapability = '') => {
    if (dialogKeysReleased) return;
    dialogKeysReleased = true;
  };
  if (!chatApiUrl || !chatApiKey) {
    finishDialogKeyLeases(null);
    return toast('请先在设置里完善全局聊天供应商和密钥', 'warn');
  }
  const run = startDialogRun('routing', '正在判断任务类型');
  renderDialogEditWorkbench();
  const currentAttachments = host.dialogEditAttachments.map(item => ({...item})).filter(item => item?.path || item?.url);
  updateDialogRun(run, '正在识别附件内容');
  await hydrateDialogTextAttachments(currentAttachments);
  const displayBrief = buildDialogImageBrief(currentAttachments);
  const taskContext = buildDialogImageTaskContext(displayBrief);
  let optimizedPrompt = displayBrief;
  const videoAttachments = currentAttachments.filter(item => item.kind === 'video' && item.path);
  const userText = String(host.dialogEditInput || '').trim() || (videoAttachments.length ? '请理解这个视频' : '生成图片');
  const explicitRefs = dialogExplicitReferenceItems();
  const latestRef = dialogLatestGeneratedImageRef();
  let runPlan;
  let activeApiCapability = 'chat';
  try {
    runPlan = await planDialogRunWithTextModel({
      apiUrl: chatApiUrl,
      apiKey: chatApiKey,
      model: chatModel,
      endpoint: chatProvider.chatEndpoint,
      userText,
      explicitRefs,
      latestRef
    });
    assertDialogRunActive(run);
    activeApiCapability = '';
  } catch (err) {
    finishDialogKeyLeases(err, 'chat');
    finishDialogRun(run);
    if (err?.code === 'DIALOG_RUN_CANCELLED') return;
    const msg = err?.message || String(err);
    pushDialogMessage('assistant', '任务判断失败：\n' + msg);
    saveProject();
    renderDialogEditWorkbench();
    toast(msg, 'error');
    return;
  }
  let refUrls = explicitRefs.map(item => item.url).filter(Boolean);
  if (runPlan.useLatestContext && latestRef?.url && !refUrls.includes(latestRef.url)) refUrls = [...refUrls, latestRef.url];
  let runKind = runPlan.kind;
  const hasTextFileAttachment = currentAttachments.some(attachment => attachment.kind === 'file');
  if (hasTextFileAttachment && isExplicitImageExecutionRequest(userText)) runKind = 'image';
  if (hasTextFileAttachment && runKind !== 'image') runKind = 'codex';
  if (videoAttachments.length && isVideoUnderstandingRequest(userText)) runKind = 'video-understand';
  if (runKind === 'image') imageApiKey = await providerApiKey(imageProvider);
  if (host.dialogEditEditingIndex >= 0) {
    applyDialogMessageEdit(userText, currentAttachments);
  } else {
    pushDialogMessage('user', userText, currentAttachments);
  }
  if (runKind === 'image' && (!imageApiUrl || (!imageApiKey && imageProvider.type !== 'custom-sync') || !imageModel)) {
    finishDialogKeyLeases(null);
    finishDialogRun(run);
    const msg = !imageModel ? '请先选择或填写全局图片模型' : '请先在设置里完善全局图片供应商和密钥';
    pushDialogMessage('assistant', msg);
    saveProject();
    renderDialogEditWorkbench();
    toast(msg, 'warn');
    return;
  }
  try {
    if (runKind === 'video-understand') {
      updateDialogRun(run, '正在提取全片代表帧');
      try {
        const sampledVideos = [];
        for (const attachment of videoAttachments.slice(0, 2)) {
          const sampled = await window.codexBridge.videoFrames({storageDir: host.storageDir, path: attachment.path, frameCount: videoAttachments.length > 1 ? 6 : 10});
          sampledVideos.push({name: attachment.name, ...sampled});
        }
        assertDialogRunActive(run);
        updateDialogRun(run, '正在理解视频内容与时间顺序');
        activeApiCapability = 'chat';
        const summary = await multimodalVideoUnderstand({
          apiUrl: chatApiUrl,
          apiKey: chatApiKey,
          model: chatModel,
          endpoint: chatProvider.chatEndpoint,
          userText,
          videos: sampledVideos
        });
        activeApiCapability = '';
        assertDialogRunActive(run);
        pushDialogMessage('assistant', summary, [], {taskKind: 'video-understand'});
        host.dialogEditAttachments = [];
        host.dialogEditInput = '';
        finishDialogRun(run);
        saveProject();
        renderDialogEditWorkbench();
        finishDialogKeyLeases(null);
        return;
      } catch (err) {
        if (err?.code === 'DIALOG_RUN_CANCELLED') throw err;
        finishDialogRun(run);
        finishDialogKeyLeases(err, 'chat');
        toast(host.codexCli?.ok ? '多模态视频理解未完成，已转交 Codex 深度处理' : '多模态视频理解未完成', 'warn');
        await runLocalTask({userText, attachments: currentAttachments, alreadyRecorded: true});
        return;
      }
    }
    if (runKind === 'codex') {
      finishDialogRun(run);
      finishDialogKeyLeases(null);
      await runLocalTask({userText, attachments: currentAttachments, alreadyRecorded: true});
      return;
    }
    if (runKind === 'chat') {
      updateDialogRun(run, '正在生成文字回复');
      activeApiCapability = 'chat';
      const reply = await dialogTextChatReply({
        apiUrl: chatApiUrl,
        apiKey: chatApiKey,
        model: chatModel,
        endpoint: chatProvider.chatEndpoint,
        userText
      });
      activeApiCapability = '';
      assertDialogRunActive(run);
      pushDialogMessage('assistant', reply);
      host.dialogEditAttachments = [];
      host.dialogEditActiveNodeId = '';
      host.dialogEditInput = '';
      finishDialogRun(run);
      saveProject();
      renderDialogEditWorkbench();
      finishDialogKeyLeases(null);
      return;
    }
    if (runKind === 'understand') {
      updateDialogRun(run, '正在理解参考图片');
      activeApiCapability = 'chat';
      const summary = await multimodalImageUnderstand({
        apiUrl: chatApiUrl,
        apiKey: chatApiKey,
        model: chatModel,
        endpoint: chatProvider.chatEndpoint,
        images: refUrls,
        prompt: [assistantSystemPrompt(), '请分析当前图片和参考图，输出主体、风格、构图、光线、色彩、可改动点和可复用提示词。'].filter(Boolean).join('\n\n')
      });
      activeApiCapability = '';
      assertDialogRunActive(run);
      pushDialogMessage('assistant', summary);
      host.dialogEditAttachments = [];
      host.dialogEditActiveNodeId = '';
      finishDialogRun(run);
      saveProject();
      renderDialogEditWorkbench();
      finishDialogKeyLeases(null);
      return;
    }
    updateDialogRun(run, '正在优化图片提示词');
    activeApiCapability = 'chat';
    optimizedPrompt = await optimizeDialogImagePrompt({
      apiUrl: chatApiUrl,
      apiKey: chatApiKey,
      model: chatModel,
      provider: chatProvider,
      rawPrompt: taskContext,
      fallbackPrompt: displayBrief
    });
    activeApiCapability = '';
    assertDialogRunActive(run);
    const finalImageSize = imageSizeFromDialogPrompt(userText, '');
    const requestSize = apiCompatibleImageSize(finalImageSize);
    const shouldUseReferenceEdit = refUrls.length > 0;
    const imageRequestPrompt = applyModelAgnosticGenerationRules(optimizedPrompt, 'image');
    updateDialogRun(run, shouldUseReferenceEdit ? '正在根据参考图生成图片' : '正在生成图片');
    activeApiCapability = 'image';
    const result = shouldUseReferenceEdit
      ? await imageEditWithFallback({apiUrl: imageApiUrl, apiKey: imageApiKey, provider: imageProvider, model: imageModel, prompt: imageRequestPrompt, size: requestSize, quality: 'auto', refUrls, onFallback: text => setDialogEditStatus(text)})
      : await imageGenerateRequest({apiUrl: imageApiUrl, apiKey: imageApiKey, provider: imageProvider, model: imageModel, prompt: imageRequestPrompt, size: requestSize, quality: 'auto'});
    activeApiCapability = '';
    assertDialogRunActive(run);
    updateDialogRun(run, '正在保存生成结果');
    const persisted = await persistGeneratedImageResult(result, `dialog_edit_${Date.now()}`, 'png');
    assertDialogRunActive(run);
    const version = {url: persisted, name: `版本 ${host.dialogEditVersions.length + 1}`, prompt: optimizedPrompt, time: Date.now(), size: requestSize};
    host.dialogEditVersions = [version, ...host.dialogEditVersions].slice(0, 12);
    pushDialogMessage('assistant', `图片已生成。\n\n优化后的提示词：\n${optimizedPrompt}\n\n你可以继续追加细节，或编辑这条提示词后重新生成。`, [{name: version.name, url: persisted}], {generationPrompt: optimizedPrompt, taskKind: 'image'});
    host.dialogEditAttachments = [];
    host.dialogEditActiveNodeId = '';
    host.dialogEditInput = '';
    finishDialogRun(run);
    saveProject();
    renderDialogEditWorkbench();
    drawEdges();
    finishDialogKeyLeases(null);
    toast('对话图像任务完成', 'success');
  } catch (err) {
    finishDialogKeyLeases(err, activeApiCapability);
    finishDialogRun(run);
    if (err?.code === 'DIALOG_RUN_CANCELLED') return;
    // Only image runs get the image-provider diagnosis; local/chat failures must not be reported as 生图 errors.
    const isImageRun = runKind === 'image' || activeApiCapability === 'image';
    const msg = isImageRun
      ? formatImageGenerationError(err, {providerName: imageProvider?.name, model: imageModel, refCount: refUrls.length})
      : (err?.message || String(err));
    pushDialogMessage('assistant', (isImageRun ? '生成失败：\n' : '任务失败：\n') + msg);
    saveProject();
    renderDialogEditWorkbench();
    toast(msg, 'error');
  }
}

function setDialogEditStatus(text) {
  if (dialogRunIsActive(host.dialogRun)) return updateDialogRun(host.dialogRun, text);
  pushDialogMessage('assistant', text);
  saveProject();
  renderDialogEditWorkbench();
}
    return {
      dialogEditTargetNode,
      dialogExplicitTargetNode,
      ensureDialogEditState,
      dialogEditReferenceItems,
      dialogExplicitReferenceItems,
      dialogLatestGeneratedImageRef,
      dialogShouldUseLatestContextImage,
      dialogGenerationReferenceUrls,
      dialogEditModeLabel,
      dialogMessageRunKind,
      fallbackDialogRunPlan,
      isPromptWritingRequest,
      isLocalFileTaskRequest,
      isCodexTaskRequest,
      planDialogRunWithTextModel,
      parseFirstJsonObject,
      dialogReferenceIntent,
      dialogReferenceInstructions,
      dialogReferenceDisplayItems,
      pushDialogMessage,
      dialogAttachmentStripHtml,
      dialogMessageAttachmentHtml,
      startDialogRun,
      dialogRunIsActive,
      assertDialogRunActive,
      updateDialogRun,
      finishDialogRun,
      resetDialogRun,
      stopDialogRun,
      dialogRunningCardHtml,
      codexStepRowHtml,
      renderCodexInlineMarkdown,
      renderCodexMessage,
      codexExecutionHtml,
      dialogMessageImportButton,
      dialogMessageDownloadButton,
      dialogMessageText,
      dialogMessageWorkingPrompt,
      dialogMessageAttachments,
      isSeedancePromptText,
      dialogMessageActionButtons,
      beginDialogMessageEdit,
      applyDialogMessageEdit,
      dialogTextChatReply,
      dialogSubjectFramingConstraints,
      buildDialogImageBrief,
      buildDialogImageTaskContext,
      buildDialogEditPrompt,
      openDialogEditWorkbench,
      closeDialogEditWorkbench,
      renderDialogEditWorkbench,
      scrollDialogThreadToBottom,
      onDialogEditWorkbenchClick,
      downloadDialogMessageAttachment,
      importDialogMessageToCanvas,
      onDialogEditWorkbenchInput,
      handleDialogEditUploads,
      buildCodexAssistantPrompt,
      isVideoUnderstandingRequest,
      isExplicitImageExecutionRequest,
      hydrateDialogTextAttachments,
      runDialogCodexAssistant,
      stopDialogCodexRun,
      runDialogEditGeneration,
      setDialogEditStatus
    };
  }

  window.FutureAIDialogRuntime = { create };
})();
