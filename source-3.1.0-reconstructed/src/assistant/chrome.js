(() => {
  'use strict';

  /**
   * 灵枢万象 chrome: topics, profiles, skills, codex console / schedules.
   * Dialog thread generation lives in assistant/dialog-runtime.js.
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    const wait = deps.wait;
    const saveProject = deps.saveProject;
    const saveSettings = deps.saveSettings;
    const getStore = deps.getStore;
    const setStore = deps.setStore;
    const setActiveWorkspace = deps.setActiveWorkspace;
    const openDialogEditWorkbench = deps.openDialogEditWorkbench;
    const closeDialogEditWorkbench = deps.closeDialogEditWorkbench;
    const renderDialogEditWorkbench = deps.renderDialogEditWorkbench;
    const resetDialogRun = deps.resetDialogRun;
    const globalProviderForKind = deps.globalProviderForKind;
    const providerApiKey = deps.providerApiKey;
    const reportProviderKeyResult = deps.reportProviderKeyResult;
    const unique = deps.unique;
    const openModal = deps.openModal;
    const serialize = deps.serialize;
    const nodeDisplayTitle = deps.nodeDisplayTitle;
    const drawEdges = deps.drawEdges;
    const ensurePromptWorkbenchState = deps.ensurePromptWorkbenchState;
    const validAssistantContextMode = deps.validAssistantContextMode;
    const activeAssistantProfile = deps.activeAssistantProfile;
    const assistantSystemPrompt = deps.assistantSystemPrompt;
    const API_TIMEOUTS = deps.API_TIMEOUTS;
    const fetchJsonWithRetry = deps.fetchJsonWithRetry;
    const AssistantTopics = deps.AssistantTopics || window.FutureAIAssistantTopics;
    const ensureAssistantProfiles = deps.ensureAssistantProfiles;
    const createAssistantProject = deps.createAssistantProject;
    const ensureDialogEditState = deps.ensureDialogEditState;
    const getActivePromptTopic = deps.getActivePromptTopic;
    const providerModelsForKind = deps.providerModelsForKind;
    const modelsForKind = deps.modelsForKind;
    const fillSelect = deps.fillSelect;
    const syncAssistantContextModeControls = deps.syncAssistantContextModeControls;
    const dialogRunIsActive = deps.dialogRunIsActive;
    const updateDialogRun = deps.updateDialogRun;
    const finishDialogRun = deps.finishDialogRun;
    const pushDialogMessage = deps.pushDialogMessage;
    const ensureApiProviders = deps.ensureApiProviders;
    const viewCenter = deps.viewCenter;
    const addNode = deps.addNode;
    const connectSilently = deps.connectSilently;
    const renderAll = deps.renderAll;
    const openDirectorDesk = deps.openDirectorDesk;
    const renameProject = deps.renameProject;
    const loadProject = deps.loadProject;
    const buildCodexAssistantPrompt = deps.buildCodexAssistantPrompt;
    const chooseStorageDir = deps.chooseStorageDir;
    const openSettings = deps.openSettings;
    const providerOptionsForKind = deps.providerOptionsForKind;
    const dialogEditWorkbench = $('dialogEditWorkbench');
    const codexScheduleSessions = new Map();
    const codexProjectTreeExpanded = new Set();
    let skillLibrarySearch = '';
    let skillMarketSearch = '';
    let skillMarketResults = [];
    let skillMarketStatus = '未搜索';
    let sharedCodexSkills = [];
    let sharedCodexPlugins = [];

function renderAssistantWorkspace() {
  if (host.assistantActiveTab !== 'dialog') host.assistantActiveTab = 'dialog';
  ensureAssistantProfiles();
  ensurePromptWorkbenchState();
  renderAssistantChrome();
  renderAgentConsole();
  dialogEditWorkbench?.classList.remove('hidden');
  if (host.codexNavView === 'scheduled') {
    renderCodexScheduleWorkspace();
    return;
  }
  if (host.codexNavView === 'skills') {
    renderCodexSkillWorkspace();
    return;
  }
  if (host.codexNavView === 'plugins') {
    renderCodexPluginWorkspace();
    return;
  }
  ensureDialogEditState();
  renderDialogEditWorkbench();
}

function renderAssistantChrome() {
  ensureAssistantProfiles();
  ensurePromptWorkbenchState();
  const profile = activeAssistantProfile();
  const topic = getActivePromptTopic();
  const profileList = $('assistantProfileList');
  if (profileList) profileList.innerHTML = assistantProfileListHtml();
  const skillLibrary = $('assistantSkillLibrary');
  if (skillLibrary) skillLibrary.innerHTML = assistantSkillLibraryHtml();
  const topicList = $('assistantTopicList');
  if (topicList) topicList.innerHTML = assistantTopicRailHtml();
  const unfiledList = $('assistantUnfiledTaskList');
  if (unfiledList) unfiledList.innerHTML = assistantUnfiledTaskHtml();
  document.querySelectorAll('[data-codex-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.codexView === host.codexNavView);
  });
  const scheduleCount = $('codexScheduleCount');
  if (scheduleCount) scheduleCount.textContent = String(host.codexSchedules.filter(item => item.enabled).length);
  const breadcrumb = $('assistantBreadcrumb');
  if (breadcrumb) {
    const trail = host.codexNavView === 'scheduled' ? '已安排' : (host.codexNavView === 'skills' ? '技能库' : (host.codexNavView === 'plugins' ? '插件' : topic?.name || '当前任务'));
    breadcrumb.innerHTML = `<i class="fa-solid fa-terminal"></i><strong>∞ 灵枢万象</strong><i class="fa-solid fa-chevron-right"></i><span>${esc(trail)}</span>`;
  }
  const chatProvider = globalProviderForKind('chat');
  const globalChatModel = chatProvider?.chatModel || $('chatModel')?.value || '';
  const chatModels = unique([globalChatModel, ...providerModelsForKind(chatProvider, 'chat'), ...modelsForKind(host.importedModels || [], 'chat')]).filter(Boolean);
  const selectedChatModel = chatModels.includes(profile?.model) && profile?.model === globalChatModel ? profile.model : globalChatModel;
  fillSelect($('assistantModelSelect'), chatModels, selectedChatModel);
  syncAssistantContextModeControls();
  renderCodexDesktopContext();
  renderAgentConsole();
}

function renderCodexDesktopContext() {
  const summary = agentProjectSummary();
  const provider = globalProviderForKind('chat');
  const model = provider?.chatModel || $('chatModel')?.value || '未选择';
  const runtime = $('assistantRuntimeInfo');
  if (runtime) runtime.innerHTML = `
    <div><i class="fa-regular fa-folder"></i><span title="${esc(host.storageDir || '未选择工作目录')}">${esc(host.storageDir || '未选择工作目录')}</span></div>
    <div><i class="fa-solid fa-microchip"></i><span>${esc(provider?.name || '未选择供应商')} / ${esc(model)}</span></div>
    <div><i class="fa-solid fa-shield-halved"></i><span>${esc(({readonly: '只读审查', project: '项目内开发', full: '完全开发'})[host.codexPermission] || '项目内开发')}</span></div>`;
  const project = $('assistantProjectContext');
  if (project) project.innerHTML = `
    <div class="codex-context-project-name">${esc(summary.projectName)}</div>
    <div class="codex-context-stat"><span>节点</span><strong>${summary.nodeCount}</strong></div>
    <div class="codex-context-stat"><span>素材</span><strong>${summary.assetCount}</strong></div>
    <div class="codex-context-stat"><span>历史</span><strong>${summary.historyCount}</strong></div>
    <p>${summary.selectedCount ? `已选中：${esc(summary.selectedNames.join('、'))}` : '未选中画布节点'}</p>`;
}

function agentProjectSummary() {
  const selected = [...(host.selectedNodes || [])].map(id => host.nodes.get(id)).filter(Boolean);
  const counts = [...host.nodes.values()].reduce((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});
  const emptyPrompts = [...host.nodes.values()].filter(node => ['prompt', 'image', 'video', 'character'].includes(node.type) && !String(node.data?.prompt || '').trim()).length;
  const mediaReady = [...host.nodes.values()].filter(node => node.data?.url || (Array.isArray(node.data?.urls) && node.data.urls.length)).length;
  const selectedNames = selected.map(node => nodeDisplayTitle(node)).slice(0, 4);
  return {
    projectName: host.projects.find(item => item.id === host.currentProjectId)?.name || $('projectTitle')?.textContent || '未命名项目',
    nodeCount: host.nodes.size,
    edgeCount: host.edges?.length || 0,
    selectedCount: selected.length,
    selectedNames,
    counts,
    assetCount: host.assetLibrary?.length || 0,
    historyCount: host.history?.length || 0,
    mediaReady,
    emptyPrompts,
    activeAgent: activeAssistantProfile()?.name || '默认助手',
    activeTopic: activePromptTopic()?.name || '未命名话题'
  };
}

function renderAgentConsole() {
  const el = $('agentConsole');
  if (!el) return;
  if (document.body.classList.contains('workspace-assistant')) {
    el.innerHTML = '';
    return;
  }
  const permissionOptions = [
    ['readonly', '只读审查'],
    ['project', '项目内开发'],
    ...(host.appReleaseChannel === 'internal' ? [['full', '完全开发']] : [])
  ].map(([value, label]) => `<option value="${value}" ${host.codexPermission === value ? 'selected' : ''}>${label}</option>`).join('');
  const codexPermissionLabel = ({readonly: '只读审查', project: '项目内开发', full: '完全开发'})[host.codexPermission] || '项目内开发';
  const codexOpen = host.codexExpanded;
  const codexActions = `
    <button type="button" data-codex-action="check"><i class="fa-solid fa-circle-check"></i>检测</button>
    ${host.appReleaseChannel === 'internal' ? `<button type="button" data-codex-action="choose"><i class="fa-solid fa-folder-open"></i>程序</button><button type="button" data-codex-action="update" ${host.codexUpdating || host.codexRunning ? 'disabled' : ''}><i class="fa-solid fa-rotate"></i>更新</button>` : ''}
    <button type="button" data-codex-action="run" ${host.codexRunning || host.codexUpdating ? 'disabled' : ''}><i class="fa-solid fa-play"></i>运行</button>
    <button type="button" data-codex-action="stop" ${host.codexRunning || host.codexUpdating ? '' : 'disabled'}><i class="fa-solid fa-stop"></i>停止</button>
    <button type="button" data-codex-action="toggle"><i class="fa-solid ${codexOpen ? 'fa-chevron-up' : 'fa-terminal'}"></i>${codexOpen ? '收起' : '控制台'}</button>`;
  const codexPanel = codexOpen ? `
    <div class="codex-console is-open">
      <div class="codex-command-line">程序：${host.appReleaseChannel === 'stable' ? '软件内置 Codex' : (host.codexCommand ? esc(host.codexCommand) : '使用手动选择的 Codex；未选择时优先使用软件内置 Codex')}</div>
      <div class="codex-api-line">联网/API：安装后可联网调用；运行时自动使用设置里的文本 API、密钥和聊天模型。</div>
      <label class="codex-permission-line"><span>开发权限</span><select id="codexPermissionSelect">${permissionOptions}</select></label>
      <textarea id="codexPromptInput" class="codex-prompt" placeholder="把要交给本地 Codex 的任务写在这里。">${esc(host.codexPromptDraft)}</textarea>
      <pre id="codexOutputBox" class="codex-output">${esc(host.codexOutput)}</pre>
    </div>` : '';
  el.innerHTML = `
    <div class="agent-console-head">
      <div><strong>本地 Codex</strong><span>${esc(host.codexStatus)} · ${esc(codexPermissionLabel)}</span></div>
      <div class="agent-console-path">${host.storageDir ? esc(host.storageDir) : '未选择本地存储目录'}</div>
      <div class="agent-console-actions">${codexActions}</div>
    </div>
    ${codexPanel}`;
}

function appendAgentMessage(content) {
  ensureDialogEditState();
  host.dialogEditMessages.push({role: 'assistant', content});
  saveActiveTopicDialogState();
  saveProject();
  renderDialogEditWorkbench();
}

function appendCodexOutput(text) {
  host.codexOutput = `${host.codexOutput || ''}${text || ''}`.slice(-60000);
  const box = $('codexOutputBox');
  if (box) {
    box.textContent = host.codexOutput;
    box.scrollTop = box.scrollHeight;
  }
}

function codexFailureMessage(errorText = '') {
  const text = String(errorText || '');
  if (/\b401\b|unauthorized|missing bearer/i.test(text)) return 'Codex 调用失败：供应商拒绝了密钥（HTTP 401）。请在设置中检查全局聊天供应商的 API 地址和密钥。';
  if (/\b403\b|forbidden/i.test(text)) return 'Codex 调用失败：供应商拒绝访问（HTTP 403）。请检查该密钥是否有此模型的调用权限。';
  if (/timeout|timed out|network|fetch failed|connect/i.test(text)) return 'Codex 调用失败：无法连接到当前供应商。请检查 API 地址、网络和中转站状态。';
  return 'Codex 调用失败。请在设置中检查全局聊天供应商、模型和密钥。';
}

function installCodexOutputHandler() {
  if (!window.codexBridge?.onOutput) return;
  window.codexBridge.onOutput(payload => {
    if (!payload) return;
    const scheduleSession = codexScheduleSessions.get(payload.sessionId);
    if (scheduleSession) {
      const schedule = host.codexSchedules.find(item => item.id === scheduleSession.scheduleId);
      if (payload.type === 'result' && payload.text) scheduleSession.output = `${scheduleSession.output}${payload.text}`.slice(-60000);
      if ((payload.type === 'stderr' || payload.type === 'error') && payload.text) scheduleSession.error = `${scheduleSession.error}${payload.text}`.slice(-12000);
      if (payload.type === 'close' || payload.type === 'error') {
        if (schedule) {
          schedule.lastStatus = payload.type === 'error' ? '运行失败' : '已完成';
          schedule.lastResult = (scheduleSession.output || scheduleSession.error || '任务已结束。').slice(-4000);
          saveProject();
          if (host.codexNavView === 'scheduled') renderCodexScheduleWorkspace();
        }
        codexScheduleSessions.delete(payload.sessionId);
      }
      return;
    }
    if (!host.codexSessionId && (host.codexRunning || host.codexUpdating) && payload.sessionId) host.codexSessionId = payload.sessionId;
    if (payload.sessionId !== host.codexSessionId) return;
    if (host.codexDialogRun && dialogRunIsActive(host.codexDialogRun) && payload.type === 'activity' && payload.text) {
      updateDialogRun(host.codexDialogRun, payload.text);
    }
    if (host.codexDialogRun && payload.type === 'result' && payload.text) {
      host.codexDialogRun.output = `${host.codexDialogRun.output || ''}${payload.text}`.slice(-60000);
    }
    if (host.codexDialogRun && (payload.type === 'stderr' || payload.type === 'error') && payload.text) {
      host.codexDialogRun.error = `${host.codexDialogRun.error || ''}${payload.text}`.slice(-12000);
    }
    if (payload.type === 'close' || payload.type === 'error') {
      const wasUpdating = host.codexUpdating;
      host.codexRunning = false;
      host.codexUpdating = false;
      host.codexStatus = payload.type === 'error' ? (wasUpdating ? '更新失败' : '运行失败') : (wasUpdating ? '更新完成' : '任务结束');
      if (host.codexDialogRun) {
        const run = host.codexDialogRun;
        const finalText = String(run.output || '').trim();
        const failureText = String(run.error || '').trim();
        const steps = [...run.steps];
        host.codexDialogRun = null;
        if (dialogRunIsActive(run)) {
          finishDialogRun(run);
          pushDialogMessage('assistant', finalText || (failureText ? codexFailureMessage(failureText) : (payload.type === 'error' ? 'Codex 运行失败。' : 'Codex 任务结束。')), [], {steps});
          saveProject();
          renderDialogEditWorkbench();
        }
      }
      renderAgentConsole();
    }
    appendCodexOutput(payload.text || '');
  });
}

async function runCodexConsoleAction(action) {
  if (!window.codexBridge) return toast('当前应用环境不支持本地 Codex', 'warn');
  if (action === 'toggle') {
    host.codexExpanded = !host.codexExpanded;
    renderAgentConsole();
    return;
  }
  if (action === 'check') {
    host.codexExpanded = true;
    host.codexPromptDraft = $('codexPromptInput')?.value || host.codexPromptDraft;
    host.codexPermission = $('codexPermissionSelect')?.value || host.codexPermission;
    host.codexStatus = '检测中';
    host.codexOutput = '正在检测本地 Codex...\n';
    renderAgentConsole();
    try {
      const result = await window.codexBridge.check({ command: host.codexCommand });
      host.codexStatus = result?.ok ? '可用' : '不可用';
      host.codexOutput += result?.ok ? `检测成功：${result.output || 'Codex 已响应'}\n` : `检测失败：${result?.error || result?.output || '无法启动 Codex CLI'}\n`;
      renderAgentConsole();
      toast(result?.ok ? '本地 Codex 可用' : '本地 Codex 暂不可用', result?.ok ? 'success' : 'warn');
    } catch (err) {
      host.codexStatus = '不可用';
      host.codexOutput += `检测失败：${err.message || err}\n`;
      renderAgentConsole();
    }
    return;
  }
  if (action === 'choose') {
    host.codexExpanded = true;
    host.codexPromptDraft = $('codexPromptInput')?.value || host.codexPromptDraft;
    host.codexPermission = $('codexPermissionSelect')?.value || host.codexPermission;
    const picked = await window.codexBridge.chooseCommand?.();
    if (picked) {
      host.codexCommand = picked;
      const settings = getStore(host.STORE.settings, {});
      setStore(host.STORE.settings, { ...settings, codexCommand: host.codexCommand, codexPermission: host.codexPermission });
      host.codexStatus = '已选择程序';
      host.codexOutput = `已选择：${picked}\n请点击检测确认是否可用。\n`;
      renderAgentConsole();
    }
    return;
  }
  if (action === 'update') {
    host.codexExpanded = true;
    host.codexPromptDraft = $('codexPromptInput')?.value || host.codexPromptDraft;
    host.codexPermission = $('codexPermissionSelect')?.value || host.codexPermission;
    host.codexOutput = '正在联网更新内置 Codex...\n';
    host.codexStatus = '更新中';
    host.codexUpdating = true;
    renderAgentConsole();
    try {
      const result = await window.codexBridge.update?.({ command: host.codexCommand });
      host.codexSessionId = result?.sessionId || '';
      if (result?.backupFile) appendCodexOutput(`已备份旧版：${result.backupFile}\n`);
      const settings = getStore(host.STORE.settings, {});
      setStore(host.STORE.settings, { ...settings, codexLastAutoUpdateAt: Date.now() });
    } catch (err) {
      host.codexUpdating = false;
      host.codexStatus = '更新失败';
      host.codexOutput += `更新失败：${err.message || err}\n`;
      renderAgentConsole();
    }
    return;
  }
  if (action === 'run') {
    host.codexExpanded = true;
    const prompt = $('codexPromptInput')?.value?.trim() || '';
    host.codexPromptDraft = prompt;
    host.codexPermission = $('codexPermissionSelect')?.value || host.codexPermission;
    if (!prompt) return toast('请先输入任务', 'warn');
    if (!host.storageDir) return toast('请先选择本地存储目录，Codex 会在该目录内工作', 'warn');
    host.codexOutput = `任务：${prompt}\n\n`;
    host.codexStatus = '运行中';
    host.codexRunning = true;
    renderAgentConsole();
    try {
      const apiConfig = await codexApiConfig();
      const result = await window.codexBridge.run({ prompt, storageDir: host.storageDir, command: host.codexCommand, permission: host.codexPermission, ...apiConfig });
      host.codexSessionId = result?.sessionId || '';
    } catch (err) {
      host.codexRunning = false;
      host.codexStatus = '启动失败';
      host.codexOutput += `启动失败：${err.message || err}\n`;
      renderAgentConsole();
    }
    return;
  }
  if (action === 'stop') {
    if (host.codexSessionId) await window.codexBridge.cancel(host.codexSessionId);
    host.codexRunning = false;
    host.codexUpdating = false;
    host.codexStatus = '已停止';
    appendCodexOutput('\n已请求停止。\n');
    renderAgentConsole();
  }
}

function scheduleCodexAutoUpdate() {
  if (!window.codexBridge?.update) return;
  const settings = getStore(host.STORE.settings, {});
  const last = Number(settings.codexLastAutoUpdateAt || 0);
  const oneDay = 24 * 60 * 60 * 1000;
  if (Date.now() - last < oneDay) return;
  setTimeout(async () => {
    if (host.codexRunning || host.codexUpdating) return;
    host.codexUpdating = true;
    host.codexStatus = '自动更新中';
    host.codexOutput = '正在联网自动更新内置 Codex...\n';
    renderAgentConsole();
    try {
      const result = await window.codexBridge.update({ command: host.codexCommand });
      host.codexSessionId = result?.sessionId || '';
      setStore(host.STORE.settings, { ...getStore(host.STORE.settings, {}), codexLastAutoUpdateAt: Date.now() });
    } catch (err) {
      host.codexUpdating = false;
      host.codexStatus = '自动更新失败';
      host.codexOutput += `自动更新失败：${err.message || err}\n`;
      setStore(host.STORE.settings, { ...getStore(host.STORE.settings, {}), codexLastAutoUpdateAt: Date.now() });
      renderAgentConsole();
    }
  }, 12000);
}

async function codexApiConfig() {
  ensureApiProviders();
  const provider = globalProviderForKind('chat');
  const baseUrl = provider.apiUrl || $('apiUrl')?.value.trim().replace(/\/$/, '') || '';
  const model = provider.chatModel || $('chatModel')?.value.trim() || '';
  const apiKey = await providerApiKey(provider, 'chat', model);
  if (!apiKey || !baseUrl) {
    if (apiKey) reportProviderKeyResult?.(provider, 'chat', {releaseOnly: true});
    toast('Codex 未接到完整 API：请先在设置里保存文本 API 和密钥', 'warn');
  }
  const settings = getStore(host.STORE.settings, {});
  const sharedPluginIds = Array.isArray(settings.codexSharedPluginIds) ? settings.codexSharedPluginIds : sharedCodexPlugins.map(plugin => plugin.id);
  return { apiKey, baseUrl, model, providerName: provider.name || '', useSharedExtensions: settings.codexSharedExtensions !== false, sharedPluginIds };
}

function agentProjectDiagnosisText() {
  const s = agentProjectSummary();
  const lines = [`项目体检：${s.projectName}`, `节点：${s.nodeCount} 个，连线：${s.edgeCount} 条，资产：${s.assetCount} 个，历史：${s.historyCount} 条。`];
  if (s.selectedCount) lines.push(`当前选中：${s.selectedNames.join('、')}。`);
  if (!s.nodeCount) lines.push('建议先创建故事大纲、角色设定、关键帧和视频节点。');
  if (s.emptyPrompts) lines.push(`有 ${s.emptyPrompts} 个节点缺少提示词，优先补齐镜头目标、主体动作、场景和运镜。`);
  if (!s.edgeCount && s.nodeCount > 1) lines.push('建议把脚本/角色节点连接到图片和视频节点，让上下文能自动传递。');
  if (!s.assetCount) lines.push('建议把常用角色图、场景图、导演台截图加入资产库，后续拖拽复用。');
  lines.push('可执行下一步：用 Seedance 2 导演整理一个 5 秒镜头，生成关键帧，再接视频节点测试。');
  return lines.join('\n');
}

function agentNextPlanText() {
  return [
    '下一步执行计划：',
    '1. 选定一个镜头目标：主体、动作、场景、情绪和时长。',
    '2. 用 Seedance 2 导演输出镜头提示词，明确平滑运镜和负向避免。',
    '3. 创建关键帧图片节点，保持角色和场景稳定。',
    '4. 把关键帧接到视频节点，生成 5 秒测试镜头。',
    '5. 把满意结果加入资产库，再进入导演台做机位和关键帧预演。'
  ].join('\n');
}

async function runAgentConsoleAction(action) {
  if (action === 'analyze') {
    appendAgentMessage(agentProjectDiagnosisText());
    return;
  }
  if (action === 'plan') {
    appendAgentMessage(agentNextPlanText());
    return;
  }
  if (action === 'seedance') {
    const profile = activeAssistantProfile();
    if (profile) {
      const skills = new Set(Array.isArray(profile.skills) ? profile.skills : []);
      skills.add('seedance2-director');
      profile.skills = [...skills];
    }
    saveProject();
    renderAssistantWorkspace();
    toast('已为当前助手启用 Seedance 2 导演技能', 'success');
    return;
  }
  if (action === 'seedance-node') {
    const c = viewCenter();
    const prompt = addNode('prompt', c.x - 520, c.y - 120, {
      title: 'Seedance 2 镜头指令',
      prompt: '镜头目标：\nSeedance 2 正向提示词：\n镜头运动：平滑推进/跟拍/环绕，速度稳定，不跳切。\n主体一致性：保持角色身份、服装、脸部特征和空间方向。\n负向避免：主体漂移、脸部变形、服装变化、镜头突然跳切、运动过快、画面闪烁、文字、水印。',
      tags: ['Seedance 2', '导演', '镜头']
    }, null, false);
    const video = addNode('video', c.x - 80, c.y - 140, {
      title: 'Seedance 2 视频',
      prompt: '使用左侧 Seedance 2 镜头指令生成 5 秒测试镜头。',
      model: $('videoModel')?.value || 'seedance',
      duration: '5',
      size: '1280x720',
      tags: ['Seedance 2', '视频']
    }, null, false);
    connectSilently(prompt.id, 'text', video.id, 'prompt');
    saveProject();
    setActiveWorkspace('canvas');
    renderAll();
    toast('已创建 Seedance 2 镜头节点组', 'success');
    return;
  }
  if (action === 'director') {
    openDirectorDesk();
  }
}
async function onAssistantWorkbenchClick(e) {
  if (e.target.closest('[data-assistant-action="add-project"]')) {
    await createAssistantProject();
    return;
  }
  const projectNewTopicId = e.target.closest('[data-codex-project-new-topic]')?.dataset.codexProjectNewTopic;
  if (projectNewTopicId) {
    if (projectNewTopicId !== host.currentProjectId) switchCodexProject(projectNewTopicId);
    createAssistantTopic({standalone: false});
    return;
  }
  const projectRenameId = e.target.closest('[data-codex-project-rename]')?.dataset.codexProjectRename;
  if (projectRenameId) {
    await renameProject(projectRenameId);
    renderAssistantWorkspace();
    return;
  }
  const renameTopicButton = e.target.closest('[data-assistant-topic-rename]');
  if (renameTopicButton) {
    const projectId = renameTopicButton.dataset.assistantTopicProject || host.currentProjectId;
    if (projectId !== host.currentProjectId) switchCodexProject(projectId);
    await renameAssistantTopic(renameTopicButton.dataset.assistantTopicRename);
    return;
  }
  const deleteTopicButton = e.target.closest('[data-assistant-topic-delete]');
  if (deleteTopicButton) {
    e.preventDefault();
    e.stopPropagation();
    const projectId = deleteTopicButton.dataset.assistantTopicProject || host.currentProjectId;
    if (projectId !== host.currentProjectId) switchCodexProject(projectId);
    await deleteAssistantTopic(deleteTopicButton.dataset.assistantTopicDelete);
    return;
  }
  const navView = e.target.closest('[data-codex-view]')?.dataset.codexView;
  if (navView) {
    host.codexNavView = navView;
    renderAssistantWorkspace();
    return;
  }
  const projectToggleId = e.target.closest('[data-codex-project-toggle]')?.dataset.codexProjectToggle;
  if (projectToggleId) {
    if (codexProjectTreeExpanded.has(projectToggleId)) codexProjectTreeExpanded.delete(projectToggleId);
    else codexProjectTreeExpanded.add(projectToggleId);
    renderAssistantChrome();
    return;
  }
  const projectTopic = e.target.closest('[data-codex-project-topic]');
  if (projectTopic) {
    const projectId = projectTopic.dataset.codexProjectTopic;
    const topicId = projectTopic.dataset.assistantTopic;
    if (projectId !== host.currentProjectId) switchCodexProject(projectId);
    saveActiveTopicDialogState();
    host.promptWorkbenchActiveId = topicId;
    host.codexNavView = 'tasks';
    loadActiveTopicDialogState();
    saveProject();
    renderAssistantWorkspace();
    return;
  }
  const scheduleAction = e.target.closest('[data-codex-schedule-action]')?.dataset.codexScheduleAction;
  if (scheduleAction) {
    await handleCodexScheduleAction(scheduleAction, e.target.closest('[data-codex-schedule-id]')?.dataset.codexScheduleId);
    return;
  }
  if (e.target.closest('[data-codex-plugin-open]')) {
    openAssistantSkillLibrary();
    return;
  }
  if (e.target.closest('[data-codex-extensions-refresh]')) {
    await loadSharedCodexExtensions();
    renderAssistantWorkspace();
    toast('技能与插件已刷新', 'success');
    return;
  }
  const codexAction = e.target.closest('[data-codex-action]')?.dataset.codexAction;
  if (codexAction) {
    await runCodexConsoleAction(codexAction);
    return;
  }
  const agentAction = e.target.closest('[data-agent-action]')?.dataset.agentAction;
  if (agentAction) {
    await runAgentConsoleAction(agentAction);
    return;
  }
  const skillToggle = e.target.closest('[data-skill-library-toggle]');
  if (skillToggle) {
    toggleAssistantSkill(skillToggle.dataset.skillLibraryToggle, skillToggle.checked);
    return;
  }
  if (e.target.closest('[data-skill-library-open]')) {
    openAssistantSkillLibrary();
    return;
  }
  const deleteProfileId = e.target.closest('[data-assistant-delete]')?.dataset.assistantDelete;
  if (deleteProfileId) {
    e.preventDefault();
    e.stopPropagation();
    await deleteAssistantProfile(deleteProfileId);
    return;
  }
  const settingsId = e.target.closest('[data-assistant-settings]')?.dataset.assistantSettings;
  if (settingsId) {
    e.preventDefault();
    e.stopPropagation();
    host.assistantActiveId = settingsId;
    renderAssistantChrome();
    renderAssistantProfileSettings(settingsId);
    return;
  }
  const profileBtn = e.target.closest('[data-assistant-profile]');
  if (profileBtn) {
    host.assistantActiveId = profileBtn.dataset.assistantProfile;
    saveProject();
    renderAssistantWorkspace();
    return;
  }
  const topicBtn = e.target.closest('[data-assistant-topic]');
  if (topicBtn) {
    saveActiveTopicDialogState();
    host.promptWorkbenchActiveId = topicBtn.dataset.assistantTopic;
    host.codexNavView = 'tasks';
    loadActiveTopicDialogState();
    saveProject();
    renderAssistantChrome();
    renderDialogEditWorkbench();
    return;
  }
  const addProfile = e.target.closest('[data-assistant-action="add-profile"]');
  if (addProfile) {
    const next = AssistantTopics.newAssistantProfile({defaultModel: globalProviderForKind('chat')?.chatModel || $('chatModel')?.value || ''});
    host.assistantProfiles = [next, ...host.assistantProfiles];
    host.assistantActiveId = next.id;
    saveProject();
    renderAssistantWorkspace();
    renderAssistantProfileSettings(next.id);
    return;
  }
  const addTopic = e.target.closest('[data-assistant-action="add-topic"], .assistant-topic-new');
  if (addTopic) {
    createAssistantTopic();
  }
}

async function onAssistantWorkbenchDoubleClick(e) {
  if (e.target.closest('button')) return;
  const topicRow = e.target.closest('[data-assistant-topic]');
  if (topicRow) {
    const projectId = topicRow.dataset.codexProjectTopic || host.currentProjectId;
    if (projectId !== host.currentProjectId) switchCodexProject(projectId);
    await renameAssistantTopic(topicRow.dataset.assistantTopic);
    return;
  }
  const projectRow = e.target.closest('[data-codex-project-toggle]');
  if (projectRow) {
    await renameProject(projectRow.dataset.codexProjectToggle);
    renderAssistantWorkspace();
  }
}

function createAssistantTopic({standalone = true} = {}) {
  const next = AssistantTopics.newAssistantTopic({index: host.promptTopics.length + 1});
  next.standalone = !!standalone;
  saveActiveTopicDialogState();
  host.promptTopics.unshift(next);
  host.promptWorkbenchActiveId = next.id;
  host.codexNavView = 'tasks';
  loadActiveTopicDialogState();
  resetDialogRun();
  saveProject();
  renderAssistantWorkspace();
  focusDialogComposer();
  toast(standalone ? '已新建任务' : '已在项目中创建对话', 'success');
}

function ensureDialogComposerEditable(event) {
  const input = event.target?.closest?.('[data-dialog-field="input"]');
  if (!input) return;
  input.disabled = false;
  input.readOnly = false;
  input.removeAttribute('aria-disabled');
  requestAnimationFrame(() => input.focus({preventScroll: true}));
}

function focusDialogComposer() {
  requestAnimationFrame(() => {
    const input = $('dialogEditWorkbenchPanel')?.querySelector('[data-dialog-field="input"]');
    if (!input) return;
    input.disabled = false;
    input.readOnly = false;
    input.removeAttribute('aria-disabled');
    input.focus({preventScroll: true});
  });
}

async function renameAssistantTopic(id) {
  ensurePromptWorkbenchState();
  const topic = host.promptTopics.find(item => item.id === id);
  if (!topic) return;
  const name = await openModal({title: '重命名对话', value: topic.name || '未命名对话', okText: '保存'});
  if (name === null) return;
  topic.name = String(name).trim() || '未命名对话';
  saveProject();
  renderAssistantWorkspace();
  toast('对话名称已保存', 'success');
}

async function deleteAssistantProfile(id) {
  ensureAssistantProfiles();
  const index = host.assistantProfiles.findIndex(profile => profile.id === id);
  if (index < 0) return;
  if (host.assistantProfiles.length <= 1) {
    toast('至少保留一个助手', 'warn');
    return;
  }
  const profile = host.assistantProfiles[index];
  const confirmed = await openModal({title: '删除助手', text: `确认删除「${profile.name || '默认助手'}」？`, okText: '删除', confirm: true});
  if (!confirmed) return;
  host.assistantProfiles = host.assistantProfiles.filter(item => item.id !== id);
  if (host.assistantActiveId === id) {
    host.assistantActiveId = host.assistantProfiles[Math.min(index, host.assistantProfiles.length - 1)]?.id || host.assistantProfiles[0]?.id || '';
  }
  const modal = $('assistantProfileModal');
  if (modal?.dataset.profileId === id) modal.remove();
  saveProject();
  renderAssistantWorkspace();
  toast('已删除助手', 'success');
}

async function deleteAssistantTopic(id) {
  ensurePromptWorkbenchState();
  const index = host.promptTopics.findIndex(topic => topic.id === id);
  if (index < 0) return;
  const topic = host.promptTopics[index];
  const confirmed = await openModal({title: '删除对话', text: `确认删除「${topic.name || '未命名对话'}」？对话记录会一起删除。`, okText: '删除', confirm: true});
  if (!confirmed) return;
  const wasActive = host.promptWorkbenchActiveId === id;
  if (wasActive) saveActiveTopicDialogState();
  host.promptTopics = host.promptTopics.filter(item => item.id !== id);
  if (!host.promptTopics.length) {
    const next = AssistantTopics.newAssistantTopic({index: 1});
    host.promptTopics = [next];
    host.promptWorkbenchActiveId = next.id;
    loadActiveTopicDialogState();
  } else if (wasActive) {
    host.promptWorkbenchActiveId = host.promptTopics[Math.min(index, host.promptTopics.length - 1)]?.id || host.promptTopics[0]?.id || '';
    loadActiveTopicDialogState();
  }
  saveProject();
  renderAssistantWorkspace();
  toast('已删除对话', 'success');
}

async function clearCurrentDialogConversation() {
  const confirmed = await openModal({title: '清空当前对话', text: '参考图、生成版本和正在编辑的内容都会清空。确认继续吗？', okText: '清空', confirm: true});
  if (!confirmed) return;
  const blank = blankDialogTopicState('当前对话已清空，可以重新开始。');
  host.dialogEditMessages = blank.messages;
  host.dialogEditAttachments = [];
  host.dialogEditVersions = [];
  host.dialogEditInput = '';
  host.dialogEditActiveNodeId = '';
  host.dialogEditMode = 'generate';
  host.dialogEditEditingIndex = -1;
  resetDialogRun();
  saveActiveTopicDialogState();
  saveProject();
  renderAssistantWorkspace();
  toast('已清空当前对话', 'success');
}

function renderAssistantProfileSettings(profileId = host.assistantActiveId) {
  ensureAssistantProfiles();
  const profile = host.assistantProfiles.find(item => item.id === profileId) || activeAssistantProfile();
  if (!profile) return;
  let modal = $('assistantProfileModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'assistantProfileModal';
    modal.className = 'assistant-profile-modal hidden';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-assistant-settings-close]')) {
        modal.classList.add('hidden');
      }
    });
    modal.addEventListener('input', e => {
      const field = e.target.closest('[data-assistant-profile-field]')?.dataset.assistantProfileField;
      if (!field) return;
      const current = profileFromSettingsModal();
      if (!current) return;
      current[field] = e.target.value;
      saveProject();
      renderAssistantChrome();
    });
    modal.addEventListener('change', e => {
      const skillToggle = e.target.closest('[data-assistant-skill]');
      if (skillToggle) {
        const current = profileFromSettingsModal();
        if (!current) return;
        const skills = new Set(Array.isArray(current.skills) ? current.skills : []);
        if (skillToggle.checked) skills.add(skillToggle.dataset.assistantSkill);
        else skills.delete(skillToggle.dataset.assistantSkill);
        current.skills = [...skills];
        saveProject();
        renderAssistantChrome();
        return;
      }
      const field = e.target.closest('[data-assistant-profile-field]')?.dataset.assistantProfileField;
      if (!field) return;
      const current = profileFromSettingsModal();
      if (!current) return;
      current[field] = e.target.value;
      if (field === 'model') $('chatModel').value = e.target.value;
      saveSettings();
      saveProject();
      renderAssistantChrome();
    });
  }
  modal.dataset.profileId = profile.id;
  const imported = host.importedModels || [];
  const chatModels = unique([profile.model, $('chatModel')?.value, ...imported.filter(m => /gpt|chat|claude|gemini|qwen|deepseek|kimi/i.test(m)), ...imported]).filter(Boolean);
  const skills = AssistantTopics.assistantSkills ? AssistantTopics.assistantSkills() : [];
  const enabledSkills = new Set(Array.isArray(profile.skills) ? profile.skills : []);
  const skillHtml = skills.length ? skills.map(skill => `
    <label class="assistant-skill-toggle">
      <input type="checkbox" data-assistant-skill="${esc(skill.id)}" ${enabledSkills.has(skill.id) ? 'checked' : ''}>
      <span><strong>${esc(skill.name)}</strong><small>${esc(skill.description || '')}</small></span>
    </label>
  `).join('') : '<div class="assistant-skill-empty">暂无可用技能</div>';
  modal.innerHTML = `
    <div class="assistant-profile-card">
      <header>
        <strong>${esc(profile.name || '助手设置')}</strong>
        <button class="icon-btn" data-assistant-settings-close type="button"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <div class="assistant-profile-settings">
        <nav>
          <button class="active" type="button">提示词设置</button>
          <button type="button">模型设置</button>
          <button type="button">知识库设置</button>
          <button type="button">常用短语</button>
          <button type="button">全局记忆</button>
        </nav>
        <main>
          <label>名称<input data-assistant-profile-field="name" value="${esc(profile.name || '')}"></label>
          <label>图标<input data-assistant-profile-field="icon" value="${esc(profile.icon || '😊')}" maxlength="4"></label>
          <label>默认模型<select data-assistant-profile-field="model">${chatModels.map(model => `<option value="${esc(model)}" ${model === profile.model ? 'selected' : ''}>${esc(model)}</option>`).join('')}</select></label>
          <section class="assistant-skill-section"><div><strong>技能</strong><span>像 Codex skills 一样叠加到当前助手，不再单独占一个工作台。</span></div>${skillHtml}</section>
          <label>提示词<textarea data-assistant-profile-field="systemPrompt" placeholder="设置该助手的前置提示词、性格、工作方式和输出要求...">${esc(profile.systemPrompt || '')}</textarea></label>
          <label>负向提示词<textarea data-assistant-profile-field="negativePrompt" placeholder="可填写不希望出现的风格、元素、质量问题...">${esc(profile.negativePrompt || '')}</textarea></label>
          <div class="assistant-profile-foot">
            <span>Tokens: ${String(profile.systemPrompt || '').length + String(profile.negativePrompt || '').length}</span>
            <button class="primary-btn" data-assistant-settings-close type="button"><i class="fa-regular fa-pen-to-square"></i> 保存</button>
          </div>
        </main>
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

function profileFromSettingsModal() {
  const id = $('assistantProfileModal')?.dataset.profileId || host.assistantActiveId;
  return host.assistantProfiles.find(item => item.id === id) || null;
}

function installedSkillCatalog() {
  return getStore(host.STORE.settings, {}).installedAssistantSkills || [];
}

function syncInstalledSkillCatalog() {
  if (!AssistantTopics.setAssistantSkillCatalog) return;
  const selectedIds = getStore(host.STORE.settings, {}).codexSharedSkillIds;
  const sharedSkills = Array.isArray(selectedIds)
    ? sharedCodexSkills.filter(skill => selectedIds.includes(skill.id))
    : sharedCodexSkills;
  const catalog = new Map();
  [...installedSkillCatalog(), ...sharedSkills].forEach(skill => {
    if (skill?.id && !catalog.has(skill.id)) catalog.set(skill.id, skill);
  });
  AssistantTopics.setAssistantSkillCatalog([...catalog.values()]);
}

async function loadSharedCodexExtensions() {
  if (!window.codexBridge?.extensions) return;
  try {
    const catalog = await window.codexBridge.extensions();
    sharedCodexSkills = Array.isArray(catalog?.skills) ? catalog.skills : [];
    sharedCodexPlugins = Array.isArray(catalog?.plugins) ? catalog.plugins : [];
    host.sharedCodexHome = String(catalog?.root || '');
    syncInstalledSkillCatalog();
  } catch (err) {
    sharedCodexSkills = [];
    sharedCodexPlugins = [];
    host.sharedCodexHome = '';
    console.warn('shared Codex extensions unavailable', err);
  }
}

function saveInstalledSkillCatalog(skills) {
  const settings = getStore(host.STORE.settings, {});
  setStore(host.STORE.settings, { ...settings, installedAssistantSkills: skills });
  syncInstalledSkillCatalog();
}

function normalizeDownloadedSkill(skill = {}) {
  const id = String(skill.id || '').replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80);
  const name = String(skill.name || '社区技能').trim().slice(0, 40);
  const description = String(skill.description || '').trim().slice(0, 180);
  const prompt = String(skill.prompt || '').trim().slice(0, 6000);
  if (!id || !name || !prompt) return null;
  return { id, name, description, prompt, source: String(skill.source || '').slice(0, 400), originalName: String(skill.originalName || '').slice(0, 100), originalDescription: String(skill.originalDescription || '').slice(0, 220), tags: Array.isArray(skill.tags) ? skill.tags.slice(0, 6) : [], installedAt: Date.now() };
}

function installMarketSkill(skill) {
  const normalized = normalizeDownloadedSkill(skill);
  if (!normalized) return toast('技能内容不完整，无法下载', 'warn');
  const installed = installedSkillCatalog().filter(item => item.id !== normalized.id);
  saveInstalledSkillCatalog([normalized, ...installed]);
  renderAssistantChrome();
  renderAssistantSkillLibraryModal();
  toast('技能已下载到本地技能库', 'success');
}

function uninstallMarketSkill(skillId) {
  if (!skillId) return;
  saveInstalledSkillCatalog(installedSkillCatalog().filter(skill => skill.id !== skillId));
  host.assistantProfiles.forEach(profile => {
    if (Array.isArray(profile.skills)) profile.skills = profile.skills.filter(id => id !== skillId);
  });
  saveProject();
  renderAssistantChrome();
  renderAssistantSkillLibraryModal();
  toast('技能已移除', 'success');
}

async function searchSkillMarket(query = skillMarketSearch) {
  skillMarketSearch = query;
  skillMarketStatus = '搜索中';
  renderAssistantSkillLibraryModal();
  try {
    const result = await window.skillMarketBridge?.search({ query });
    skillMarketResults = Array.isArray(result?.skills) ? result.skills : [];
    const remoteCount = Number(result?.remoteCount || 0);
    const localCount = Number(result?.localCount || 0);
    const diag = Array.isArray(result?.diagnostics) && result.diagnostics.length ? ` · ${result.diagnostics.slice(-2).join(' / ')}` : '';
    skillMarketStatus = remoteCount ? `已联网搜索：远程 ${remoteCount}，精选 ${localCount}` : `仅显示精选：远程未命中${diag}`;
  } catch (err) {
    skillMarketStatus = '搜索失败';
    skillMarketResults = [];
    toast('技能市场搜索失败：\n' + (err.message || err), 'warn');
  }
  renderAssistantSkillLibraryModal();
}

function assistantSkillLibraryHtml() {
  const profile = activeAssistantProfile();
  const skills = AssistantTopics.assistantSkills ? AssistantTopics.assistantSkills() : [];
  const enabled = new Set(Array.isArray(profile?.skills) ? profile.skills : []);
  const enabledCount = [...enabled].filter(id => skills.some(skill => skill.id === id)).length;
  return `
    <button class="skill-library-trigger" data-skill-library-open type="button">
      <span><i class="fa-solid fa-layer-group"></i><strong>技能库</strong></span>
      <small>${enabledCount}/${skills.length}</small>
    </button>`;
}

function toggleAssistantSkill(skillId, enabled) {
  const profile = activeAssistantProfile();
  if (!profile || !skillId) return;
  const skills = new Set(Array.isArray(profile.skills) ? profile.skills : []);
  if (enabled) skills.add(skillId);
  else skills.delete(skillId);
  profile.skills = [...skills];
  saveProject();
  renderAssistantChrome();
  renderDialogEditWorkbench();
  toast(enabled ? '技能已启用' : '技能已关闭', 'success');
}

function openAssistantSkillLibrary() {
  renderAssistantSkillLibraryModal();
  if (!skillMarketResults.length && skillMarketStatus === '未搜索') searchSkillMarket('');
}

function closeAssistantSkillLibrary() {
  $('assistantSkillLibraryModal')?.classList.add('hidden');
}

function renderAssistantSkillLibraryModal() {
  let modal = $('assistantSkillLibraryModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'assistantSkillLibraryModal';
    modal.className = 'skill-library-modal hidden';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-skill-library-close]')) closeAssistantSkillLibrary();
      const toggle = e.target.closest('[data-skill-library-toggle]');
      if (toggle) {
        toggleAssistantSkill(toggle.dataset.skillLibraryToggle, toggle.checked);
        renderAssistantSkillLibraryModal();
      }
      const install = e.target.closest('[data-skill-market-install]');
      if (install) {
        e.preventDefault();
        e.stopPropagation();
        installMarketSkill(skillMarketResults.find(skill => skill.id === install.dataset.skillMarketInstall));
      }
      const remove = e.target.closest('[data-skill-market-remove]');
      if (remove) {
        e.preventDefault();
        e.stopPropagation();
        uninstallMarketSkill(remove.dataset.skillMarketRemove);
      }
      if (e.target.closest('[data-skill-market-search]')) {
        e.preventDefault();
        searchSkillMarket(skillMarketSearch);
      }
    });
    modal.addEventListener('input', e => {
      if (e.target?.id === 'skillLibrarySearch') {
        skillLibrarySearch = e.target.value;
        renderAssistantSkillLibraryModal();
      }
      if (e.target?.id === 'skillMarketSearch') skillMarketSearch = e.target.value;
    });
    modal.addEventListener('keydown', e => {
      if (e.target?.id === 'skillMarketSearch' && e.key === 'Enter') searchSkillMarket(skillMarketSearch);
    });
  }
  const profile = activeAssistantProfile();
  const enabled = new Set(Array.isArray(profile?.skills) ? profile.skills : []);
  const query = skillLibrarySearch.trim().toLowerCase();
  const skills = (AssistantTopics.assistantSkills ? AssistantTopics.assistantSkills() : []).filter(skill => !query || `${skill.name} ${skill.description}`.toLowerCase().includes(query));
  const installedIds = new Set(installedSkillCatalog().map(skill => skill.id));
  modal.innerHTML = `
    <section class="skill-library-card">
      <header><div><strong>技能库</strong><span>启用已安装技能，或从市场下载新技能</span></div><button class="icon-btn" data-skill-library-close type="button"><i class="fa-solid fa-xmark"></i></button></header>
      <div class="skill-library-search"><i class="fa-solid fa-magnifying-glass"></i><input id="skillLibrarySearch" value="${esc(skillLibrarySearch)}" placeholder="搜索技能"></div>
      <div class="skill-library-modal-list installed-skills">
        ${skills.map(skill => `
          <label class="skill-library-modal-item ${enabled.has(skill.id) ? 'active' : ''}">
            <input type="checkbox" data-skill-library-toggle="${esc(skill.id)}" ${enabled.has(skill.id) ? 'checked' : ''}>
            <span><strong>${esc(skill.name)}</strong><small>${esc(skill.description || '')}</small>${skill.originalName ? `<small>原名：${esc(skill.originalName)}</small>` : ''}${skill.source ? `<small>来源：${esc(skill.source)}</small>` : ''}</span>
            ${installedIds.has(skill.id) ? `<button class="skill-market-mini" data-skill-market-remove="${esc(skill.id)}" type="button">移除</button>` : ''}
          </label>
        `).join('') || '<div class="skill-library-empty">没有匹配的技能</div>'}
      </div>
      <div class="skill-market-panel">
        <div class="skill-market-head"><div><strong>技能市场</strong><span>${esc(skillMarketStatus)}</span></div><button class="ghost-btn" data-skill-market-search type="button"><i class="fa-solid fa-cloud-arrow-down"></i> 搜索</button></div>
        <div class="skill-market-search"><i class="fa-solid fa-magnifying-glass"></i><input id="skillMarketSearch" value="${esc(skillMarketSearch)}" placeholder="搜索 GitHub / 精选技能，例如：分镜、角色、提示词"></div>
        <div class="skill-market-list">
          ${(skillMarketResults.length ? skillMarketResults : []).map(skill => `
            <article class="skill-market-item ${installedIds.has(skill.id) ? 'installed' : ''}">
              <div><strong>${esc(skill.name)}</strong><small>${esc(skill.description || '')}</small>${skill.originalName ? `<small>原名：${esc(skill.originalName)}</small>` : ''}${skill.installNote ? `<small>${esc(skill.installNote)}</small>` : ''}<em>${esc([skill.source, skill.stars ? `${skill.stars} 星` : ''].filter(Boolean).join(' · '))}</em></div>
              <button class="primary-btn" data-skill-market-install="${esc(skill.id)}" type="button" ${installedIds.has(skill.id) ? 'disabled' : ''}>${installedIds.has(skill.id) ? '已下载' : '下载'}</button>
            </article>
          `).join('') || '<div class="skill-library-empty">点击搜索，自动寻找可用技能</div>'}
        </div>
      </div>
    </section>`;
  modal.classList.remove('hidden');
  const input = $('skillLibrarySearch');
  if (input) {
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

function assistantProfileListHtml() {
  ensureAssistantProfiles();
  return host.assistantProfiles.map(profile => `
    <div class="assistant-profile-item ${profile.id === host.assistantActiveId ? 'active' : ''}" data-assistant-profile="${esc(profile.id)}" role="button" tabindex="0">
      <span class="assistant-avatar">${esc(profile.icon || '😊')}</span>
      <span class="assistant-item-name">${esc(profile.name || '默认助手')}</span>
      <button class="assistant-inline-action" data-assistant-action="settings" data-assistant-settings="${esc(profile.id)}" type="button" title="设置助手" aria-label="设置助手"><i class="fa-solid fa-ellipsis-vertical"></i></button>
      <button class="assistant-inline-action danger" data-assistant-delete="${esc(profile.id)}" type="button" title="删除助手" aria-label="删除助手"><i class="fa-regular fa-trash-can"></i></button>
    </div>`).join('');
}

function assistantTopicRailHtml() {
  ensurePromptWorkbenchState();
  return host.projects.map(project => {
    const isCurrent = project.id === host.currentProjectId;
    const expanded = codexProjectTreeExpanded.has(project.id) || isCurrent;
    const topics = isCurrent ? host.promptTopics : (project.state?.promptWorkbench?.topics || []);
    const projectTopics = topics.filter(topic => !topic?.standalone);
    return `<section class="codex-project-tree ${isCurrent ? 'current' : ''}">
      <div class="codex-project-tree-head" data-codex-project-toggle="${esc(project.id)}" role="button" tabindex="0">
        <i class="fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i><i class="fa-regular fa-folder"></i><span>${esc(project.name || '未命名项目')}</span><em>${projectTopics.length}</em>
        <div class="codex-project-actions">
          <button data-codex-project-new-topic="${esc(project.id)}" type="button" title="在项目中新建对话" aria-label="在项目中新建对话"><i class="fa-solid fa-plus"></i></button>
          <button data-codex-project-rename="${esc(project.id)}" type="button" title="重命名项目" aria-label="重命名项目"><i class="fa-solid fa-pen"></i></button>
        </div>
      </div>
      ${expanded ? `<div class="codex-project-tree-tasks">${projectTopics.map(topic => `
        <div class="assistant-topic-item ${isCurrent && topic.id === host.promptWorkbenchActiveId ? 'active' : ''}" data-codex-project-topic="${esc(project.id)}" data-assistant-topic="${esc(topic.id)}" role="button" tabindex="0">
          <i class="fa-regular fa-message"></i><span class="assistant-item-name">${esc(topic.name || '未命名任务')}</span>
          <button class="assistant-inline-action" data-assistant-topic-rename="${esc(topic.id)}" data-assistant-topic-project="${esc(project.id)}" type="button" title="重命名对话" aria-label="重命名对话"><i class="fa-solid fa-pen"></i></button>
          <button class="assistant-inline-action danger" data-assistant-topic-delete="${esc(topic.id)}" data-assistant-topic-project="${esc(project.id)}" type="button" title="删除对话" aria-label="删除对话"><i class="fa-regular fa-trash-can"></i></button>
        </div>`).join('') || '<div class="codex-tree-empty">没有项目任务</div>'}</div>` : ''}
    </section>`;
  }).join('');
}

function assistantUnfiledTaskHtml() {
  ensurePromptWorkbenchState();
  const tasks = host.promptTopics.filter(topic => topic?.standalone);
  return tasks.map(topic => `
    <div class="assistant-topic-item ${topic.id === host.promptWorkbenchActiveId ? 'active' : ''}" data-assistant-topic="${esc(topic.id)}" role="button" tabindex="0">
      <i class="fa-regular fa-message"></i><span class="assistant-item-name">${esc(topic.name || '未命名任务')}</span>
      <button class="assistant-inline-action" data-assistant-topic-rename="${esc(topic.id)}" type="button" title="重命名任务" aria-label="重命名任务"><i class="fa-solid fa-pen"></i></button>
      <button class="assistant-inline-action danger" data-assistant-topic-delete="${esc(topic.id)}" type="button" title="删除任务" aria-label="删除任务"><i class="fa-regular fa-trash-can"></i></button>
  </div>`).join('') || '<div class="codex-tree-empty">新建任务会显示在这里</div>';
}

function normalizeCodexSchedules(value) {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    const scheduleType = item?.scheduleType === 'interval' ? 'interval' : 'once';
    const intervalMinutes = Math.max(1, Math.min(10080, Number(item?.intervalMinutes) || 60));
    return {
      id: String(item?.id || `codex_schedule_${Date.now()}_${index}`),
      title: String(item?.title || '未命名任务').slice(0, 100),
      prompt: String(item?.prompt || '').slice(0, 12000),
      enabled: item?.enabled === true,
      scheduleType,
      intervalMinutes,
      nextRunAt: Number(item?.nextRunAt) || 0,
      lastRunAt: Number(item?.lastRunAt) || 0,
      lastStatus: String(item?.lastStatus || '未运行').slice(0, 80),
      lastResult: String(item?.lastResult || '').slice(0, 4000)
    };
  });
}

function formatCodexScheduleTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return '未设置';
  return new Date(timestamp).toLocaleString('zh-CN', {hour12: false});
}

function datetimeLocalValue(value) {
  const date = new Date(Number(value) || Date.now() + 5 * 60 * 1000);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function renderCodexScheduleWorkspace() {
  const panel = $('dialogEditWorkbenchPanel');
  if (!panel) return;
  const schedules = normalizeCodexSchedules(host.codexSchedules);
  panel.innerHTML = `<div class="codex-page-shell">
    <header class="codex-page-head"><div><h2>已安排</h2><p>任务只会在开启后、到达指定时间时运行。执行结果会保存到当前项目。</p></div><button class="primary-btn" data-codex-schedule-action="new" type="button"><i class="fa-solid fa-plus"></i> 新建安排</button></header>
    <div class="codex-schedule-list">${schedules.map(schedule => `<article class="codex-schedule-card" data-codex-schedule-id="${esc(schedule.id)}">
      <div class="codex-schedule-card-head"><input data-codex-schedule-field="title" value="${esc(schedule.title)}" aria-label="任务名称"><label class="codex-switch"><input data-codex-schedule-field="enabled" type="checkbox" ${schedule.enabled ? 'checked' : ''}><span>启用</span></label></div>
      <textarea data-codex-schedule-field="prompt" placeholder="描述要交给 Codex 的任务">${esc(schedule.prompt)}</textarea>
      <div class="codex-schedule-fields"><label>运行方式<select data-codex-schedule-field="scheduleType"><option value="once" ${schedule.scheduleType === 'once' ? 'selected' : ''}>单次</option><option value="interval" ${schedule.scheduleType === 'interval' ? 'selected' : ''}>周期</option></select></label><label>下次运行<input data-codex-schedule-field="nextRunAt" type="datetime-local" value="${datetimeLocalValue(schedule.nextRunAt)}"></label><label>间隔（分钟）<input data-codex-schedule-field="intervalMinutes" type="number" min="1" max="10080" value="${schedule.intervalMinutes}"></label></div>
      <div class="codex-schedule-meta"><span>状态：${esc(schedule.lastStatus)}</span><span>上次：${esc(formatCodexScheduleTime(schedule.lastRunAt))}</span><span>下次：${esc(formatCodexScheduleTime(schedule.nextRunAt))}</span></div>
      ${schedule.lastResult ? `<details class="codex-schedule-result"><summary>最近结果</summary><pre>${esc(schedule.lastResult)}</pre></details>` : ''}
      <footer><button class="ghost-btn" data-codex-schedule-action="save" type="button">保存安排</button><button class="ghost-btn" data-codex-schedule-action="run" type="button"><i class="fa-solid fa-play"></i> 立即运行</button><button class="icon-btn danger" data-codex-schedule-action="delete" type="button" title="删除安排"><i class="fa-regular fa-trash-can"></i></button></footer>
    </article>`).join('') || '<div class="codex-page-empty">还没有已安排任务。新建后可指定运行时间或周期。</div>'}</div>
  </div>`;
}

function renderCodexPluginWorkspace() {
  const panel = $('dialogEditWorkbenchPanel');
  if (!panel) return;
  const selectedIds = getStore(host.STORE.settings, {}).codexSharedPluginIds;
  const plugins = sharedCodexPlugins.map(plugin => ({...plugin, selected: !Array.isArray(selectedIds) || selectedIds.includes(plugin.id)}));
  panel.innerHTML = `<div class="codex-page-shell"><header class="codex-page-head"><div><h2>插件</h2><p>已接入本机 Codex 的插件注册。运行时只复用插件与市场，不会覆盖本软件的 API、模型或密钥。</p></div><div class="codex-page-actions"><button class="ghost-btn" data-codex-extensions-refresh type="button"><i class="fa-solid fa-rotate"></i> 刷新</button><button class="primary-btn" data-codex-plugin-open type="button"><i class="fa-solid fa-sliders"></i> 管理启用项</button></div></header><div class="codex-extension-summary"><span><i class="fa-solid fa-plug-circle-bolt"></i> ${plugins.filter(plugin => plugin.selected).length} / ${plugins.length} 个插件已启用</span><small>${esc(host.sharedCodexHome || '未发现本机 Codex 扩展目录')}</small></div><div class="codex-plugin-grid">${plugins.map(plugin => `<article class="${plugin.selected ? 'active' : ''}"><i class="fa-solid fa-puzzle-piece"></i><div><strong>${esc(plugin.name || plugin.id)}</strong><p>${esc(plugin.description || plugin.id)}</p><small>${esc(plugin.id)}</small></div><em>${plugin.selected ? '已启用' : '已关闭'}</em></article>`).join('') || '<div class="codex-page-empty">尚未发现本机 Codex 插件。技能库仍可使用内置与已下载技能。</div>'}</div></div>`;
}

function renderCodexSkillWorkspace() {
  const panel = $('dialogEditWorkbenchPanel');
  if (!panel) return;
  const profile = activeAssistantProfile();
  const enabled = new Set(Array.isArray(profile?.skills) ? profile.skills : []);
  const skills = AssistantTopics.assistantSkills ? AssistantTopics.assistantSkills() : [];
  const featured = skills.filter(skill => enabled.has(skill.id) || !String(skill.id).startsWith('local-codex-')).slice(0, 18);
  panel.innerHTML = `<div class="codex-page-shell"><header class="codex-page-head"><div><h2>技能库</h2><p>本机 Skill 已恢复为当前助手可启用的能力。启用后会随任务上下文一起交给 Codex。</p></div><button class="primary-btn" data-codex-plugin-open type="button"><i class="fa-solid fa-layer-group"></i> 管理技能</button></header><div class="codex-extension-summary"><span><i class="fa-solid fa-wand-magic-sparkles"></i> ${skills.length} 个可用技能</span><small>当前助手已启用 ${enabled.size} 个</small></div><div class="codex-plugin-grid">${featured.map(skill => `<article class="${enabled.has(skill.id) ? 'active' : ''}"><i class="fa-solid fa-wand-magic-sparkles"></i><div><strong>${esc(skill.name)}</strong><p>${esc(skill.description || '本地技能')}</p></div><em>${enabled.has(skill.id) ? '已启用' : '可启用'}</em></article>`).join('') || '<div class="codex-page-empty">没有可用技能</div>'}</div></div>`;
}

function switchCodexProject(projectId) {
  if (!host.projects.some(project => project.id === projectId) || projectId === host.currentProjectId) return;
  saveProject();
  host.currentProjectId = projectId;
  localStorage.setItem(host.STORE.current, projectId);
  loadProject(projectId);
  codexProjectTreeExpanded.add(projectId);
}

async function handleCodexScheduleAction(action, scheduleId) {
  if (action === 'new') {
    host.codexSchedules.unshift({id: `codex_schedule_${Date.now()}_${Math.random().toString(16).slice(2)}`, title: '新的 Codex 任务', prompt: '', enabled: false, scheduleType: 'once', intervalMinutes: 60, nextRunAt: Date.now() + 5 * 60 * 1000, lastRunAt: 0, lastStatus: '未运行', lastResult: ''});
    saveProject();
    renderCodexScheduleWorkspace();
    return;
  }
  const index = host.codexSchedules.findIndex(item => item.id === scheduleId);
  if (index < 0) return;
  if (action === 'delete') {
    const confirmed = await openModal({title: '删除已安排任务', text: '确认删除这个 Codex 任务安排吗？', okText: '删除', confirm: true});
    if (!confirmed) return;
    host.codexSchedules.splice(index, 1);
    saveProject();
    renderAssistantWorkspace();
    return;
  }
  if (action === 'save') {
    const card = document.querySelector(`.codex-schedule-card[data-codex-schedule-id="${CSS.escape(scheduleId)}"]`);
    if (!card) return;
    const field = name => card.querySelector(`[data-codex-schedule-field="${name}"]`);
    const next = host.codexSchedules[index];
    next.title = String(field('title')?.value || '').trim() || '未命名任务';
    next.prompt = String(field('prompt')?.value || '').trim();
    next.enabled = !!field('enabled')?.checked;
    next.scheduleType = field('scheduleType')?.value === 'interval' ? 'interval' : 'once';
    next.intervalMinutes = Math.max(1, Math.min(10080, Number(field('intervalMinutes')?.value) || 60));
    next.nextRunAt = new Date(field('nextRunAt')?.value || '').getTime() || Date.now() + 5 * 60 * 1000;
    saveProject();
    renderAssistantWorkspace();
    toast('已保存安排', 'success');
    return;
  }
  if (action === 'run') await runCodexSchedule(host.codexSchedules[index], true);
}

function startCodexScheduleTimer() {
  clearInterval(host.codexScheduleTimer);
  host.codexScheduleTimer = setInterval(checkDueCodexSchedules, 30000);
  checkDueCodexSchedules();
}

async function checkDueCodexSchedules() {
  if (getStore(host.STORE.settings, {}).codexScheduleAutoRun === false) return;
  const now = Date.now();
  for (const schedule of host.codexSchedules) {
    if (schedule.enabled && schedule.nextRunAt && schedule.nextRunAt <= now && ![...codexScheduleSessions.values()].some(session => session.scheduleId === schedule.id)) await runCodexSchedule(schedule, false);
  }
}

async function runCodexSchedule(schedule, manual = false) {
  if (!window.codexBridge?.run) return toast('当前应用环境不支持本地 Codex', 'warn');
  if (!String(schedule?.prompt || '').trim()) return toast('请先填写已安排任务的内容', 'warn');
  if (!host.storageDir) return toast('请先在灵枢万象设置中选择工作目录', 'warn');
  schedule.lastStatus = '运行中';
  schedule.lastRunAt = Date.now();
  if (schedule.scheduleType === 'once') schedule.enabled = false;
  else schedule.nextRunAt = Date.now() + schedule.intervalMinutes * 60 * 1000;
  saveProject();
  if (host.codexNavView === 'scheduled') renderCodexScheduleWorkspace();
  try {
    const apiConfig = await codexApiConfig();
    const prompt = `【已安排任务】\n${schedule.title}\n\n${buildCodexAssistantPrompt(schedule.prompt)}`;
    const result = await window.codexBridge.run({prompt, storageDir: host.storageDir, command: host.codexCommand, permission: host.codexPermission === 'full' ? 'project' : host.codexPermission, scheduled: true, ...apiConfig});
    if (!result?.sessionId) throw new Error('Codex 没有返回任务会话');
    codexScheduleSessions.set(result.sessionId, {scheduleId: schedule.id, output: '', error: ''});
    if (manual) toast('已开始执行安排任务', 'success');
  } catch (err) {
    schedule.lastStatus = '启动失败';
    schedule.lastResult = err?.message || String(err);
    saveProject();
    if (host.codexNavView === 'scheduled') renderCodexScheduleWorkspace();
    toast(schedule.lastResult, 'error');
  }
}

function openCodexSettings() {
  ensureApiProviders();
  const provider = globalProviderForKind('chat');
  const models = providerModelsForKind(provider, 'chat');
  const extensionSettings = getStore(host.STORE.settings, {});
  const enabledSharedSkillIds = new Set(Array.isArray(extensionSettings.codexSharedSkillIds) ? extensionSettings.codexSharedSkillIds : sharedCodexSkills.map(skill => skill.id));
  const enabledSharedPluginIds = new Set(Array.isArray(extensionSettings.codexSharedPluginIds) ? extensionSettings.codexSharedPluginIds : sharedCodexPlugins.map(plugin => plugin.id));
  let modal = $('codexSettingsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'codexSettingsModal';
    modal.className = 'codex-settings-modal';
    document.body.appendChild(modal);
    modal.addEventListener('click', async event => {
      if (event.target === modal || event.target.closest('[data-codex-settings-close]')) return modal.remove();
      if (event.target.closest('[data-codex-settings-dir]')) return chooseStorageDir().then(openCodexSettings);
      if (event.target.closest('[data-codex-settings-api]')) return openSettings();
      if (!event.target.closest('[data-codex-settings-save]')) return;
      const providerId = $('codexSettingsProvider')?.value || provider.id;
  const selectedProvider = (host.apiProviders || []).find(item => item.id === providerId) || provider;
      const model = String($('codexSettingsModel')?.value || '').trim();
      globalModelProviders.chat = selectedProvider.id;
      selectedProvider.chatModel = model;
      if ($('chatModel')) $('chatModel').value = model;
      host.codexPermission = $('codexSettingsPermission')?.value || 'project';
      host.codexCommand = host.appReleaseChannel === 'stable' ? '' : String($('codexSettingsCommand')?.value || '').trim();
      const previous = getStore(host.STORE.settings, {});
      const enabledSkillIds = [...modal.querySelectorAll('[data-codex-shared-skill]:checked')].map(input => input.value);
      const enabledPluginIds = [...modal.querySelectorAll('[data-codex-shared-plugin]:checked')].map(input => input.value);
      setStore(host.STORE.settings, {...previous, codexScheduleAutoRun: !!$('codexSettingsAutoRun')?.checked, codexSharedExtensions: !!$('codexSettingsSharedExtensions')?.checked, codexSharedSkillIds: enabledSkillIds, codexSharedPluginIds: enabledPluginIds});
      saveSettings();
      syncInstalledSkillCatalog();
      modal.remove();
      renderAssistantChrome();
      toast('灵枢万象设置已保存', 'success');
    });
  }
  const fullPermissionOption = host.appReleaseChannel === 'internal' ? `<option value="full" ${host.codexPermission === 'full' ? 'selected' : ''}>完全开发</option>` : '';
  const commandSetting = host.appReleaseChannel === 'internal' ? `<label>Codex 执行命令<input id="codexSettingsCommand" value="${esc(host.codexCommand)}" placeholder="留空时使用内置 Codex"></label>` : '';
  modal.innerHTML = `<section class="codex-settings-card"><header><div><h2>灵枢万象设置</h2><p>管理灵枢万象的模型与执行环境，不改动画布和媒体设置。</p></div><button class="icon-btn" data-codex-settings-close type="button" title="关闭"><i class="fa-solid fa-xmark"></i></button></header><div class="codex-settings-body"><label>聊天供应商<select id="codexSettingsProvider">${providerOptionsForKind('chat', provider.id)}</select></label><label>调用模型<input id="codexSettingsModel" list="codexSettingsModelList" value="${esc(provider.chatModel || '')}" placeholder="选择或粘贴模型 ID"><datalist id="codexSettingsModelList">${models.map(model => `<option value="${esc(model)}"></option>`).join('')}</datalist></label><label>执行权限<select id="codexSettingsPermission"><option value="readonly" ${host.codexPermission === 'readonly' ? 'selected' : ''}>只读审查</option><option value="project" ${host.codexPermission === 'project' ? 'selected' : ''}>项目内开发</option>${fullPermissionOption}</select></label>${commandSetting}<section class="codex-runtime-card"><header><span><i class="fa-solid fa-laptop-code"></i></span><div><strong>本地执行环境</strong><small>任务只在你选择的目录中运行</small></div></header><div class="codex-settings-dir"><i class="fa-regular fa-folder-open"></i><span title="${esc(host.storageDir || '未选择工作目录')}">${esc(host.storageDir || '未选择工作目录')}</span><button class="ghost-btn" data-codex-settings-dir type="button"><i class="fa-solid fa-folder-tree"></i> 选择目录</button></div><div class="codex-runtime-options"><div class="codex-runtime-option"><div><strong>自动运行已安排任务</strong><small>到达时间后在此目录执行</small></div><label class="codex-switch"><input id="codexSettingsAutoRun" type="checkbox" ${getStore(host.STORE.settings, {}).codexScheduleAutoRun === false ? '' : 'checked'}><span></span></label></div><div class="codex-runtime-option"><div><strong>接入本机 Skill 与插件</strong><small>仅复用扩展，不覆盖当前 API 设置</small></div><label class="codex-switch"><input id="codexSettingsSharedExtensions" type="checkbox" ${getStore(host.STORE.settings, {}).codexSharedExtensions === false ? '' : 'checked'}><span></span></label></div></div></section><div class="codex-settings-api-state"><i class="fa-solid fa-key"></i><span>API 密钥由当前供应商保存和管理。</span><button class="ghost-btn" data-codex-settings-api type="button">管理 API</button></div></div><footer><button class="ghost-btn" data-codex-settings-close type="button">取消</button><button class="primary-btn" data-codex-settings-save type="button">保存</button></footer></section>`;
  const apiState = modal.querySelector('.codex-settings-api-state');
  apiState?.insertAdjacentHTML('beforebegin', `<section class="codex-extension-manager"><header><div><strong>本机 Skill</strong><small>${sharedCodexSkills.length} 个可选，关闭后不会出现在技能库</small></div><em>${enabledSharedSkillIds.size} 已启用</em></header><div class="codex-extension-list">${sharedCodexSkills.map(skill => `<label><input data-codex-shared-skill type="checkbox" value="${esc(skill.id)}" ${enabledSharedSkillIds.has(skill.id) ? 'checked' : ''}><span><strong>${esc(skill.name)}</strong><small>${esc(skill.description || '本机 Skill')}</small></span></label>`).join('') || '<div class="codex-extension-empty">未发现本机 Skill</div>'}</div></section><section class="codex-extension-manager"><header><div><strong>本机插件</strong><small>关闭后不会写入 Codex 本次运行配置</small></div><em>${enabledSharedPluginIds.size} 已启用</em></header><div class="codex-extension-list">${sharedCodexPlugins.map(plugin => `<label><input data-codex-shared-plugin type="checkbox" value="${esc(plugin.id)}" ${enabledSharedPluginIds.has(plugin.id) ? 'checked' : ''}><span><strong>${esc(plugin.name || plugin.id)}</strong><small>${esc(plugin.id)}</small></span></label>`).join('') || '<div class="codex-extension-empty">未发现本机插件</div>'}</div></section>`);
}

function blankDialogTopicState(message = '直接输入画面需求即可生成图片；上传参考图后，也可以继续修改或理解图片。') {
  return AssistantTopics.blankDialogTopicState(message);
}

function dialogTopicState() {
  return AssistantTopics.dialogTopicState({
    messages: Array.isArray(host.dialogEditMessages) ? host.dialogEditMessages : [],
    attachments: Array.isArray(host.dialogEditAttachments) ? host.dialogEditAttachments : [],
    versions: Array.isArray(host.dialogEditVersions) ? host.dialogEditVersions : [],
    input: host.dialogEditInput || '',
    activeNodeId: '',
    mode: host.dialogEditMode || 'edit'
  });
}

function activePromptTopic() {
  ensurePromptWorkbenchState();
  return AssistantTopics.activePromptTopic(host.promptTopics, host.promptWorkbenchActiveId);
}

function saveActiveTopicDialogState() {
  const topic = activePromptTopic();
  if (!topic) return;
  topic.dialogEdit = dialogTopicState();
}

function loadActiveTopicDialogState(fallback = null) {
  resetDialogRun();
  const topic = activePromptTopic();
  const state = topic?.dialogEdit || fallback || blankDialogTopicState();
  host.dialogEditMessages = Array.isArray(state.messages) && state.messages.length ? state.messages : blankDialogTopicState().messages;
  host.dialogEditAttachments = Array.isArray(state.attachments) ? state.attachments : [];
  host.dialogEditVersions = Array.isArray(state.versions) ? state.versions : [];
  host.dialogEditInput = state.input || '';
  host.dialogEditActiveNodeId = '';
  host.dialogEditMode = 'generate';
  host.dialogEditEditingIndex = -1;
  resetDialogRun();
  if (topic) topic.dialogEdit = dialogTopicState();
}
    return {
      renderAssistantWorkspace,
      renderAssistantChrome,
      renderCodexDesktopContext,
      agentProjectSummary,
      renderAgentConsole,
      appendAgentMessage,
      appendCodexOutput,
      codexFailureMessage,
      installCodexOutputHandler,
      runCodexConsoleAction,
      scheduleCodexAutoUpdate,
      codexApiConfig,
      agentProjectDiagnosisText,
      agentNextPlanText,
      runAgentConsoleAction,
      onAssistantWorkbenchClick,
      onAssistantWorkbenchDoubleClick,
      createAssistantTopic,
      ensureDialogComposerEditable,
      focusDialogComposer,
      renameAssistantTopic,
      deleteAssistantProfile,
      deleteAssistantTopic,
      clearCurrentDialogConversation,
      renderAssistantProfileSettings,
      profileFromSettingsModal,
      installedSkillCatalog,
      syncInstalledSkillCatalog,
      loadSharedCodexExtensions,
      saveInstalledSkillCatalog,
      normalizeDownloadedSkill,
      installMarketSkill,
      uninstallMarketSkill,
      searchSkillMarket,
      assistantSkillLibraryHtml,
      toggleAssistantSkill,
      openAssistantSkillLibrary,
      closeAssistantSkillLibrary,
      renderAssistantSkillLibraryModal,
      assistantProfileListHtml,
      assistantTopicRailHtml,
      assistantUnfiledTaskHtml,
      normalizeCodexSchedules,
      formatCodexScheduleTime,
      datetimeLocalValue,
      renderCodexScheduleWorkspace,
      renderCodexPluginWorkspace,
      renderCodexSkillWorkspace,
      switchCodexProject,
      handleCodexScheduleAction,
      startCodexScheduleTimer,
      checkDueCodexSchedules,
      runCodexSchedule,
      openCodexSettings,
      blankDialogTopicState,
      dialogTopicState,
      activePromptTopic,
      saveActiveTopicDialogState,
      loadActiveTopicDialogState
    };
  }

  window.FutureAIAssistantChrome = { create };
})();
