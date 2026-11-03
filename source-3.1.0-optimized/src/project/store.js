(() => {
  'use strict';

  /**
   * Project lifecycle + local/browser store helpers.
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const safeMediaUrl = deps.safeMediaUrl || (value => window.FutureAIMediaUtils?.safeMediaUrl?.(value) || '');
    const toast = deps.toast;
    const wait = deps.wait;
    const unique = deps.unique;
    const openModal = deps.openModal;
    const setActiveWorkspace = deps.setActiveWorkspace;
    const drawEdges = deps.drawEdges;
    const resetView = deps.resetView;
    const fitView = deps.fitView;
    const addNode = deps.addNode;
    const hydrateNode = deps.hydrateNode;
    const clearCanvasSearch = deps.clearCanvasSearch;
    const applyCanvasFilters = deps.applyCanvasFilters;
    const scheduleVisibilityUpdate = deps.scheduleVisibilityUpdate;
    const scheduleTransform = deps.scheduleTransform;
    const scheduleDrawEdges = deps.scheduleDrawEdges;
    const updateZoomLabel = deps.updateZoomLabel;
    const setCanvasProxyActive = deps.setCanvasProxyActive;
    const renderAll = deps.renderAll;
    const renderHistory = deps.renderHistory;
    const renderAssetLibrary = deps.renderAssetLibrary;
    const renderModels = deps.renderModels;
    const renderApiProviders = deps.renderApiProviders;
    const renderMusicPlayer = deps.renderMusicPlayer;
    const renderShortWorkbench = deps.renderShortWorkbench;
    const renderAssistantWorkspace = deps.renderAssistantWorkspace;
    const renderDialogEditWorkbench = deps.renderDialogEditWorkbench;
    const restoreShortWorkbenchState = deps.restoreShortWorkbenchState;
    const normalizeCodexSchedules = deps.normalizeCodexSchedules;
    const dialogTopicState = deps.dialogTopicState;
    const saveActiveTopicDialogState = deps.saveActiveTopicDialogState;
    const loadActiveTopicDialogState = deps.loadActiveTopicDialogState;
    const resetDialogRun = deps.resetDialogRun;
    const shortProductionBrief = deps.shortProductionBrief;
    const normalizeAssetFolders = deps.normalizeAssetFolders;
    const blankDialogTopicState = deps.blankDialogTopicState;
    const globalProviderForKind = deps.globalProviderForKind;
    const connectSilently = deps.connectSilently;
    const setSelectedPort = deps.setSelectedPort;
    const saveSettings = deps.saveSettings;
    const FILE_STORE_BY_KEY = deps.FILE_STORE_BY_KEY || window.FutureAICanvasStorage?.FILE_STORE_BY_KEY || {};
    const compactBrowserStoreValue = deps.compactBrowserStoreValue || window.FutureAICanvasStorage?.compactBrowserStoreValue;
    const shouldUseCompactBrowserStore = deps.shouldUseCompactBrowserStore || window.FutureAICanvasStorage?.shouldUseCompactBrowserStore;
    const isQuotaError = deps.isQuotaError || window.FutureAICanvasStorage?.isQuotaError;
    const AssistantTopics = deps.AssistantTopics || window.FutureAIAssistantTopics;
    const ProjectTemplates = deps.ProjectTemplates || window.FutureAIProjectTemplates;
    const closeHistory = deps.closeHistory;
    const restoreCanvasInteractivity = deps.restoreCanvasInteractivity;
    const normalizeWorkspace = deps.normalizeWorkspace;
    const applyTransform = deps.applyTransform;
    const addGroup = deps.addGroup;
    const refreshAllLinkedInputs = deps.refreshAllLinkedInputs;
    const renderGroups = deps.renderGroups;
    const persistMediaUrl = deps.persistMediaUrl;
    const mediaExtFromDataUrl = deps.mediaExtFromDataUrl;
    const getActiveProjectWork = deps.getActiveProjectWork || (() => '');
    const CanvasNodes = deps.CanvasNodes || window.FutureAICanvasNodes;

function blankProject(name, templateId = selectedProjectTemplateId()) {
  return {id: 'p_' + Date.now() + '_' + Math.random().toString(16).slice(2), name, templateId: selectedProjectTemplateId(templateId), createdAt: Date.now(), updatedAt: Date.now(), state: null};
}
function loadProjects() {
  host.projects = getStore(host.STORE.projects, []);
  host.projects = migrateLegacyProjects(host.projects);
  if (!Array.isArray(host.projects) || !host.projects.length) {
    host.projects = [];
    host.currentProjectId = null;
    clearCanvas();
    try { localStorage.removeItem(host.STORE.current); } catch {}
    return;
  }
  host.currentProjectId = localStorage.getItem(host.STORE.current) || host.projects[0].id;
  if (!host.projects.some(p => p.id === host.currentProjectId)) host.currentProjectId = host.projects[0].id;
  loadProject(host.currentProjectId);
  saveProjects();
}
function migrateLegacyProjects(list) {
  if (!Array.isArray(list)) return [];
  let changed = false;
  const fix = (text, fallback) => {
    const s = String(text ?? '');
    if (!hasMojibake(s)) return s;
    changed = true;
    return fallback;
  };
  const migrated = list.map(project => {
    const p = {...project};
    p.name = fix(p.name, p.name && /新|new/i.test(String(p.name)) ? '新建项目' : '默认项目');
    if (p.state?.nodes) {
      p.state = {...p.state, nodes: p.state.nodes.map(item => {
        const node = {...item, data: {...(item.data || {})}};
        if (typeof node.data.prompt === 'string' && hasMojibake(node.data.prompt)) {
          changed = true;
          node.data.prompt = defaultPromptFor(node.type);
        }
        return node;
      })};
    }
    return p;
  });
  if (changed) setStore(host.STORE.projects, migrated);
  return migrated;
}
function hasMojibake(text) {
  const marks = [0xfffd,0x93c2,0x922d,0x9422,0x6924,0x9365,0x7459,0x9358,0x59af,0x7481,0x93bb,0x5a13,0x699b,0x93c8,0x95c0,0x6748,0x7ef1,0x7ecb,0x66b1,0x68f0,0x20ac,0x951b,0x752f,0x51a8];
  return [...String(text || '')].some(ch => marks.includes(ch.codePointAt(0)));
}
function defaultPromptFor(type) {
  return CanvasNodes.defaultPromptFor(type);
}
function ensureAssistantProfiles() {
  const defaultChatModel = globalProviderForKind('chat')?.chatModel || $('chatModel')?.value || '';
  const next = AssistantTopics.normalizeAssistantProfiles({
    profiles: host.assistantProfiles,
    activeId: host.assistantActiveId,
    defaultModel: defaultChatModel
  });
  host.assistantProfiles = next.profiles;
  host.assistantActiveId = next.activeId;
}
function activeAssistantProfile() {
  ensureAssistantProfiles();
  return AssistantTopics.activeAssistantProfile(host.assistantProfiles, host.assistantActiveId);
}
function assistantSystemPrompt() {
  ensureAssistantProfiles();
  return AssistantTopics.assistantSystemPrompt(host.assistantProfiles, host.assistantActiveId);
}
function validAssistantContextMode(value) {
  return ['auto', 'selected', 'full', 'off'].includes(value) ? value : 'auto';
}
function syncAssistantContextModeControls(sourceId = '') {
  const main = $('assistantContextMode');
  const inline = $('assistantContextModeInline');
  const next = validAssistantContextMode(sourceId === 'assistantContextModeInline' ? inline?.value : main?.value || inline?.value);
  if (main && main.value !== next) main.value = next;
  if (inline && inline.value !== next) inline.value = next;
}
function ensurePromptWorkbenchState() {
  const next = AssistantTopics.ensurePromptTopics({topics: host.promptTopics, activeId: host.promptWorkbenchActiveId});
  host.promptTopics = next.topics;
  host.promptWorkbenchActiveId = next.activeId;
}
function getActivePromptTopic() {
  ensurePromptWorkbenchState();
  return AssistantTopics.activePromptTopic(host.promptTopics, host.promptWorkbenchActiveId);
}
function setSaveStatus(state, text) {
  const status = $('saveStatus');
  if (!status) return;
  status.classList.remove('is-saving', 'is-saved', 'is-error');
  status.classList.add(`is-${state}`);
  const icon = state === 'saving' ? 'fa-arrows-rotate fa-spin' : state === 'error' ? 'fa-triangle-exclamation' : 'fa-check';
  status.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${esc(text)}</span>`;
}
function saveProjects() {
  if (!Array.isArray(host.projects)) host.projects = [];
  const projectsSaved = setStore(host.STORE.projects, host.projects);
  let currentSaved = true;
  try { localStorage.setItem(host.STORE.current, host.currentProjectId || ''); } catch { currentSaved = false; }
  const saved = projectsSaved && currentSaved;
  setSaveStatus(saved ? 'saved' : 'error', saved ? '已保存' : '保存失败');
  return saved;
}
function cloneProjectState(state) {
  if (!state || typeof state !== 'object') return null;
  try { return JSON.parse(JSON.stringify(state)); } catch { return null; }
}
function projectStateSignature(state) {
  try { return JSON.stringify(state || null); } catch { return ''; }
}
function normalizeProjectHistory(project) {
  if (!project) return [];
  const history = Array.isArray(project.history) ? project.history : [];
  return history.filter(item => item?.state && typeof item.state === 'object').slice(-24);
}
function recordProjectVersion(project, nextState) {
  if (!project || host.projectHistoryBusy || !project.state) return;
  const previousSignature = projectStateSignature(project.state);
  const nextSignature = projectStateSignature(nextState);
  if (!previousSignature || previousSignature === nextSignature) return;
  const snapshot = cloneProjectState(project.state);
  if (!snapshot) return;
  const history = normalizeProjectHistory(project);
  const last = history[history.length - 1];
  if (last && projectStateSignature(last.state) === previousSignature) return;
  history.push({
    id: 'v_' + Date.now() + '_' + Math.random().toString(16).slice(2, 6),
    createdAt: Date.now(),
    label: '自动恢复点',
    state: snapshot
  });
  project.history = history.slice(-24);
  host.projectUndoStack = project.history;
  host.projectRedoStack = [];
}
function selectedProjectTemplateId(id = host.selectedProjectTemplate) {
  return ProjectTemplates.selectedProjectTemplateId(id);
}
function resetAssistantStateForNewProject() {
  try {
    host.promptTopics = AssistantTopics?.defaultPromptTopics?.() || [];
    host.promptWorkbenchActiveId = host.promptTopics[0]?.id || '';
    host.assistantActiveTab = 'dialog';
    const defaultModel = globalProviderForKind?.('chat')?.chatModel || $('chatModel')?.value || '';
    host.assistantProfiles = AssistantTopics?.defaultAssistantProfiles?.(defaultModel) || [];
    host.assistantActiveId = host.assistantProfiles[0]?.id || '';
    host.codexSchedules = [];
    const blank = blankDialogTopicState?.('新项目已创建。直接描述想完成的工作。') || {
      messages: [{role: 'assistant', content: '新项目已创建。直接描述想完成的工作。'}],
      attachments: [], versions: [], input: '', activeNodeId: '', mode: 'generate'
    };
    host.dialogEditMessages = blank.messages || [];
    host.dialogEditAttachments = [];
    host.dialogEditVersions = [];
    host.dialogEditInput = '';
    host.dialogEditActiveNodeId = '';
    host.dialogEditMode = 'generate';
    host.dialogEditEditingIndex = -1;
    host.dialogEditRunning = false;
  } catch (err) {
    console.error('[project] resetAssistantStateForNewProject failed', err);
  }
}
async function createProject(openAfter, presetName = '', templateId = selectedProjectTemplateId()) {
  if (blockProjectTransition('新建项目')) return null;
  if (!await ensureStorageReady()) return null;
  try { saveProject(); } catch (err) { console.warn('[project] save before create failed', err); }
  const name = presetName || await openModal({title: '新建项目', value: '新建项目', okText: '创建'});
  if (name === null) return null;
  const chosenTemplate = selectedProjectTemplateId(templateId);
  const p = blankProject(name.trim() || '新建项目', chosenTemplate);
  const prev = Array.isArray(host.projects) ? host.projects : [];
  // Always reassign so host setter + fileStoreCache stay aligned
  host.projects = [p, ...prev.filter(item => item && item.id !== p.id)];
  host.currentProjectId = p.id;
  try { saveProjects(); renderProjects(); } catch (err) { console.error('[project] early persist failed', err); }
  let templateError = null;
  try {
    clearCanvas();
    resetView?.(false);
    resetAssistantStateForNewProject();
    createProjectFromTemplate(chosenTemplate);
  } catch (err) {
    templateError = err;
    console.error('[project] create template failed', err);
  }
  try {
    saveProject();
  } catch (err) {
    console.error('[project] save after create failed', err);
    // Ensure project row still exists even if canvas serialize fails
    const row = host.projects.find(item => item.id === p.id);
    if (row && !row.state) {
      row.state = {
        nodeSeq: host.nodeSeq || 0,
        groupSeq: host.groupSeq || 0,
        scale: host.scale || 1,
        offsetX: host.offsetX ?? 170,
        offsetY: host.offsetY ?? 120,
        templateId: chosenTemplate || 'default',
        edges: Array.isArray(host.edges) ? host.edges : [],
        groups: [],
        nodes: host.nodes && typeof host.nodes.values === 'function'
          ? [...host.nodes.values()].map(n => ({id: n.id, type: n.type, x: n.x, y: n.y, data: n.data || {}}))
          : []
      };
      row.updatedAt = Date.now();
    }
  }
  try { saveProjects(); } catch (err) { console.error('[project] saveProjects failed', err); }
  try { renderAll(); } catch (err) { console.error('[project] renderAll failed', err); try { renderProjects(); } catch {} }
  if (openAfter) {
    try { showApp(); } catch (err) { console.error('[project] showApp failed', err); }
  }
  if (templateError) toast('项目已创建，但默认模板未完全加载：' + (templateError.message || templateError), 'warn');
  else toast('项目已创建', 'success');
  return p;
}

async function createAssistantProject() {
  const project = await createProject(false);
  if (!project) return;
  host.codexProjectTreeExpanded.add(project.id);
  host.activeWorkspace = 'assistant';
  setActiveWorkspace('assistant');
  renderAssistantWorkspace();
}
function enterProject(id) {
  if (!id) return;
  if (id !== host.currentProjectId && blockProjectTransition('切换项目')) return;
  saveProject();
  host.currentProjectId = id;
  localStorage.setItem(host.STORE.current, id);
  loadProject(id);
  renderAll();
  showApp();
}
function showHome() {
  try { saveProject(); } catch (err) { console.warn('[project] save on showHome failed', err); }
  try { renderAll(); } catch (err) { console.error('[project] renderAll on showHome failed', err); try { renderProjects(); } catch {} }
  try { closeHistory?.(); } catch {}
  $('appShell')?.classList.add('hidden');
  $('projectHome')?.classList.remove('hidden');
}
function showApp() {
  $('projectHome').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  setActiveWorkspace(host.activeWorkspace || 'canvas');
  restoreCanvasInteractivity();
  drawEdges();
  requestAnimationFrame(() => {
    drawEdges();
  });
  updateZoomLabel();
  scheduleVisibilityUpdate();
}
function resumeLastProjectOrShowHome() {
  if (hasStorageDir() && host.projects.length && host.currentProjectId) {
    showApp();
    return;
  }
  showHome();
  if (!hasStorageDir()) promptStorageDirRequired();
}
function onProjectGridClick(e) {
  const emptyAction = e.target.closest('[data-empty-action]')?.dataset.emptyAction;
  if (emptyAction === 'storage') return chooseStorageDir();
  if (emptyAction === 'create') return createProject(true);
  const card = e.target.closest('[data-project]');
  if (!card) return;
  const id = card.dataset.project;
  const act = e.target.closest('[data-act]');
  if (!act) return enterProject(id);
  if (act.dataset.act === 'open') enterProject(id);
  if (act.dataset.act === 'rename') renameProject(id);
  if (act.dataset.act === 'delete') deleteProject(id);
}
function onSideProjectClick(e) {
  const row = e.target.closest('[data-project]');
  if (!row) return;
  const act = e.target.closest('[data-act]');
  if (!act) return enterProject(row.dataset.project);
  if (act.dataset.act === 'rename') renameProject(row.dataset.project);
  if (act.dataset.act === 'delete') deleteProject(row.dataset.project);
}
async function renameProject(id) {
  const p = host.projects.find(x => x.id === id);
  if (!p) return;
  const name = await openModal({title: '重命名项目', value: p.name, okText: '保存'});
  if (name === null) return;
  p.name = name.trim() || '未命名项目';
  p.updatedAt = Date.now();
  saveProjects();
  renderAll();
}
async function deleteProject(id) {
  if (host.projects.length <= 1) return toast('至少保留一个项目', 'warn');
  const p = host.projects.find(x => x.id === id);
  if (!p) return;
  if (host.currentProjectId === id && blockProjectTransition('删除当前项目')) return;
  const ok = await openModal({title: '删除项目', text: `确认删除「${p.name}」？`, okText: '删除', confirm: true});
  if (!ok) return;
  if (host.currentProjectId !== id) saveProject();
  host.projects = host.projects.filter(x => x.id !== id);
  if (host.currentProjectId === id) {
    host.currentProjectId = host.projects[0].id;
    loadProject(host.currentProjectId);
  }
  saveProjects();
  renderAll();
}

function blockProjectTransition(action) {
  const active = String(getActiveProjectWork() || '').trim();
  if (!active) return false;
  toast(`${active}正在运行，请完成或取消后再${action}`, 'warn');
  return true;
}

function serialize() {
  saveActiveTopicDialogState();
  return {
    nodeSeq: host.nodeSeq,
    groupSeq: host.groupSeq,
    scale: host.scale,
    offsetX: host.offsetX,
    offsetY: host.offsetY,
    templateId: host.projects.find(x => x.id === host.currentProjectId)?.templateId || 'default',
    promptWorkbench: {
      topics: host.promptTopics.map(topic => topic.id === host.promptWorkbenchActiveId ? {...topic, dialogEdit: dialogTopicState()} : topic),
      activeId: host.promptWorkbenchActiveId,
      codexSchedules: normalizeCodexSchedules(host.codexSchedules),
      workspace: host.activeWorkspace,
      assistantTab: host.assistantActiveTab,
      assistantProfiles: host.assistantProfiles,
      assistantActiveId: host.assistantActiveId
    },
    shortWorkbench: {
      brief: shortProductionBrief(),
      storyApproved: host.shortStoryApproved,
      storyApprovedRevision: host.shortStoryApprovedRevision,
      storyboardItems: host.shortStoryboardItems,
      assetItems: host.shortAssetItems,
      qcItems: host.shortQcItems,
      audioPlan: host.shortAudioPlan,
      timelineItems: host.shortTimelineItems,
      tts: {
        engine: $('shortTtsEngine')?.value || 'relay',
        model: $('shortTtsModel')?.value || 'gpt-4o-mini-tts',
        voice: $('shortTtsVoice')?.value || 'alloy',
        speed: Number($('shortTtsSpeed')?.value || 1),
        endpoint: $('shortTtsEndpoint')?.value || 'http://127.0.0.1:50000/inference_zero_shot',
        promptText: $('shortTtsPromptText')?.value || '',
        referenceUrl: host.shortVoiceReferenceUrl,
        referenceName: host.shortVoiceReferenceName
      },
      storyText: $('shortStoryText')?.value || '',
      ideaText: $('shortIdeaInput')?.value || ''
    },
    dialogEdit: {
      active: host.dialogEditActive,
      activeNodeId: '',
      messages: host.dialogEditMessages,
      attachments: host.dialogEditAttachments,
      versions: host.dialogEditVersions,
      input: host.dialogEditInput,
      mode: host.dialogEditMode
    },
    generationQueue: (Array.isArray(host.generationQueue) ? host.generationQueue : []).map(item => ({
      id: item.id,
      type: item.type || 'image',
      nodeId: item.nodeId,
      title: item.title,
      providerId: item.providerId,
      providerName: item.providerName,
      model: item.model,
      parameters: item.parameters || null,
      status: item.status,
      message: item.message,
      createdAt: item.createdAt,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      attempts: item.attempts,
      diagnosis: item.diagnosis || null
    })),
    edges: host.edges,
    groups: [...host.groups.values()]
      .map(g => ({id: g.id, name: g.name, nodeIds: g.nodeIds.filter(id => host.nodes.has(id)), workflowId: g.workflowId || '', workflowVersion: g.workflowVersion || '', workflowDefinition: g.workflowDefinition || null, collapsed: Boolean(g.collapsed)}))
      .filter(g => g.nodeIds.length > 1),
    nodes: [...host.nodes.values()].map(n => ({id: n.id, type: n.type, x: n.x, y: n.y, data: n.data}))
  };
}
function saveProject() {
  const p = host.projects.find(x => x.id === host.currentProjectId);
  if (!p) return;
  setSaveStatus('saving', '正在保存');
  const nextState = serialize();
  recordProjectVersion(p, nextState);
  p.state = nextState;
  p.updatedAt = Date.now();
  saveProjects();
  renderProjectVersionControls();
}
function projectVersionLabel(item, index) {
  const time = item?.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', {hour12: false}) : ('版本 ' + (index + 1));
  return time + ' · ' + (item?.label || '自动恢复点');
}
function renderProjectVersionControls() {
  const project = host.projects?.find(item => item.id === host.currentProjectId);
  const history = normalizeProjectHistory(project);
  const select = $('projectVersionSelect');
  if (select) {
    select.innerHTML = history.length
      ? history.slice().reverse().map((item, reverseIndex) => {
          const index = history.length - 1 - reverseIndex;
          return '<option value="' + index + '">' + esc(projectVersionLabel(item, index)) + '</option>';
        }).join('')
      : '<option value="">暂无自动恢复点</option>';
    select.disabled = !history.length;
  }
  const undo = $('undoProject');
  const redo = $('redoProject');
  if (undo) undo.disabled = !history.length || host.projectHistoryBusy;
  if (redo) redo.disabled = !Array.isArray(host.projectRedoStack) || !host.projectRedoStack.length || host.projectHistoryBusy;
  const summary = $('projectVersionSummary');
  if (summary) summary.textContent = history.length ? ('已保留 ' + history.length + ' 个自动恢复点') : '尚无自动恢复点';
}
function applyProjectSnapshot(state, message = '项目已恢复') {
  const project = host.projects?.find(item => item.id === host.currentProjectId);
  if (!project || !state) return false;
  host.projectHistoryBusy = true;
  const undoStack = Array.isArray(host.projectUndoStack) ? host.projectUndoStack : [];
  const redoStack = Array.isArray(host.projectRedoStack) ? host.projectRedoStack : [];
  try {
    project.state = cloneProjectState(state);
    project.updatedAt = Date.now();
    loadProject(project.id, {preserveHistory: true});
    host.projectUndoStack = undoStack;
    host.projectRedoStack = redoStack;
    saveProjects();
    renderAll();
    renderProjectVersionControls();
    toast(message, 'success');
    return true;
  } finally {
    host.projectHistoryBusy = false;
    renderProjectVersionControls();
  }
}
function undoProject() {
  const project = host.projects?.find(item => item.id === host.currentProjectId);
  const history = normalizeProjectHistory(project);
  if (!project?.state || !history.length) return toast('还没有可撤销的项目修改', 'warn');
  const current = cloneProjectState(project.state);
  const previous = history[history.length - 1];
  project.history = history.slice(0, -1);
  host.projectUndoStack = project.history;
  host.projectRedoStack = [...(host.projectRedoStack || []), {id: 'redo_' + Date.now(), state: current}].slice(-24);
  return applyProjectSnapshot(previous.state, '已撤销到上一个恢复点');
}
function redoProject() {
  const project = host.projects?.find(item => item.id === host.currentProjectId);
  const redo = Array.isArray(host.projectRedoStack) ? host.projectRedoStack : [];
  if (!project || !redo.length) return toast('没有可重做的项目修改', 'warn');
  const current = cloneProjectState(project.state);
  const next = redo[redo.length - 1];
  host.projectRedoStack = redo.slice(0, -1);
  project.history = [...normalizeProjectHistory(project), {id: 'v_' + Date.now(), createdAt: Date.now(), label: '重做前恢复点', state: current}].slice(-24);
  host.projectUndoStack = project.history;
  return applyProjectSnapshot(next.state, '已重做上一个项目修改');
}
function restoreProjectVersion(index) {
  const project = host.projects?.find(item => item.id === host.currentProjectId);
  const history = normalizeProjectHistory(project);
  const selected = Number(index ?? $('projectVersionSelect')?.value);
  if (!Number.isInteger(selected) || !history[selected]) return toast('请选择一个有效的项目恢复点', 'warn');
  const current = cloneProjectState(project.state);
  const newer = history.slice(selected + 1).map(item => ({id: item.id, state: cloneProjectState(item.state)}));
  host.projectRedoStack = [...newer, {id: 'redo_' + Date.now(), state: current}].filter(item => item.state).slice(-24);
  project.history = history.slice(0, selected);
  host.projectUndoStack = project.history;
  return applyProjectSnapshot(history[selected].state, '已恢复所选项目版本');
}
function queueSave() {
  clearTimeout(host.saveTimer);
  setSaveStatus('saving', '正在保存');
  host.saveTimer = setTimeout(saveProject, 300);
}
function loadProject(id, options = {}) {
  const p = host.projects.find(x => x.id === id);
  if (!options.preserveHistory) {
    host.projectUndoStack = normalizeProjectHistory(p);
    host.projectRedoStack = [];
  }
  clearCanvas();
  clearCanvasSearch(false);
  if (!p || !p.state) {
    host.generationQueue = [];
    host.activeWorkspace = 'canvas';
    resetView(false);
    restoreShortWorkbenchState({});
    createDefaultScene();
    setActiveWorkspace(host.activeWorkspace);
    saveProject();
    return;
  }
  host.nodeSeq = p.state.nodeSeq || 0;
  host.groupSeq = p.state.groupSeq || 0;
  host.scale = p.state.scale || 1;
  host.offsetX = p.state.offsetX ?? 170;
  host.offsetY = p.state.offsetY ?? 120;
  host.promptTopics = p.state.promptWorkbench?.topics || AssistantTopics.defaultPromptTopics();
  host.promptWorkbenchActiveId = p.state.promptWorkbench?.activeId || host.promptTopics[0]?.id || '';
  host.codexSchedules = normalizeCodexSchedules(p.state.promptWorkbench?.codexSchedules);
  host.assistantActiveTab = 'dialog';
  host.assistantProfiles = Array.isArray(p.state.promptWorkbench?.assistantProfiles) ? p.state.promptWorkbench.assistantProfiles : AssistantTopics.defaultAssistantProfiles(globalProviderForKind('chat')?.chatModel || $('chatModel')?.value || '');
  host.assistantActiveId = p.state.promptWorkbench?.assistantActiveId || host.assistantProfiles[0]?.id || '';
  ensureAssistantProfiles();
  host.activeWorkspace = normalizeWorkspace(p.state.promptWorkbench?.workspace || 'canvas');
  restoreShortWorkbenchState(p.state.shortWorkbench || {});
  host.dialogEditActive = !!p.state.dialogEdit?.active;
  host.dialogEditActiveNodeId = '';
  const legacyDialogState = {
    messages: Array.isArray(p.state.dialogEdit?.messages) ? p.state.dialogEdit.messages : [],
    attachments: Array.isArray(p.state.dialogEdit?.attachments) ? p.state.dialogEdit.attachments : [],
    versions: Array.isArray(p.state.dialogEdit?.versions) ? p.state.dialogEdit.versions : [],
    input: p.state.dialogEdit?.input || '',
    activeNodeId: '',
    mode: 'generate'
  };
  const activeTopic = AssistantTopics.activePromptTopic(host.promptTopics, host.promptWorkbenchActiveId);
  if (activeTopic && !activeTopic.dialogEdit) activeTopic.dialogEdit = legacyDialogState;
  loadActiveTopicDialogState(legacyDialogState);
  applyTransform();
  (p.state.nodes || []).forEach(item => addNode(item.type, item.x, item.y, item.data || {}, item.id, false));
  host.generationQueue = (Array.isArray(p.state.generationQueue) ? p.state.generationQueue : [])
    .filter(item => item?.nodeId && host.nodes.has(item.nodeId))
    .map(item => {
      const recovered = {...item};
      if (recovered.status === 'running' || recovered.status === 'queued') {
        recovered.status = 'paused';
        recovered.message = '软件重新打开后待继续';
      }
      return recovered;
    });
  for (const node of host.nodes.values()) {
    if (node.type === 'video' && node.data.videoTask) {
      node.data.status = node.data.status || '已提交的视频任务，可点击“继续查询视频”';
      node.data.statusType = '';
      hydrateNode(node);
    }
  }
  (p.state.groups || []).forEach(item => addGroup(item.nodeIds || [], item.id, item.name || '', false, item));
  host.edges = p.state.edges || [];
  refreshAllLinkedInputs();
  drawEdges();
  renderGroups();
  requestAnimationFrame(drawEdges);
  scheduleVisibilityUpdate();
  applyCanvasFilters();
  renderProjectVersionControls();
}
function clearCanvas() {
  try {
    if (host.nodes && typeof host.nodes.forEach === 'function') {
      host.nodes.forEach(n => { try { n.el?.remove(); } catch {} });
      host.nodes.clear?.();
    }
    if (host.groups && typeof host.groups.forEach === 'function') {
      host.groups.forEach(g => { try { g.el?.remove(); } catch {} });
      host.groups.clear?.();
    }
    host.edges = [];
    host.selectedNodes?.clear?.();
    setSelectedPort?.(null);
    const edgesEl = $('edges');
    if (edgesEl) edgesEl.innerHTML = '';
    $('selectionToolbar')?.classList.add('hidden');
    scheduleVisibilityUpdate?.();
    applyCanvasFilters?.();
  } catch (err) {
    console.error('[project] clearCanvas failed', err);
  }
}
function createDefaultScene() {
  const imageModel = $('imageModel')?.value || 'gpt-image2';
  const videoModel = $('videoModel')?.value || 'omni-flash';
  const img = addNode?.('image', 260, 190, {model: imageModel, size: '1024x1024', prompt: ''}, null, false);
  const video = addNode?.('video', 820, 190, {model: videoModel, size: '1280x720', duration: '5', prompt: ''}, null, false);
  if (img?.id && video?.id) connectSilently?.(img.id, 'image', video.id, 'ref');
}
function createProjectFromTemplate(templateId = 'default') {
  applyProjectTemplate(selectedProjectTemplateId(templateId));
}
function applyProjectTemplate(templateId) {
  if (templateId === 'short-video') return createShortVideoTemplate();
  if (templateId === 'character') return createCharacterTemplate();
  if (templateId === 'image-to-image') return createImageToImageTemplate();
  if (templateId === 'comfyui') return createComfyUITemplate();
  if (templateId === 'storyboard') return createStoryboardTemplate();
  return createDefaultScene();
}
function createShortVideoTemplate() {
  const script = addNode('prompt', 160, 180, {title: '短视频脚本', prompt: '短视频脚本：主题、角色、冲突、结尾反转、旁白节奏。', tags: ['短视频', '脚本']}, null, false);
  const firstFrame = addNode('image', 520, 150, {title: '首帧画面', prompt: '根据脚本生成竖屏短视频首帧，强调主体、情绪和场景。', model: $('imageModel').value, size: '720x1280', tags: ['短视频', '首帧']}, null, false);
  const video = addNode('video', 1080, 170, {title: '视频生成', prompt: '把首帧扩展为连贯短视频，保留角色和镜头连续性。', model: $('videoModel').value, size: '720x1280', duration: '5', tags: ['短视频', '视频']}, null, false);
  connectSilently(script.id, 'text', firstFrame.id, 'prompt');
  connectSilently(firstFrame.id, 'image', video.id, 'ref');
}
function createCharacterTemplate() {
  const character = addNode('character', 170, 180, {title: '角色设定', prompt: '角色姓名、年龄、外貌、服装、性格、口头禅、禁忌元素。', tags: ['角色', '设定'], favorite: true}, null, false);
  const portrait = addNode('image', 560, 160, {title: '角色参考图', prompt: '根据角色设定生成稳定角色参考图，正面半身，清晰服装和面部特征。', model: $('imageModel').value, size: '1024x1536', tags: ['角色', '参考图']}, null, false);
  connectSilently(character.id, 'text', portrait.id, 'prompt');
}
function createImageToImageTemplate() {
  const upload = addNode('upload', 180, 210, {title: '上传参考', name: '参考素材', kind: 'image', tags: ['图生图', '参考']}, null, false);
  const prompt = addNode('prompt', 180, 520, {title: '改图要求', prompt: '保留主体结构，调整风格、背景、光影或细节。', tags: ['图生图', '提示词']}, null, false);
  const image = addNode('image', 620, 210, {title: '图生图结果', prompt: '按照参考图和改图要求生成新图。', model: $('imageModel').value, size: '1024x1024', tags: ['图生图', '输出']}, null, false);
  connectSilently(upload.id, 'media', image.id, 'ref');
  connectSilently(prompt.id, 'text', image.id, 'prompt');
}
function createComfyUITemplate() {
  const prompt = addNode('prompt', 170, 190, {title: 'ComfyUI 正向提示词', prompt: '主体、风格、镜头、光线、质量关键词。', tags: ['ComfyUI', '提示词']}, null, false);
  const comfy = addNode('comfyui', 560, 160, {title: 'ComfyUI 工作流', prompt: '从左侧提示词接入，导入 workflow 后运行本地生成。', workflowName: $('comfyWorkflowName')?.value || '默认工作流', workflowJson: $('comfyWorkflowJson')?.value || '', tags: ['ComfyUI', 'workflow']}, null, false);
  connectSilently(prompt.id, 'text', comfy.id, 'prompt');
}
function createStoryboardTemplate() {
  const story = addNode('prompt', 150, 160, {title: '故事大纲', prompt: '故事大纲：起因、发展、转折、结尾。', tags: ['分镜', '大纲']}, null, false);
  const shot = addNode('prompt', 150, 430, {title: '分镜表', prompt: '分镜表：镜头编号、景别、角色动作、场景、镜头运动、时长。', tags: ['分镜', '镜头']}, null, false);
  const frame = addNode('image', 560, 210, {title: '关键帧', prompt: '根据分镜生成关键帧，保持画面连续性。', model: $('imageModel').value, size: '1280x720', tags: ['分镜', '关键帧']}, null, false);
  const video = addNode('video', 1120, 220, {title: '镜头视频', prompt: '根据分镜和关键帧生成单镜头视频，保持节奏和连续性。', model: $('videoModel').value, size: '1280x720', duration: '5', tags: ['分镜', '视频']}, null, false);
  connectSilently(story.id, 'text', frame.id, 'prompt');
  connectSilently(shot.id, 'text', frame.id, 'prompt');
  connectSilently(shot.id, 'text', video.id, 'prompt');
  connectSilently(frame.id, 'image', video.id, 'ref');
}

function renderProjects() {
  const list = Array.isArray(host.projects) ? host.projects : [];
  const hasCurrentProject = Boolean(host.storageDir && host.currentProjectId && list.some(item => item.id === host.currentProjectId));
  const grid = $('projectGrid');
  const side = $('sideProjects');
  const currentButton = $('homeOpenCurrent');
  if (currentButton) {
    currentButton.disabled = !hasCurrentProject;
    currentButton.setAttribute('aria-disabled', String(!hasCurrentProject));
    currentButton.title = hasCurrentProject ? '进入当前项目' : '请先选择存储位置并创建项目';
  }
  const quickOpen = $('homeQuickOpen');
  if (quickOpen) {
    quickOpen.disabled = !hasCurrentProject;
    quickOpen.setAttribute('aria-disabled', String(!hasCurrentProject));
  }
  if (grid) {
    grid.innerHTML = list.length ? list.map(p => {
      const thumb = projectThumb(p);
      const count = p.state?.nodes?.length || 0;
      return `<article class="project-card" data-project="${p.id}">
      <div class="project-thumb">${thumb ? `<img src="${esc(thumb)}" alt="">` : '<i class="fa-solid fa-crop-simple fa-3x"></i>'}</div>
      <div class="project-body">
        <div class="project-row">
          <div><div class="project-name">${esc(p.name)}</div><div class="project-meta">${count} 个节点 · ${new Date(p.updatedAt || p.createdAt).toLocaleString()}</div></div>
          <div><button data-act="rename" class="icon-btn" type="button" title="重命名项目" aria-label="重命名项目"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button data-act="delete" class="icon-btn" type="button" title="删除项目" aria-label="删除项目"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></div>
        </div>
        <div class="project-actions"><button data-act="open" class="primary-btn">进入画布</button></div>
      </div>
    </article>`;
    }).join('') : `<section class="project-empty-state" aria-label="项目中心为空">
      <strong>可以开始创作了</strong>
      <span>先选本地存储位置，再新建项目或使用模板。</span>
      <div class="gd-action-grid empty-actions">
        <button type="button" class="action-card" data-empty-action="storage"><span class="t">选择存储并开始</span><span class="d">指定本地项目文件夹</span></button>
        <button type="button" class="action-card" data-empty-action="create"><span class="t">新建项目</span><span class="d">从空白或模板开始一部作品</span></button>
      </div>
    </section>`;
  }
  if (side) {
    side.innerHTML = list.length
      ? list.map(p => `<div class="side-project ${p.id === host.currentProjectId ? 'active' : ''}" data-project="${p.id}"><span>${esc(p.name)}</span><span><button data-act="rename" class="icon-btn" type="button" title="重命名项目" aria-label="重命名项目"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button data-act="delete" class="icon-btn" type="button" title="删除项目" aria-label="删除项目"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></span></div>`).join('')
      : '<div class="side-empty-state">还没有项目。点击上方加号开始。</div>';
  }
}
function projectThumb(p) {
  const img = p.state?.nodes?.find(n => n.type === 'image' && (n.data?.url || n.data?.refUrl));
  return img ? safeMediaUrl(img.data.url || img.data.refUrl) : '';
}

async function persistProjectMedia(projectList) {
  if (!host.storageDir || !window.localStorageBridge?.saveMedia || !Array.isArray(projectList)) {
    return {projects: projectList, changed: false};
  }
  let changed = false;
  const persistValue = async (value, name) => {
    if (typeof value === 'string') {
      if (!/^data:(image|video)\//i.test(value)) return value;
      changed = true;
      return await persistMediaUrl(value, name, mediaExtFromDataUrl(value));
    }
    if (Array.isArray(value)) {
      const next = [];
      for (let i = 0; i < value.length; i++) next.push(await persistValue(value[i], `${name}_${i + 1}`));
      return next;
    }
    if (value && typeof value === 'object') {
      const next = {};
      for (const [key, item] of Object.entries(value)) next[key] = await persistValue(item, `${name}_${key}`);
      return next;
    }
    return value;
  };
  const projectsOut = [];
  for (const project of projectList) {
    if (!project?.state?.nodes) {
      projectsOut.push(project);
      continue;
    }
    const nodesOut = [];
    for (const node of project.state.nodes) {
      nodesOut.push({
        ...node,
        data: await persistValue(node.data || {}, `${project.id || 'project'}_${node.id || 'node'}`)
      });
    }
    projectsOut.push({...project, state: {...project.state, nodes: nodesOut}});
  }
  return {projects: changed ? projectsOut : projectList, changed};
}
function hasStorageDir() {
  return Boolean(host.storageDir && window.localStorageBridge);
}
function promptStorageDirRequired() {
  toast('请先选择本地存储文件夹，项目、历史和媒体会保存到该目录。', 'warn');
}
async function ensureStorageReady() {
  if (hasStorageDir()) return true;
  promptStorageDirRequired();
  await chooseStorageDir();
  return hasStorageDir();
}
async function loadLocalStores() {
  if (!host.storageDir || !window.localStorageBridge) return;
  try {
    let [localProjects, localHistory, localAssets, localAssetFolders, localModels] = await Promise.all([
      window.localStorageBridge.readJson(host.storageDir, 'projects'),
      window.localStorageBridge.readJson(host.storageDir, 'history'),
      window.localStorageBridge.readJson(host.storageDir, 'assets'),
      window.localStorageBridge.readJson(host.storageDir, 'asset-folders'),
      window.localStorageBridge.readJson(host.storageDir, 'models')
    ]);
    if (localProjects) {
      const migration = await persistProjectMedia(localProjects);
      localProjects = migration.projects;
      host.fileStoreCache.projects = localProjects;
      cacheBrowserStore(host.STORE.projects, localProjects);
      if (migration.changed) syncLocalStore('projects', localProjects);
    }
    if (localHistory) {
      host.fileStoreCache.history = localHistory;
      cacheBrowserStore(host.STORE.history, localHistory);
    }
    if (localAssets) {
      host.fileStoreCache.assets = localAssets;
      cacheBrowserStore(host.STORE.assets, localAssets);
    }
    if (localAssetFolders) {
      host.fileStoreCache['asset-folders'] = normalizeAssetFolders(localAssetFolders);
      cacheBrowserStore(host.STORE.assetFolders, host.fileStoreCache['asset-folders']);
    }
    if (localModels) {
      host.fileStoreCache.models = localModels;
      cacheBrowserStore(host.STORE.models, localModels);
    }
  } catch (err) {
    toast('读取本地存储失败：\n' + (err.message || err), 'error');
  }
}
async function chooseStorageDir() {
  if (blockProjectTransition('更改存储目录')) return;
  if (!window.localStorageBridge) return toast('当前环境不支持选择本地文件夹', 'warn');
  const dir = await window.localStorageBridge.chooseDir();
  if (!dir) return;
  host.storageDir = dir;
  if ($('localStoragePath')) $('localStoragePath').value = host.storageDir;
  saveSettings();
  await Promise.all([
    syncLocalStore('projects', getStore(host.STORE.projects, [])),
    syncLocalStore('history', host.history),
    syncLocalStore('assets', host.assetLibrary),
    syncLocalStore('asset-folders', host.assetLibraryFolders),
    syncLocalStore('models', host.importedModels)
  ]);
  await loadLocalStores();
  host.importedModels = getStore(host.STORE.models, []);
  host.history = getStore(host.STORE.history, []);
  host.assetLibrary = getStore(host.STORE.assets, []);
  host.assetLibraryFolders = normalizeAssetFolders(getStore(host.STORE.assetFolders, []));
  loadProjects();
  renderAll();
  toast('本地存储位置已更新', 'success');
}
async function openStorageDir() {
  if (!host.storageDir) return toast('请先选择本地存储文件夹', 'warn');
  await window.localStorageBridge?.openDir(host.storageDir);
}
async function flushWorkspaceStores() {
  saveProject();
  saveProjects();
  saveSettings();
  await Promise.all([
    syncLocalStore('projects', getStore(host.STORE.projects, [])),
    syncLocalStore('history', host.history),
    syncLocalStore('assets', host.assetLibrary),
    syncLocalStore('asset-folders', host.assetLibraryFolders),
    syncLocalStore('models', host.importedModels)
  ]);
}
function workspaceBackupPayload() {
  return {
    storageDir: host.storageDir,
    currentProjectId: host.currentProjectId || '',
    settings: getStore(host.STORE.settings, {})
  };
}
async function exportWorkspaceBackup() {
  if (!window.backupBridge?.exportWorkspace) return toast('当前环境不支持完整备份', 'warn');
  if (!await ensureStorageReady()) return;
  try {
    await flushWorkspaceStores();
    const result = await window.backupBridge.exportWorkspace(workspaceBackupPayload());
    if (result?.canceled) return;
    toast(`完整备份已创建：${result.files || 0} 个文件`, 'success');
    return result;
  } catch (err) {
    toast('完整备份失败：\n' + (err.message || err), 'error');
    throw err;
  }
}
async function restoreWorkspaceBackup() {
  if (blockProjectTransition('恢复完整备份')) return;
  if (!window.backupBridge?.restoreWorkspace) return toast('当前环境不支持完整恢复', 'warn');
  if (!await ensureStorageReady()) return;
  const confirmed = await openModal({
    title: '恢复完整工作区',
    text: '恢复会替换当前项目、历史、资产、模型、媒体和附件。软件会先自动保存一份当前工作区安全备份，API 密钥不会被修改。',
    okText: '选择备份并恢复',
    confirm: true
  });
  if (!confirmed) return;
  try {
    await flushWorkspaceStores();
    const result = await window.backupBridge.restoreWorkspace(workspaceBackupPayload());
    if (result?.canceled) return;
    if (!result?.restored) throw new Error('备份未完成恢复');
    const currentSettings = getStore(host.STORE.settings, {});
    setStore(host.STORE.settings, {...currentSettings, ...(result.settings || {}), storageDir: host.storageDir});
    localStorage.setItem(host.STORE.current, result.currentProjectId || '');
    toast('完整工作区已恢复，正在重新载入', 'success');
    setTimeout(() => window.location.reload(), 350);
    return result;
  } catch (err) {
    toast('完整恢复失败：\n' + (err.message || err), 'error');
    throw err;
  }
}
async function restoreProjectBackup() {
  if (blockProjectTransition('恢复项目备份')) return;
  if (!host.storageDir || !window.localStorageBridge?.listProjectBackups) return toast('请先选择本地存储文件夹', 'warn');
  const backups = await window.localStorageBridge.listProjectBackups(host.storageDir);
  if (!backups.length) return toast('暂无项目备份可恢复', 'warn');
  const latest = backups[0];
  const names = backups.slice(0, 8).map((item, index) => `${index + 1}. ${item.fileName}`).join('\n');
  const fileName = await openModal({
    title: '恢复项目备份',
    value: latest.fileName,
    okText: '恢复'
  });
  if (fileName === null) return;
  const chosen = backups.find(item => item.fileName === fileName.trim());
  if (!chosen) return toast('请输入有效的备份文件名：\n' + names, 'warn');
  await window.localStorageBridge.restoreProjectBackup(host.storageDir, chosen.fileName);
  await loadLocalStores();
  host.importedModels = getStore(host.STORE.models, []);
  host.history = getStore(host.STORE.history, []);
  host.assetLibrary = getStore(host.STORE.assets, []);
  host.assetLibraryFolders = normalizeAssetFolders(getStore(host.STORE.assetFolders, []));
  loadProjects();
  renderAll();
  showHome();
  toast('项目备份已恢复', 'success');
}

function getStore(key, fallback) {
  const fileName = FILE_STORE_BY_KEY[key];
  if (fileName && Object.prototype.hasOwnProperty.call(host.fileStoreCache, fileName)) {
    return host.fileStoreCache[fileName] ?? fallback;
  }
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
}
function setStore(key, value) {
  const fileName = FILE_STORE_BY_KEY[key];
  if (fileName) {
    host.fileStoreCache[fileName] = value;
    syncLocalStore(fileName, value);
  }
  const browserSaved = cacheBrowserStore(key, value);
  return browserSaved || Boolean(fileName && host.storageDir && window.localStorageBridge);
}
function cacheBrowserStore(key, value) {
  const preferred = shouldUseCompactBrowserStore(key, host.storageDir, window.localStorageBridge) ? compactBrowserStoreValue(key, value) : value;
  if (trySetLocalStorage(key, preferred)) return true;
  const compact = compactBrowserStoreValue(key, value);
  const compactSaved = compact !== preferred && trySetLocalStorage(key, compact);
  if (!compactSaved && key !== host.STORE.settings) {
    try { localStorage.removeItem(key); } catch {}
  }
  if (key === host.STORE.projects) warnStorageQuotaOnce();
  return compactSaved;
}
function trySetLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (!isQuotaError(err)) console.warn('localStorage write failed', err);
    return false;
  }
}
function warnStorageQuotaOnce() {
  if (host.storageQuotaWarned) return;
  host.storageQuotaWarned = true;
  toast(host.storageDir
    ? '浏览器缓存空间已满，完整项目已改写入本地存储文件夹。'
    : '浏览器缓存空间已满，请在设置里选择本地存储文件夹，避免大型图片丢失。', 'warn');
}
function syncLocalStore(name, value) {
  if (!host.storageDir || !window.localStorageBridge) return Promise.resolve(false);
  const seq = Number(host.storageSyncSeq || 0) + 1;
  host.storageSyncSeq = seq;
  return window.localStorageBridge.writeJson(host.storageDir, name, value).then(() => {
    if (seq === host.storageSyncSeq) {
      host.storageSyncFailed = false;
      host.storageSyncWarned = false;
    }
    return true;
  }).catch(err => {
    console.warn('local storage sync failed', err);
    if (seq === host.storageSyncSeq) {
      host.storageSyncFailed = true;
      setSaveStatus('error', '保存失败');
      if (!host.storageSyncWarned) {
        host.storageSyncWarned = true;
        toast('项目已更新，但写入本地存储文件夹失败。请检查磁盘空间和目录权限后重试。', 'error');
      }
    }
    return false;
  });
}

    return {
      blankProject,
      loadProjects,
      migrateLegacyProjects,
      hasMojibake,
      defaultPromptFor,
      ensureAssistantProfiles,
      activeAssistantProfile,
      assistantSystemPrompt,
      validAssistantContextMode,
      syncAssistantContextModeControls,
      ensurePromptWorkbenchState,
      getActivePromptTopic,
      saveProjects,
      selectedProjectTemplateId,
      resetAssistantStateForNewProject,
      createProject,
      createAssistantProject,
      enterProject,
      showHome,
      showApp,
      resumeLastProjectOrShowHome,
      onProjectGridClick,
      onSideProjectClick,
      renameProject,
      deleteProject,
      serialize,
      saveProject,
      queueSave,
      loadProject,
      renderProjectVersionControls,
      undoProject,
      redoProject,
      restoreProjectVersion,
      clearCanvas,
      createDefaultScene,
      createProjectFromTemplate,
      applyProjectTemplate,
      createShortVideoTemplate,
      createCharacterTemplate,
      createImageToImageTemplate,
      createComfyUITemplate,
      createStoryboardTemplate,
      renderProjects,
      projectThumb,
      persistProjectMedia,
      hasStorageDir,
      promptStorageDirRequired,
      ensureStorageReady,
      loadLocalStores,
      chooseStorageDir,
      openStorageDir,
      flushWorkspaceStores,
      workspaceBackupPayload,
      exportWorkspaceBackup,
      restoreWorkspaceBackup,
      restoreProjectBackup,
      getStore,
      setStore,
      cacheBrowserStore,
      trySetLocalStorage,
      warnStorageQuotaOnce,
      syncLocalStore
    };
  }

  window.FutureAIProjectStore = { create };
})();
