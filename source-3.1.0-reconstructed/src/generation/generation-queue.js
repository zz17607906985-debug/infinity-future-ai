(() => {
  'use strict';

  /**
   * Generation queue + image run orchestration.
   * State (queue lists, pause flag, concurrency counters) stays in app shell via host.
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    const getNode = deps.getNode;
    const generateImageKeepingOriginal = deps.generateImageKeepingOriginal;
    const focusQueueNode = deps.focusQueueNode;
    const setActiveWorkspace = deps.setActiveWorkspace;
    const hydrateNode = deps.hydrateNode;
    const saveProject = deps.saveProject;
    const addHistory = deps.addHistory;
    const currentProviderForNode = deps.currentProviderForNode;
    const providerTypeLabel = deps.providerTypeLabel;
    const providerApiKey = deps.providerApiKey;
    const nodeDisplayTitle = deps.nodeDisplayTitle;
    const getInputPrompt = deps.getInputPrompt;
    const withCameraPrompt = deps.withCameraPrompt;
    const ensureInputImageRefs = deps.ensureInputImageRefs;
    const effectiveImageModel = deps.effectiveImageModel;
    const setImageStatus = deps.setImageStatus;
    const imageTargetSize = deps.imageTargetSize;
    const apiCompatibleImageSize = deps.apiCompatibleImageSize;
    const imageEditWithFallback = deps.imageEditWithFallback;
    const imageGenerateRequest = deps.imageGenerateRequest;
    const persistGeneratedImageResult = deps.persistGeneratedImageResult;
    const isApiGatewayTimeoutError = deps.isApiGatewayTimeoutError;
    const referenceGuidedImageFallback = deps.referenceGuidedImageFallback;
    const refreshDownstreamLinkedInputs = deps.refreshDownstreamLinkedInputs;
    const isSafetyError = deps.isSafetyError;
    const formatImageGenerationError = deps.formatImageGenerationError;
    const imageErrorTitle = deps.imageErrorTitle;
    const diagnoseGenerationError = deps.diagnoseGenerationError;
    // Batch runs report one combined toast; per-node toasts are muted for these ids.
    const quietToastNodeIds = new Set();
    const nodeToast = (id, ...args) => { if (!quietToastNodeIds.has(id)) toast(...args); };
    const ModelCapabilities = deps.ModelCapabilities || window.FutureAIModelCapabilities;
    const ReferenceRoles = deps.ReferenceRoles || window.FutureAIReferenceRoles;
    const authorizeGenerationBudget = deps.authorizeGenerationBudget;
    const completeGenerationBudget = deps.completeGenerationBudget;
    const AutoRetry = deps.AutoRetry || window.FutureAIAutoRetry;
    const getAutoRetryLimit = deps.getAutoRetryLimit || (() => 1);
    // nodeId -> remaining automatic retries for the run in progress; read by runImageNow's error path.
    const autoRetryAllowance = new Map();
    let retryPumpTimer = 0;
    const VariantManager = deps.VariantManager || window.FutureAIVariantManager;
    const Provenance = deps.Provenance || window.FutureAIProvenance;
  const ImageRequestPolicy = deps.ImageRequestPolicy || window.FutureAIImageRequestPolicy;
  let queueElapsedTimer = 0;

function buildImageRequest(node, references = []) {
  const provider = currentProviderForNode(node);
  const request = ImageRequestPolicy.build({
    data: node.data,
    ownPrompt: node.data.prompt || '',
    linkedPrompt: getInputPrompt(node.id),
    model: node.data.model || provider.imageModel || FutureAIApiDefaults.get('imageModel')?.trim(),
    size: imageTargetSize(node.data),
    references,
    composePrompt: prompt => withCameraPrompt(prompt, node) + (ReferenceRoles?.imageReferenceInstructions(references) || '')
  });
  request.provider = provider.name || provider.id || '';
  request.protocol = provider.type || 'openai-images';
  request.dimensionFields = deps.imageRequestDimensionFields?.(provider, request.size) || {size: request.size};
  request.seed = deps.imageRequestSeedFields?.({model: request.model, seed: node.data.seed})?.seed ?? null;
  return request;
}
function previewImageRequest(id, references = [], previous = false) {
  const node = getNode(id);
  if (!node) throw new Error('图片节点不存在');
  if (previous && !node.data.lastImageRequest) throw new Error('该节点还没有新版请求记录');
  const request = previous ? node.data.lastImageRequest : buildImageRequest(node, references);
  ImageRequestPolicy.showPreview(request, previous ? '最近一次提交记录' : '图片请求预览');
  return request;
}

function assertImageModelCapability(node, provider, model, references) {
  if (!ModelCapabilities) return null;
  const profile = ModelCapabilities.resolveProfile({provider, modelId: model, kind: 'image'});
  const result = ModelCapabilities.validateRequest(profile, {
    operation: references.length ? 'edit' : 'generate',
    aspect: node.data.aspect || '',
    resolution: node.data.resolution || '1K',
    count: Math.max(1, Math.min(4, Number(node.data.count) || 1)),
    references
  });
  node.data.modelCapability = {
    schemaVersion: profile.schemaVersion,
    profileVersion: profile.profileVersion,
    source: profile.source,
    checkedAt: Date.now(),
    warnings: result.warnings.map(item => item.message)
  };
  if (result.errors.length) {
    const error = new Error(result.errors.map(item => item.message).join('\n'));
    error.code = 'MODEL_CAPABILITY_MISMATCH';
    error.issues = result.errors;
    throw error;
  }
  return {profile, result};
}

function providerConcurrencyLimit(providerId) {
  const provider = host.apiProviders.find(item => item.id === providerId);
  const configured = Number(provider?.concurrency || host.providerConcurrency.get(providerId) || 1);
  return Math.max(1, Math.min(4, configured));
}
function enqueueImageGeneration(id, options = {}) {
  const node = getNode(id);
  if (!node) return Promise.resolve(false);
  if (options.quiet) quietToastNodeIds.add(id);
  const existing = host.generationQueue.find(item => item.nodeId === id && (item.status === 'queued' || item.status === 'running'));
  if (existing) {
    renderQueue();
    return existing.promise;
  }
  let resolveTask;
  let rejectTask;
  const promise = new Promise((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });
  const provider = currentProviderForNode(node);
  const item = {
    id: 'q-' + (host.nextQueueSeq()),
    type: 'image',
    nodeId: id,
    title: nodeDisplayTitle(node),
    providerId: provider.id,
    providerName: provider.name || providerTypeLabel(provider.type),
    model: node.data.model || provider.imageModel || FutureAIApiDefaults.get('imageModel') || '',
    parameters: {
      size: imageTargetSize(node.data) || '',
      aspect: node.data.aspect || '',
      resolution: node.data.resolution || '1K',
      count: Math.max(1, Math.min(4, Number(node.data.count) || 1)),
      // A queued task is created before its request object exists; quality is fixed by the policy.
      quality: ImageRequestPolicy.qualityForModel(node.data.model || provider.imageModel || '')
    },
    status: 'queued',
    message: '等待生成',
    createdAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    attempts: 0,
    promise,
    resolve: resolveTask,
    reject: rejectTask
  };
  host.generationQueue.push(item);
  saveProject?.();
  renderQueue();
  pumpGenerationQueue();
  return options.returnItem ? item : promise;
}
function scheduleRetryPump() {
  if (retryPumpTimer) window.clearTimeout(retryPumpTimer);
  retryPumpTimer = 0;
  const waits = host.generationQueue.filter(item => item.status === 'queued' && Number(item.retryAt) > Date.now()).map(item => Number(item.retryAt));
  if (!waits.length) return;
  retryPumpTimer = window.setTimeout(() => {
    retryPumpTimer = 0;
    pumpGenerationQueue();
  }, Math.max(200, Math.min(...waits) - Date.now() + 50));
}
function autoRetryWillApply(id, err) {
  if (!(autoRetryAllowance.get(id) > 0) || !AutoRetry) return false;
  return AutoRetry.isRetrySafeError(err, {online: navigator.onLine !== false});
}
function pumpGenerationQueue() {
  if (host.queuePaused) return renderQueue();
  let started = false;
  for (const item of host.generationQueue) {
    if (item.status !== 'queued') continue;
    if (Number(item.retryAt) > Date.now()) continue;
    const running = host.providerRunningCounts.get(item.providerId) || 0;
    if (running >= providerConcurrencyLimit(item.providerId)) continue;
    startQueueItem(item);
    started = true;
  }
  if (started) renderQueue();
  scheduleRetryPump();
}
async function startQueueItem(item) {
  const node = getNode(item.nodeId);
  if (!node) {
    item.status = 'failed';
    item.message = '节点已不存在';
    item.finishedAt = Date.now();
    item.reject?.(new Error(item.message));
    renderQueue();
    return;
  }
  item.status = 'running';
  item.message = '生成中';
  item.startedAt = Date.now();
  item.retryAt = 0;
  item.attempts += 1;
  saveProject?.();
  host.providerRunningCounts.set(item.providerId, (host.providerRunningCounts.get(item.providerId) || 0) + 1);
  renderQueue();
  const retryLimit = AutoRetry ? AutoRetry.normalizeLimit(getAutoRetryLimit(), 1) : 0;
  const retriesUsed = Math.max(0, Number(item.autoRetries || 0));
  autoRetryAllowance.set(item.nodeId, Math.max(0, retryLimit - retriesUsed));
  try {
    const result = await runImageNow(item.nodeId);
    item.status = 'done';
    item.message = '完成';
    item.finishedAt = Date.now();
    item.resolve?.(result);
  } catch (err) {
    if (autoRetryWillApply(item.nodeId, err) && getNode(item.nodeId)) {
      const retryNumber = retriesUsed + 1;
      const delayMs = AutoRetry.delayFor(retryNumber, err);
      item.autoRetries = retryNumber;
      item.status = 'queued';
      item.retryAt = Date.now() + delayMs;
      item.message = AutoRetry.waitingMessage(retryNumber, retryLimit, delayMs);
      item.diagnosis = null;
      return;
    }
    item.status = 'failed';
    const diagnosis = diagnoseGenerationError(err, {
      providerName: item.providerName,
      model: item.model,
      mode: item.type
    });
    item.message = diagnosis.summary;
    item.diagnosis = diagnosis;
    item.finishedAt = Date.now();
    item.reject?.(err);
  } finally {
    autoRetryAllowance.delete(item.nodeId);
    if (item.status !== 'queued') quietToastNodeIds.delete(item.nodeId);
    saveProject?.();
    host.providerRunningCounts.set(item.providerId, Math.max(0, (host.providerRunningCounts.get(item.providerId) || 1) - 1));
    renderQueue();
    pumpGenerationQueue();
  }
}
function queueStatusLabel(status, message = '') {
  if (status === 'paused' && /重新打开|待继续/.test(message)) return '待继续';
  if (status === 'queued' && /自动重试/.test(message)) return '等待重试';
  return ({queued: '排队', paused: '已暂停', running: '运行中', done: '完成', failed: '失败', canceled: '已取消'})[status] || status;
}
function queueElapsed(item) {
  const start = Number(item.startedAt || item.createdAt || Date.now());
  const end = Number(item.finishedAt || Date.now());
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return seconds + ' 秒';
  return Math.floor(seconds / 60) + ' 分 ' + (seconds % 60) + ' 秒';
}
function renderQueue() {
  const queued = host.generationQueue.filter(item => item.status === 'queued').length;
  const running = host.generationQueue.filter(item => item.status === 'running').length;
  const failed = host.generationQueue.filter(item => item.status === 'failed').length;
  const active = queued + running;
  if ($('queueCount')) $('queueCount').textContent = String(active);
  if ($('queueSummary')) $('queueSummary').textContent = host.queuePaused ? `已暂停 · ${queued} 等待 · ${running} 运行` : `${queued} 等待 · ${running} 运行 · ${failed} 失败`;
  const list = $('queueList');
  if (!list) return;
  list.innerHTML = host.generationQueue.length ? host.generationQueue.map(item => `
    <article class="queue-item ${esc(item.status)}" data-queue-id="${esc(item.id)}" aria-label="${esc(item.title)}，${esc(queueStatusLabel(item.status, item.message))}">
      <div class="queue-meta"><strong>${esc(item.title)}</strong><span class="queue-state" role="status">${esc(queueStatusLabel(item.status, item.message))}</span></div>
      <span>${esc(item.providerName)}${item.model ? ' · ' + esc(item.model) : ''}</span>
      ${item.parameters ? `<span>参数：${esc(item.parameters.size || '默认尺寸')} · ${esc(item.parameters.resolution || '1K')} · ${esc(item.parameters.count || 1)} 张 · ${esc(item.parameters.quality || 'auto')}</span>` : ''}
      <span>${esc(item.message || '')}${item.diagnosis?.suggestion ? ' · ' + esc(item.diagnosis.suggestion) : ''}${item.attempts > 1 ? ' · 第 ' + item.attempts + ' 次' : ''} · 已用 ${esc(queueElapsed(item))}</span>
      ${item.status === 'running' ? `<div class="queue-progress" aria-label="任务处理中"><span></span></div>` : ''}
      <div class="queue-item-actions">
        ${item.status === 'queued' ? '<button class="ghost-btn" data-queue-up type="button" title="提高优先级" aria-label="提高优先级"><i class="fa-solid fa-arrow-up"></i></button><button class="ghost-btn" data-queue-down type="button" title="降低优先级" aria-label="降低优先级"><i class="fa-solid fa-arrow-down"></i></button>' : ''}
        ${item.status === 'queued' ? '<button class="ghost-btn" data-queue-pause type="button" title="暂停此任务">暂停</button>' : ''}
        ${item.status === 'paused' ? '<button class="ghost-btn" data-queue-resume type="button" title="继续此任务">继续</button>' : ''}
        ${item.status === 'failed' ? '<button class="ghost-btn" data-queue-retry type="button">重试</button>' : ''}
        ${item.status === 'failed' ? '<button class="ghost-btn" data-queue-edit type="button">修改参数</button>' : ''}
        ${(item.status === 'done' || item.status === 'failed' || item.status === 'canceled') ? '<button class="ghost-btn" data-queue-copy type="button">复制任务</button>' : ''}
        ${(item.status === 'queued' || item.status === 'failed' || item.status === 'canceled') ? `<button class="ghost-btn" data-queue-remove type="button">${item.status === 'queued' ? '取消' : '移除'}</button>` : ''}
      </div>
    </article>`).join('') : '<div class="queue-empty"><strong>还没有生成任务</strong><span>先在无限画布添加图片或视频节点，再回来统一运行。</span><button class="ghost-btn" data-queue-empty-canvas type="button"><i class="fa-solid fa-infinity" aria-hidden="true"></i>打开无限画布</button></div>';
}
function openQueueDrawer() {
  $('queueDrawer')?.classList.remove('hidden');
  $('queueDrawer')?.setAttribute('aria-hidden', 'false');
  renderQueue();
  if (!queueElapsedTimer) queueElapsedTimer = window.setInterval(() => {
    if (!$('queueDrawer')?.classList.contains('hidden')) renderQueue();
  }, 1000);
}
function closeQueueDrawer() {
  $('queueDrawer')?.classList.add('hidden');
  $('queueDrawer')?.setAttribute('aria-hidden', 'true');
  if (queueElapsedTimer) {
    window.clearInterval(queueElapsedTimer);
    queueElapsedTimer = 0;
  }
}
function toggleQueueDrawer() {
  const drawer = $('queueDrawer');
  drawer?.classList.toggle('hidden');
  drawer?.setAttribute('aria-hidden', String(drawer.classList.contains('hidden')));
  renderQueue();
}
function pauseQueue() {
  host.queuePaused = true;
  renderQueue();
}
function resumeQueue() {
  host.queuePaused = false;
  renderQueue();
  pumpGenerationQueue();
}
function clearQueue() {
  const keep = [];
  let canceled = 0;
  let running = 0;
  for (const item of host.generationQueue) {
    if (item.status === 'queued' || item.status === 'paused') {
      const error = new Error('生成任务已取消');
      item.status = 'canceled';
      item.message = '已取消';
      item.finishedAt = Date.now();
      item.reject?.(error);
      keep.push(item);
      canceled++;
      continue;
    }
    if (item.status === 'running') {
      keep.push(item);
      running++;
    }
  }
  host.generationQueue = keep;
  saveProject?.();
  renderQueue();
  if (running) toast(`已取消 ${canceled} 个排队任务；当前 ${running} 个运行中任务会继续完成`, 'warn');
  else if (canceled) toast(`已取消 ${canceled} 个排队任务`, 'success');
}
function pauseQueueItem(item) {
  if (!item || item.status !== 'queued') return;
  item.status = 'paused';
  item.message = '已暂停，等待继续';
  renderQueue();
  saveProject?.();
}
function resumeQueueItem(item) {
  if (!item || item.status !== 'paused') return;
  item.status = 'queued';
  item.message = '等待生成';
  item.retryAt = 0;
  renderQueue();
  saveProject?.();
  pumpGenerationQueue();
}
function retryFailedQueue() {
  const failed = host.generationQueue.filter(item => item.status === 'failed');
  if (!failed.length) return toast('没有需要重试的失败任务', 'warn');
  const nodeIds = [...new Set(failed.map(item => item.nodeId))];
  host.generationQueue = host.generationQueue.filter(item => item.status !== 'failed');
  saveProject?.();
  // Same rule as the node button: a node that shows a picture keeps it, the retry lands on a new node.
  nodeIds.forEach(nodeId => Promise.resolve(generateImageKeepingOriginal(getNode(nodeId))).catch(() => {}));
  renderQueue();
}
function moveQueueItem(item, direction) {
  if (item.status !== 'queued') return;
  const queued = host.generationQueue.filter(task => task.status === 'queued');
  const current = queued.indexOf(item);
  const target = current + direction;
  if (current < 0 || target < 0 || target >= queued.length) return;
  const other = queued[target];
  const a = host.generationQueue.indexOf(item);
  const b = host.generationQueue.indexOf(other);
  [host.generationQueue[a], host.generationQueue[b]] = [host.generationQueue[b], host.generationQueue[a]];
  renderQueue();
  saveProject?.();
}
function copyQueueItem(item) {
  const node = getNode(item?.nodeId);
  if (!node) return toast('原节点已不存在，无法复制任务', 'warn');
  if (host.generationQueue.some(task => task.nodeId === node.id && (task.status === 'queued' || task.status === 'running'))) {
    return toast('该节点的任务还在排队或生成中，完成后再复制', 'warn');
  }
  const keeps = Boolean(node.data?.url || (Array.isArray(node.data?.urls) && node.data.urls.some(Boolean)));
  Promise.resolve(generateImageKeepingOriginal(node)).catch(() => {});
  toast(keeps ? '已复制：将在右侧新节点生成，原图保留' : '已复制为新的排队任务', 'success');
}
function onQueueListClick(e) {
  const card = e.target.closest('[data-queue-id]');
  if (!card && e.target.closest('[data-queue-empty-canvas]')) {
    closeQueueDrawer();
    setActiveWorkspace?.('canvas');
    return;
  }
  const item = host.generationQueue.find(task => task.id === card?.dataset.queueId);
  if (!item) return;
  if (e.target.closest('[data-queue-up]')) return moveQueueItem(item, -1);
  if (e.target.closest('[data-queue-down]')) return moveQueueItem(item, 1);
  if (e.target.closest('[data-queue-pause]')) return pauseQueueItem(item);
  if (e.target.closest('[data-queue-resume]')) return resumeQueueItem(item);
  if (e.target.closest('[data-queue-edit]')) return focusQueueNode?.(item.nodeId);
  if (e.target.closest('[data-queue-copy]')) return copyQueueItem(item);
  if (e.target.closest('[data-queue-retry]')) {
    const nodeId = item.nodeId;
    host.generationQueue = host.generationQueue.filter(task => task.id !== item.id);
    Promise.resolve(generateImageKeepingOriginal(getNode(nodeId))).catch(() => {});
    renderQueue();
    return;
  }
  if (e.target.closest('[data-queue-remove]')) {
    const wasQueued = item.status === 'queued';
    if (wasQueued) {
      item.status = 'canceled';
      item.message = '已取消';
      item.finishedAt = Date.now();
      item.reject?.(new Error('生成任务已取消'));
    }
    if (!wasQueued) host.generationQueue = host.generationQueue.filter(task => task.id !== item.id);
    renderQueue();
    saveProject?.();
  }
}
async function runImage(id) {
  return await enqueueImageGeneration(id);
}
async function runImageNow(id, visiting = new Set()) {
  const node = getNode(id);
  if (!node) return;
  const generationStartedAt = Date.now();
  const previousUrls = Array.isArray(node.data.urls) ? [...node.data.urls] : (node.data.url ? [node.data.url] : []);
  if (visiting.has(id)) throw new Error('参考图连接出现循环，请断开循环连线');
  // Regenerating keeps the current output in the node's history (‹ › on the node).
  VariantManager?.ensureCurrentOutput(node.data, 'image');
  visiting.add(id);
  const ownPrompt = String(node.data.prompt || '');
  const linkedPrompt = getInputPrompt(id);
  const prompt = ownPrompt.trim() ? ownPrompt : linkedPrompt;
  let finalPrompt = prompt;
  const refs = await ensureInputImageRefs(id, visiting);
  // Match saved roles by url (not position) so a role can never land on the wrong image.
  const savedReferences = Array.isArray(node.data.references) ? node.data.references : [];
  const resolvedReferences = ReferenceRoles?.mergeResolvedReferences({
    nodeType: 'image',
    references: savedReferences,
    resolvedItems: refs.map((url, index) => {
      const saved = savedReferences[index]?.url === url ? savedReferences[index] : savedReferences.find(item => item?.url === url) || {};
      return Object.assign({}, saved, {url, key: saved.key || `resolved-${index}`});
    })
  }) || refs.map((url, index) => ({url, role: index === 0 ? 'source' : 'reference', order: index}));
  node.data.references = resolvedReferences;
  const imageRequest = buildImageRequest(node, resolvedReferences);
  finalPrompt = imageRequest.prompt;
  // Images are attached in role-priority order, the same order 图1…图N uses in the prompt.
  const refUrls = resolvedReferences.map(item => item.url);
  if (refUrls[0]) node.data.refUrl = refUrls[0];
  if (!refs.length) {
    node.data.refUrl = '';
    node.data.manualRefUrl = '';
    node.data.refOrder = [];
  }
  hydrateNode(node);
  if (!prompt) {
    nodeToast(id, '图片节点缺少提示词', 'warn');
    throw new Error('图片节点缺少提示词');
  }
  const provider = currentProviderForNode(node);
  const apiUrl = provider.apiUrl || FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '');
  const imageModel = imageRequest.model;
  if (node.data.model !== imageModel) {
    node.data.model = imageModel;
    deps.refreshNodeModelSelects?.();
  }
  if (!apiUrl) {
    nodeToast(id, '请先在设置里完善该图片节点选择的 API 配置和密钥', 'warn');
    throw new Error('图片节点缺少 API 配置或密钥');
  }
  if (!imageModel) {
    nodeToast(id, '请先选择或填写图像模型', 'warn');
    throw new Error('图片节点缺少图像模型');
  }
  const count = Math.max(1, Math.min(4, parseInt(node.data.count, 10) || 1));
  const capabilityCheck = assertImageModelCapability(node, provider, imageModel, resolvedReferences);
  const budgetRequest = {
    operation: resolvedReferences.length ? 'edit' : 'generate',
    aspect: node.data.aspect || '',
    resolution: node.data.resolution || '1K',
    count,
    references: resolvedReferences
  };
  let budgetEntryId = '';
  let budgetActualRequests = 0;
  budgetEntryId = await authorizeGenerationBudget?.({node, provider, model: imageModel, kind: 'image', request: budgetRequest, profile: capabilityCheck?.profile}) || '';
  const btn = node.el.querySelector('[data-run="image"]');
  const composerSend = btn?.classList.contains('composer-send');
  setImageStatus(
    node,
    'running',
    refUrls.length > 1 ? '正在按当前缩略图顺序提交多张参考图' : refUrls.length ? '正在提交参考图生成' : '正在提交文生图生成',
    refUrls.length ? '图生图生成中...' : '文生图生成中...'
  );
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = composerSend
      ? '<i class="fa-solid fa-spinner fa-spin"></i>'
      : (refUrls.length ? '图生图生成中...' : '文生图生成中...');
  }
  try {
    const urls = new Array(count);
    const outputModels = new Array(count);
    const requestRecords = [];
    const errors = new Array(count);
    const targetSize = imageTargetSize(node.data);
    if (!targetSize) throw new Error('自定义尺寸请填写 64-16384 之间的宽和高。');
    const requestSize = apiCompatibleImageSize(targetSize);
    const variantSeedFor = index => {
      const raw = String(node.data.seed || '').trim();
      const base = Number.parseInt(raw, 10);
      if (raw && Number.isFinite(base)) return base + index;
      return Math.floor(Math.random() * 2147483646) + 1 + index;
    };
    const completedCount = () => urls.filter(Boolean).length;
    const applyPartialOutputs = () => {
      const ready = urls.filter(Boolean);
      if (!ready.length) return;
      node.data.urls = ready;
      node.data.url = ready[0] || '';
      node.data.outputModel = outputModels[urls.findIndex(Boolean)] || '';
      hydrateNode(node);
    };
    const runOneImageRequest = async i => {
      const seed = variantSeedFor(i);
      setImageStatus(node, 'running', `正在生成第 ${i + 1}/${count} 张`, count > 1 ? `文生图 ${i + 1}/${count}` : (refUrls.length ? '图生图生成中...' : '文生图生成中...'));
      {
        const requestApiKey = provider.type === 'custom-sync' ? '' : await providerApiKey(provider);
        if (!requestApiKey && provider.type !== 'custom-sync') throw new Error('图片节点没有可用的 Key，请先在设置中保存 API Key');
        let requestError = null;
        let referenceProfile = '';
        let requestRecord;
        try {
          budgetActualRequests += 1;
          requestRecord = {...imageRequest, seed: deps.imageRequestSeedFields?.({model: imageModel, seed})?.seed ?? null, provider: provider.name || provider.id, providerId: provider.id || '', keyLabel: provider.useGlobalKey ? '全局 Key' : '服务 Key', requestedModel: imageModel, status: 'submitted', submittedAt: Date.now()};
          requestRecords.push(requestRecord);
          node.data.lastImageRequest = requestRecord;
          saveProject();
          const result = refUrls.length
            ? await imageEditWithFallback({...imageRequest, provider, apiUrl, apiKey: requestApiKey, model: imageModel, prompt: finalPrompt, size: requestSize, resolution: node.data.resolution || '1K', quality: imageRequest.quality, seed, refUrls, references: resolvedReferences, onFallback: text => setImageStatus(node, 'running', text, '多参考图兼容生成中...')})
            : await imageGenerateRequest({...imageRequest, provider, apiUrl, apiKey: requestApiKey, model: imageModel, prompt: finalPrompt, size: requestSize, quality: imageRequest.quality, resolution: node.data.resolution || '1K', seed});
      outputModels[i] = result.model || imageModel;
      Object.assign(requestRecord, {adapterModel: outputModels[i], status: 'received'});
      if (result.fallback) {
        Object.assign(requestRecord, {fallbackNote: result.fallback.note, provider: result.fallback.providerName, providerId: result.fallback.providerId});
      }
      const persistedUrl = await persistGeneratedImageResult(result, `generated_image_${Date.now()}_${i + 1}`, 'png');
      urls[i] = persistedUrl;
      if (/^https?:/i.test(String(result.url))) requestRecord.sourceUrl = String(result.url);
      requestRecord.status = 'saved';
          errors[i] = null;
          setImageStatus(node, 'running', `已完成 ${completedCount()}/${count} 张`, count > 1 ? `多张生成 ${completedCount()}/${count}` : '');
          applyPartialOutputs();
          return;
        } catch (err) {
          requestError = err;
          // The provider already accepted the request (result or task id received): a re-run could charge again.
          if (requestRecord && requestRecord.status !== 'submitted' && err && typeof err === 'object') {
            try { err.afterSubmit = true; } catch (_) {}
          }
          if (requestRecord) requestRecord.status = 'failed';
          if (imageRequest.allowReferenceFallback && refUrls.length && isApiGatewayTimeoutError(err)) {
            try {
              budgetActualRequests += 1;
              const fallback = await referenceGuidedImageFallback({
                provider,
                apiUrl,
                apiKey: requestApiKey,
                model: imageModel,
                prompt: finalPrompt,
                size: requestSize,
                quality: imageRequest.quality,
                seed,
                refUrls,
                referenceProfile,
                onStatus: text => setImageStatus(node, 'running', text, '参考特征兼容生成中...')
              });
              referenceProfile = fallback.referenceProfile;
              outputModels[i] = fallback.model || imageModel;
              const persistedUrl = await persistGeneratedImageResult(fallback, `generated_image_${Date.now()}_${i + 1}`, 'png');
              if (requestRecord) Object.assign(requestRecord, {adapterModel: outputModels[i], status: 'saved', ...(/^https?:/i.test(String(fallback.url)) ? {sourceUrl: String(fallback.url)} : {})});
              urls[i] = persistedUrl;
              errors[i] = null;
              setImageStatus(node, 'running', `已完成 ${completedCount()}/${count} 张`, count > 1 ? `多张生成 ${completedCount()}/${count}` : '');
              applyPartialOutputs();
              return;
            } catch (fallbackErr) {
              requestError = new Error(`${err.message || String(err)}\n\n参考图兼容生成也未成功：${fallbackErr.message || String(fallbackErr)}`);
            }
          }
          throw requestError;
        }
      }
    };
    let nextRequestIndex = 0;
    const requestConcurrency = Math.max(1, Math.min(count, Number(provider.concurrency || 1)));
    const workers = Array.from({length: requestConcurrency}, async () => {
      while (nextRequestIndex < count) {
        const requestIndex = nextRequestIndex++;
        try {
          await runOneImageRequest(requestIndex);
        } catch (err) {
          errors[requestIndex] = err;
        }
      }
    });
    const workerResults = await Promise.allSettled(workers);
    const completedUrls = urls.filter(Boolean);
    const failedCount = errors.filter(Boolean).length;
    if (!completedUrls.length) {
      const failedWorker = workerResults.find(item => item.status === 'rejected');
      const firstError = failedWorker?.reason || errors.find(Boolean) || new Error('全部图片生成失败');
      if (errors.some(error => error?.afterSubmit) && firstError && typeof firstError === 'object') {
        try { firstError.afterSubmit = true; } catch (_) {}
      }
      throw firstError;
    }
    const firstReadyIndex = urls.findIndex(Boolean);
    node.data.prompt = ownPrompt || node.data.prompt;
    node.data.urls = completedUrls;
    node.data.url = completedUrls[0] || '';
    node.data.outputModel = outputModels[firstReadyIndex] || imageModel;
    node.data.generatedAt = Date.now();
    const outputRecords = [];
    for (let index = 0; index < count; index += 1) {
      if (urls[index]) {
        outputRecords.push({
          url: urls[index],
          mediaType: 'image',
          status: 'unseen',
          model: outputModels[index] || imageModel,
          provider: provider.name || provider.id || '',
          prompt: finalPrompt,
          parameters: Object.assign({}, budgetRequest, {quality: imageRequest.quality, seed: variantSeedFor(index)}),
          elapsedMs: Date.now() - generationStartedAt,
          estimatedCost: node.data.lastEstimatedCost || null,
          createdAt: Date.now() + index
        });
      } else if (errors[index]) {
        outputRecords.push({
          mediaType: 'image',
          status: 'revision',
          model: imageModel,
          provider: provider.name || provider.id || '',
          prompt: finalPrompt,
          parameters: Object.assign({}, budgetRequest, {quality: imageRequest.quality}),
          elapsedMs: Date.now() - generationStartedAt,
          error: errors[index]?.message || String(errors[index]),
          createdAt: Date.now() + index
        });
      }
    }
    VariantManager?.recordOutputs(node.data, outputRecords);
    Provenance?.recordNodeOutputs(node.data, completedUrls.map((url, index) => ({
      url,
      mediaType: 'image',
      providerId: provider.id || '',
      providerName: provider.name || '',
      modelId: outputModels[urls.indexOf(url)] || imageModel,
      capabilityProfileVersion: capabilityCheck?.profile?.profileVersion || 1,
      requestProtocol: provider.type || 'openai-compatible',
      prompt: finalPrompt,
      parameters: Object.assign({}, budgetRequest, {quality: imageRequest.quality}),
      references: resolvedReferences,
      requested: {size: targetSize},
      estimatedCost: node.data.lastEstimatedCost || null,
      generatedAt: Date.now() + index
    })));
    setImageStatus(node, '', '', '');
    refreshDownstreamLinkedInputs(node.id);
    addHistory({url: node.data.url, urls: completedUrls, refUrl: refUrls[0] || '', prompt: finalPrompt, model: node.data.outputModel, requestedModel: imageModel, outputModels: urls.flatMap((url, index) => url ? [outputModels[index] || imageModel] : []), provider: provider.name, size: targetSize, request: {...imageRequest}, requests: requestRecords.map(record => ({...record})), time: Date.now()});
    saveProject();
    if (failedCount) nodeToast(id, `生成完成：${completedUrls.length} 张成功，${failedCount} 张失败`, 'warn');
    else nodeToast(id, '生成完成：' + completedUrls.length + ' 张', 'success');
    completeGenerationBudget?.(budgetEntryId, {actualRequests: budgetActualRequests, status: 'completed', differenceReason: failedCount ? `${failedCount} 张失败，已保留 ${completedUrls.length} 张成功结果` : (budgetActualRequests > count ? '参考图兼容回退增加了请求' : '')});
    return true;
  } catch (err) {
    const formatted = formatImageGenerationError(err, {
      refCount: refUrls.length,
      providerName: provider.name,
      model: imageModel,
      endpoint: refUrls.length ? provider.editEndpoint || '/images/edits' : provider.imageEndpoint || provider.endpoint
    });
    // Keep the last successful output visible after a failed retry.
    node.data.urls = previousUrls;
    node.data.url = previousUrls[0] || '';
    VariantManager?.recordOutputs(node.data, [{
      mediaType: 'image',
      status: 'revision',
      model: imageModel,
      provider: provider.name || provider.id || '',
      prompt: finalPrompt,
      parameters: budgetRequest,
      elapsedMs: Date.now() - generationStartedAt,
      error: err?.message || String(err),
      createdAt: Date.now()
    }]);
    const willRetry = autoRetryWillApply(id, err);
    if (willRetry) setImageStatus(node, 'running', '服务暂时繁忙或网络中断，稍后自动重试…', '等待自动重试');
    else setImageStatus(node, 'error', formatted, imageErrorTitle(refUrls.length), {safety: isSafetyError(err)});
    refreshDownstreamLinkedInputs(node.id);
    saveProject();
    completeGenerationBudget?.(budgetEntryId, {actualRequests: budgetActualRequests, status: 'failed', differenceReason: err?.message || '生成失败'});
    if (err && typeof err === 'object') { try { err.formattedMessage = formatted; } catch (_) {} }
    if (willRetry) nodeToast(id, `${nodeDisplayTitle(node)}：服务暂时繁忙或网络中断，稍后会自动重试`, 'warn');
    else nodeToast(id, formatted, 'error');
    throw err;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = composerSend
        ? '<i class="fa-solid fa-arrow-up"></i>'
        : '<i class="fa-solid fa-wand-magic-sparkles"></i> 生成图像 / 图生图';
    }
  }
}
    return {
      buildImageRequest,
      previewImageRequest,
      providerConcurrencyLimit,
      enqueueImageGeneration,
      pumpGenerationQueue,
      startQueueItem,
      queueStatusLabel,
      renderQueue,
      openQueueDrawer,
      closeQueueDrawer,
      toggleQueueDrawer,
      pauseQueue,
      resumeQueue,
      clearQueue,
      retryFailedQueue,
      pauseQueueItem,
      resumeQueueItem,
      copyQueueItem,
      onQueueListClick,
      runImage,
      runImageNow
    };
  }

  window.FutureAIGenerationQueue = { create };
})();
