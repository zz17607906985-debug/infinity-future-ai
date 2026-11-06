(() => {
  'use strict';

  /**
   * E2E smoke suite for FUTURE_CANVAS_E2E gate.
   * Only startE2ESmokeTest is public; helpers are private to this domain.
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    const wait = deps.wait;
    const showApp = deps.showApp;
    const showHome = deps.showHome;
    const setActiveWorkspace = deps.setActiveWorkspace;
    const createProject = deps.createProject;
    const loadProject = deps.loadProject;
    const loadProjects = deps.loadProjects;
    const saveProject = deps.saveProject;
    const saveProjects = deps.saveProjects;
    const saveSettings = deps.saveSettings;
    const loadLocalStores = deps.loadLocalStores;
    const loadSettings = deps.loadSettings;
    const addNode = deps.addNode;
    const hydrateNode = deps.hydrateNode;
    const applyCanvasFilters = deps.applyCanvasFilters;
    const nodeMatchesCanvasFilters = deps.nodeMatchesCanvasFilters;
    const clearCanvasSearch = deps.clearCanvasSearch;
    const cacheBrowserStore = deps.cacheBrowserStore;
    const syncLocalStore = deps.syncLocalStore;
    const getStore = deps.getStore;
    const setStore = deps.setStore;
    const runImage = deps.runImage;
    const runImageNow = deps.runImageNow;
    const runComfyUI = deps.runComfyUI;
    const buildPromptContext = deps.buildPromptContext;
    const canvasContextSnapshot = deps.canvasContextSnapshot;
    const buildBatchExportPayload = deps.buildBatchExportPayload;
    const applyModelPreset = deps.applyModelPreset;
    const currentModelPreset = deps.currentModelPreset;
    const exportDiagnosticsPackage = deps.exportDiagnosticsPackage;
    const scanMediaLibrary = deps.scanMediaLibrary;
    const runOneClickCleanup = deps.runOneClickCleanup;
    const checkUpdates = deps.checkUpdates;
    const applyUpdatePackage = deps.applyUpdatePackage;
    const rollbackUpdate = deps.rollbackUpdate;
    const normalizeApiProvider = deps.normalizeApiProvider;
    const fetchJsonWithRetry = deps.fetchJsonWithRetry;
    const API_TIMEOUTS = deps.API_TIMEOUTS;
    const shortProductionBrief = deps.shortProductionBrief;
    const normalizeShortTimeline = deps.normalizeShortTimeline;
    const buildShortAudioPlan = deps.buildShortAudioPlan;
    const renderAll = deps.renderAll;
    const drawEdges = deps.drawEdges;
    const connectSilently = deps.connectSilently;
    const promptWithCanvasContext = deps.promptWithCanvasContext;
    const selectSingleNode = deps.selectSingleNode;
    const diagnosticsSettingsSummary = deps.diagnosticsSettingsSummary;
    const renderMediaLibraryReport = deps.renderMediaLibraryReport;
    const optimizePromptRequest = deps.optimizePromptRequest;
    const planDialogRunWithTextModel = deps.planDialogRunWithTextModel;
    const dialogTextChatReply = deps.dialogTextChatReply;
    const imageGenerateRequest = deps.imageGenerateRequest;
    const persistGeneratedImageResult = deps.persistGeneratedImageResult;
    const videoGenerateRequest = deps.videoGenerateRequest;
    const shortTimelineSrtText = deps.shortTimelineSrtText;
    const renderShortAudioPlan = deps.renderShortAudioPlan;
    const renderShortTimeline = deps.renderShortTimeline;
    const renderShortDelivery = deps.renderShortDelivery;
    const shortProductionPackage = deps.shortProductionPackage;

function e2eAssert(condition, message) {
  if (!condition) throw new Error(message);
}
async function e2eWait(ms = 80) {
  return await wait(ms);
}
function e2eDispatchPointer(target, type, options = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    ...options
  });
  target.dispatchEvent(event);
}
function e2eHitSummary(clientX, clientY) {
  const stack = document.elementsFromPoint?.(clientX, clientY) || [];
  return stack.slice(0, 8).map(el => ({
    tag: el.tagName,
    id: el.id || '',
    className: typeof el.className === 'string' ? el.className : '',
    hidden: el.classList?.contains('hidden') || false
  }));
}
async function runE2ECanvasInteractionCheck(node) {
  showApp();
  setActiveWorkspace('canvas');
  await e2eWait(120);
  e2eAssert(document.body.classList.contains('workspace-canvas'), 'body should be in canvas workspace');
  e2eAssert($('shortWorkbench')?.classList.contains('hidden'), 'short workbench should not cover canvas');
  e2eAssert($('assistantWorkbench')?.classList.contains('hidden'), 'assistant workbench should not cover canvas');
  const shortButton = document.querySelector('[data-workspace="short"]');
  const canvasButton = document.querySelector('[data-workspace="canvas"]');
  shortButton?.click();
  await e2eWait(60);
  e2eAssert(document.body.classList.contains('workspace-short'), 'workspace button should open short workbench');
  canvasButton?.click();
  await e2eWait(60);
  e2eAssert(document.body.classList.contains('workspace-canvas'), 'workspace button should return to canvas');
  const before = {x: node.x, y: node.y};
  const rect = node.el.getBoundingClientRect();
  const startX = rect.left + Math.min(80, Math.max(20, rect.width / 2));
  const startY = rect.top + Math.min(48, Math.max(20, rect.height / 3));
  const top = document.elementFromPoint(startX, startY);
  const hit = e2eHitSummary(startX, startY);
  e2eAssert(top?.closest?.('.node') === node.el, 'node should be the top interactive target: ' + JSON.stringify(hit));
  e2eDispatchPointer(node.el, 'pointerdown', {clientX: startX, clientY: startY});
  await e2eWait(20);
  e2eDispatchPointer(document, 'pointermove', {clientX: startX + 90, clientY: startY + 45});
  await e2eWait(20);
  e2eDispatchPointer(document, 'pointerup', {clientX: startX + 90, clientY: startY + 45, buttons: 0});
  await e2eWait(80);
  e2eAssert(Math.abs(node.x - before.x) >= 40 || Math.abs(node.y - before.y) >= 20, 'node drag should move node coordinates');
  return {nodeId: node.id, before, after: {x: node.x, y: node.y}, hit};
}
async function runE2EUiSurfaceCheck(uploadNode) {
  const settingsTrigger = $('topSettings') || $('openSettings');
  e2eAssert(settingsTrigger, 'settings trigger should exist');
  settingsTrigger.focus();
  settingsTrigger.click();
  await e2eWait(80);
  e2eAssert(!$('settingsDrawer')?.classList.contains('hidden'), 'settings drawer should open');
  e2eAssert($('settingsDrawer')?.getAttribute('aria-hidden') === 'false', 'settings drawer should expose its open state');
  e2eAssert(document.activeElement?.id === 'closeSettings', 'settings drawer should focus its close button (active=' + (document.activeElement?.id || document.activeElement?.tagName || '') + ')');
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await e2eWait(60);
  e2eAssert($('settingsDrawer')?.classList.contains('hidden'), 'Escape should close settings drawer');
  e2eAssert(document.activeElement === settingsTrigger, 'settings focus should return to its trigger');

  const queueTrigger = $('queueToggle');
  queueTrigger?.focus();
  queueTrigger?.click();
  await e2eWait(180);
  e2eAssert(!$('queueDrawer')?.classList.contains('hidden'), 'queue drawer should open');
  e2eAssert($('queueDrawer')?.getAttribute('aria-hidden') === 'false', 'queue drawer should expose its open state');
  e2eAssert(document.activeElement?.id === 'closeQueue', 'queue drawer should focus its close button (active=' + (document.activeElement?.id || document.activeElement?.tagName || '') + ')');
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await e2eWait(60);
  e2eAssert($('queueDrawer')?.classList.contains('hidden'), 'Escape should close queue drawer');
  e2eAssert(document.activeElement === queueTrigger, 'queue focus should return to its trigger (active=' + (document.activeElement?.id || document.activeElement?.tagName || '') + ')');

  host.history.unshift({
    id: 'e2e-ui-history',
    projectId: host.currentProjectId,
    type: 'image',
    url: uploadNode.data.url,
    prompt: 'E2E UI preview',
    model: 'e2e-ui-model',
    time: Date.now()
  });
  const historyTrigger = $('historyToggle');
  historyTrigger?.focus();
  historyTrigger?.click();
  await e2eWait(80);
  e2eAssert(!$('historyDrawer')?.classList.contains('hidden'), 'history drawer should open');
  e2eAssert($('historyDrawer')?.getAttribute('aria-hidden') === 'false', 'history drawer should expose its open state');
  e2eAssert(document.activeElement?.id === 'closeHistory', 'history drawer should focus its close button');
  const historyPreview = $('historyList')?.querySelector('[data-history-preview]');
  e2eAssert(historyPreview, 'history should expose an accessible preview control');
  historyPreview.focus();
  historyPreview.click();
  await e2eWait(80);
  e2eAssert(!$('imageModal')?.classList.contains('hidden'), 'history preview should open the media modal');
  e2eAssert($('imageModal')?.getAttribute('aria-hidden') === 'false', 'media modal should expose its open state');
  e2eAssert(document.activeElement?.id === 'imageModalClose', 'media modal should focus its close button');
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await e2eWait(60);
  e2eAssert($('imageModal')?.classList.contains('hidden'), 'Escape should close media preview');
  e2eAssert($('imageModal')?.getAttribute('aria-hidden') === 'true', 'media modal should expose its closed state');
  e2eAssert(document.activeElement === historyPreview, 'media preview focus should return to its trigger (active=' + (document.activeElement?.id || document.activeElement?.tagName || '') + ')');

  const assetTrigger = $('railAssets');
  assetTrigger?.focus();
  assetTrigger?.click();
  await e2eWait(80);
  e2eAssert(!$('assetLibraryDrawer')?.classList.contains('hidden'), 'asset library should open');
  e2eAssert($('assetLibraryDrawer')?.getAttribute('aria-hidden') === 'false', 'asset library should expose its open state');
  e2eAssert(document.activeElement?.id === 'assetLibrarySearch', 'asset library should focus search');
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await e2eWait(60);
  e2eAssert($('assetLibraryDrawer')?.classList.contains('hidden'), 'Escape should close asset library');
  e2eAssert(document.activeElement === assetTrigger, 'asset library focus should return to its trigger');
  return {settings: true, queue: true, history: true, preview: true, assets: true};
}
async function runE2EApiFailureCheck() {
  const node = addNode('image', 1040, 260, {
    model: 'e2e-image-model',
    prompt: 'E2E API failure prompt',
    size: '1024x1024'
  });
  const originalProviders = Array.isArray(host.apiProviders) ? host.apiProviders.slice() : [];
  const testProvider = normalizeApiProvider({
    id: 'e2e-network-failure-provider',
    name: 'E2E 网络失败供应商',
    type: 'openai-images',
    apiUrl: 'http://127.0.0.1:9/v1',
    useGlobalKey: true,
    imageModel: 'e2e-image-model',
    models: ['e2e-image-model'],
    enabledImage: true,
    imageCapabilityStatus: 'available'
  });
  host.apiProviders = [...originalProviders, testProvider];
  node.data.providerId = testProvider.id;
  const originalApiUrl = $('apiUrl').value;
  const originalApiKey = $('apiKey').value;
  const originalImageModel = $('imageModel').value;
  $('apiUrl').value = 'http://127.0.0.1:9/v1';
  $('apiKey').value = 'e2e-redacted-key';
  $('imageModel').value = 'e2e-image-model';
  try {
    await runImage(node.id);
  } catch (error) {
    node.data.e2eError = String(error?.message || error);
  } finally {
    host.apiProviders = originalProviders;
    $('apiUrl').value = originalApiUrl;
    $('apiKey').value = originalApiKey;
    $('imageModel').value = originalImageModel;
  }
  e2eAssert(node.data.statusType === 'error', 'AI generation failure should mark the image node as error');
  e2eAssert(/失败|failed|fetch|network|timeout|aborted/i.test(node.data.status || ''), 'AI failure status should be visible');
  return {nodeId: node.id, status: node.data.status};
}
async function runE2EComfyFailureCheck() {
  const node = addNode('comfyui', 1040, 620, {
    prompt: 'E2E ComfyUI failure prompt',
    workflowJson: '{"1":{"class_type":"CLIPTextEncode","inputs":{"text":""}}}'
  });
  const originalComfyUrl = $('comfyUrl').value;
  $('comfyUrl').value = 'http://127.0.0.1:9';
  try {
    await runComfyUI(node.id);
  } catch (error) {
    node.data.e2eError = String(error?.message || error);
  } finally {
    $('comfyUrl').value = originalComfyUrl;
  }
  e2eAssert(node.data.statusType === 'error', 'ComfyUI failure should mark the node as error');
  e2eAssert(/ComfyUI|失败|failed|fetch|network|timeout|aborted/i.test(node.data.status || ''), 'ComfyUI failure status should be visible');
  return {nodeId: node.id, status: node.data.status};
}
async function runE2EDiagnosticsCheck() {
  const originalApiKey = $('apiKey').value;
  $('apiKey').value = 'e2e-redacted-key';
  try {
    const result = await window.diagnosticsBridge.exportDiagnostics({
      storageDir: host.storageDir,
      currentProjectId: host.currentProjectId,
      settingsSummary: diagnosticsSettingsSummary()
    });
    e2eAssert(result?.reportFile?.includes('diagnostic-report.json'), 'diagnostics should write diagnostic-report.json');
    return result;
  } finally {
    $('apiKey').value = originalApiKey;
  }
}
async function runE2EBatchExportCheck(uploadNode) {
  const originalApiKey = $('apiKey').value;
  $('apiKey').value = 'e2e-redacted-key';
  selectSingleNode(uploadNode.id);
  host.history.unshift({
    id: 'e2e-history-export',
    projectId: host.currentProjectId,
    type: 'image',
    url: uploadNode.data.url,
    prompt: 'E2E history export item',
    model: 'e2e-export-model',
    time: Date.now()
  });
  try {
    saveProject();
    saveProjects();
    const result = await window.exportBridge.exportProjectPackage(buildBatchExportPayload());
    e2eAssert(result?.zipFile?.includes('project-package.zip'), 'batch export should write project-package.zip');
    e2eAssert(result?.manifestFile?.includes('media-manifest.json'), 'batch export should write media-manifest.json');
    e2eAssert(result?.files?.some(file => file.endsWith('canvas.json')), 'batch export should write canvas.json');
    e2eAssert(result?.files?.some(file => file.endsWith('selected-nodes.json')), 'batch export should write selected-nodes.json');
    e2eAssert(result?.files?.some(file => file.endsWith('history.json')), 'batch export should write history.json');
    return result;
  } finally {
    $('apiKey').value = originalApiKey;
  }
}
async function runE2EModelPresetCheck() {
  const originalApiKey = $('apiKey').value;
  $('apiKey').value = 'e2e-redacted-key';
  if ($('modelPresetSelect')) $('modelPresetSelect').value = 'siliconflow';
  const preset = applyModelPreset('siliconflow');
  const apiKeyChanged = $('apiKey').value !== 'e2e-redacted-key';
  e2eAssert(preset.id === 'siliconflow', 'model preset should apply SiliconFlow');
  e2eAssert($('apiUrl').value === preset.apiUrl, 'model preset should update API url');
  e2eAssert($('imageModel').value === preset.imageModel, 'model preset should update image model');
  e2eAssert($('videoModel').value === preset.videoModel, 'model preset should update video model');
  e2eAssert($('chatModel').value === preset.chatModel, 'model preset should update chat model');
  e2eAssert(!apiKeyChanged, 'model preset should preserve API key');
  $('apiKey').value = originalApiKey;
  return {presetId: preset.id, apiUrl: preset.apiUrl, imageModel: preset.imageModel, apiKeyChanged};
}
async function runE2EMediaLibraryCheck(uploadNode) {
  const duplicateUrl = await window.localStorageBridge.saveMedia(host.storageDir, {
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    name: 'e2e-duplicate',
    ext: 'png'
  });
  const missingUrl = uploadNode.data.url.replace(/\/[^/]+$/, '/e2e-missing-reference.png');
  host.history.unshift({
    id: 'e2e-missing-media',
    projectId: host.currentProjectId,
    type: 'image',
    url: missingUrl,
    prompt: 'E2E missing media reference',
    model: 'e2e-model',
    time: Date.now()
  });
  saveProject();
  saveProjects();
  await syncLocalStore('history', host.history);
  const index = await window.mediaLibraryBridge.scanMediaLibrary({storageDir: host.storageDir});
  e2eAssert(index?.summary?.files >= 2, 'media library should list media files');
  e2eAssert(index?.duplicateGroups?.length >= 1, 'media library should detect duplicate media');
  e2eAssert(index?.files?.some(item => item.url === uploadNode.data.url && item.referencedBy?.length), 'media library should track media references');
  e2eAssert(index?.missingReferences?.some(item => item.url === missingUrl), 'media library should detect missing references');
  renderMediaLibraryReport(index);
  return {
    files: index.summary.files,
    duplicateGroups: index.summary.duplicateGroups,
    missingReferences: index.summary.missingReferences,
    unreferenced: index.summary.unreferenced,
    duplicateUrl
  };
}
async function runE2ECleanupCheck(uploadNode) {
  await window.secretBridge?.setApiKey?.('e2e-cleanup-api-key');
  const unreferencedUrl = await window.localStorageBridge.saveMedia(host.storageDir, {
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    name: 'cleanup-unreferenced',
    ext: 'png'
  });
  saveProject();
  saveProjects();
  await e2eWait(250);
  const scan = await window.cleanupBridge.scanCleanup({storageDir: host.storageDir});
  e2eAssert(scan?.cleanupToken, 'cleanup scan should return a token');
  e2eAssert(scan.items?.some(item => item.type === 'unreferencedMedia' && item.label.includes('cleanup-unreferenced')), 'cleanup scan should find unreferenced media');
  e2eAssert(!scan.items?.some(item => uploadNode.data.url && item.path && uploadNode.data.url.includes(item.label)), 'cleanup scan should not target referenced upload media');
  const result = await window.cleanupBridge.executeCleanup({cleanupToken: scan.cleanupToken, confirmed: true});
  e2eAssert(result?.deleted?.some(item => item.label.includes('cleanup-unreferenced')), 'cleanup should delete unreferenced media');
  return {
    scanCount: scan.items.length,
    deletedCount: result.deleted.length,
    unreferencedUrl,
    referencedUrl: uploadNode.data.url
  };
}
async function runE2EUpdateSystemCheck() {
  const result = await window.updateBridge.capabilities();
  e2eAssert(result?.protected?.includes('projects.json'), 'update system should protect projects.json');
  e2eAssert(result?.protected?.includes('history.json'), 'update system should protect history.json');
  e2eAssert(result?.protected?.includes('api-key.json'), 'update system should protect api-key.json');
  e2eAssert(result?.mode === 'signed-nsis-installer', 'update system should use complete signed installer');
  e2eAssert(result?.asarIntegrityPreserved === true, 'update system should preserve ASAR integrity');
  e2eAssert(result?.automaticRollback === true, 'update system should support automatic rollback');
  return {
    mode: result.mode,
    protected: result.protected,
    automaticRollback: result.automaticRollback,
    runtimeData: result.runtimeData
  };
}
async function runE2EAIContextCheck(promptNode, imageNode) {
  connectSilently(promptNode.id, 'text', imageNode.id, 'prompt');
  const unselected = promptWithCanvasContext('E2E base prompt', 'image', imageNode.id);
  host.selectedNodes.add(imageNode.id);
  const selected = promptWithCanvasContext('E2E base prompt', 'image', imageNode.id);
  host.selectedNodes.delete(imageNode.id);
  e2eAssert(unselected === 'E2E base prompt', 'AI context should not alter prompts when the target node is not selected');
  e2eAssert(selected.includes('画布上下文'), 'AI context should append selected canvas context');
  e2eAssert(selected.includes('E2E 持久化项目'), 'AI context should include project name');
  e2eAssert(selected.includes('E2E prompt node') || selected.includes(promptNode.id), 'AI context should include upstream prompt context');
  return {
    unselectedChanged: unselected !== 'E2E base prompt',
    selectedHasContext: selected.includes('画布上下文'),
    selectedHasProject: selected.includes('E2E 持久化项目')
  };
}
async function runE2EMusicSourcePolicyCheck() {
  const registry = await window.musicBridge.registry();
  const plugins = Array.isArray(registry?.plugins) ? registry.plugins : [];
  e2eAssert(registry?.protocol === 'futureai-musicfree-compatible', 'music registry should expose the compatible protocol');
  e2eAssert(plugins.length >= 4, 'music registry should expose official built-in sources');
  e2eAssert(!plugins.some(plugin => plugin.id === 'web'), 'commercial music registry should not expose generic web scraping');
  e2eAssert(plugins.every(plugin => ['open-license', 'platform-stream'].includes(plugin.manifest?.rightsMode)), 'music sources should declare a rights mode');
  e2eAssert(plugins.every(plugin => plugin.manifest?.downloadAllowed === false && plugin.manifest?.exportAllowed === false), 'remote music sources should disable download and export');
  let forgedTrackRejected = false;
  try {
    await window.musicBridge.resolveTrack({
      track: {
        sourceId: 'audius',
        url: 'https://example.com/forged.mp3',
        playbackGrant: 'forged'
      }
    });
  } catch {
    forgedTrackRejected = true;
  }
  e2eAssert(forgedTrackRejected, 'music resolver should reject forged source URLs and grants');
  return { pluginCount: plugins.length, forgedTrackRejected };
}
async function runE2ERequestResilienceCheck(config) {
  if (!config.mockApiUrl) return {skipped: true};
  const headers = {Authorization: 'Bearer e2e-key'};
  const flaky = await fetchJsonWithRetry(`${config.mockApiUrl}/e2e/flaky`, {
    timeoutMs: 1500,
    retries: 1,
    headers
  });
  const flakyBody = await flaky.json();
  e2eAssert(flaky.ok && flakyBody?.ok && flakyBody?.attempts === 2, 'transient 503 should recover on the bounded retry');

  const timeoutStartedAt = performance.now();
  let timeoutError = null;
  try {
    await fetchJsonWithRetry(`${config.mockApiUrl}/e2e/slow`, {
      timeoutMs: 120,
      retries: 0,
      headers
    });
  } catch (error) {
    timeoutError = error;
  }
  const timeoutElapsedMs = Math.round(performance.now() - timeoutStartedAt);
  e2eAssert(timeoutError?.isTimeout === true, 'a stalled relay request should surface the typed timeout error');
  e2eAssert(timeoutElapsedMs < 1500, 'a stalled relay request should remain bounded');

  const recovery = await fetchJsonWithRetry(`${config.mockApiUrl}/models`, {
    timeoutMs: 1500,
    retries: 0,
    headers
  });
  const recoveryBody = await recovery.json();
  e2eAssert(recovery.ok && recoveryBody?.data?.some(model => model.id === 'e2e-chat-model'), 'request layer should remain usable after a timeout');
  return {skipped: false, retryAttempts: flakyBody.attempts, timeoutElapsedMs, recoveredAfterTimeout: true};
}
async function runE2ESoakCheck(durationMs) {
  const boundedDuration = Math.max(0, Math.min(900000, Number(durationMs) || 0));
  if (!boundedDuration) return {skipped: true};
  const workspaces = ['short', 'assistant', 'canvas', 'music'];
  for (let pass = 0; pass < 2; pass++) {
    for (const workspace of workspaces) {
      setActiveWorkspace(workspace);
      await e2eWait(30);
    }
  }
  const startedAt = performance.now();
  const baselineDomNodes = document.getElementsByTagName('*').length;
  const memorySamples = [];
  const domSamples = [];
  let cycles = 0;
  let maxEventLoopLagMs = 0;
  let nextSampleAt = 0;
  while (performance.now() - startedAt < boundedDuration) {
    const expectedAt = performance.now() + 20;
    await e2eWait(20);
    maxEventLoopLagMs = Math.max(maxEventLoopLagMs, performance.now() - expectedAt);
    const workspace = workspaces[cycles % workspaces.length];
    setActiveWorkspace(workspace);
    e2eAssert(document.body.classList.contains(`workspace-${workspace}`), `soak navigation should activate ${workspace}`);
    e2eAssert(!$('appShell')?.classList.contains('hidden'), 'application shell should remain visible during soak');
    cycles += 1;
    const elapsed = performance.now() - startedAt;
    if (elapsed >= nextSampleAt) {
      const usedHeap = Number(performance.memory?.usedJSHeapSize || 0);
      memorySamples.push({elapsedMs: Math.round(elapsed), usedHeap});
      domSamples.push({elapsedMs: Math.round(elapsed), nodes: document.getElementsByTagName('*').length});
      nextSampleAt = elapsed + 1000;
    }
  }
  const finalDomNodes = document.getElementsByTagName('*').length;
  const heapValues = memorySamples.map(sample => sample.usedHeap).filter(Boolean);
  const heapGrowthBytes = heapValues.length > 1 ? heapValues.at(-1) - heapValues[0] : 0;
  e2eAssert(maxEventLoopLagMs < 2000, 'event loop should remain responsive during soak');
  e2eAssert(finalDomNodes <= baselineDomNodes + 50, 'workspace switching should not leak DOM host.nodes after lazy workspaces are initialized');
  e2eAssert(heapGrowthBytes < 256 * 1024 * 1024, 'workspace switching should not show catastrophic heap growth');
  return {
    skipped: false,
    durationMs: Math.round(performance.now() - startedAt),
    cycles,
    maxEventLoopLagMs: Math.round(maxEventLoopLagMs),
    baselineDomNodes,
    finalDomNodes,
    heapGrowthBytes,
    memorySamples,
    domSamples
  };
}
async function runE2ECoreAIWorkflowCheck(config) {
  if (!config.mockApiUrl) return { skipped: true };
  const provider = normalizeApiProvider({
    id: 'e2e-openai-compatible',
    name: 'E2E OpenAI Compatible',
    type: 'openai-images',
    apiUrl: config.mockApiUrl,
    useGlobalKey: false,
    chatModel: 'e2e-chat-model',
    imageModel: 'e2e-image-model',
    videoModel: 'e2e-video-model',
    models: ['e2e-chat-model', 'e2e-image-model', 'e2e-video-model'],
    chatEndpoint: '/chat/completions',
    imageEndpoint: '/images/generations',
    videoEndpoint: '/video/create',
    enabledText: true,
    enabledImage: true,
    enabledVideo: true,
    imageCapabilityStatus: 'available'
  });
  const apiKey = 'e2e-key';
  const optimizedPrompt = await optimizePromptRequest({
    apiUrl: provider.apiUrl,
    apiKey,
    provider,
    model: provider.chatModel,
    nodeType: 'image',
    prompt: '雨夜城市人物，16:9'
  });
  e2eAssert(/16:9/.test(optimizedPrompt), 'prompt optimization should preserve the 16:9 requirement');

  const routing = await planDialogRunWithTextModel({
    apiUrl: provider.apiUrl,
    apiKey,
    model: provider.chatModel,
    endpoint: provider.chatEndpoint,
    userText: '解释如何保持角色一致性'
  });
  e2eAssert(routing?.kind === 'chat', 'Ling Shu routing should parse a compatible chat-completion response');
  const reply = await dialogTextChatReply({
    apiUrl: provider.apiUrl,
    apiKey,
    model: provider.chatModel,
    endpoint: provider.chatEndpoint,
    userText: '解释如何保持角色一致性'
  });
  e2eAssert(reply.includes('灵枢万象'), 'Ling Shu should use the configured global chat-compatible model');

  const imageResult = await imageGenerateRequest({
    apiUrl: provider.apiUrl,
    apiKey,
    provider,
    model: provider.imageModel,
    prompt: optimizedPrompt,
    size: '1280x720',
    quality: 'auto'
  });
  e2eAssert(/^(?:data:image\/|blob:|file:)/i.test(String(imageResult.url || '')), 'image generation should return a usable image URL');
  const savedImage = await persistGeneratedImageResult(imageResult, 'e2e-core-ai-image', 'png');
  e2eAssert(String(savedImage).startsWith('file:'), 'generated image should persist into the isolated project');

  const videoUrl = await videoGenerateRequest({
    apiUrl: provider.apiUrl,
    apiKey,
    provider,
    model: provider.videoModel,
    prompt: '16:9 横向镜头，人物沿雨夜街道缓慢前行',
    size: '1280x720',
    duration: '5',
    mode: 'auto',
    refUrl: ''
  });
  e2eAssert(/^data:video\/mp4;base64,/.test(videoUrl), 'video generation should parse an immediate compatible response');
  return {
    skipped: false,
    optimizedPrompt,
    routing: routing.kind,
    reply,
    savedImage,
    imageProtocol: provider.imageEndpoint,
    videoProtocol: provider.videoEndpoint
  };
}
function runE2EManjuTimelineCheck() {
  e2eAssert(Boolean($('shortAudio') && $('shortTimeline') && $('shortDelivery')), 'manju production sections should exist');
  host.shortStoryboardItems = [
    {id: 'e2e-shot-1', title: 'E2E 镜头一', duration: 5, videoUrl: 'data:video/mp4;base64,AAAA'},
    {id: 'e2e-shot-2', title: 'E2E 镜头二', duration: 3, videoUrl: ''}
  ];
  host.shortAudioPlan = [
    {shotId: 'e2e-shot-1', shotIndex: 0, subtitle: '第一句', duration: 5, audioUrl: 'data:audio/mpeg;base64,AAAA', status: '配音已生成'},
    {shotId: 'e2e-shot-2', shotIndex: 1, subtitle: '第二句', duration: 3, audioUrl: '', status: '待生成配音'}
  ];
  host.shortTimelineItems = [{shotId: 'e2e-shot-1', shotIndex: 0, enabled: true, trimIn: 1, trimOut: 0}];
  normalizeShortTimeline();
  e2eAssert(host.shortTimelineItems.length === 2, 'timeline should mirror storyboard shots');
  e2eAssert(host.shortTimelineItems[0].trimIn === 1, 'timeline should preserve user trim by stable shot id');
  e2eAssert(host.shortTimelineItems[0].audioUrl.startsWith('data:audio/'), 'timeline should sync generated voice media');
  e2eAssert(shortTimelineSrtText().includes('00:00:04,000 --> 00:00:07,000'), 'timeline SRT should account for trim and enabled clip durations');
  renderShortAudioPlan();
  renderShortTimeline();
  renderShortDelivery();
  const productionPackage = shortProductionPackage();
  e2eAssert(productionPackage.timelineItems.length === 2, 'production package should include timeline data');
  e2eAssert($('shortTimelineList')?.querySelectorAll('.short-timeline-item').length === 2, 'timeline UI should render every shot');
  return {clips: host.shortTimelineItems.length, readyVideos: host.shortTimelineItems.filter(item => item.videoUrl).length, voices: host.shortAudioPlan.filter(item => item.audioUrl).length};
}
async function runE2EManjuFfmpegCheck(config) {
  if (!config.manjuVideo) return {skipped: true};
  const result = await window.exportBridge.exportManjuVideo({
    e2e: true,
    storageDir: config.storageDir,
    name: 'E2E 漫剧成片',
    size: '320x568',
    clips: [{shotId: 'e2e-ffmpeg-shot', videoUrl: config.manjuVideo, audioUrl: '', duration: 1, trimIn: 0, trimOut: 0}],
    srt: '1\n00:00:00,000 --> 00:00:01,000\nE2E 字幕\n'
  });
  e2eAssert(!result?.canceled && result?.clips === 1, 'FFmpeg exporter should produce one output clip');
  e2eAssert(String(result.outputFile || '').endsWith('e2e-manju-output.mp4'), 'FFmpeg exporter should return the E2E output path');
  return result;
}
async function startE2ESmokeTest() {
  const bridge = window.e2eBridge;
  const config = await bridge?.getConfig?.().catch(() => null);
  if (!config?.enabled || !config.storageDir) return;
  const report = {
    status: 'running',
    gate: 'FUTURE_CANVAS_E2E',
    storageEnv: 'FUTURE_CANVAS_E2E_STORAGE_DIR',
    reportEnv: 'FUTURE_CANVAS_E2E_REPORT',
    processId: config.processId,
    storageDir: String(config.storageDir).replace(/\\/g, '/'),
    checks: [],
    startedAt: new Date().toISOString()
  };
  const finish = async (status, error = null) => {
    report.status = status;
    report.finishedAt = new Date().toISOString();
    if (error) report.error = error.message || String(error);
    window.__futureCanvasE2EReport = report;
    await bridge?.writeReport?.(report);
    await bridge?.quit?.(status === 'pass' ? 0 : 1);
  };
  await bridge?.writeReport?.(report);
  try {
    const windowFocused = await bridge?.focusWindow?.().catch(() => false);
    await e2eWait(120);
    report.windowFocused = Boolean(windowFocused || document.hasFocus());
    e2eAssert(report.windowFocused, 'the Electron window should be focused before UI interaction checks');
    report.checks.push('window-focus');
    host.storageDir = config.storageDir;
    if ($('localStoragePath')) $('localStoragePath').value = host.storageDir;
    if (config.resume) {
      await loadLocalStores();
      loadProjects();
      const resumedProject = host.projects.find(project => project.name === 'E2E 持久化项目');
      e2eAssert(resumedProject, 'the persisted E2E project should exist after a full app restart');
      const resumedPrompt = resumedProject.state?.nodes?.find(node => node.data?.prompt === 'E2E prompt node');
      const resumedImage = resumedProject.state?.nodes?.find(node => node.type === 'image' && String(node.data?.url || '').startsWith('file:'));
      const resumedLocalMedia = resumedImage || resumedProject.state?.nodes?.find(node => node.type === 'upload' && String(node.data?.url || '').startsWith('file:'));
      e2eAssert(resumedPrompt?.data?.favorite === true, 'node metadata should survive a full app restart');
      e2eAssert(resumedPrompt?.data?.tags?.includes('e2e-tag'), 'node tags should survive a full app restart');
      e2eAssert(resumedLocalMedia, 'a persisted local media reference should survive a full app restart');
      if (config.crashVerify) {
        e2eAssert(resumedProject.state?.shortWorkbench?.ideaText === 'E2E 强制退出恢复标记', 'debounced workbench input should survive an ungraceful process termination');
        report.crashRecovery = {ideaTextRecovered: true, projectId: resumedProject.id};
        report.checks.push('crash-recovery');
      }
      const restoredImage = await window.localStorageBridge.readMedia(resumedLocalMedia.data.url);
      e2eAssert(/^data:image\/png;base64,/.test(restoredImage), 'the persisted local media file should remain readable after restart');
      report.restartPersistence = {
        projectId: resumedProject.id,
        nodeCount: resumedProject.state?.nodes?.length || 0,
        mediaType: resumedLocalMedia.type,
        persistedMedia: resumedLocalMedia.data.url,
        generatedImage: resumedImage?.data?.url || ''
      };
      report.checks.push('restart-persistence');
      await finish('pass');
      return;
    }
    localStorage.removeItem(host.STORE.current);
    host.projects = [];
    host.currentProjectId = null;
    host.fileStoreCache.projects = [];
    host.fileStoreCache.history = [];
    host.fileStoreCache.assets = [];
    host.fileStoreCache['asset-folders'] = [];
    host.fileStoreCache.models = [];
    cacheBrowserStore(host.STORE.projects, []);
    cacheBrowserStore(host.STORE.history, []);
    cacheBrowserStore(host.STORE.assets, []);
    cacheBrowserStore(host.STORE.assetFolders, []);
    cacheBrowserStore(host.STORE.models, []);
    host.shortStoryboardItems = [];
    host.shortAssetItems = [];
    host.shortQcItems = [];
    host.shortAudioPlan = [];
    host.shortTimelineItems = [];
    saveSettings();
    await Promise.all([
      syncLocalStore('projects', []),
      syncLocalStore('history', []),
      syncLocalStore('assets', []),
      syncLocalStore('asset-folders', []),
      syncLocalStore('models', [])
    ]);

    await createProject(false, 'E2E 持久化项目');
    e2eAssert(host.projects.some(p => p.name === 'E2E 持久化项目'), 'project should be created through app flow');
    report.checks.push('new-project');

    await createProject(false, 'E2E 分镜模板项目', 'storyboard');
    const templateProject = host.projects.find(p => p.name === 'E2E 分镜模板项目');
    e2eAssert(templateProject.templateId === 'storyboard', 'templated project should persist template id');
    e2eAssert(templateProject.state?.nodes?.length >= 3, 'storyboard template should create default nodes');
    e2eAssert(templateProject.state?.edges?.length >= 2, 'storyboard template should create default edges');
    e2eAssert(templateProject.state?.nodes?.some(n => n.data?.tags?.includes('分镜')), 'storyboard template should tag its nodes');
    report.templateNodeCount = templateProject.state.nodes.length;
    report.checks.push('project-template');

    const mainProject = host.projects.find(p => p.name === 'E2E 持久化项目');
    host.currentProjectId = mainProject.id;
    loadProject(mainProject.id);

    setActiveWorkspace('canvas');
    const promptNode = addNode('prompt', 260, 220, {prompt: 'E2E prompt node'});
    const imageNode = addNode('image', 640, 220, {prompt: 'E2E image node', model: 'e2e-image-model'});
    promptNode.data.tags = ['e2e-tag', 'story'];
    promptNode.data.favorite = true;
    hydrateNode(promptNode);
    host.canvasSearchQuery = 'e2e-tag';
    host.canvasTypeFilter = 'all';
    host.canvasFavoritesOnly = false;
    applyCanvasFilters();
    e2eAssert(nodeMatchesCanvasFilters(promptNode), 'tagged prompt node should match canvas search');
    e2eAssert(!nodeMatchesCanvasFilters(imageNode), 'untagged image node should be filtered by tag search');
    host.canvasFavoritesOnly = true;
    applyCanvasFilters();
    e2eAssert(nodeMatchesCanvasFilters(promptNode), 'favorite tagged node should remain visible with favorites filter');
    report.checks.push('canvas-search');
    report.checks.push('node-tags');
    report.checks.push('node-favorite');
    clearCanvasSearch();
    const uploadNode = addNode('upload', 260, 520, {name: 'e2e-import.png', mime: 'image/png', kind: 'image'});
    uploadNode.data.url = await window.localStorageBridge.saveMedia(host.storageDir, {
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      name: 'e2e-import',
      ext: 'png'
    });
    hydrateNode(uploadNode);
    e2eAssert(uploadNode.data.url.startsWith('file:'), 'imported image should be persisted as local media');
    report.checks.push('add-host.nodes');
    report.checks.push('import-image');
    report.canvasInteraction = await runE2ECanvasInteractionCheck(promptNode);
    report.checks.push('canvas-interaction');
    report.uiSurfaces = await runE2EUiSurfaceCheck(uploadNode);
    report.checks.push('ui-surfaces');

    saveProject();
    saveProjects();
    await e2eWait(250);
    loadProjects();
    const savedProject = host.projects.find(p => p.name === 'E2E 持久化项目');
    e2eAssert(savedProject?.state?.nodes?.some(n => n.id === promptNode.id), 'prompt node should survive reload');
    e2eAssert(savedProject?.state?.nodes?.some(n => n.id === imageNode.id), 'image node should survive reload');
    e2eAssert(savedProject?.state?.nodes?.some(n => n.id === uploadNode.id && n.data?.url), 'uploaded image node should survive reload');
    e2eAssert(savedProject?.state?.nodes?.some(n => n.id === promptNode.id && n.data?.favorite === true), 'node favorite should survive reload');
    e2eAssert(savedProject?.state?.nodes?.some(n => n.id === promptNode.id && Array.isArray(n.data?.tags) && n.data.tags.includes('e2e-tag')), 'node tags should survive reload');
    report.projectId = savedProject.id;
    report.nodeCount = savedProject.state.nodes.length;
    report.checks.push('save-reload');

    report.aiContext = await runE2EAIContextCheck(promptNode, imageNode);
    report.checks.push('ai-context');

    report.batchExport = await runE2EBatchExportCheck(uploadNode);
    report.checks.push('batch-export');
    report.modelPreset = await runE2EModelPresetCheck();
    report.checks.push('model-preset');
    report.mediaLibrary = await runE2EMediaLibraryCheck(uploadNode);
    report.checks.push('media-library');
    report.apiFailure = await runE2EApiFailureCheck();
    report.checks.push('api-failure');
    report.comfyFailure = await runE2EComfyFailureCheck();
    report.checks.push('comfyui-failure');
    report.diagnostics = await runE2EDiagnosticsCheck();
    report.checks.push('diagnostics-export');
    report.cleanup = await runE2ECleanupCheck(uploadNode);
    report.checks.push('cleanup-unreferenced');
    report.updateSystem = await runE2EUpdateSystemCheck();
    report.checks.push('update-system');
    report.musicSourcePolicy = await runE2EMusicSourcePolicyCheck();
    report.checks.push('music-source-policy');
    report.requestResilience = await runE2ERequestResilienceCheck(config);
    if (!report.requestResilience.skipped) report.checks.push('request-retry-timeout-recovery');
    report.coreAIWorkflow = await runE2ECoreAIWorkflowCheck(config);
    if (!report.coreAIWorkflow.skipped) {
      const persistedImageNode = host.nodes.get(imageNode.id);
      e2eAssert(persistedImageNode, 'the generated image node should remain in the active project map');
      persistedImageNode.data.url = report.coreAIWorkflow.savedImage;
      hydrateNode(persistedImageNode);
      saveProject();
      report.checks.push('core-ai-compatible-workflow');
    }
    report.manjuTimeline = runE2EManjuTimelineCheck();
    report.checks.push('manju-tts-timeline');
    report.manjuFfmpeg = await runE2EManjuFfmpegCheck(config);
    if (!report.manjuFfmpeg.skipped) report.checks.push('manju-ffmpeg-export');
    report.soak = await runE2ESoakCheck(config.soakMs);
    if (!report.soak.skipped) report.checks.push('workspace-soak');
    saveProject();
    await e2eWait(250);
    if (config.crashPrepare) {
      setActiveWorkspace('short');
      $('shortIdeaInput').value = 'E2E 强制退出恢复标记';
      $('shortIdeaInput').dispatchEvent(new Event('input', {bubbles: true}));
      await e2eWait(800);
      report.status = 'ready-for-crash';
      report.crashMarker = 'E2E 强制退出恢复标记';
      report.checks.push('autosave-before-crash');
      window.__futureCanvasE2EReport = report;
      await bridge?.writeReport?.(report);
      return;
    }
    await finish('pass');
  } catch (err) {
    console.error('E2E smoke test failed', err);
    await finish('fail', err);
  }
}
    return { startE2ESmokeTest };
  }

  window.FutureAIE2ESmoke = { create };
})();
