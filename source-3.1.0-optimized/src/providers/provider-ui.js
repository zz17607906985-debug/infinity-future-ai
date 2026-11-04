(() => {
  'use strict';

  /**
   * Provider settings cards + conformance UI.
   * Provider request protocol lives in providers/provider-api.js.
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    const wait = deps.wait;
    const fetchJsonWithRetry = deps.fetchJsonWithRetry;
    const API_TIMEOUTS = deps.API_TIMEOUTS;
    const IMAGE_PROVIDER_TYPES = deps.IMAGE_PROVIDER_TYPES || [];
    const STORE = deps.STORE;
    const getStore = deps.getStore;
    const setStore = deps.setStore;
    const saveSettings = deps.saveSettings;
    const onBalanceDisplayChange = deps.onBalanceDisplayChange;
    const renderModels = deps.renderModels;
    const refreshNodeProviderSelects = deps.refreshNodeProviderSelects;
    const refreshNodeModelSelects = deps.refreshNodeModelSelects;
    const refreshNodeCapabilityControls = deps.refreshNodeCapabilityControls;
    const ModelCapabilities = deps.ModelCapabilities || window.FutureAIModelCapabilities;
    const unique = deps.unique;
    const ProviderConformance = deps.ProviderConformance;
    const secretBridge = () => window.secretBridge;
    // Model helpers still owned by app shell
    const applyImportedModelsToProvider = deps.applyImportedModelsToProvider;
    const applyImportedModelRecordsToProvider = deps.applyImportedModelRecordsToProvider;
    const extractModelIds = deps.extractModelIds;
  const extractModelRecords = deps.extractModelRecords;
  const globalProviderForKind = deps.globalProviderForKind;
    const assertUsableApiBaseAddress = deps.assertUsableApiBaseAddress;
    const assertModelListResponse = deps.assertModelListResponse;
    const modelImportSummary = deps.modelImportSummary;
    const modelsForKind = deps.modelsForKind;
    const firstImportedModelForKind = deps.firstImportedModelForKind;
    const effectiveImageModel = deps.effectiveImageModel;
    const expandKnownModelAliases = deps.expandKnownModelAliases;
    const providerModelsForKind = deps.providerModelsForKind;
    const normalizeModelRecords = deps.normalizeModelRecords;
    // Protocol helpers (wrappers → providerApi)
    const fetchApiWithBaseFallback = deps.fetchApiWithBaseFallback;
    const safeJson = deps.safeJson;
    const apiErrorMessage = deps.apiErrorMessage;
    const imageGenerateRequest = deps.imageGenerateRequest;
    const imageEditWithFallback = deps.imageEditWithFallback;
    const videoGenerateRequest = deps.videoGenerateRequest;
    const chatCompletionTextRequest = deps.chatCompletionTextRequest;
    const joinApiPath = deps.joinApiPath;
    const applyKnownImageProtocol = deps.applyKnownImageProtocol;
    const saveKnownImageProtocolCorrection = deps.saveKnownImageProtocolCorrection;
    const openModal = deps.openModal;
    const getNode = deps.getNode || (id => null);
    const nodes = { get: id => getNode(id) };
    const saveProject = deps.saveProject;
    const saveProjects = deps.saveProjects;
    const loadProject = deps.loadProject;
    const classifyModelKind = deps.classifyModelKind;
    const modelFieldForKind = deps.modelFieldForKind;
    const inputIdForModelKind = deps.inputIdForModelKind;
    const isZexImageGateway = deps.isZexImageGateway;
    const normalizeKnownImageModelAlias = deps.normalizeKnownImageModelAlias;
    const setGlobalModelValue = deps.setGlobalModelValue;
    const setGlobalProviderValue = deps.setGlobalProviderValue;
  const syncGlobalModelInputs = deps.syncGlobalModelInputs;
  const modelKindLabel = deps.modelKindLabel;
  const requestImageGenerationWithModel = deps.requestImageGenerationWithModel;
  const loadImageForCanvas = deps.loadImageForCanvas;
  const rawImageEditRequest = deps.rawImageEditRequest;
  const rawImageGenerationWithModel = deps.rawImageGenerationWithModel;
  const KeyPool = deps.KeyPool || window.FutureAIKeyPool;
  const providerKeyCache = new Map();
  // Instantaneous per-key load stays in memory only; never persist it with provider settings.
  const providerKeyRunningCounts = new Map();
  const providerKeyLeases = new Map();
  let providerConformanceProviderId = '';
  let providerConformanceRunning = false;

function providerKeyRunningKey(provider, keyId) {
  return `${provider?.id || ''}:${keyId || ''}`;
}
function providerKeyRunningCount(provider, keyId) {
  return Number(providerKeyRunningCounts.get(providerKeyRunningKey(provider, keyId)) || 0);
}
function providerKeyRunningSnapshot(provider) {
  return Object.fromEntries((provider?.keyPool || []).map(item => [item.id, providerKeyRunningCount(provider, item.id)]));
}
function changeProviderKeyRunningCount(provider, keyId, delta) {
  if (!provider?.id || !keyId) return 0;
  const mapKey = providerKeyRunningKey(provider, keyId);
  const next = Math.max(0, providerKeyRunningCount(provider, keyId) + Number(delta || 0));
  if (next) providerKeyRunningCounts.set(mapKey, next);
  else providerKeyRunningCounts.delete(mapKey);
  return next;
}
function recordProviderKeyLease(provider, capability, keyId) {
  const leaseKey = `${provider?.id || ''}:${capability || 'all'}`;
  const leases = providerKeyLeases.get(leaseKey) || [];
  leases.push(keyId);
  providerKeyLeases.set(leaseKey, leases);
}
function consumeProviderKeyLease(provider, capability, preferredId = '') {
  const leaseKey = `${provider?.id || ''}:${capability || 'all'}`;
  const leases = providerKeyLeases.get(leaseKey) || [];
  const keyId = KeyPool?.takeLease?.(leases, preferredId) || leases.shift() || '';
  if (leases.length) providerKeyLeases.set(leaseKey, leases);
  else providerKeyLeases.delete(leaseKey);
  return keyId;
}
function releaseProviderKeyLease(provider, capability, preferredId = '') {
  const leasedId = consumeProviderKeyLease(provider, capability, preferredId);
  if (leasedId) changeProviderKeyRunningCount(provider, leasedId, -1);
  return Boolean(leasedId);
}

function providerTypeLabel(type) {
  return IMAGE_PROVIDER_TYPES.find(item => item.id === type)?.label || 'OpenAI Images';
}
function providerTypeMeta(type) {
  return IMAGE_PROVIDER_TYPES.find(item => item.id === type) || IMAGE_PROVIDER_TYPES[0];
}
function providerTypeOptionsHtml(current = '', protocolMode = 'manual') {
  const visibleIds = new Set(['openai-images', 'chat-image', 'custom-sync']);
  const visible = IMAGE_PROVIDER_TYPES.filter(item => visibleIds.has(item.id));
  const currentMeta = IMAGE_PROVIDER_TYPES.find(item => item.id === current);
  const options = currentMeta && !visibleIds.has(current) ? [currentMeta, ...visible] : visible;
  return `<option value="__auto__" ${protocolMode === 'auto' ? 'selected' : ''}>自动识别</option>`
    + options.map(item => `<option value="${esc(item.id)}" ${protocolMode !== 'auto' && item.id === current ? 'selected' : ''}>${esc(item.label)}</option>`).join('');
}
function providerSupports(provider, capability) {
  const meta = providerTypeMeta(provider?.type).supports || {};
  if (capability === 'text') return Boolean(meta.text || provider?.chatModel || provider?.chatEndpoint);
  if (capability === 'image') return Boolean(meta.image || provider?.imageModel || provider?.imageEndpoint);
  if (capability === 'edit') return Boolean(meta.edit || provider?.editEndpoint);
  if (capability === 'video') return Boolean(meta.video || provider?.videoModel || provider?.videoEndpoint);
  return Boolean(meta[capability]);
}
function defaultEndpointForProvider(type, kind) {
  if (kind === 'chat') return '/chat/completions';
  if (kind === 'image') return type === 'chat-image' ? '/chat/completions' : '/images/generations';
  if (kind === 'edit') return '/images/edits';
  if (kind === 'video') return '';
  if (kind === 'videoQuery') return '/video/query';
  if (kind === 'models') return '/models';
  return '';
}
function providerProtocolMode(provider = {}) {
  if (provider.protocolMode === 'manual') return 'manual';
  if (provider.protocolMode === 'auto') return 'auto';
  // Preserve existing non-default custom configurations until the user opts into auto mode.
  return provider.type && provider.type !== 'openai-images' ? 'manual' : 'auto';
}
function providerProtocolStatusText(provider = {}) {
  const label = providerTypeLabel(provider.detectedProtocol || provider.type);
  if (providerProtocolMode(provider) === 'manual') return `手动协议 · ${label}`;
  if (provider.detectedProtocol) return `自动识别 · ${label}`;
  if (provider.protocolMessage) return '自动识别 · 待确认';
  return '自动识别 · 保存时检测';
}
function protocolSignalType(apiUrl = '') {
  const value = String(apiUrl || '').toLowerCase();
  if (/(?:dashscope|aliyuncs|wanx|bailian)/i.test(value)) return 'dashscope-wanx';
  if (/(?:volcengine|volces|ark\.|doubao|火山)/i.test(value)) return 'volcengine-ark';
  if (/(?:siliconflow|硅基流动)/i.test(value)) return 'siliconflow';
  if (/(?:openai|chat\/completions|images\/generations|images\/edits)/i.test(value)) return 'openai-images';
  return '';
}
function modelListLooksLikeOpenAi(data, models = []) {
  return Array.isArray(data?.data)
    || data?.object === 'list'
    || (models.length > 0 && Array.isArray(data?.data));
}
async function detectProviderProtocol(provider, apiUrl, apiKey = '') {
  const hintedType = protocolSignalType(apiUrl);
  const result = {
    type: hintedType || '',
    confidence: hintedType ? 'medium' : 'low',
    message: hintedType ? `已根据地址识别为${providerTypeLabel(hintedType)}` : '',
    source: hintedType ? 'address' : 'fallback',
    models: [],
    modelRecords: [],
    usedV1Fallback: false
  };
  if (!apiUrl) return result;
  try {
    const headers = apiKey ? {Authorization: 'Bearer ' + apiKey} : {};
    const probe = await fetchApiWithBaseFallback(apiUrl, '/models', {
      timeoutMs: 15000,
      retries: 0,
      headers
    });
    const data = await safeJson(probe.res);
    const modelRecords = probe.res.ok ? extractModelRecords(data) : [];
    const models = modelRecords.map(record => record.id);
    result.modelRecords = modelRecords;
    result.models = models;
    result.usedV1Fallback = Boolean(probe.usedV1Fallback);
    if (probe.res.ok && (modelListLooksLikeOpenAi(data, models) || models.length)) {
      if (!hintedType) {
        result.type = 'openai-images';
        result.confidence = 'high';
        result.source = 'models';
        result.message = '已通过 /models 识别为 OpenAI 兼容接口';
      } else {
        result.confidence = 'high';
        result.source = 'address+models';
        result.message = `已识别为${providerTypeLabel(hintedType)}，模型列表可用`;
      }
      return result;
    }
  } catch {
    // Address signals remain useful when a gateway does not expose /models.
  }
  if (hintedType) return result;
  result.message = '未能确认接口协议，将按 OpenAI 兼容方式尝试；如请求失败请到高级接口设置手动选择。';
  return result;
}
function applyDetectedProviderProtocol(provider, detected = {}) {
  if (!provider || providerProtocolMode(provider) !== 'auto') return false;
  const nextType = String(detected.type || '').trim();
  provider.detectedProtocol = nextType;
  provider.protocolConfidence = String(detected.confidence || 'low');
  provider.protocolMessage = String(detected.message || '').trim();
  provider.protocolDetectedAt = Date.now();
  if (!nextType) return false;
  const changed = provider.type !== nextType;
  provider.type = nextType;
  provider.chatEndpoint = defaultEndpointForProvider(nextType, 'chat');
  provider.imageEndpoint = defaultEndpointForProvider(nextType, 'image');
  provider.editEndpoint = defaultEndpointForProvider(nextType, 'edit');
  provider.videoEndpoint = defaultEndpointForProvider(nextType, 'video');
  provider.videoQueryEndpoint = defaultEndpointForProvider(nextType, 'videoQuery');
  provider.imageTaskMode = nextType === 'dashscope-wanx' || nextType === 'volcengine-ark' ? 'async' : 'sync';
  provider.enabledText = providerSupports(provider, 'text');
  provider.enabledImage = providerSupports(provider, 'image');
  provider.enabledVideo = providerSupports(provider, 'video');
  if (changed) {
    provider.imageCapabilityStatus = 'unknown';
    provider.imageCapabilityMessage = '';
    provider.imageCapabilityKeyId = '';
    provider.imageCapabilityByKey = {};
    provider.lastTest = {status: '', message: '', checkedAt: 0};
  }
  return changed;
}
async function autoDetectProviderProtocol(provider, apiUrl, apiKey = '') {
  if (!provider || providerProtocolMode(provider) !== 'auto') return null;
  const detected = await detectProviderProtocol(provider, apiUrl, apiKey);
  applyDetectedProviderProtocol(provider, detected);
  saveSettings();
  return detected;
}
function defaultApiProvider(overrides = {}) {
  return normalizeApiProvider(Object.assign({
    id: 'default-openai',
    name: '默认 OpenAI 兼容',
    type: 'openai-images',
    protocolMode: 'auto',
    apiUrl: $('apiUrl')?.value || 'https://nexusapi.cn/v1',
    useGlobalKey: true,
    chatModel: $('chatModel')?.value || 'gpt-4o-mini',
    imageModel: $('imageModel')?.value || 'gpt-image2',
    videoModel: $('videoModel')?.value || 'sora-2',
    models: [],
    concurrency: 1,
    chatEndpoint: '/chat/completions',
    imageEndpoint: '/images/generations',
    editEndpoint: '/images/edits',
    imageRequestFormat: 'auto',
    imageOutpaintPolicy: 'never',
    imageTaskMode: 'sync',
    imageQueryEndpoint: '/image/query',
    imageTaskIdPath: 'task_id',
    imageTaskStatusPath: 'status',
    imageTaskResultPath: 'data.0.url',
    imagePollIntervalMs: 3000,
    imageMaxPollAttempts: 120,
    videoEndpoint: '',
    videoQueryEndpoint: '/video/query',
    responsePath: '',
    videoResponsePath: ''
  }, overrides));
}
function normalizeImageCapabilityByKey(value = {}, keys = []) {
  const validIds = new Set((keys || []).map(item => String(item?.id || '')).filter(Boolean));
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).map(([keyId, record]) => [String(keyId || ''), {
    status: ['unknown', 'available', 'blocked'].includes(record?.status) ? record.status : 'unknown',
    message: String(record?.message || '').slice(0, 240),
    checkedAt: Number(record?.checkedAt || 0)
  }]).filter(([keyId]) => keyId && (keyId === '__global__' || validIds.has(keyId))));
}
function normalizeApiProvider(provider = {}) {
  const id = String(provider.id || 'provider-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  const type = String(provider.type || 'openai-images');
  const legacyEndpoint = String(provider.endpoint || '').trim();
  const apiUrl = String(provider.apiUrl || '').trim().replace(/\/$/, '');
  const name = String(provider.name || providerTypeLabel(type));
  const models = unique(Array.isArray(provider.models) ? provider.models.map(model => String(model || '').trim()).filter(Boolean) : []);
  const modelCatalog = normalizeModelRecords(provider.modelCatalog || []).map(record => ({
    id: record.id,
    label: record.label,
    kind: record.kind || classifyModelKind(`${record.id} ${record.label}`)
  }));
  const imageModel = normalizeKnownImageModelAlias(provider.imageModel, {apiUrl, name, models});
  const lastTest = provider.lastTest && typeof provider.lastTest === 'object' ? provider.lastTest : {};
  const imageCapabilityStatus = ['unknown', 'available', 'blocked'].includes(provider.imageCapabilityStatus) ? provider.imageCapabilityStatus : 'unknown';
  const keyPool = KeyPool?.migrateLegacyProviderKey(provider, Boolean(provider.apiKeySaved || provider.apiKey)) || {keys: [], activeKeyId: ''};
  const modelKeyBindings = KeyPool?.normalizeModelKeyBindings?.(provider.modelKeyBindings, keyPool.keys) || {};
  const imageCapabilityByKey = normalizeImageCapabilityByKey(provider.imageCapabilityByKey, keyPool.keys);
  return {
    id,
    name,
    type,
    protocolMode: providerProtocolMode(provider),
    detectedProtocol: String(provider.detectedProtocol || '').trim(),
    protocolConfidence: String(provider.protocolConfidence || '').trim(),
    protocolMessage: String(provider.protocolMessage || '').trim(),
    protocolDetectedAt: Number(provider.protocolDetectedAt || 0),
    apiUrl,
    apiKeySaved: Boolean(provider.apiKeySaved || provider.apiKey || keyPool.keys.length),
    keyPool: keyPool.keys,
    activeKeyId: keyPool.activeKeyId,
    modelKeyBindings,
    keyRotationMode: 'round-robin',
    useGlobalKey: provider.useGlobalKey !== false,
    chatModel: String(provider.chatModel || provider.textModel || '').trim(),
    imageModel,
    videoModel: String(provider.videoModel || '').trim(),
    models,
    modelCatalog,
    setupStatus: ['idle', 'ready', 'needs-model', 'needs-key', 'failed'].includes(provider.setupStatus) ? provider.setupStatus : 'idle',
    setupMessage: String(provider.setupMessage || '').trim(),
    setupModelsCount: Math.max(0, Number(provider.setupModelsCount || 0)),
    imageModelsFetchedAt: Number(provider.imageModelsFetchedAt || 0),
    concurrency: Math.max(1, Math.min(4, Number(provider.concurrency || 1))),
    chatEndpoint: String(provider.chatEndpoint || defaultEndpointForProvider(type, 'chat')).trim(),
    imageEndpoint: String(provider.imageEndpoint || legacyEndpoint || defaultEndpointForProvider(type, 'image')).trim(),
    editEndpoint: String(provider.editEndpoint || defaultEndpointForProvider(type, 'edit')).trim(),
    imageRequestFormat: ['auto', 'size', 'width-height', 'aspect-ratio', 'size-and-aspect'].includes(String(provider.imageRequestFormat || 'auto')) ? String(provider.imageRequestFormat || 'auto') : 'auto',
    imageOutpaintPolicy: ['auto', 'never'].includes(provider.imageOutpaintPolicy) ? provider.imageOutpaintPolicy : 'never',
    imageAcceptedSizes: unique((Array.isArray(provider.imageAcceptedSizes) ? provider.imageAcceptedSizes : String(provider.imageAcceptedSizes || '').split(/[,，\s]+/)).map(size => String(size || '').trim()).filter(size => /^\d+x\d+$/i.test(size))),
    imageModelSizeProfiles: provider.imageModelSizeProfiles && typeof provider.imageModelSizeProfiles === 'object' ? provider.imageModelSizeProfiles : {},
    modelCapabilityProfiles: provider.modelCapabilityProfiles && typeof provider.modelCapabilityProfiles === 'object' ? provider.modelCapabilityProfiles : {},
    imageSupportsArbitrarySize: provider.imageSupportsArbitrarySize === true || isZexImageGateway(provider),
    imageTaskMode: ['sync', 'async'].includes(provider.imageTaskMode) ? provider.imageTaskMode : (type === 'dashscope-wanx' || type === 'volcengine-ark' ? 'async' : 'sync'),
    imageQueryEndpoint: String(provider.imageQueryEndpoint || '/image/query').trim(),
    imageTaskIdPath: String(provider.imageTaskIdPath || 'task_id').trim(),
    imageTaskStatusPath: String(provider.imageTaskStatusPath || 'status').trim(),
    imageTaskResultPath: String(provider.imageTaskResultPath || provider.responsePath || 'data.0.url').trim(),
    imagePollIntervalMs: Math.max(1000, Math.min(30000, Number(provider.imagePollIntervalMs || 3000))),
    imageMaxPollAttempts: Math.max(1, Math.min(300, Number(provider.imageMaxPollAttempts || 120))),
    videoEndpoint: String(provider.videoEndpoint || defaultEndpointForProvider(type, 'video')).trim(),
    videoQueryEndpoint: String(provider.videoQueryEndpoint || defaultEndpointForProvider(type, 'videoQuery')).trim(),
    endpoint: legacyEndpoint,
    responsePath: String(provider.responsePath || '').trim(),
    videoResponsePath: String(provider.videoResponsePath || '').trim(),
    enabledText: provider.enabledText !== false && providerSupports({type}, 'text'),
    enabledImage: provider.enabledImage !== false && providerSupports({type}, 'image'),
    imageCapabilityStatus,
    imageCapabilityMessage: String(provider.imageCapabilityMessage || '').trim(),
    imageCapabilityKeyId: String(provider.imageCapabilityKeyId || '').trim(),
    imageCapabilityByKey,
    enabledVideo: provider.enabledVideo === true && providerSupports({type}, 'video'),
    collapsed: Boolean(provider.collapsed),
    lastTest: {
      status: lastTest.status || '',
      message: lastTest.message || '',
      checkedAt: lastTest.checkedAt || 0
    },
    lastConformance: provider.lastConformance?.schema === 'future-ai-provider-conformance/v1' ? provider.lastConformance : null
  };
}
function ensureApiProviders(settings = null) {
  if (!settings && host.apiProviders.length) return host.apiProviders;
  settings = settings || getStore(STORE.settings, {});
  const saved = Array.isArray(settings?.apiProviders)
    ? settings.apiProviders
    : Array.isArray(settings?.host?.apiProviders)
      ? settings.host.apiProviders
      : [];
  migrateLegacyProviderKeys(saved);
  host.apiProviders = saved.map(normalizeApiProvider).filter(provider => provider.id);
  if (!host.apiProviders.length) {
    host.apiProviders = [defaultApiProvider({
      apiUrl: settings.apiUrl || $('apiUrl')?.value || 'https://nexusapi.cn/v1',
      imageModel: settings.imageModel || $('imageModel')?.value || 'gpt-image2'
    })];
  }
  if (!host.apiProviders.some(provider => provider.id === 'default-openai')) {
    host.apiProviders.unshift(defaultApiProvider({
      apiUrl: settings.apiUrl || $('apiUrl')?.value || 'https://nexusapi.cn/v1',
      imageModel: settings.imageModel || $('imageModel')?.value || 'gpt-image2'
    }));
  }
  host.apiProviders = uniqueById(host.apiProviders).map(normalizeApiProvider);
  renderApiProviders();
  return host.apiProviders;
}
function migrateLegacyProviderKeys(savedProviders = []) {
  if (!window.secretBridge?.setProviderApiKey) return;
  savedProviders.forEach(provider => {
    if (!provider?.id || !provider.apiKey) return;
    window.secretBridge.setProviderApiKey(provider.id, provider.apiKey)
      .then(() => {
        const item = host.apiProviders.find(next => next.id === provider.id);
        if (item) item.apiKeySaved = true;
      })
      .catch(err => console.warn('provider api key migration failed', err));
  });
}
function uniqueById(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
function syncLegacyApiProvider() {
  if (!host.apiProviders.length) return;
  const provider = host.apiProviders.find(item => item.id === 'default-openai') || host.apiProviders[0];
  if (!provider || provider.id !== 'default-openai') return;
  provider.apiUrl = $('apiUrl')?.value.trim().replace(/\/$/, '') || provider.apiUrl;
  provider.chatModel = $('chatModel')?.value.trim() || provider.chatModel;
  provider.imageModel = $('imageModel')?.value.trim() || provider.imageModel;
  provider.videoModel = $('videoModel')?.value.trim() || provider.videoModel;
}
function providerOptionsHtml(current = '', capability = 'image') {
  ensureApiProviders();
  const capable = host.apiProviders.filter(provider => providerSupports(provider, capability));
  const source = capable.length ? capable : host.apiProviders;
  const globalProvider = globalProviderForKind(capability === 'video' ? 'video' : capability === 'text' ? 'chat' : 'image');
  const globalLabel = globalProvider ? `跟随全局 · ${globalProvider.name || providerTypeLabel(globalProvider.type)}` : '跟随全局';
  return `<option value="" ${!current ? 'selected' : ''}>${esc(globalLabel)}</option>`
    + source.map(provider => `<option value="${esc(provider.id)}" ${provider.id === current ? 'selected' : ''}>${esc(provider.name)} · ${esc(providerTypeLabel(provider.type))}</option>`).join('');
}
function currentProviderForNode(node, capability = 'image') {
  ensureApiProviders();
  const preferred = host.apiProviders.find(provider => provider.id === node?.data?.providerId && providerSupports(provider, capability));
  const globalKind = capability === 'video' ? 'video' : capability === 'text' ? 'chat' : 'image';
  return preferred || globalProviderForKind(globalKind) || host.apiProviders.find(provider => providerSupports(provider, capability)) || host.apiProviders[0] || defaultApiProvider();
}
function renderApiProviders() {
  const list = $('apiProviderList');
  if (!list) return;
  const selected = host.apiProviders.find(provider => provider.id === host.apiProviderUiSelectedId) || host.apiProviders[0];
  if (!selected) {
    list.innerHTML = '<div class="api-provider-empty">还没有 API 服务，点击上方“添加服务”开始配置。</div>';
    return;
  }
  host.apiProviderUiSelectedId = selected.id;
  list.innerHTML = `
    <div class="api-provider-manager">
      <aside class="api-provider-sidebar" aria-label="API 服务列表">
        <div class="api-provider-sidebar-head">
          <strong>我的服务</strong>
          <span>${host.apiProviders.length} 个</span>
        </div>
        <div class="api-provider-sidebar-list">
          ${host.apiProviders.map(providerListItemHtml).join('')}
        </div>
      </aside>
      <section class="api-provider-editor" aria-label="当前 API 服务">
        <div class="api-provider-editor-head"><span><i class="fa-solid fa-pen-to-square"></i> 当前服务</span><small>修改后会自动保存，密钥只保存在本机安全存储中</small></div>
        ${apiProviderCardHtml(selected, 0)}
      </section>
    </div>`;
  hydrateProviderKeyInputs();
}
function providerListItemHtml(provider) {
  const selected = provider.id === host.apiProviderUiSelectedId;
  const healthClass = provider.lastTest?.status === 'ok' ? 'ok' : provider.lastTest?.status === 'warn' ? 'warn' : provider.lastTest?.status === 'fail' ? 'fail' : '';
  const healthText = provider.lastTest?.status === 'ok' ? '正常' : provider.lastTest?.status === 'fail' ? '失败' : provider.lastTest?.status === 'warn' ? '需检查' : '未测试';
  const models = [provider.chatModel ? '文' : '', provider.imageModel ? '图' : '', provider.videoModel ? '视' : ''].filter(Boolean).join(' · ') || '未选模型';
  const defaults = Object.entries(host.globalModelProviders || {}).filter(([, id]) => id === provider.id).map(([kind]) => kind === 'chat' ? '聊天默认' : kind === 'image' ? '图片默认' : '视频默认');
  return `<button class="api-provider-list-item ${selected ? 'selected' : ''}" data-provider-select="${esc(provider.id)}" type="button">
    <span class="api-provider-list-avatar">${esc(providerInitial(provider))}</span>
    <span class="api-provider-list-copy"><strong>${esc(provider.name || providerTypeLabel(provider.type))}</strong><small>${esc(provider.apiUrl || '尚未填写地址')}</small><em>${esc(models)}${defaults.length ? ` · ${esc(defaults.join(' / '))}` : ''}</em>${providerBalanceLineHtml(provider)}</span>
    <span class="api-provider-list-rename" data-provider-rename="${esc(provider.id)}" role="button" tabindex="0" title="重命名服务" aria-label="重命名服务"><i class="fa-solid fa-pen"></i></span>
    <span class="api-provider-list-rename" data-provider-balance-refresh="${esc(provider.id)}" role="button" tabindex="0" title="刷新余额" aria-label="刷新余额"><i class="fa-solid fa-rotate"></i></span>
    <span class="api-provider-list-status ${healthClass}" title="${esc(healthText)}"></span>
  </button>`;
}
const providerBalances = new Map();
const providerBalanceInflight = new Map();
function providerBalanceQueryable(provider) {
  return Boolean(provider?.apiUrl && provider.type !== 'custom-sync'
    && (provider.useGlobalKey ? $('apiKey')?.value.trim() : provider.apiKeySaved || provider.keyPool?.length));
}
function formatBalanceAmount(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const code = String(unit || '').toUpperCase();
  if (code === 'USD') return `$${amount.toFixed(2)}`;
  if (code === 'CNY' || code === 'RMB') return `¥${amount.toFixed(2)}`;
  if (code === 'QUOTA') return `${Math.round(amount).toLocaleString('zh-CN')} 额度`;
  return `${amount.toFixed(2)} ${unit || ''}`.trim();
}
function providerBalanceView(provider) {
  if (!providerBalanceQueryable(provider)) return {text: '余额 —', title: '填写地址并保存 Key 后可查询余额', tone: ''};
  const state = providerBalances.get(provider.id);
  if (!state || state.status === 'loading') return {text: '余额 查询中…', title: '正在查询余额', tone: 'loading'};
  if (state.status === 'unsupported') return {text: '不支持查询', title: '该服务没有提供可用的余额查询接口', tone: 'muted'};
  if (state.status !== 'ok') return {text: `查询失败：${state.reason || '未知错误'}`, title: '点击刷新按钮重试', tone: 'fail'};
  const used = state.used == null ? '' : `已用 ${formatBalanceAmount(state.used, state.unit)}`;
  const total = state.total == null ? '' : `总额 ${formatBalanceAmount(state.total, state.unit)}`;
  const checked = state.checkedAt ? `查询于 ${new Date(state.checkedAt).toLocaleTimeString('zh-CN', {hour12: false})}` : '';
  const title = [used, total, checked].filter(Boolean).join(' · ');
  if (state.unlimited) return {text: '无限额度', title, tone: 'ok'};
  if (state.remaining != null) return {text: `余额 ${formatBalanceAmount(state.remaining, state.unit)}`, title, tone: state.remaining <= 0 ? 'fail' : 'ok'};
  return {text: total || '余额 —', title, tone: 'ok'};
}
function providerBalanceLineHtml(provider) {
  const view = providerBalanceView(provider);
  return `<span class="api-provider-list-balance ${view.tone}" data-provider-balance="${esc(provider.id)}" title="${esc(view.title)}">${esc(view.text)}</span>`;
}
function providerBalanceState(id) { return providerBalances.get(id) || null; }
function paintProviderBalance(provider) {
  const line = $('apiProviderList')?.querySelector(`[data-provider-balance="${CSS.escape(provider.id)}"]`);
  if (line) line.outerHTML = providerBalanceLineHtml(provider);
  onBalanceDisplayChange?.();
}
function refreshProviderBalance(provider, {force = false, quiet = false} = {}) {
  if (!providerBalanceQueryable(provider) || !secretBridge()?.getProviderBalance) return Promise.resolve(null);
  const inflight = providerBalanceInflight.get(provider.id);
  if (inflight) return force && !inflight.force
    ? inflight.promise.then(() => refreshProviderBalance(provider, {force, quiet}))
    : inflight.promise;
  if (!(quiet && providerBalances.get(provider.id)?.status === 'ok')) {
    providerBalances.set(provider.id, {status: 'loading'});
    paintProviderBalance(provider);
  }
  const promise = (async () => {
    let result;
    try {
      result = await secretBridge().getProviderBalance({
        providerId: provider.id, apiUrl: provider.apiUrl,
        useGlobalKey: provider.useGlobalKey === true, keyId: provider.activeKeyId || '', force
      });
    } catch {
      result = {status: 'error', reason: '查询异常'};
    }
    providerBalances.set(provider.id, result || {status: 'error', reason: '查询异常'});
    providerBalanceInflight.delete(provider.id);
    const current = host.apiProviders.find(item => item.id === provider.id);
    if (current) paintProviderBalance(current);
    return providerBalances.get(provider.id);
  })();
  providerBalanceInflight.set(provider.id, {promise, force});
  return promise;
}
function refreshProviderBalances({force = false} = {}) {
  return Promise.all(host.apiProviders.map(provider => refreshProviderBalance(provider, {force})));
}
async function hydrateProviderKeyInputs() {
  if (!window.secretBridge?.getProviderApiKey) return;
  const list = $('apiProviderList');
  if (!list) return;
  for (const provider of host.apiProviders) {
    const card = list.querySelector(`[data-provider-id="${CSS.escape(provider.id)}"]`);
    if (!card || !provider.apiKeySaved) continue;
    const input = card.querySelector('[data-provider-key-input]');
    const entries = await window.secretBridge.listProviderApiKeys?.(provider.id) || [];
    provider.keyPool = entries.map(providerKeyMeta);
    if (!provider.activeKeyId || !provider.keyPool.some(item => item.id === provider.activeKeyId)) provider.activeKeyId = provider.keyPool[0]?.id || '';
    const healthBox = card.querySelector('[data-provider-key-health]');
    if (healthBox) healthBox.innerHTML = providerKeyHealthHtml(provider);
    if (!input || document.activeElement === input) continue;
    const cacheKey = provider.id + ':' + (provider.activeKeyId || '');
    const value = providerKeyCache.has(cacheKey)
      ? providerKeyCache.get(cacheKey)
      : await window.secretBridge.getProviderApiKeyForKey?.(provider.id, provider.activeKeyId) || await window.secretBridge.getProviderApiKey(provider.id);
    providerKeyCache.set(cacheKey, value || '');
    input.value = value || '';
  }
}
function providerKeyMeta(item = {}) {
  return {
    id: item.id,
    label: item.label,
    scope: item.scope || 'all',
    masked: item.masked || '',
    lastUsedAt: Number(item.lastUsedAt || 0),
    failureCount: Number(item.failureCount || 0),
    cooldownUntil: Number(item.cooldownUntil || 0),
    lastError: item.lastError || '',
    health: item.health || 'unknown'
  };
}
function providerKeyStatusText(item = {}) {
  if (item.health === 'blocked') return '已停用';
  const remaining = Math.max(0, Number(item.cooldownUntil || 0) - Date.now());
  if (remaining > 0) return `冷却 ${Math.max(1, Math.ceil(remaining / 1000))} 秒`;
  if (item.health === 'ok') return '正常';
  return item.failureCount ? `失败 ${item.failureCount} 次` : '未检测';
}
function providerKeyUnavailableMessage(provider, capability = 'all') {
  if (!provider) return '当前 API 配置不存在，请重新打开设置。';
  if (provider.useGlobalKey) return '当前配置使用全局 Key，但全局 Key 为空。请填写全局 API Key。';
  const keys = Array.isArray(provider.keyPool) ? provider.keyPool : [];
  if (!keys.length) return 'API 地址已填写，但还没有保存独立 Key。请粘贴 Key 后点击“保存 Key”。';
  const scoped = keys.filter(item => item.scope === 'all' || capability === 'all' || item.scope === capability);
  if (!scoped.length) {
    const label = capability === 'chat' ? '文本' : capability === 'image' ? '图片' : capability === 'video' ? '视频' : '当前用途';
    return `已保存 Key，但没有可用于${label}的 Key。请调整 Key 用途或添加对应 Key。`;
  }
  const capabilityBlocked = capability === 'image'
    ? scoped.filter(item => provider.imageCapabilityByKey?.[item.id]?.status === 'blocked')
    : [];
  if (capabilityBlocked.length === scoped.length) {
    return '已保存图片 Key，但这些 Key 所属账户组都未开通图片生成。请在中转站开通图片权限，或添加另一把已开通图片能力的 Key。';
  }
  const blocked = scoped.filter(item => item.health === 'blocked');
  if (blocked.length === scoped.length) {
    const lastError = blocked.find(item => item.lastError)?.lastError || '';
    return `当前用途的 Key 已停用${lastError ? `：${lastError}` : ''}。请粘贴新的 Key，软件会自动加入这个供应商的 Key 池。`;
  }
  const now = Date.now();
  const cooling = scoped.filter(item => Number(item.cooldownUntil || 0) > now);
  if (cooling.length === scoped.length) {
    const seconds = Math.max(1, Math.ceil((Math.min(...cooling.map(item => Number(item.cooldownUntil || 0))) - now) / 1000));
    return `当前 Key 池正在冷却，请等待约 ${seconds} 秒后重试，软件会自动恢复可用 Key。`;
  }
  return '已保存 Key，但程序无法读取可用密钥。请重新点击“保存密钥”后再测试。';
}
function providerKeyScopeLabel(scope = 'all') {
  return scope === 'chat' ? '文本' : scope === 'image' ? '图片' : scope === 'video' ? '视频' : '全部';
}
function providerQuickKeyPoolHtml(provider) {
  if (provider.useGlobalKey) return '<div class="provider-quick-key-pool"><span><i class="fa-solid fa-key"></i> 当前复用全局 Key</span></div>';
  const keys = provider.keyPool || [];
  if (!keys.length) return '<div class="provider-quick-key-pool empty"><span><i class="fa-solid fa-key"></i> 尚未添加 Key</span></div>';
  const automatic = true;
  return `<div class="api-provider-wide provider-quick-key-pool ${automatic ? 'active' : 'manual'}">
    <div class="provider-quick-key-pool-head">
      <span><i class="fa-solid fa-layer-group"></i> Key 池 · ${keys.length} 把，自动共同使用</span>
      <em>自动分配</em>
    </div>
    <div class="provider-quick-key-items">${keys.map(item => `<span class="${esc(item.health || 'unknown')}"><b>${esc(item.label || 'Key')}</b><small>${esc(providerKeyScopeLabel(item.scope))} · ${esc(item.masked || '已安全保存')}</small></span>`).join('')}</div>
  </div>`;
}
function providerKeyHealthHtml(provider) {
  const keys = provider.keyPool || [];
  const keyRunningTotal = keys.reduce((sum, item) => sum + providerKeyRunningCount(provider, item.id), 0);
  const running = Math.max(Number(host.providerRunningCounts?.get?.(provider.id) || 0), keyRunningTotal);
  const limit = Math.max(1, Math.min(4, Number(provider.concurrency || 1)));
  if (!keys.length) return `<div class="provider-key-health-empty">尚未保存独立 Key · 并发 ${running}/${limit}</div>`;
  return `<div class="provider-key-health-summary">当前并发 ${running}/${limit}</div><div class="provider-key-health-list">${keys.map(item => {
    const lastError = item.lastError ? ` · 最近错误：${item.lastError}` : '';
    const keyRunning = providerKeyRunningCount(provider, item.id);
    return `<div class="provider-key-health-row ${esc(item.health || 'unknown')}" title="${esc(lastError.replace(/^ · /, '') || '暂无最近错误')}"><span><strong>${esc(item.label || 'Key')}</strong><small>${esc(item.masked || '已安全保存')} · ${esc(item.scope || 'all')} · 并发 ${keyRunning}${lastError}</small></span><em>${esc(providerKeyStatusText(item))}</em></div>`;
  }).join('')}</div>`;
}
function providerSetupResultHtml(provider = {}) {
  const status = provider.setupStatus || 'idle';
  const icon = status === 'ready' ? 'fa-circle-check' : status === 'failed' ? 'fa-circle-xmark' : status === 'needs-model' ? 'fa-circle-exclamation' : 'fa-wand-magic-sparkles';
  const title = status === 'ready'
    ? '已自动配置，可以开始使用'
    : status === 'needs-model'
      ? '接口已连通，还需要确认图片模型'
      : status === 'failed'
        ? '自动配置失败，请检查地址或密钥'
        : '输入地址和 Key 后先保存，再读取模型';
  const detail = provider.setupMessage || (provider.setupModelsCount ? '已发现 ' + provider.setupModelsCount + ' 个模型' : '不会自动发起收费生图请求');
  return '<div class="provider-auto-setup-result ' + esc(status) + '"><i class="fa-solid ' + esc(icon) + '"></i><div><strong>' + esc(title) + '</strong><span>' + esc(detail) + '</span></div></div>';
}
function providerInitial(provider) {
  const name = String(provider?.name || providerTypeLabel(provider?.type) || 'API').trim();
  return (name.match(/[\u4e00-\u9fa5A-Za-z0-9]/)?.[0] || 'A').toUpperCase();
}
function providerModelDatalistHtml(provider, kind) {
  return providerModelsForKind(provider, kind).map(model => `<option value="${esc(model)}"></option>`).join('');
}
function providerModelSelectOptionsHtml(provider, kind) {
  const active = provider?.[modelFieldForKind(kind)] || '';
  const models = unique([active, ...providerModelsForKind(provider, kind)].filter(Boolean));
  return `<option value="" ${active ? '' : 'selected'}>选择模型，或在下方手动添加</option>`
    + models.map(model => `<option value="${esc(model)}" ${model === active ? 'selected' : ''}>${esc(model)}</option>`).join('');
}
function providerModelGroupHtml(provider, kind) {
  const models = modelsForKind(provider?.models || [], kind);
  const active = provider?.[modelFieldForKind(kind)] || '';
  const body = models.length
    ? models.slice(0, 40).map(model => `<button type="button" class="provider-model-chip ${model === active ? 'active' : ''}" data-provider-use-model="${esc(kind)}" data-model-id="${esc(model)}">${esc(model)}</button>`).join('')
    : '<span class="provider-model-empty">暂无</span>';
  return `<section><header>${modelKindLabel(kind)}<em>${models.length}</em></header><div>${body}</div></section>`;
}
function providerModelLibraryHtml(provider) {
  const unknown = (provider?.models || []).filter(model => !classifyModelKind(model));
  const unknownHtml = unknown.length
    ? `<section><header>未识别<em>${unknown.length}</em></header><div>${unknown.slice(0, 40).map(model => `<span class="provider-model-chip muted">${esc(model)}</span>`).join('')}</div></section>`
    : '';
  if (!(provider?.models || []).length) {
    return `<div class="provider-model-library empty">还没有导入模型。点击“导入模型”，或直接在上方输入模型 ID。</div>
      <div class="provider-model-manual"><input data-provider-manual-model placeholder="手动添加或粘贴模型 ID"><button type="button" class="ghost-btn" data-provider-add-model>添加到模型库</button></div>`;
  }
  return `<div class="provider-model-library">
    ${providerModelGroupHtml(provider, 'chat')}
    ${providerModelGroupHtml(provider, 'image')}
    ${providerModelGroupHtml(provider, 'video')}
    ${unknownHtml}
  </div>
  <div class="provider-model-manual"><input data-provider-manual-model placeholder="手动添加或粘贴模型 ID"><button type="button" class="ghost-btn" data-provider-add-model>添加到模型库</button></div>`;
}
function providerCapabilityEditorHtml(provider, kind) {
  if (!ModelCapabilities) return '';
  const modelId = String(kind === 'video' ? provider.videoModel : provider.imageModel || '').trim();
  if (!modelId) return '<p class="provider-note">选择模型后可以维护该模型的能力、价格和停用信息。</p>';
  const profile = ModelCapabilities.resolveProfile({provider, modelId, kind});
  const custom = profile.source?.kind === 'provider-custom';
  const operations = kind === 'image'
    ? [['generate', '生成'], ['edit', '参考图编辑']]
    : [['generate', '文生/图生'], ['first-last-frame', '首尾帧'], ['keyframes', '多关键帧'], ['edit', '视频编辑/局部修改'], ['stylize', '视频风格化'], ['extend', '向前/向后延长'], ['loop', '循环视频']];
  const operationHtml = operations.map(([value, label]) => `<label class="provider-capability-check"><input type="checkbox" data-provider-capability-kind="${kind}" data-provider-capability-field="operation" value="${value}" ${profile.operations.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('');
  const output = kind === 'image' ? profile.outputs.image : profile.outputs.video;
  const inputConstraintFields = kind === 'image'
    ? `<label class="api-provider-wide">支持文件类型<input data-provider-capability-kind="image" data-provider-capability-field="imageMimeTypes" value="${esc((profile.inputs?.image?.mimeTypes || []).join(', '))}" placeholder="image/png, image/jpeg, image/webp"></label>
       <label>单文件上限（MB）<input type="number" min="0" step="0.1" data-provider-capability-kind="image" data-provider-capability-field="imageMaxFileSizeMB" value="${esc(profile.inputs?.image?.maxFileSizeMB || 0)}"></label>
       <label>参考总量上限（MB）<input type="number" min="0" step="0.1" data-provider-capability-kind="image" data-provider-capability-field="imageMaxTotalSizeMB" value="${esc(profile.inputs?.image?.maxTotalSizeMB || 0)}"></label>`
    : `<label class="api-provider-wide">图片参考支持文件类型<input data-provider-capability-kind="video" data-provider-capability-field="imageMimeTypes" value="${esc((profile.inputs?.image?.mimeTypes || []).join(', '))}" placeholder="image/png, image/jpeg"></label>
       <label>图片单文件上限（MB）<input type="number" min="0" step="0.1" data-provider-capability-kind="video" data-provider-capability-field="imageMaxFileSizeMB" value="${esc(profile.inputs?.image?.maxFileSizeMB || 0)}"></label>
       <label>图片参考总量（MB）<input type="number" min="0" step="0.1" data-provider-capability-kind="video" data-provider-capability-field="imageMaxTotalSizeMB" value="${esc(profile.inputs?.image?.maxTotalSizeMB || 0)}"></label>
       <label class="api-provider-wide">视频参考支持文件类型<input data-provider-capability-kind="video" data-provider-capability-field="videoMimeTypes" value="${esc((profile.inputs?.video?.mimeTypes || []).join(', '))}" placeholder="video/mp4, video/webm"></label>
       <label>视频单文件上限（MB）<input type="number" min="0" step="0.1" data-provider-capability-kind="video" data-provider-capability-field="videoMaxFileSizeMB" value="${esc(profile.inputs?.video?.maxFileSizeMB || 0)}"></label>
       <label>视频参考总量（MB）<input type="number" min="0" step="0.1" data-provider-capability-kind="video" data-provider-capability-field="videoMaxTotalSizeMB" value="${esc(profile.inputs?.video?.maxTotalSizeMB || 0)}"></label>
       <label class="api-provider-wide">音频参考支持文件类型<input data-provider-capability-kind="video" data-provider-capability-field="audioMimeTypes" value="${esc((profile.inputs?.audio?.mimeTypes || []).join(', '))}" placeholder="audio/mpeg, audio/wav"></label>
       <label>音频单文件上限（MB）<input type="number" min="0" step="0.1" data-provider-capability-kind="video" data-provider-capability-field="audioMaxFileSizeMB" value="${esc(profile.inputs?.audio?.maxFileSizeMB || 0)}"></label>
       <label>音频参考总量（MB）<input type="number" min="0" step="0.1" data-provider-capability-kind="video" data-provider-capability-field="audioMaxTotalSizeMB" value="${esc(profile.inputs?.audio?.maxTotalSizeMB || 0)}"></label>`;
  const outputFields = kind === 'image'
    ? `<label class="api-provider-wide">支持比例<input data-provider-capability-kind="image" data-provider-capability-field="aspects" value="${esc((output?.aspects || []).join(', '))}"><small>例如：1:1, 16:9, 9:16, custom</small></label>
       <label>支持清晰度<input data-provider-capability-kind="image" data-provider-capability-field="resolutions" value="${esc((output?.resolutions || []).join(', '))}" placeholder="1K, 2K, 4K"></label>`
    : `<label class="api-provider-wide">支持尺寸<input data-provider-capability-kind="video" data-provider-capability-field="sizes" value="${esc((output?.sizes || []).join(', '))}" placeholder="1280x720, 720x1280"></label>
       <label>支持时长（秒）<input data-provider-capability-kind="video" data-provider-capability-field="durations" value="${esc((output?.durations || []).join(', '))}" placeholder="5, 10"></label>`;
  return `<details class="provider-capability-editor">
    <summary><span>${esc(ModelCapabilities.profileSummary(profile))}</span><small>${custom ? '本地自定义' : '内置/兼容默认'}</small></summary>
    <div class="provider-capability-body">
      <div class="provider-capability-operations">${operationHtml}</div>
      <div class="api-provider-grid">
        ${outputFields}
        <label>最多图片参考<input type="number" min="0" max="32" step="1" data-provider-capability-kind="${kind}" data-provider-capability-field="maxReferences" value="${esc(profile.inputs?.image?.maxCount || 0)}"></label>
        ${kind === 'video' ? `<label>最多视频参考<input type="number" min="0" max="8" step="1" data-provider-capability-kind="video" data-provider-capability-field="maxVideoReferences" value="${esc(profile.inputs?.video?.maxCount || 0)}"></label><label>最多音频参考<input type="number" min="0" max="8" step="1" data-provider-capability-kind="video" data-provider-capability-field="maxAudioReferences" value="${esc(profile.inputs?.audio?.maxCount || 0)}"></label>` : ''}
        ${inputConstraintFields}
        <label>计费方式<select data-provider-capability-kind="${kind}" data-provider-capability-field="billingUnit"><option value="${kind === 'image' ? 'image' : 'video-task'}" ${profile.billing?.unit === (kind === 'image' ? 'image' : 'video-task') ? 'selected' : ''}>${kind === 'image' ? '每张图片' : '每次视频任务'}</option>${kind === 'video' ? `<option value="video-second" ${profile.billing?.unit === 'video-second' ? 'selected' : ''}>每秒视频</option>` : ''}</select></label>
        <label>参考单价<input type="number" min="0" step="0.000001" data-provider-capability-kind="${kind}" data-provider-capability-field="estimatedPrice" value="${profile.billing?.estimatedPrice == null ? '' : esc(profile.billing.estimatedPrice)}" placeholder="留空表示未知"></label>
        <label>输入素材单价<input type="number" min="0" step="0.000001" data-provider-capability-kind="${kind}" data-provider-capability-field="inputReferencePrice" value="${esc(profile.billing?.inputReferencePrice || 0)}"></label>
        <label>最低费用<input type="number" min="0" step="0.000001" data-provider-capability-kind="${kind}" data-provider-capability-field="minimumCharge" value="${esc(profile.billing?.minimumCharge || 0)}"></label>
        <label>价格浮动（±%）<input type="number" min="0" max="100" step="1" data-provider-capability-kind="${kind}" data-provider-capability-field="uncertaintyPercent" value="${esc(profile.billing?.uncertaintyPercent || 0)}"></label>
        <label class="api-provider-wide">分辨率倍率<input data-provider-capability-kind="${kind}" data-provider-capability-field="resolutionMultipliers" value="${esc(Object.entries(profile.billing?.resolutionMultipliers || {}).map(([key, value]) => `${key}:${value}`).join(', '))}" placeholder="2K:1.5, 4K:2, 1280x720:1"></label>
        <label>币种<input data-provider-capability-kind="${kind}" data-provider-capability-field="currency" value="${esc(profile.billing?.currency || 'USD')}" maxlength="8"></label>
        <label>生命周期<select data-provider-capability-kind="${kind}" data-provider-capability-field="lifecycleStatus"><option value="active" ${profile.lifecycle?.status === 'active' ? 'selected' : ''}>正常使用</option><option value="deprecated" ${profile.lifecycle?.status === 'deprecated' ? 'selected' : ''}>即将停用</option><option value="retired" ${profile.lifecycle?.status === 'retired' ? 'selected' : ''}>已经停用</option></select></label>
        <label>启用日期<input type="date" data-provider-capability-kind="${kind}" data-provider-capability-field="availableFrom" value="${esc(profile.lifecycle?.availableFrom || '')}"></label>
        <label>开始停用提醒<input type="date" data-provider-capability-kind="${kind}" data-provider-capability-field="deprecatedAt" value="${esc(profile.lifecycle?.deprecatedAt || '')}"></label>
        <label>正式停用日期<input type="date" data-provider-capability-kind="${kind}" data-provider-capability-field="shutdownAt" value="${esc(profile.lifecycle?.shutdownAt || '')}"></label>
        <label>替代模型<input data-provider-capability-kind="${kind}" data-provider-capability-field="replacementModelId" value="${esc(profile.lifecycle?.replacementModelId || '')}" placeholder="可选"></label>
      </div>
      <div class="provider-capability-actions"><button type="button" class="ghost-btn" data-provider-find-model-usage="${kind}"><i class="fa-solid fa-magnifying-glass"></i> 查找使用位置</button><button type="button" class="ghost-btn" data-provider-migrate-model="${kind}" ${profile.lifecycle?.replacementModelId ? '' : 'disabled'}><i class="fa-solid fa-arrow-right-arrow-left"></i> 迁移到替代模型</button><button type="button" class="ghost-btn" data-provider-reset-capability="${kind}" ${custom ? '' : 'disabled'}>恢复默认档案</button></div>
    </div>
  </details>`;
}
function splitCapabilityList(value) {
  return unique(String(value || '').split(/[,，\s]+/).map(item => item.trim()).filter(Boolean));
}
function splitCapabilityMap(value) {
  const output = {};
  String(value || '').split(/[,，\n]+/).forEach(part => {
    const [rawKey, rawValue] = part.split(/[:：]/);
    const key = String(rawKey || '').trim();
    const number = Number(rawValue);
    if (key && Number.isFinite(number) && number > 0) output[key] = number;
  });
  return output;
}
function syncProviderCapabilityEditor(card, provider, kind) {
  if (!ModelCapabilities || !card || !provider || !['image', 'video'].includes(kind)) return false;
  const modelId = String(kind === 'video' ? provider.videoModel : provider.imageModel || '').trim();
  if (!modelId) return false;
  const read = field => card.querySelector(`[data-provider-capability-kind="${kind}"][data-provider-capability-field="${field}"]`);
  const previous = provider.modelCapabilityProfiles?.[modelId] || {};
  const base = ModelCapabilities.resolveProfile({provider: {...provider, modelCapabilityProfiles: {}}, modelId, kind});
  const operations = [...card.querySelectorAll(`[data-provider-capability-kind="${kind}"][data-provider-capability-field="operation"]:checked`)].map(input => input.value);
  const maxReferences = Math.max(0, Math.min(32, Number(read('maxReferences')?.value || 0)));
  const maxVideoReferences = kind === 'video' ? Math.max(0, Math.min(8, Number(read('maxVideoReferences')?.value || 0))) : 0;
  const maxAudioReferences = kind === 'video' ? Math.max(0, Math.min(8, Number(read('maxAudioReferences')?.value || 0))) : 0;
  const estimatedPriceText = String(read('estimatedPrice')?.value || '').trim();
  const inputSpec = (type, maxCount, fallbackRoles) => ({
    maxCount,
    roles: previous.inputs?.[type]?.roles || base.inputs?.[type]?.roles || fallbackRoles,
    mimeTypes: splitCapabilityList(read(`${type}MimeTypes`)?.value),
    maxFileSizeMB: Math.max(0, Number(read(`${type}MaxFileSizeMB`)?.value || 0)),
    maxTotalSizeMB: Math.max(0, Number(read(`${type}MaxTotalSizeMB`)?.value || 0))
  });
  const output = kind === 'image'
    ? {image: {
        aspects: splitCapabilityList(read('aspects')?.value),
        resolutions: splitCapabilityList(read('resolutions')?.value),
        nativeSizes: [...(provider.imageAcceptedSizes || [])],
        allowPostProcessSizing: true
      }}
    : {video: {
        sizes: splitCapabilityList(read('sizes')?.value),
        durations: splitCapabilityList(read('durations')?.value).map(Number).filter(value => Number.isFinite(value) && value > 0),
        allowArbitrarySize: false
      }};
  provider.modelCapabilityProfiles = provider.modelCapabilityProfiles && typeof provider.modelCapabilityProfiles === 'object' ? provider.modelCapabilityProfiles : {};
  provider.modelCapabilityProfiles[modelId] = {
    schemaVersion: ModelCapabilities.SCHEMA_VERSION,
    profileVersion: Math.max(1, Number(previous.profileVersion || base.profileVersion || 1) + 1),
    modalities: [kind],
    operations: operations.length ? operations : ['generate'],
    inputs: {
      image: inputSpec('image', maxReferences, ['reference']),
      video: inputSpec('video', maxVideoReferences, ['source', 'motion', 'reference']),
      audio: inputSpec('audio', maxAudioReferences, ['audio', 'reference'])
    },
    outputs: output,
    billing: {
      unit: String(read('billingUnit')?.value || (kind === 'image' ? 'image' : 'video-task')),
      estimatedPrice: estimatedPriceText === '' ? null : Math.max(0, Number(estimatedPriceText) || 0),
      inputReferencePrice: Math.max(0, Number(read('inputReferencePrice')?.value || 0)),
      minimumCharge: Math.max(0, Number(read('minimumCharge')?.value || 0)),
      uncertaintyPercent: Math.max(0, Math.min(100, Number(read('uncertaintyPercent')?.value || 0))),
      resolutionMultipliers: splitCapabilityMap(read('resolutionMultipliers')?.value),
      currency: String(read('currency')?.value || 'USD').trim().toUpperCase().slice(0, 8)
    },
    lifecycle: {
      status: String(read('lifecycleStatus')?.value || 'active'),
      availableFrom: ModelCapabilities.normalizeLifecycleDate(read('availableFrom')?.value),
      deprecatedAt: ModelCapabilities.normalizeLifecycleDate(read('deprecatedAt')?.value),
      shutdownAt: ModelCapabilities.normalizeLifecycleDate(read('shutdownAt')?.value),
      replacementModelId: String(read('replacementModelId')?.value || '').trim()
    },
    source: {kind: 'provider-custom', updatedAt: new Date().toISOString().slice(0, 10)}
  };
  return true;
}
function apiProviderCardHtml(provider, index = 0) {
  const typeOptions = providerTypeOptionsHtml(provider.type, providerProtocolMode(provider));
  const meta = providerTypeMeta(provider.type);
  const capabilities = (meta.capabilities || []).map(item => `<span>${esc(item)}</span>`).join('');
  const healthClass = provider.lastTest?.status === 'ok' ? 'ok' : provider.lastTest?.status === 'warn' ? 'warn' : provider.lastTest?.status === 'fail' ? 'fail' : '';
  const healthText = provider.lastTest?.message || '未测试';
  const activeKey = (provider.keyPool || []).find(item => item.id === provider.activeKeyId) || provider.keyPool?.[0] || null;
  const imageCapability = imageCapabilityForKey(provider, activeKey || (provider.useGlobalKey ? {keyId: '__global__'} : null));
  const imageCapabilityNote = imageCapability?.status === 'blocked'
    ? `<p class="provider-note api-provider-alert">最近使用的图片 Key 未开通图片生成：${esc(imageCapability.message || '软件会自动尝试 Key 池中的其他 Key。')}</p>`
    : imageCapability?.status === 'available'
      ? '<p class="provider-note api-provider-success">图片能力已验证，可以开始生图。</p>'
      : '';
  const customHelp = provider.type === 'custom-sync' || provider.type === 'dashscope-wanx' || provider.type === 'volcengine-ark'
    ? '<p class="provider-note">当前接口使用自定义或异步协议。普通中转站一般请选择“API 中转站 / OpenAI 兼容”。</p>'
    : '';
  return `
    <article class="api-provider-card api-provider-row active-provider" data-provider-id="${esc(provider.id)}">
      <header class="api-provider-card-head">
        <div class="api-provider-main">
          <span class="api-provider-avatar">${esc(providerInitial(provider))}</span>
          <div>
            <strong data-provider-title>${esc(provider.name || providerTypeLabel(provider.type))}</strong>
            <span>${esc(provider.apiUrl || '还没有填写服务地址')}</span>
            <small data-provider-protocol-status>${esc(providerProtocolStatusText(provider))} · ${provider.apiKeySaved || provider.useGlobalKey ? 'Key 已配置' : '等待配置 Key'}</small>
          </div>
          <div class="api-provider-key-state ${provider.apiKeySaved ? 'saved' : 'empty'}"><i class="fa-solid fa-${provider.apiKeySaved ? 'shield-check' : 'circle-info'}"></i> ${provider.apiKeySaved ? 'Key 已安全保存，输入框不会回显明文' : '尚未保存 Key'}</div>
        </div>
        <div class="api-provider-head-actions">
          <em class="provider-health ${healthClass}">${esc(healthText)}</em>
          <button class="icon-btn" data-provider-remove title="删除 API 服务" aria-label="删除 API 服务" ${provider.id === 'default-openai' ? 'disabled' : ''}><i class="fa-solid fa-trash"></i></button>
        </div>
      </header>
      <div class="api-provider-body api-provider-flow">
        <div class="provider-capabilities">${capabilities}</div>
        <section class="api-provider-step api-provider-step-connect">
          <div class="api-provider-step-head"><span class="api-provider-step-number">1</span><div><strong>连接服务</strong><small>填入接口地址和 Key</small></div></div>
          <div class="api-provider-grid api-provider-connect-grid">
            <label class="api-provider-wide">API 地址<input data-provider-field="apiUrl" value="${esc(provider.apiUrl)}" placeholder="https://api.example.com/v1"></label>
            <label class="api-provider-wide api-provider-key-input">API Key<input data-provider-key-input type="password" value="" placeholder="${provider.apiKeySaved ? '粘贴新 Key，自动加入当前服务' : '粘贴 API Key'}"><small>新 Key 会自动追加到当前服务的 Key 池，并参与聊天、生图和视频请求。</small></label>
            ${providerQuickKeyPoolHtml(provider)}
          </div>
        </section>
        <section class="api-provider-step api-provider-step-model">
          <div class="api-provider-step-head"><span class="api-provider-step-number">2</span><div><strong>读取模型</strong><small>Key 保存后按需读取模型并选择可用能力</small></div></div>
          <div class="api-provider-model-choice">
            <label><span>聊天模型</span><select data-provider-field="chatModel">${providerModelSelectOptionsHtml(provider, 'chat')}</select></label>
            <label><span>图片模型</span><select data-provider-field="imageModel">${providerModelSelectOptionsHtml(provider, 'image')}</select></label>
            <label><span>视频模型</span><select data-provider-field="videoModel">${providerModelSelectOptionsHtml(provider, 'video')}</select></label>
          </div>
        </section>
        <section class="api-provider-flow-actions">
          <button class="primary-btn" data-provider-auto-configure type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> 保存并自动配置</button>
          <button class="ghost-btn" data-provider-test-image type="button"><i class="fa-regular fa-image"></i> 测试生图</button>
          <button class="ghost-btn" data-provider-import-models type="button"><i class="fa-solid fa-cloud-arrow-down"></i> 重新读取模型</button>
        </section>
        ${imageCapabilityNote}
        <details class="api-provider-more-options">
          <summary><span><i class="fa-solid fa-sliders"></i> 高级接口设置</span><small>仅在接口不兼容时修改</small></summary>
          <div class="api-provider-advanced-body">
            <div class="api-provider-actions api-provider-actions-top">
              <button class="ghost-btn" data-provider-save-key type="button"><i class="fa-solid fa-key"></i> 保存密钥</button>
              <button class="ghost-btn" data-provider-test type="button"><i class="fa-solid fa-vial"></i> 测试文本</button>
              <button class="ghost-btn" data-provider-test-key type="button"><i class="fa-solid fa-key"></i> 测试一把 Key</button>
              <button class="ghost-btn" data-provider-conformance type="button"><i class="fa-solid fa-clipboard-check"></i> 接口验收</button>
              <button class="ghost-btn" data-provider-remove-key type="button"><i class="fa-regular fa-trash-can"></i> 删除最近使用 Key</button>
            </div>
            <div class="api-provider-section"><b>服务选项</b><div class="api-provider-grid">
              <label>服务名称<input data-provider-field="name" value="${esc(provider.name)}"></label>
              <label>接口协议<select data-provider-field="type">${typeOptions}</select><small>普通 API 中转站保持默认即可。</small></label>
              <label>密钥策略<select data-provider-field="useGlobalKey"><option value="true" ${provider.useGlobalKey ? 'selected' : ''}>复用全局 Key</option><option value="false" ${!provider.useGlobalKey ? 'selected' : ''}>使用独立 Key</option></select></label>
              <label>队列并发<input data-provider-field="concurrency" type="number" min="1" max="4" step="1" value="${esc(provider.concurrency || 1)}"></label>
              <div class="api-provider-wide" data-provider-key-health>${providerKeyHealthHtml(provider)}</div>
            </div></div>
            <div class="api-provider-section"><b>聊天接口</b><div class="api-provider-grid"><p class="provider-note api-provider-wide">聊天、图片和视频模型自动共用当前服务的 Key 池。</p><label>聊天路径<input data-provider-field="chatEndpoint" value="${esc(provider.chatEndpoint)}" placeholder="/chat/completions"></label></div></div>
            <div class="api-provider-section"><b>图片接口</b><div class="api-provider-grid">
              <label>生图路径<input data-provider-field="imageEndpoint" value="${esc(provider.imageEndpoint)}" placeholder="/images/generations"></label>
              <label>尺寸字段<select data-provider-field="imageRequestFormat"><option value="auto" ${provider.imageRequestFormat === 'auto' ? 'selected' : ''}>自动</option><option value="size" ${provider.imageRequestFormat === 'size' ? 'selected' : ''}>size</option><option value="width-height" ${provider.imageRequestFormat === 'width-height' ? 'selected' : ''}>width + height</option><option value="aspect-ratio" ${provider.imageRequestFormat === 'aspect-ratio' ? 'selected' : ''}>aspect_ratio</option><option value="size-and-aspect" ${provider.imageRequestFormat === 'size-and-aspect' ? 'selected' : ''}>size + aspect_ratio</option></select></label>
              <label>图生图路径<input data-provider-field="editEndpoint" value="${esc(provider.editEndpoint)}" placeholder="/images/edits"></label>
              <label>返回字段<input data-provider-field="responsePath" value="${esc(provider.responsePath)}" placeholder="data.0.url / output.images.0.url"></label>
              <label>任务协议<select data-provider-field="imageTaskMode"><option value="sync" ${provider.imageTaskMode === 'sync' ? 'selected' : ''}>同步返回</option><option value="async" ${provider.imageTaskMode === 'async' ? 'selected' : ''}>异步轮询</option></select></label>
              <label class="api-provider-wide">已知原生尺寸<input data-provider-field="imageAcceptedSizes" value="${esc((provider.imageAcceptedSizes || []).join(', '))}" placeholder="1024x1024, 1536x1024, 1024x1536"></label>
              <label>异步查询路径<input data-provider-field="imageQueryEndpoint" value="${esc(provider.imageQueryEndpoint)}" placeholder="/tasks/{id}"></label>
              <label>任务 ID 字段<input data-provider-field="imageTaskIdPath" value="${esc(provider.imageTaskIdPath)}" placeholder="task_id / data.id"></label>
              <label>任务状态字段<input data-provider-field="imageTaskStatusPath" value="${esc(provider.imageTaskStatusPath)}" placeholder="status / data.state"></label>
              <label>异步结果字段<input data-provider-field="imageTaskResultPath" value="${esc(provider.imageTaskResultPath)}" placeholder="data.0.url / output.url"></label>
              <label>轮询间隔（毫秒）<input data-provider-field="imagePollIntervalMs" type="number" min="1000" max="30000" step="500" value="${esc(provider.imagePollIntervalMs)}"></label>
              <label>最多轮询次数<input data-provider-field="imageMaxPollAttempts" type="number" min="1" max="300" step="1" value="${esc(provider.imageMaxPollAttempts)}"></label>
            </div>${providerCapabilityEditorHtml(provider, 'image')}</div>
            <div class="api-provider-section"><b>视频接口</b><div class="api-provider-grid"><label>视频路径<input data-provider-field="videoEndpoint" value="${esc(provider.videoEndpoint)}" placeholder="/videos"></label><label>查询路径<input data-provider-field="videoQueryEndpoint" value="${esc(provider.videoQueryEndpoint)}" placeholder="/video/query"></label><label class="api-provider-wide">视频返回字段<input data-provider-field="videoResponsePath" value="${esc(provider.videoResponsePath)}" placeholder="data.0.url / output.video_url"></label></div>${providerCapabilityEditorHtml(provider, 'video')}</div>
            ${customHelp}
          </div>
        </details>
      </div>
    </article>`;
}
function addApiProvider() {
  const id = 'provider-' + Date.now();
  host.apiProviders.push(defaultApiProvider({
    id,
    name: '新的 API 配置',
    type: 'openai-images',
    protocolMode: 'auto',
    apiUrl: '',
    useGlobalKey: false,
    chatModel: '',
    imageModel: '',
    videoModel: ''
  }));
  host.apiProviderUiSelectedId = id;
  saveSettings();
  renderApiProviders();
  refreshNodeProviderSelects();
}
function syncApiProviderCardFields(card, provider) {
  if (!card || !provider) return provider;
  const imageRouteBefore = [provider.apiUrl, provider.type, provider.imageModel, provider.imageEndpoint].join('\u0000');
  card.querySelectorAll('[data-provider-field]').forEach(input => {
    const field = input.dataset.providerField;
    if (!field) return;
    if (field === 'type') {
      if (input.value === '__auto__') {
        provider.protocolMode = 'auto';
        provider.protocolMessage = '';
      } else {
        provider.type = input.value;
        provider.protocolMode = 'manual';
        provider.detectedProtocol = input.value;
        provider.protocolConfidence = 'manual';
        provider.protocolMessage = '已手动指定接口协议';
      }
      return;
    }
    provider[field] = field === 'useGlobalKey'
      ? input.value !== 'false'
      : field === 'imageAcceptedSizes'
        ? unique(String(input.value || '').split(/[,，\s]+/).map(size => size.trim()).filter(size => /^\d+x\d+$/i.test(size)))
        : input.value;
  });
  provider.apiUrl = String(provider.apiUrl || '').trim().replace(/\/$/, '');
  provider.concurrency = Math.max(1, Math.min(4, Number(provider.concurrency || 1)));
  const imageRouteAfter = [provider.apiUrl, provider.type, provider.imageModel, provider.imageEndpoint].join('\u0000');
  if (imageRouteBefore !== imageRouteAfter) {
    provider.imageCapabilityStatus = 'unknown';
    provider.imageCapabilityMessage = '';
    provider.imageCapabilityKeyId = '';
    provider.imageCapabilityByKey = {};
  }
  return provider;
}
function handleApiProviderInput(e) {
  const field = e.target?.dataset?.providerField;
  const capabilityKind = e.target?.dataset?.providerCapabilityKind;
  const card = e.target?.closest?.('[data-provider-id]');
  if (!card) return;
  const provider = host.apiProviders.find(item => item.id === card.dataset.providerId);
  if (!provider) return;

  // API 地址和 Key 都是连接配置的一部分。以前只有点击“保存并自动配置”
  // 才会读取模型，导致用户输入后看不到已保存状态，也不会自动导入模型。
  // 在输入框失焦/提交变更时触发一次防抖配置，避免逐字输入产生请求。
  const keyInput = e.target?.matches?.('[data-provider-key-input]');
  if (keyInput && e.type === 'change') {
    saveSettings();
    return;
  }
  if (capabilityKind) {
    if (!syncProviderCapabilityEditor(card, provider, capabilityKind)) return;
    saveSettings();
    refreshNodeModelSelects();
    const profile = ModelCapabilities.resolveProfile({
      provider,
      modelId: capabilityKind === 'video' ? provider.videoModel : provider.imageModel,
      kind: capabilityKind
    });
    const editor = e.target.closest('.provider-capability-editor');
    const summary = editor?.querySelector('summary span');
    const source = editor?.querySelector('summary small');
    if (summary) summary.textContent = ModelCapabilities.profileSummary(profile);
    if (source) source.textContent = '本地自定义';
    const reset = editor?.querySelector('[data-provider-reset-capability]');
    if (reset) reset.disabled = false;
    return;
  }
  if (!field) return;
  if (field === 'type') {
    if (e.target.value === '__auto__') {
      provider.protocolMode = 'auto';
      provider.protocolMessage = '';
    } else {
      provider.type = e.target.value;
      provider.protocolMode = 'manual';
      provider.detectedProtocol = e.target.value;
      provider.protocolConfidence = 'manual';
      provider.protocolMessage = '已手动指定接口协议';
    }
  } else {
    provider[field] = field === 'useGlobalKey' ? e.target.value !== 'false' : e.target.value;
  }
  if (field === 'name') {
    const title = card.querySelector('[data-provider-title]');
    if (title) title.textContent = provider.name || providerTypeLabel(provider.type);
    saveSettings();
    if (e.type === 'change') {
      renderModels();
      refreshNodeProviderSelects();
      syncGlobalModelInputs();
    }
    return;
  }
  if (field === 'type') {
    if (provider.protocolMode === 'auto') {
      provider.lastTest = {status: '', message: '', checkedAt: 0};
      saveSettings();
      renderApiProviders();
      return;
    }
    if (!provider.name) provider.name = providerTypeLabel(provider.type);
    provider.chatEndpoint = defaultEndpointForProvider(provider.type, 'chat');
    provider.imageEndpoint = defaultEndpointForProvider(provider.type, 'image');
    provider.editEndpoint = defaultEndpointForProvider(provider.type, 'edit');
    provider.videoEndpoint = defaultEndpointForProvider(provider.type, 'video');
    provider.videoQueryEndpoint = defaultEndpointForProvider(provider.type, 'videoQuery');
    provider.enabledText = providerSupports(provider, 'text');
    provider.enabledImage = providerSupports(provider, 'image');
    provider.enabledVideo = providerSupports(provider, 'video');
    provider.lastTest = {status: '', message: '', checkedAt: 0};
  }
  if (['apiUrl', 'type', 'imageModel', 'imageEndpoint', 'imageRequestFormat'].includes(field)) {
    provider.imageCapabilityStatus = 'unknown';
    provider.imageCapabilityMessage = '';
    provider.imageCapabilityKeyId = '';
    provider.imageCapabilityByKey = {};
  }
  if (['apiUrl', 'chatEndpoint', 'imageEndpoint', 'editEndpoint', 'videoEndpoint', 'videoQueryEndpoint'].includes(field)) {
    provider.lastTest = {status: '', message: '', checkedAt: 0};
  }
  saveSettings();
  renderModels();
  refreshNodeProviderSelects();
  if (field === 'type') renderApiProviders();
  // API configuration is explicit: typing or blurring a field never starts a
  // network request. Use “读取模型” when the address and saved Key are ready.
}

const providerAutoConfigureTimers = new Map();
function scheduleProviderAutoConfigure(card) {
  const providerId = String(card?.dataset?.providerId || '');
  if (!providerId) return;
  clearTimeout(providerAutoConfigureTimers.get(providerId));
  const timer = setTimeout(async () => {
    providerAutoConfigureTimers.delete(providerId);
    const provider = host.apiProviders.find(item => item.id === providerId);
    const currentCard = document.querySelector(`[data-provider-id="${CSS.escape(providerId)}"]`);
    if (!provider || !currentCard || !String(provider.apiUrl || '').trim()) return;
    const typedKey = currentCard.querySelector('[data-provider-key-input]')?.value?.trim() || '';
    if (!typedKey && !provider.apiKeySaved && !(provider.keyPool || []).length && !provider.useGlobalKey) return;
    await autoConfigureProviderFromCard(currentCard, null);
  }, 450);
  providerAutoConfigureTimers.set(providerId, timer);
}
function handleApiProviderClick(e) {
  const balanceRefresh = e.target.closest('[data-provider-balance-refresh]');
  if (balanceRefresh) {
    e.preventDefault();
    e.stopPropagation();
    const provider = host.apiProviders.find(item => item.id === balanceRefresh.dataset.providerBalanceRefresh);
    return provider && refreshProviderBalance(provider, {force: true});
  }
  const rename = e.target.closest('[data-provider-rename]');
  if (rename) {
    e.preventDefault();
    e.stopPropagation();
    const provider = host.apiProviders.find(item => item.id === rename.dataset.providerRename);
    if (!provider) return;
    return Promise.resolve(openModal?.({title: '重命名服务', value: provider.name, okText: '保存'})).then(value => {
      const name = typeof value === 'string' ? value.trim().slice(0, 60) : '';
      if (!name || name === provider.name) return;
      provider.name = name;
      saveSettings();
      renderApiProviders();
      refreshNodeModelSelects();
    });
  }
  const selectProvider = e.target.closest('[data-provider-select]');
  if (selectProvider) {
    host.apiProviderUiSelectedId = selectProvider.dataset.providerSelect;
    renderApiProviders();
    return;
  }
  const actionCard = e.target.closest('[data-provider-id]');
  const findUsage = e.target.closest('[data-provider-find-model-usage]');
  const migrateModel = e.target.closest('[data-provider-migrate-model]');
  if (findUsage || migrateModel) {
    const provider = host.apiProviders.find(item => item.id === actionCard?.dataset.providerId);
    const kind = (findUsage || migrateModel).dataset.providerFindModelUsage || (findUsage || migrateModel).dataset.providerMigrateModel;
    const modelId = kind === 'video' ? provider?.videoModel : provider?.imageModel;
    if (!provider || !modelId || !ModelCapabilities) return;
    saveProject?.();
    const usages = ModelCapabilities.scanModelUsage(host.projects, {modelId, providerId: provider.id});
    if (findUsage) {
      const projects = new Set(usages.map(item => item.projectId));
      return toast(usages.length ? `${modelId} 在 ${projects.size} 个项目的 ${usages.length} 个节点中使用` : `${modelId} 当前没有被项目节点使用`, usages.length ? 'warn' : 'success');
    }
    const profile = ModelCapabilities.resolveProfile({provider, modelId, kind});
    const replacement = String(profile.lifecycle?.replacementModelId || '').trim();
    if (!replacement) return toast('请先填写替代模型', 'warn');
    return openModal?.({
      title: '批量迁移模型',
      text: usages.length ? `将在 ${new Set(usages.map(item => item.projectId)).size} 个项目中，把 ${usages.length} 个“${modelId}”节点迁移为“${replacement}”。每个受影响项目都会保留迁移前恢复点。` : `当前项目库中没有使用“${modelId}”的节点。`,
      okText: usages.length ? '保留恢复点并迁移' : '知道了',
      cancelText: '取消',
      confirm: Boolean(usages.length)
    }).then(confirmed => {
      if (!confirmed || !usages.length) return;
      const result = ModelCapabilities.migrateModelUsage(host.projects, {fromModelId: modelId, toModelId: replacement, providerId: provider.id});
      host.projects = result.projects;
      saveProjects?.();
      loadProject?.(host.currentProjectId, {preserveHistory: true});
      toast(`模型迁移完成：${result.changes.length} 个节点，可在项目恢复点中撤销`, 'success');
    });
  }
  const resetCapability = e.target.closest('[data-provider-reset-capability]');
  if (resetCapability) {
    const provider = host.apiProviders.find(item => item.id === actionCard?.dataset.providerId);
    const kind = resetCapability.dataset.providerResetCapability;
    const modelId = kind === 'video' ? provider?.videoModel : provider?.imageModel;
    if (!provider || !modelId || !provider.modelCapabilityProfiles?.[modelId]) return;
    delete provider.modelCapabilityProfiles[modelId];
    saveSettings();
    renderApiProviders();
    refreshNodeModelSelects();
    return toast(`已恢复 ${modelId} 的默认能力档案`, 'success');
  }
  if (e.target.closest('[data-provider-toggle]')) return toggleApiProviderCollapsed(actionCard);
  if (e.target.closest('[data-provider-enable-key-pool]')) {
    const provider = host.apiProviders.find(item => item.id === actionCard?.dataset.providerId);
    if (!provider) return;
    provider.keyRotationMode = 'round-robin';
    saveSettings();
    renderApiProviders();
    return toast(`${provider.name} 的 ${provider.keyPool?.length || 0} 把 Key 已全部加入自动分配`, 'success');
  }
  if (e.target.closest('[data-provider-auto-configure]')) return autoConfigureProviderFromCard(actionCard, e.target.closest('[data-provider-auto-configure]'));
  if (e.target.closest('[data-provider-add-key]')) return prepareProviderKeyAddition(actionCard);
  const saveKeyButton = e.target.closest('[data-provider-save-key]');
  if (saveKeyButton) {
    saveKeyButton.disabled = true;
    saveKeyButton.dataset.originalLabel = saveKeyButton.dataset.originalLabel || saveKeyButton.textContent.trim();
    saveKeyButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 保存中';
    return saveProviderKeyFromCard(actionCard).finally(() => {
      if (!saveKeyButton.isConnected) return;
      saveKeyButton.disabled = false;
      saveKeyButton.innerHTML = `<i class="fa-solid fa-key"></i> ${saveKeyButton.dataset.originalLabel || '保存 Key'}`;
    });
  }
  if (e.target.closest('[data-provider-remove-key]')) return removeProviderKeyFromCard(actionCard);
  if (e.target.closest('[data-provider-test]')) return testApiProviderFromCard(actionCard);
  if (e.target.closest('[data-provider-test-key]')) return testSelectedProviderKey(actionCard, e.target.closest('[data-provider-test-key]'));
  if (e.target.closest('[data-provider-test-image]')) return testImageProviderFromCard(actionCard);
  if (e.target.closest('[data-provider-conformance]')) return openProviderConformance(actionCard);
  const importModelsButton = e.target.closest('[data-provider-import-models]');
  if (importModelsButton) {
    importModelsButton.disabled = true;
    importModelsButton.dataset.originalLabel = importModelsButton.dataset.originalLabel || importModelsButton.textContent.trim();
    importModelsButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 读取中';
    return importModelsForProviderCard(actionCard).finally(() => {
      if (!importModelsButton.isConnected) return;
      importModelsButton.disabled = false;
      importModelsButton.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> ${importModelsButton.dataset.originalLabel || '读取模型'}`;
    });
  }
  if (e.target.closest('[data-provider-add-model]')) return addProviderModelFromCard(actionCard);
  const modelBtn = e.target.closest('[data-provider-use-model]');
  if (modelBtn) return useProviderModelFromCard(actionCard, modelBtn.dataset.providerUseModel, modelBtn.dataset.modelId);
  const remove = e.target.closest('[data-provider-remove]');
  if (!remove) return;
  const card = actionCard;
  const id = card?.dataset.providerId;
  if (!id || id === 'default-openai') return;
  host.apiProviders = host.apiProviders.filter(provider => provider.id !== id);
  nodes.forEach(node => {
    if ((node.type === 'image' || node.type === 'video') && node.data?.providerId === id) node.data.providerId = '';
  });
  saveSettings();
  renderApiProviders();
  refreshNodeProviderSelects();
  saveProject();
}
function useProviderModelFromCard(card, kind, model) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider || !kind || !model) return;
  provider[modelFieldForKind(kind)] = model;
  provider.models = expandKnownModelAliases(unique([model, ...(provider.models || [])]));
  if (host.globalModelProviders[kind] === provider.id) setGlobalModelValue(kind, model, {save: false, rerender: false});
  saveSettings();
  renderApiProviders();
  renderModels();
  refreshNodeModelSelects();
  toast(`已设为${provider.name}的${modelKindLabel(kind)}模型：${model}`, 'success');
}
function addProviderModelFromCard(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  const input = card?.querySelector('[data-provider-manual-model]');
  const model = input?.value?.trim() || '';
  if (!provider || !model) return toast('请输入要添加的模型 ID', 'warn');
  const kind = classifyModelKind(model);
  provider.models = unique([model, ...(provider.models || [])]);
  if (kind && !provider[modelFieldForKind(kind)]) provider[modelFieldForKind(kind)] = model;
  if (kind && host.globalModelProviders[kind] === provider.id && !$(inputIdForModelKind(kind))?.value?.trim()) {
    setGlobalModelValue(kind, model, {save: false, rerender: false});
  }
  if (input) input.value = '';
  saveSettings();
  renderApiProviders();
  renderModels();
  refreshNodeModelSelects();
  toast(`已添加模型：${model}${kind ? `（${modelKindLabel(kind)}）` : '（未识别，可直接填到对应模型框）'}`, 'success');
}
function toggleApiProviderCollapsed(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  provider.collapsed = provider.collapsed === false;
  saveSettings();
  renderApiProviders();
}
async function providerApiKey(provider, capability = 'all', requestedModel = '') {
  if (!provider) return '';
  if (provider.useGlobalKey) return $('apiKey')?.value.trim() || '';
  if (!Array.isArray(provider.keyPool) || !provider.keyPool.length) {
    const entries = await window.secretBridge?.listProviderApiKeys?.(provider.id) || [];
    provider.keyPool = entries.map(providerKeyMeta);
  }
  const now = Date.now();
  const runningCounts = providerKeyRunningSnapshot(provider);
  const selectedId = KeyPool?.selectKeyIdForRequest?.(provider, capability, requestedModel, now, runningCounts) || '';
  const selected = provider.keyPool.find(item => item.id === selectedId);
  if (!selected) return '';
  selected.lastUsedAt = now;
  provider.activeKeyId = selected.id;
  const cacheKey = provider.id + ':' + (selected?.id || 'legacy');
  const value = providerKeyCache.has(cacheKey)
    ? providerKeyCache.get(cacheKey) || ''
    : (selected?.id
      ? await window.secretBridge?.getProviderApiKeyForKey?.(provider.id, selected.id) || ''
      : await window.secretBridge?.getProviderApiKey?.(provider.id) || '');
  if (!value) return '';
  providerKeyCache.set(cacheKey, value);
  changeProviderKeyRunningCount(provider, selected.id, 1);
  recordProviderKeyLease(provider, capability, selected.id);
  provider._lastSelectedKeyId = provider._lastSelectedKeyId || {};
  provider._lastSelectedKeyId[capability] = selected.id;
  persistProviderKeyHealth(provider, selected);
  const leasedValue = new String(value);
  Object.defineProperty(leasedValue, 'keyId', {value: selected.id, enumerable: false});
  return leasedValue;
}
function providerKeyHealth(provider, capability = 'all') {
  const now = Date.now();
  const keys = (provider?.keyPool || []).filter(item => item.scope === 'all' || item.scope === capability);
  return keys.map(item => ({
    id: item.id,
    label: item.label,
    scope: item.scope || 'all',
    health: Number(item.cooldownUntil || 0) > now ? 'cooldown' : (item.health || 'unknown'),
    cooldownUntil: Number(item.cooldownUntil || 0),
    failureCount: Number(item.failureCount || 0),
    lastError: item.lastError || '',
    running: providerKeyRunningCount(provider, item.id)
  }));
}
function reportProviderKeyResult(provider, capability = 'all', error = null, leaseRef = null) {
  if (!provider || provider.useGlobalKey) return false;
  const leaseId = String(leaseRef?.keyId || leaseRef || '').trim();
  if (error?.releaseOnly) return releaseProviderKeyLease(provider, capability, leaseId);
  const leasedId = consumeProviderKeyLease(provider, capability, leaseId);
  const id = leasedId || provider._lastSelectedKeyId?.[capability] || provider.activeKeyId;
  const key = provider.keyPool?.find(item => item.id === id);
  if (!key) return false;
  if (leasedId) changeProviderKeyRunningCount(provider, key.id, -1);
  const status = Number(error?.status || error?.response?.status || 0);
  const rawMessage = String(error?.message || error || '');
  const message = KeyPool?.sanitizeErrorSummary?.(rawMessage, [...providerKeyCache.values()]) || rawMessage.slice(0, 240);
  const rotates = KeyPool?.shouldRotateOnError?.(error)
    ?? (status === 401 || status === 403 || status === 429 || /invalid.{0,12}(?:api.?key|credential)|quota|rate.?limit|unauthori[sz]ed|forbidden/i.test(rawMessage));
  if (!error) {
    key.health = 'ok';
    key.failureCount = 0;
    key.lastError = '';
    key.cooldownUntil = 0;
    persistProviderKeyHealth(provider, key);
    return true;
  }
  if (!rotates) {
    key.lastError = message;
    persistProviderKeyHealth(provider, key);
    return false;
  }
  key.failureCount = Number(key.failureCount || 0) + 1;
  key.lastError = message;
  const longCooldown = status === 401 || status === 403 || /invalid.{0,12}(?:api.?key|credential)|unauthori[sz]ed|forbidden/i.test(rawMessage);
  key.cooldownUntil = Date.now() + (longCooldown ? 24 * 60 * 60 * 1000 : 15 * 1000);
  key.health = longCooldown ? 'blocked' : 'cooldown';
  const next = provider.keyPool.find(item => (item.scope === 'all' || item.scope === capability) && item.id !== key.id && Number(item.cooldownUntil || 0) <= Date.now() && item.health !== 'blocked');
  if (next) provider.activeKeyId = next.id;
  persistProviderKeyHealth(provider, key);
  return true;
}
function persistProviderKeyHealth(provider, key) {
  if (!provider?.id || !key?.id || !window.secretBridge?.updateProviderApiKeyMetadata) return;
  window.secretBridge.updateProviderApiKeyMetadata(provider.id, key.id, {
    lastUsedAt: key.lastUsedAt,
    failureCount: key.failureCount,
    cooldownUntil: key.cooldownUntil,
    lastError: key.lastError,
    health: key.health
  }).catch(err => console.warn('provider key health persistence failed', err));
  saveSettings();
}
async function addProviderKeyFromCard(card) {
  return await saveProviderKeyFromCard(card, false);
}
function prepareProviderKeyAddition(card) {
  const input = card?.querySelector('[data-provider-key-input]');
  if (!card || !input) return;
  input.value = '';
  input.placeholder = '粘贴新的 API Key';
  input.focus();
  toast('请粘贴新 Key，然后点击“保存 Key”；它会自动加入当前服务的 Key 池。', 'success');
}
async function saveProviderKeyFromCard(card, silent = false) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  const input = card?.querySelector('[data-provider-key-input]');
    const value = input?.value?.trim() || '';
  syncApiProviderCardFields(card, provider);
  if (!provider || !value) {
    if (!silent) toast('请输入要保存的独立 API Key', 'warn');
    return false;
  }
  try {
    assertUsableApiBaseAddress(provider.apiUrl);
  } catch (err) {
    if (!silent) toast(`未保存密钥：\n${err.message || String(err)}`, 'warn');
    return false;
  }
  if (!window.secretBridge?.setProviderApiKey) {
    if (!silent) toast('密钥保存通道不可用，请重启软件后再试', 'error');
    return false;
  }
  // A typed key is always a new member of this provider's pool. Replacing a
  // key silently made the multi-key feature look like separate providers.
  const keyId = '';
  const scope = 'all';
  const scopeLabel = scope === 'chat' ? '文本' : scope === 'image' ? '图片' : scope === 'video' ? '视频' : '通用';
  const label = `${scopeLabel} Key ${(provider.keyPool?.filter(item => item.scope === scope).length || 0) + 1}`;
  let saved;
  let savedId = keyId;
  try {
    saved = await window.secretBridge.setProviderApiKey(provider.id, value, keyId, label, scope);
    if (!saved) throw new Error('主进程没有确认写入');
    savedId = saved.id || keyId;
    const readback = await window.secretBridge.getProviderApiKeyForKey?.(provider.id, savedId) || await window.secretBridge.getProviderApiKey?.(provider.id);
    if (readback !== value) throw new Error('写入后读取校验不一致');
  } catch (error) {
    provider.setupStatus = 'failed';
    provider.setupMessage = `Key 保存失败：${apiErrorMessage(error, '本机安全存储不可用')}`;
    saveSettings();
    if (!silent) toast(provider.setupMessage, 'error');
    return false;
  }
  providerKeyCache.set(provider.id + ':' + savedId, value);
  provider.activeKeyId = savedId;
  provider.keyPool = (await window.secretBridge.listProviderApiKeys?.(provider.id) || provider.keyPool || []).map(providerKeyMeta);
  provider.apiKeySaved = true;
  provider.useGlobalKey = false;
  provider.keyRotationMode = 'round-robin';
  provider.setupStatus = 'key-saved';
  provider.setupMessage = 'Key 已安全保存，可以读取模型';
  if (scope === 'all' || scope === 'image') {
    provider.imageCapabilityByKey = normalizeImageCapabilityByKey(provider.imageCapabilityByKey, provider.keyPool || []);
    delete provider.imageCapabilityByKey[savedId];
    if (provider.imageCapabilityKeyId === savedId || provider.imageCapabilityStatus === 'blocked') {
      provider.imageCapabilityStatus = 'unknown';
      provider.imageCapabilityMessage = '';
      provider.imageCapabilityKeyId = '';
    }
  }
  if (input) input.value = value;
  saveSettings();
  renderApiProviders();
  if (!silent) toast(`已安全保存：${provider.name} / ${label}，用途：${scopeLabel}`, 'success');
  return true;
}
async function saveTypedProviderKeyIfNeeded(card) {
  const input = card?.querySelector('[data-provider-key-input]');
  if (!input?.value?.trim()) return false;
  return await saveProviderKeyFromCard(card, true);
}
function automaticModelForKind(provider, records, kind) {
  const field = modelFieldForKind(kind);
  const current = String(provider?.[field] || '').trim();
  const candidates = unique((records || [])
    .filter(record => (record?.kind || classifyModelKind((record?.id || '') + ' ' + (record?.label || ''))) === kind)
    .map(record => String(record.id || '').trim())
    .filter(Boolean));
  const available = candidates;
  if (current && available.includes(current)) return current;
  if (!available.length) return '';
  const patterns = {
    image: /image|img|dall|gpt[-_]?image|flux|sdxl|stable|kolors|seedream|wanx|midjourney|ideogram|recraft|生图/i,
    chat: /chat|gpt|claude|gemini|qwen|deepseek|kimi|doubao|glm|llama|mistral|instruct|turbo/i,
    video: /video|sora|kling|wan|hailuo|runway|veo|luma|pika|seedance|t2v|i2v|vidu|pixverse|可灵/i
  };
  return available.slice().sort((a, b) => {
    const score = value => (patterns[kind]?.test(value) ? 10 : 0) + (records?.some(record => record.id === value && record.kind === kind) ? 3 : 0);
    return score(b) - score(a);
  })[0] || '';
}
function applyAutomaticProviderDefaults(provider) {
  if (!provider || !host.globalModelProviders) return;
  for (const kind of ['chat', 'image', 'video']) {
    const field = modelFieldForKind(kind);
    const model = String(provider[field] || '').trim();
    if (!model) continue;
    const currentId = host.globalModelProviders[kind] || '';
    const current = host.apiProviders.find(item => item.id === currentId);
    const shouldUse = !currentId || currentId === provider.id || !current?.[field] || current.lastTest?.status !== 'ok';
    if (!shouldUse) continue;
    host.globalModelProviders[kind] = provider.id;
    setGlobalModelValue?.(kind, model, {save: false, rerender: false});
  }
}
async function autoConfigureProviderFromCard(card, button) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  const resetButton = () => {
    if (button?.isConnected) {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 保存并自动配置';
    }
  };
  const withTimeout = (promise, timeoutMs, message) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))
  ]);
  // Give immediate feedback before any async secret-store or network work.
  // Reading a global Key can cross the main-process bridge and previously left
  // the button visually idle until that await completed.
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 正在读取配置';
  }
  provider.setupStatus = 'running';
  provider.setupMessage = '正在保存地址和 Key，准备读取模型列表…';
  saveSettings();
  toast('正在保存 API 配置并读取模型列表…', 'info');
  syncApiProviderCardFields(card, provider);
  if (!provider.apiUrl) {
    resetButton();
    provider.setupStatus = 'needs-url';
    provider.setupMessage = '请先填写 API 地址';
    saveSettings();
    return toast('请先填写 API 地址。', 'warn');
  }
  const typedKey = card?.querySelector('[data-provider-key-input]')?.value?.trim() || '';
  let apiKey = '';
  try {
    if (typedKey && !await withTimeout(saveProviderKeyFromCard(card, true), 12000, '保存 API Key 超时，请检查密钥存储权限后重试')) {
      resetButton();
      provider.setupStatus = 'failed';
      provider.setupMessage = 'Key 保存失败';
      saveSettings();
      return toast('密钥未能保存，请检查 API 地址和 Key 后重试。', 'error');
    }
    apiKey = await withTimeout(providerApiKey(provider, 'all'), 12000, '读取 API Key 超时，请重启软件后重试');
    if (!apiKey && provider.type !== 'custom-sync') {
      resetButton();
      provider.setupStatus = 'needs-key';
      provider.setupMessage = '请粘贴 API Key，软件会自动加入当前服务的 Key 池';
      saveSettings();
      renderApiProviders();
      return toast(providerKeyUnavailableMessage(provider, 'all'), 'warn');
    }
    if (button) button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 正在读取模型';
    let detected = null;
    let records = [];
    assertUsableApiBaseAddress(provider.apiUrl);
    detected = await withTimeout(autoDetectProviderProtocol(provider, provider.apiUrl, apiKey), 20000, '读取接口配置超时，请检查 API 地址后重试');
    records = detected?.modelRecords || [];
    let requestUrl = '';
    let usedV1Fallback = Boolean(detected?.usedV1Fallback);
    if (!records.length) {
      const response = await withTimeout(fetchApiWithBaseFallback(provider.apiUrl, '/models', {
        timeoutMs: API_TIMEOUTS.text,
        retries: 0,
        headers: apiKey ? {Authorization: 'Bearer ' + apiKey} : {}
      }), 20000, '读取模型列表超时，请检查 API 地址后重试');
      requestUrl = response.requestUrl || '';
      usedV1Fallback = usedV1Fallback || Boolean(response.usedV1Fallback);
      const data = await safeJson(response.res);
      if (!response.res.ok) throw new Error(data?.error?.message || data?.message || '模型列表请求失败（HTTP ' + response.res.status + '）');
      records = extractModelRecords(data);
      assertModelListResponse({response: response.res, payload: data, models: records.map(record => record.id), requestUrl});
    }
    const models = unique(records.map(record => String(record.id || '').trim()).filter(Boolean));
    if (!models.length) throw new Error('接口已响应，但没有返回可用模型。');
    if (applyImportedModelRecordsToProvider) applyImportedModelRecordsToProvider(provider, records);
    else applyImportedModelsToProvider(provider, models);
    provider.models = unique([...(provider.models || []), ...models]);
    provider.chatModel = automaticModelForKind(provider, records, 'chat');
    provider.imageModel = automaticModelForKind(provider, records, 'image');
    provider.videoModel = automaticModelForKind(provider, records, 'video');
    provider.setupModelsCount = models.length;
    provider.imageModelsFetchedAt = Date.now();
    provider.setupStatus = provider.imageModel ? 'ready' : 'needs-model';
    const protocolText = detected?.message || providerProtocolStatusText(provider);
    const modelText = provider.imageModel ? '图片模型：' + provider.imageModel : '未能从模型列表确认图片模型，请到“其他模型与 Key”手动选择';
    provider.setupMessage = [protocolText, '发现 ' + models.length + ' 个模型', modelText, usedV1Fallback ? '已自动兼容 /v1' : ''].filter(Boolean).join(' · ');
    provider.lastTest = {status: provider.imageModel ? 'ok' : 'warn', message: provider.imageModel ? '自动配置完成' : '需要确认图片模型', checkedAt: Date.now()};
    applyAutomaticProviderDefaults(provider);
    if (apiKey) reportProviderKeyResult(provider, 'all', null, apiKey);
    saveSettings();
    renderApiProviders();
    renderModels();
    refreshNodeProviderSelects();
    refreshNodeModelSelects();
    const summary = provider.imageModel ? '图片模型 ' + provider.imageModel : '未确认图片模型';
    toast('自动配置完成：' + provider.name + ' · ' + summary, provider.imageModel ? 'success' : 'warn');
  } catch (err) {
    if (apiKey) reportProviderKeyResult(provider, 'all', err, apiKey);
    provider.setupStatus = 'failed';
    provider.setupMessage = apiErrorMessage(err, '自动配置失败');
    provider.lastTest = {status: 'fail', message: '自动配置失败', checkedAt: Date.now()};
    saveSettings();
    renderApiProviders();
    // Rendering replaces password inputs for security. Keep the just-entered
    // value in the fresh card after a failed save so the user can retry.
    if (typedKey) {
      const freshCard = document.querySelector(`[data-provider-id="${CSS.escape(provider.id)}"]`);
      const freshInput = freshCard?.querySelector('[data-provider-key-input]');
      if (freshInput) freshInput.value = typedKey;
    }
    toast(provider.setupMessage, 'error');
  } finally {
    resetButton();
  }
}
async function saveAndTestProviderFromCard(card, button) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  syncApiProviderCardFields(card, provider);
  if (!provider.apiUrl) return toast('请先填写 API 地址。', 'warn');
  if (provider.useGlobalKey || provider.type === 'custom-sync') return await testApiProviderFromCard(card);
  const typedKey = card?.querySelector('[data-provider-key-input]')?.value?.trim() || '';
  if (!typedKey && !(provider.keyPool || []).length) return toast('请粘贴 API Key，再点击“保存并自动配置”。', 'warn');
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 正在检测';
  }
  try {
    if (typedKey && !await saveProviderKeyFromCard(card, true)) {
      return toast('密钥未能保存，请检查 API 地址和 Key 后重试。', 'error');
    }
    const freshCard = document.querySelector(`[data-provider-id="${CSS.escape(provider.id)}"]`);
    return await testSelectedProviderKey(freshCard || card, null);
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-circle-check"></i> 保存并检测';
    }
  }
}
async function removeProviderKeyFromCard(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  const keyId = (provider.keyPool || [])
    .slice()
    .sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0))[0]?.id
    || provider.activeKeyId
    || '';
  if (!keyId) return toast('当前没有可删除的 Key', 'warn');
  await window.secretBridge?.removeProviderApiKey?.(provider.id, keyId);
  providerKeyCache.delete(provider.id + ':' + keyId);
  provider.keyPool = (await window.secretBridge?.listProviderApiKeys?.(provider.id) || []).map(providerKeyMeta);
  provider.imageCapabilityByKey = normalizeImageCapabilityByKey(provider.imageCapabilityByKey, provider.keyPool || []);
  if (provider.imageCapabilityKeyId === keyId) {
    provider.imageCapabilityStatus = 'unknown';
    provider.imageCapabilityMessage = '';
    provider.imageCapabilityKeyId = '';
  }
  provider.activeKeyId = provider.keyPool[0]?.id || '';
  provider.apiKeySaved = provider.keyPool.length > 0;
  saveSettings();
  renderApiProviders();
  toast(`已删除最近使用 Key：${provider.name}`, 'success');
}
function setProviderTestStatus(provider, status, message) {
  if (!provider) return;
  provider.lastTest = {status, message, checkedAt: Date.now()};
  saveSettings();
  renderApiProviders();
}
function providerCapabilityKeyId(keyRef = null, provider = null) {
  const keyId = String(keyRef?.keyId || keyRef?.id || '').trim();
  if (keyId) return keyId;
  return provider?.useGlobalKey && keyRef ? '__global__' : '';
}
function imageCapabilityForKey(provider, keyRef = null) {
  const keyId = providerCapabilityKeyId(keyRef, provider);
  if (!keyId) return null;
  return provider?.imageCapabilityByKey?.[keyId] || null;
}
function imageCapabilityError(provider, keyRef = null) {
  const name = provider?.name || '当前 API 配置';
  const keyId = providerCapabilityKeyId(keyRef, provider);
  const key = provider?.keyPool?.find(item => item.id === keyId);
  const keyLabel = key?.label ? `（${key.label}）` : '';
  const error = new Error(`${name} 的当前图片密钥${keyLabel}所属账户组未开通图片生成。软件会继续尝试其他可用图片 Key；也可以在中转站为该账户组开通图片生成。`);
  error.code = 'IMAGE_CAPABILITY_DISABLED';
  error.keyId = keyId;
  return error;
}
function isImageProviderCapabilityError(err) {
  return err?.code === 'IMAGE_CAPABILITY_DISABLED' || /image generation is not enabled for this group|图片生成未开通|未开通图片生成/i.test(String(err?.message || err || ''));
}
function markImageProviderCapability(provider, status, message = '', keyRef = null) {
  if (!provider) return;
  const keyId = providerCapabilityKeyId(keyRef, provider);
  provider.imageCapabilityByKey = normalizeImageCapabilityByKey(provider.imageCapabilityByKey, provider.keyPool || []);
  if (keyId) {
    if (status === 'unknown') delete provider.imageCapabilityByKey[keyId];
    else provider.imageCapabilityByKey[keyId] = {status, message: String(message || '').trim(), checkedAt: Date.now()};
    provider.imageCapabilityKeyId = keyId;
  }
  provider.imageCapabilityStatus = status;
  provider.imageCapabilityMessage = String(message || '').trim();
  if (status === 'blocked') provider.lastTest = {status: 'warn', message: '图片能力未开通', checkedAt: Date.now()};
  if (status === 'available') provider.lastTest = {status: 'ok', message: '图片能力已验证', checkedAt: Date.now()};
  saveSettings();
  renderApiProviders();
}
function assertImageProviderCapability(provider, keyRef = null) {
  const capability = imageCapabilityForKey(provider, keyRef);
  if (capability?.status === 'blocked') throw imageCapabilityError(provider, keyRef);
}
async function testImageProviderFromCard(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  await saveTypedProviderKeyIfNeeded(card);
  const apiUrl = provider.apiUrl || $('apiUrl')?.value.trim().replace(/\/$/, '');
  const model = String(provider.imageModel || '').trim();
  const apiKey = await providerApiKey(provider, 'image', model);
  if (!apiUrl) return toast('API 地址尚未填写，请先填写并保存。', 'warn');
  if (!model) return toast('图片模型尚未填写，请先选择或填写图片模型。', 'warn');
  if (!apiKey) return toast(providerKeyUnavailableMessage(provider, 'image'), 'warn');
  markImageProviderCapability(provider, 'unknown', '', apiKey);
  try {
    await autoDetectProviderProtocol(provider, apiUrl, apiKey);
    await requestImageGenerationWithModel({
      apiUrl,
      apiKey,
      provider,
      prompt: 'A single small blue circle on a plain white background.',
      size: '1024x1024',
      quality: 'auto'
    }, model);
    reportProviderKeyResult(provider, 'image', null, apiKey);
    markImageProviderCapability(provider, 'available', '', apiKey);
    toast(`图片能力已验证：${provider.name}`, 'success');
  } catch (err) {
    reportProviderKeyResult(provider, 'image', err, apiKey);
    if (isImageProviderCapabilityError(err)) return toast(err.message, 'error');
    markImageProviderCapability(provider, 'unknown', '', apiKey);
    setProviderTestStatus(provider, 'warn', '图片检测失败');
    toast(`图片检测失败：\n${err.message || String(err)}`, 'error');
  }
}
function providerConformanceOption(id) {
  return document.querySelector(`[data-conformance-step="${id}"]`);
}
function conformanceStepSelection() {
  return Object.fromEntries(ProviderConformance.STEP_ORDER.map(id => [id, Boolean(providerConformanceOption(id)?.checked && !providerConformanceOption(id)?.disabled)]));
}
function configureConformanceOptions(provider) {
  const availability = {
    models: true,
    text: Boolean(provider.chatModel),
    imageSquare: Boolean(provider.imageModel && providerSupports(provider, 'image')),
    imageLandscape: Boolean(provider.imageModel && providerSupports(provider, 'image')),
    imageReference: Boolean(provider.imageModel && providerSupports(provider, 'edit')),
    videoLandscape: Boolean(provider.videoModel && providerSupports(provider, 'video'))
  };
  for (const [id, enabled] of Object.entries(availability)) {
    const input = providerConformanceOption(id);
    if (!input) continue;
    input.disabled = !enabled;
    if (!enabled) input.checked = false;
    if (id === 'models' || id === 'text') input.checked = enabled;
  }
}
async function openProviderConformance(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider || !ProviderConformance) return;
  syncApiProviderCardFields(card, provider);
  await saveTypedProviderKeyIfNeeded(card);
  saveSettings();
  providerConformanceProviderId = provider.id;
  host.providerConformanceLiveResults = [];
  providerConformanceRunning = false;
  if ($('providerConformanceSubtitle')) $('providerConformanceSubtitle').textContent = `${provider.name} · ${providerTypeLabel(provider.type)}`;
  configureConformanceOptions(provider);
  renderProviderConformanceReport(provider.lastConformance);
  $('providerConformanceRun')?.classList.remove('hidden');
  $('providerConformanceRerun')?.classList.toggle('hidden', !provider.lastConformance);
  $('providerConformanceModal')?.classList.remove('hidden');
}
function closeProviderConformance() {
  if (providerConformanceRunning) return toast('兼容性验收正在运行', 'warn');
  $('providerConformanceModal')?.classList.add('hidden');
}
function resetProviderConformanceModal() {
  const provider = host.apiProviders.find(item => item.id === providerConformanceProviderId);
  if (!provider || providerConformanceRunning) return;
  host.providerConformanceLiveResults = [];
  configureConformanceOptions(provider);
  renderProviderConformanceReport(null);
  $('providerConformanceRun')?.classList.remove('hidden');
  $('providerConformanceRerun')?.classList.add('hidden');
}
function conformanceReferenceImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f9fb';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#1887d8';
  ctx.beginPath();
  ctx.arc(64, 64, 32, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL('image/png');
}
async function conformanceImageEvidence(url, expectedSize) {
  if (!url) throw new Error('供应商未返回图片地址');
  return {modelOutput: 'image', requestedSize: expectedSize};
}
async function conformanceVideoEvidence(url, expectedAspect = '16:9') {
  if (!url) throw new Error('供应商未返回视频地址');
  return {modelOutput: 'video', requestedSize: expectedAspect === '16:9' ? '1280x720' : ''};
}
function conformanceEvidenceText(evidence = {}) {
  return [
    evidence.modelCount != null ? `${evidence.modelCount} 个模型` : '',
    evidence.model ? evidence.model : '',
    evidence.requestedSize ? `请求 ${evidence.requestedSize}` : '',
    evidence.reply ? '已返回文本' : ''
  ].filter(Boolean).join(' · ');
}
function renderProviderConformanceReport(report = null) {
  const host = $('providerConformanceResults');
  if (!host) return;
  $('providerConformanceExport')?.classList.toggle('hidden', !ProviderConformance.commercialEvidenceReady(report));
  const rows = report?.results || host.providerConformanceLiveResults;
  if (!rows.length) {
    host.innerHTML = '<div class="provider-conformance-empty"><i class="fa-solid fa-clipboard-check"></i><span>选择验收项后开始</span></div>';
    return;
  }
  host.innerHTML = rows.map(item => {
    const icon = item.status === 'passed' ? 'fa-circle-check' : item.status === 'failed' ? 'fa-circle-xmark' : 'fa-circle-notch fa-spin';
    const detail = item.status === 'failed' ? `${item.error?.category || 'provider-error'} · ${item.error?.message || '失败'}` : item.status === 'running' ? '正在请求...' : conformanceEvidenceText(item.evidence);
    return `<div class="provider-conformance-result ${esc(item.status)}"><i class="fa-solid ${icon}"></i><div><strong>${esc(item.label)}</strong><span>${esc(detail || '已通过')}</span></div><time>${item.durationMs != null ? Math.round(item.durationMs / 100) / 10 + 's' : ''}</time></div>`;
  }).join('');
  if (report?.summary) {
    host.insertAdjacentHTML('afterbegin', `<div class="provider-conformance-summary ${esc(report.summary.status)}"><strong>${report.summary.passed}/${report.summary.selected}</strong><span>${report.summary.failed ? `${report.summary.failed} 项未通过` : '所选项全部通过'}</span></div>`);
  }
}
async function exportProviderConformanceEvidence() {
  const provider = host.apiProviders.find(item => item.id === providerConformanceProviderId);
  const report = provider?.lastConformance;
  if (!provider || !ProviderConformance.commercialEvidenceReady(report)) return toast('需要六项真实能力全部通过后才能导出证据', 'warn');
  if (!window.providerConformanceBridge?.exportEvidence) return toast('当前安装包不支持商业证据导出', 'error');
  const button = $('providerConformanceExport');
  if (button) button.disabled = true;
  try {
    const apiUrl = provider.apiUrl || $('apiUrl')?.value.trim().replace(/\/$/, '');
    const evidence = ProviderConformance.buildCommercialEvidence(report);
    const result = await window.providerConformanceBridge.exportEvidence({apiUrl, evidence});
    if (!result?.canceled) toast(`验收证据已导出\nSHA-256：${result.sha256}`, 'success');
  } catch (err) {
    toast(apiErrorMessage(err, '导出验收证据失败'), 'error');
  } finally {
    if (button) button.disabled = false;
  }
}
async function runProviderConformanceFromModal() {
  const provider = host.apiProviders.find(item => item.id === providerConformanceProviderId);
  if (!provider || providerConformanceRunning) return;
  const selected = conformanceStepSelection();
  if (!Object.values(selected).some(Boolean)) return toast('请至少选择一个验收项', 'warn');
  const apiUrl = provider.apiUrl || $('apiUrl')?.value.trim().replace(/\/$/, '');
  if (!apiUrl) return toast('API 地址尚未填写，请先填写并保存。', 'warn');
  assertUsableApiBaseAddress(apiUrl);
  providerConformanceRunning = true;
  host.providerConformanceLiveResults = [];
  $('providerConformanceRun').disabled = true;
  $('providerConformanceRun').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>验收中';
  $('providerConformanceRerun')?.classList.add('hidden');
  document.querySelectorAll('[data-conformance-step]').forEach(input => { input.disabled = true; });
  const runWithCapabilityKey = async (capability, model, task) => {
    const apiKey = await providerApiKey(provider, capability, model);
    if (!apiKey && provider.type !== 'custom-sync') throw new Error(providerKeyUnavailableMessage(provider, capability));
    try {
      const result = await task(apiKey || '');
      if (apiKey) reportProviderKeyResult(provider, capability, null, apiKey);
      return result;
    } catch (error) {
      if (apiKey) reportProviderKeyResult(provider, capability, error, apiKey);
      throw error;
    }
  };
  const imageRun = async (size, prompt, refs = []) => {
    return await runWithCapabilityKey('image', provider.imageModel, async apiKey => {
      const url = refs.length
        ? await rawImageEditRequest({provider, apiUrl, apiKey, model: provider.imageModel, prompt, size, quality: 'auto', refUrls: refs})
        : await rawImageGenerationWithModel({provider, apiUrl, apiKey, prompt, size, quality: 'auto'}, provider.imageModel, size);
      return await conformanceImageEvidence(url, size);
    });
  };
  const steps = {
    models: async () => await runWithCapabilityKey(provider.chatModel ? 'chat' : provider.imageModel ? 'image' : 'video', provider.chatModel || provider.imageModel || provider.videoModel, async apiKey => {
      const {res, usedV1Fallback} = await fetchApiWithBaseFallback(apiUrl, '/models', {timeoutMs: 30000, retries: 0, headers: apiKey ? {Authorization: 'Bearer ' + apiKey} : {}});
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
      const models = extractModelIds(data);
      assertModelListResponse({response: res, payload: data, models, requestUrl: '[API_ENDPOINT]'});
      return {modelCount: models.length, usedV1Fallback, chatModelListed: !provider.chatModel || models.includes(provider.chatModel), imageModelListed: !provider.imageModel || models.includes(provider.imageModel), videoModelListed: !provider.videoModel || models.includes(provider.videoModel)};
    }),
    text: async () => await runWithCapabilityKey('chat', provider.chatModel, async apiKey => ({model: provider.chatModel, reply: await chatCompletionTextRequest({apiUrl, apiKey, model: provider.chatModel, temperature: 0, maxTokens: 24, timeoutMs: 30000, retries: 0, endpoint: provider.chatEndpoint, messages: [{role: 'system', content: '只回复 OK。'}, {role: 'user', content: 'ping'}]})})),
    imageSquare: async () => await imageRun('1024x1024', 'A single small blue circle centered on a plain white background.'),
    imageLandscape: async () => await imageRun('1280x720', 'A simple blue horizon line on a clean white background, exact 16:9 composition.'),
    imageReference: async () => await imageRun('1024x1024', 'Keep the blue circle and add one small black dot in the center.', [conformanceReferenceImage()]),
    videoLandscape: async () => await runWithCapabilityKey('video', provider.videoModel, async apiKey => {
      const url = await videoGenerateRequest({provider, apiUrl, apiKey, model: provider.videoModel, prompt: 'A blue circle moves slowly from left to right on a white background.', size: '1280x720', duration: '5', mode: 'auto', refUrl: '', onStatus: text => {
        const running = host.providerConformanceLiveResults.find(item => item.id === 'videoLandscape');
        if (running) running.detail = text;
      }});
      return await conformanceVideoEvidence(url, '16:9');
    })
  };
  try {
    const report = await ProviderConformance.runProviderConformance({provider, selected, steps, onProgress: item => {
      const index = host.providerConformanceLiveResults.findIndex(current => current.id === item.id);
      if (index >= 0) host.providerConformanceLiveResults[index] = item;
      else host.providerConformanceLiveResults.push(item);
      renderProviderConformanceReport();
    }});
    provider.lastConformance = report;
    provider.lastTest = {status: report.summary.failed ? 'warn' : 'ok', message: `验收 ${report.summary.passed}/${report.summary.selected}`, checkedAt: Date.now()};
    saveSettings();
    renderApiProviders();
    renderProviderConformanceReport(report);
    toast(report.summary.failed ? `验收完成：${report.summary.failed} 项未通过` : '所选兼容性验收全部通过', report.summary.failed ? 'warn' : 'success');
  } finally {
    providerConformanceRunning = false;
    $('providerConformanceRun').disabled = false;
    $('providerConformanceRun').innerHTML = '<i class="fa-solid fa-play"></i>开始验收';
    $('providerConformanceRun').classList.add('hidden');
    $('providerConformanceRerun')?.classList.remove('hidden');
    configureConformanceOptions(provider);
  }
}
async function testApiProviderFromCard(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  await saveTypedProviderKeyIfNeeded(card);
  const apiUrl = provider.apiUrl || $('apiUrl')?.value.trim().replace(/\/$/, '');
  const chatModel = String(provider.chatModel || '').trim();
  const imageModel = String(provider.imageModel || '').trim();
  const videoModel = String(provider.videoModel || '').trim();
  const keyCandidates = [
    {capability: 'chat', model: chatModel},
    {capability: 'image', model: imageModel},
    {capability: 'video', model: videoModel}
  ].filter(item => item.model && providerSupports(provider, item.capability));
  let testedCapability = keyCandidates[0]?.capability || 'chat';
  let apiKey = '';
  for (const candidate of keyCandidates) {
    const candidateKey = await providerApiKey(provider, candidate.capability, candidate.model);
    if (!candidateKey) continue;
    testedCapability = candidate.capability;
    apiKey = candidateKey;
    break;
  }
  if (!apiUrl) return toast('API 地址尚未填写，请先填写并保存。', 'warn');
  if (!apiKey && provider.type !== 'custom-sync') return toast(providerKeyUnavailableMessage(provider, testedCapability), 'warn');
  try {
    assertUsableApiBaseAddress(apiUrl);
    const detected = await autoDetectProviderProtocol(provider, apiUrl, apiKey);
    let modelsNote = detected?.message ? `\n${detected.message}` : '';
    let modelsAvailable = false;
    try {
      const headers = apiKey ? {Authorization: 'Bearer ' + apiKey} : {};
      const {res, requestUrl, usedV1Fallback} = await fetchApiWithBaseFallback(apiUrl, '/models', {
        timeoutMs: 30000,
        retries: 0,
        headers
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
      const models = extractModelIds(data);
      modelsAvailable = true;
      if (usedV1Fallback) modelsNote = `\n已使用兼容接口：${requestUrl}`;
      const missingListed = [
        chatModel && !models.includes(chatModel) ? `聊天模型 ${chatModel}` : '',
        imageModel && !models.includes(imageModel) ? `图片模型 ${imageModel}` : '',
        videoModel && !models.includes(videoModel) ? `视频模型 ${videoModel}` : ''
      ].filter(Boolean);
      if (missingListed.length) modelsNote += `\n注意：${missingListed.join('、')} 不在 /models 列表中。`;
    } catch (modelsErr) {
      modelsNote = chatModel
        ? `\n注意：/models 列表不可用，但已继续测试真实聊天请求。`
        : `\n注意：/models 列表不可用，已保留配置，可在节点里实测生成。`;
    }
    if (testedCapability === 'chat' && chatModel) {
      await chatCompletionTextRequest({
        apiUrl,
        apiKey,
        model: chatModel,
        temperature: 0,
        maxTokens: 24,
        timeoutMs: 30000,
        retries: 0,
        endpoint: provider.chatEndpoint,
        messages: [
          {role: 'system', content: '只回复 OK。'},
          {role: 'user', content: 'ping'}
        ]
      });
    }
    const missing = [];
    if (providerSupports(provider, 'image') && !imageModel) missing.push('图像模型未填');
    if (providerSupports(provider, 'video') && provider.enabledVideo && !videoModel) missing.push('视频模型未填');
    const configuredCaps = [
      chatModel ? '文本' : '',
      imageModel ? '图片' : '',
      videoModel ? '视频' : ''
    ].filter(Boolean);
    const status = missing.length || (!modelsAvailable && !chatModel) || modelsNote ? 'warn' : 'ok';
    const message = missing.length ? missing.join(' / ') : configuredCaps.length ? `${configuredCaps.join('/')}已配置` : '连接可用';
    setProviderTestStatus(provider, status, message);
    reportProviderKeyResult(provider, testedCapability, null, apiKey);
    toast(`API 配置可用：${provider.name}${chatModel ? `，聊天模型 ${chatModel} 可返回内容` : ''}${!chatModel && (imageModel || videoModel) ? '，已跳过聊天测试' : ''}${modelsNote}${missing.length ? '\n注意：' + missing.join('、') : ''}`, status === 'warn' ? 'warn' : 'success');
  } catch (err) {
    reportProviderKeyResult(provider, testedCapability, err, apiKey);
    setProviderTestStatus(provider, 'fail', '测试失败');
    toast(apiErrorMessage(err, 'API 配置测试失败'), 'error');
  }
}
async function testSelectedProviderKey(card, button) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider || provider.useGlobalKey) return toast('请先把密钥策略切换为“使用独立 Key”', 'warn');
  const apiUrl = String(provider.apiUrl || '').trim().replace(/\/$/, '');
  if (!apiUrl) return toast('请先填写 API 地址', 'warn');
  const capability = provider.chatModel ? 'chat' : provider.imageModel ? 'image' : 'video';
  const apiKey = await providerApiKey(provider, capability, provider[capability === 'chat' ? 'chatModel' : capability === 'image' ? 'imageModel' : 'videoModel']);
  const key = provider?.keyPool?.find(item => item.id === apiKey?.keyId);
  if (!apiKey || !key) return toast('Key 池中没有可用密钥，请粘贴新的 Key', 'error');
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 测试中';
  }
  try {
    assertUsableApiBaseAddress(apiUrl);
    await autoDetectProviderProtocol(provider, apiUrl, apiKey);
    if (capability === 'chat' && provider.chatModel) {
      await chatCompletionTextRequest({
        apiUrl,
        apiKey,
        model: provider.chatModel,
        temperature: 0,
        maxTokens: 8,
        timeoutMs: 30000,
        retries: 0,
        endpoint: provider.chatEndpoint,
        messages: [{role: 'user', content: '只回复 OK'}]
      });
    } else {
      const {res} = await fetchApiWithBaseFallback(apiUrl, '/models', {timeoutMs: 30000, retries: 0, headers: {Authorization: 'Bearer ' + apiKey}});
      if (!res.ok) {
        const data = await safeJson(res);
        const error = new Error(data.error?.message || data.message || `HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
    }
    reportProviderKeyResult(provider, capability, null, apiKey);
    toast(`Key 池测试通过：${key.label}（${key.masked || '已脱敏'}）`, 'success');
  } catch (err) {
    reportProviderKeyResult(provider, capability, err, apiKey);
    toast(apiErrorMessage(err, `Key 池测试失败：${key.label}`), 'error');
  } finally {
    renderApiProviders();
  }
}
async function importModelsForProviderCard(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  const typedKey = card?.querySelector('[data-provider-key-input]')?.value?.trim() || '';
  if (typedKey && !await saveTypedProviderKeyIfNeeded(card)) return;
  const apiUrl = provider.apiUrl || $('apiUrl')?.value.trim().replace(/\/$/, '');
  let selectedCapability = 'chat';
  let apiKey = await providerApiKey(provider, 'chat');
  if (!apiKey) {
    selectedCapability = 'image';
    apiKey = await providerApiKey(provider, 'image');
  }
  if (!apiKey) {
    selectedCapability = 'video';
    apiKey = await providerApiKey(provider, 'video');
  }
  if (!apiUrl) return toast('API 地址尚未填写，请先填写并保存。', 'warn');
  if (!apiKey) return toast(providerKeyUnavailableMessage(provider, 'all'), 'warn');
  try {
    assertUsableApiBaseAddress(apiUrl);
    const detected = await autoDetectProviderProtocol(provider, apiUrl, apiKey);
    const {res, requestUrl, usedV1Fallback} = await fetchApiWithBaseFallback(apiUrl, '/models', {
      timeoutMs: API_TIMEOUTS.text,
      headers: {Authorization: 'Bearer ' + apiKey}
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
    const models = extractModelIds(data);
    assertModelListResponse({response: res, payload: data, models, requestUrl});
    const counts = applyImportedModelsToProvider(provider, models);
    host.importedModels = unique([...host.importedModels, ...models]);
    setStore(STORE.models, host.importedModels);
    saveSettings();
    renderApiProviders();
    renderModels();
    refreshNodeProviderSelects();
    refreshNodeModelSelects();
    reportProviderKeyResult(provider, selectedCapability, null, apiKey);
    toast(`已为 ${provider.name} 导入模型：${models.length} 个（${modelImportSummary(counts)}）${detected?.message ? `\n${detected.message}` : ''}${usedV1Fallback ? '\n已自动使用 /v1 兼容接口。' : ''}`, 'success');
  } catch (err) {
    reportProviderKeyResult(provider, selectedCapability, err, apiKey);
    toast(`模型导入失败：\n${err.message || String(err)}`, 'error');
  }
}
    return {
      providerTypeLabel,
      providerTypeMeta,
      providerTypeOptionsHtml,
      providerSupports,
      defaultEndpointForProvider,
      providerProtocolMode,
      providerProtocolStatusText,
      protocolSignalType,
      detectProviderProtocol,
      applyDetectedProviderProtocol,
      autoDetectProviderProtocol,
      defaultApiProvider,
      normalizeApiProvider,
      ensureApiProviders,
      migrateLegacyProviderKeys,
      uniqueById,
      syncLegacyApiProvider,
      providerOptionsHtml,
      currentProviderForNode,
      renderApiProviders,
      hydrateProviderKeyInputs,
      providerInitial,
      providerSetupResultHtml,
      providerModelDatalistHtml,
      providerModelSelectOptionsHtml,
      providerModelGroupHtml,
      providerModelLibraryHtml,
      providerCapabilityEditorHtml,
      syncProviderCapabilityEditor,
      apiProviderCardHtml,
      addApiProvider,
      syncApiProviderCardFields,
      handleApiProviderInput,
      handleApiProviderClick,
      refreshProviderBalance,
      refreshProviderBalances,
      providerBalanceQueryable,
      providerBalanceState,
      providerBalanceView,
      formatBalanceAmount,
      useProviderModelFromCard,
      addProviderModelFromCard,
      toggleApiProviderCollapsed,
      providerApiKey,
      providerKeyHealth,
      reportProviderKeyResult,
      addProviderKeyFromCard,
      saveProviderKeyFromCard,
      saveTypedProviderKeyIfNeeded,
      removeProviderKeyFromCard,
      setProviderTestStatus,
      imageCapabilityError,
      isImageProviderCapabilityError,
      markImageProviderCapability,
      assertImageProviderCapability,
      testImageProviderFromCard,
      providerConformanceOption,
      conformanceStepSelection,
      configureConformanceOptions,
      openProviderConformance,
      closeProviderConformance,
      resetProviderConformanceModal,
      conformanceReferenceImage,
      conformanceImageEvidence,
      conformanceVideoEvidence,
      conformanceEvidenceText,
      renderProviderConformanceReport,
      exportProviderConformanceEvidence,
      runProviderConformanceFromModal,
      testApiProviderFromCard,
      autoConfigureProviderFromCard,
      testSelectedProviderKey,
      importModelsForProviderCard
    };
  }

  window.FutureAIProviderUI = { create };
})();
