(() => {
  'use strict';

  /**
   * Provider settings cards.
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
    const refreshNodeModelSelects = deps.refreshNodeModelSelects;
    const refreshNodeCapabilityControls = deps.refreshNodeCapabilityControls;
    const ModelCapabilities = deps.ModelCapabilities || window.FutureAIModelCapabilities;
    const ModelAvailability = deps.ModelAvailability || window.FutureAIModelAvailability;
    const unique = deps.unique;
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
    const isZexImageGateway = deps.isZexImageGateway;
    const normalizeKnownImageModelAlias = deps.normalizeKnownImageModelAlias;
    const setGlobalModelValue = deps.setGlobalModelValue;
    const setGlobalProviderValue = deps.setGlobalProviderValue;
  const syncGlobalModelInputs = deps.syncGlobalModelInputs;
  const modelKindLabel = deps.modelKindLabel;
  const requestImageGenerationWithModel = deps.requestImageGenerationWithModel;
  const rawImageEditRequest = deps.rawImageEditRequest;
  const rawImageGenerationWithModel = deps.rawImageGenerationWithModel;
  const providerKeyCache = new Map();

function providerTypeLabel(type) {
  return IMAGE_PROVIDER_TYPES.find(item => item.id === type)?.label || 'OpenAI Images';
}
function providerTypeMeta(type) {
  return IMAGE_PROVIDER_TYPES.find(item => item.id === type) || IMAGE_PROVIDER_TYPES[0];
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
    apiUrl: FutureAIApiDefaults.get('apiUrl') || 'https://nexusapi.cn/v1',
    useGlobalKey: true,
    chatModel: FutureAIApiDefaults.get('chatModel') || 'gpt-4o-mini',
    imageModel: FutureAIApiDefaults.get('imageModel') || 'gpt-image2',
    videoModel: FutureAIApiDefaults.get('videoModel') || 'sora-2',
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
  // Configs saved by older versions may carry a keyPool array; any saved entry means a Key exists.
  const legacyKeySaved = Array.isArray(provider.keyPool) && provider.keyPool.length > 0;
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
    apiKeySaved: Boolean(provider.apiKeySaved || provider.apiKey || legacyKeySaved),
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
    enabledVideo: provider.enabledVideo === true && providerSupports({type}, 'video'),
    collapsed: Boolean(provider.collapsed),
    ...(provider.availableModels?.checkedAt ? {availableModels: {
      chat: Array.isArray(provider.availableModels.chat) ? provider.availableModels.chat.map(String) : [],
      image: Array.isArray(provider.availableModels.image) ? provider.availableModels.image.map(String) : [],
      video: Array.isArray(provider.availableModels.video) ? provider.availableModels.video.map(String) : [],
      checkedAt: Number(provider.availableModels.checkedAt)
    }} : {}),
    lastTest: {
      status: lastTest.status || '',
      message: lastTest.message || '',
      checkedAt: lastTest.checkedAt || 0
    }
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
      apiUrl: settings.apiUrl || FutureAIApiDefaults.get('apiUrl') || 'https://nexusapi.cn/v1',
      imageModel: settings.imageModel || FutureAIApiDefaults.get('imageModel') || 'gpt-image2'
    })];
  }
  if (!host.apiProviders.some(provider => provider.id === 'default-openai')) {
    host.apiProviders.unshift(defaultApiProvider({
      apiUrl: settings.apiUrl || FutureAIApiDefaults.get('apiUrl') || 'https://nexusapi.cn/v1',
      imageModel: settings.imageModel || FutureAIApiDefaults.get('imageModel') || 'gpt-image2'
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
  provider.apiUrl = FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '') || provider.apiUrl;
  provider.chatModel = FutureAIApiDefaults.get('chatModel').trim() || provider.chatModel;
  provider.imageModel = FutureAIApiDefaults.get('imageModel').trim() || provider.imageModel;
  provider.videoModel = FutureAIApiDefaults.get('videoModel').trim() || provider.videoModel;
}
// Every model a provider offers for one node kind: its configured default, the models found by
// 检测可用模型 and its saved model list. Ids classified as another kind are left out.
function providerPickerModels(provider, kind) {
  const seen = new Set();
  return [provider?.[modelFieldForKind(kind)], ...(provider?.availableModels?.[kind] || []), ...providerModelsForKind(provider, kind)]
    .map(model => String(model || '').trim())
    .filter(model => {
      const key = model.toLowerCase();
      if (!model || seen.has(key)) return false;
      seen.add(key);
      const modelKind = classifyModelKind(model);
      return !modelKind || modelKind === kind;
    });
}
// Data for the canvas node model picker: one group per capable API service that has models of this kind.
function modelPickerGroups(capability = 'image') {
  ensureApiProviders();
  const kind = capability === 'video' ? 'video' : 'image';
  const field = modelFieldForKind(kind);
  const capable = host.apiProviders.filter(provider => providerSupports(provider, capability));
  const globalProvider = globalProviderForKind(kind);
  return {
    globalProviderName: globalProvider ? globalProvider.name || providerTypeLabel(globalProvider.type) : '',
    globalModel: globalProvider?.[field] || '',
    groups: (capable.length ? capable : host.apiProviders)
      .map(provider => ({
        providerId: provider.id,
        label: provider.name || providerTypeLabel(provider.type),
        defaultModel: provider[field] || '',
        models: providerPickerModels(provider, kind)
      }))
      .filter(group => group.models.length)
  };
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
    </div>
    ${imageFallbackSettingsHtml()}`;
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
    <span class="api-provider-list-rename api-provider-balance-refresh" data-provider-balance-refresh="${esc(provider.id)}" role="button" tabindex="0" title="刷新余额" aria-label="刷新余额"><i class="fa-solid fa-rotate"></i></span>
    <span class="api-provider-list-status ${healthClass}" title="${esc(healthText)}"></span>
  </button>`;
}
// Relay balance (API 中转站余额). Lookups run in the main process, which reads the key itself
// and caches results, so refreshing here never exposes the key or spams the relay.
const providerBalances = new Map();
function providerBalanceQueryable(provider) {
  return Boolean(provider?.apiUrl && provider.type !== 'custom-sync'
    && window.FutureAIModelAvailability.providerHasUsableKey(provider, FutureAIApiDefaults.get('apiKey')));
}
function formatBalanceAmount(value, unit) {
  const code = String(unit || '').toUpperCase();
  if (code === 'USD') return `$${value.toFixed(2)}`;
  if (code === 'CNY' || code === 'RMB') return `¥${value.toFixed(2)}`;
  if (code === 'QUOTA') return `${Math.round(value).toLocaleString('zh-CN')} 额度`;
  return `${value.toFixed(2)} ${unit}`;
}
function providerBalanceView(provider) {
  if (!providerBalanceQueryable(provider)) return {text: '余额 —', title: '填写地址并保存 Key 后可查询余额', tone: ''};
  const state = providerBalances.get(provider.id);
  if (!state || state.status === 'loading') return {text: '余额 查询中…', title: '正在查询余额', tone: 'loading'};
  if (state.status === 'unsupported') return {text: '不支持查询', title: '该中转站没有提供可用的余额查询接口', tone: 'muted'};
  if (state.status !== 'ok') return {text: `查询失败：${state.reason || '未知错误'}`, title: '点击右侧刷新按钮重试', tone: 'fail'};
  const checked = state.checkedAt ? `查询于 ${new Date(state.checkedAt).toLocaleTimeString('zh-CN', {hour12: false})}` : '';
  const used = state.used === null || state.used === undefined ? '' : `已用 ${formatBalanceAmount(state.used, state.unit)}`;
  const total = state.total === null || state.total === undefined ? '' : `总额 ${formatBalanceAmount(state.total, state.unit)}`;
  const title = [used, total, checked].filter(Boolean).join(' · ');
  if (state.unlimited) return {text: '无限额度', title, tone: 'ok'};
  if (state.remaining !== null && state.remaining !== undefined) return {text: `余额 ${formatBalanceAmount(state.remaining, state.unit)}`, title, tone: state.remaining <= 0 ? 'fail' : 'ok'};
  return {text: total || '余额 —', title, tone: 'ok'};
}
function providerBalanceLineHtml(provider) {
  const view = providerBalanceView(provider);
  return `<span class="api-provider-list-balance ${view.tone}" data-provider-balance="${esc(provider.id)}" title="${esc(view.title)}">${esc(view.text)}</span>`;
}
function providerBalanceState(providerId) {
  return providerBalances.get(providerId) || null;
}
// Paints the settings row and tells the top-bar balance chip (app shell) to repaint too.
function paintProviderBalance(provider) {
  const line = $('apiProviderList')?.querySelector(`[data-provider-balance="${CSS.escape(provider.id)}"]`);
  if (line) line.outerHTML = providerBalanceLineHtml(provider);
  onBalanceDisplayChange?.();
}
// One lookup per provider at a time. A forced refresh that arrives while a plain one is in
// flight runs after it, so callers that need a fresh number (spend tracking) always get one.
// quiet keeps the last amount on screen instead of switching to 查询中 while it refreshes.
const providerBalanceInflight = new Map();
function refreshProviderBalance(provider, {force = false, quiet = false} = {}) {
  if (!providerBalanceQueryable(provider) || !window.secretBridge?.getProviderBalance) return Promise.resolve(null);
  const inflight = providerBalanceInflight.get(provider.id);
  if (inflight) return force && !inflight.force ? inflight.promise.then(() => refreshProviderBalance(provider, {force, quiet})) : inflight.promise;
  const previous = providerBalances.get(provider.id);
  if (!(quiet && previous?.status === 'ok')) {
    providerBalances.set(provider.id, {status: 'loading'});
    paintProviderBalance(provider);
  }
  const promise = (async () => {
    let result;
    try {
      result = await window.secretBridge.getProviderBalance({providerId: provider.id, apiUrl: provider.apiUrl, useGlobalKey: provider.useGlobalKey === true, force});
    } catch {
      result = null;
    }
    result = result || {status: 'error', reason: '查询异常'};
    providerBalances.set(provider.id, result);
    providerBalanceInflight.delete(provider.id);
    const current = host.apiProviders.find(item => item.id === provider.id);
    if (current) paintProviderBalance(current);
    return result;
  })();
  providerBalanceInflight.set(provider.id, {promise, force});
  return promise;
}
function refreshProviderBalances({force = false} = {}) {
  ensureApiProviders();
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
    if (!input || document.activeElement === input) continue;
    const value = providerKeyCache.has(provider.id)
      ? providerKeyCache.get(provider.id)
      : await window.secretBridge.getProviderApiKey(provider.id);
    providerKeyCache.set(provider.id, value || '');
    input.value = value || '';
  }
}
function providerKeyUnavailableMessage(provider) {
  if (!provider) return '当前 API 配置不存在，请重新打开设置。';
  if (provider.useGlobalKey) return '当前配置使用全局 Key，但全局 Key 为空。请填写全局 API Key。';
  if (!provider.apiKeySaved) return 'API 地址已填写，但还没有保存 Key。请粘贴 Key 后点击“保存并自动配置”。';
  if (provider.imageCapabilityStatus === 'blocked') return '已保存 Key，但该 Key 所属账户组未开通图片生成。请在中转站开通图片权限，或换一把已开通的 Key。';
  return '已保存 Key，但程序无法读取。请重新粘贴 Key 后点击“保存并自动配置”。';
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
  const models = unique([active, ...(provider?.availableModels?.[kind] || []), ...providerModelsForKind(provider, kind)].filter(Boolean));
  const available = models.filter(model => ModelAvailability.isAvailableModel(provider, kind, model));
  const ordered = [...available, ...models.filter(model => !available.includes(model))];
  return `<option value="" ${active ? '' : 'selected'}>选择模型，或在下方手动添加</option>`
    + ordered.map(model => {
      const ok = available.includes(model);
      return `<option value="${esc(model)}" ${ok ? 'class="model-option-available"' : ''} ${model === active ? 'selected' : ''}>${ok ? '✓ ' : ''}${esc(model)}${ok ? ' · 可用' : ''}</option>`;
    }).join('');
}
function formatCheckedAt(time) {
  const date = new Date(time);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function providerAvailabilityHtml(provider) {
  const record = provider?.availableModels;
  if (!record?.checkedAt) return '';
  const chips = ['chat', 'image', 'video'].flatMap(kind => (record[kind] || []).map(model => `<span class="provider-available-chip ${kind}"><em>${ModelAvailability.KIND_TAGS[kind]}</em>${esc(model)}</span>`));
  const body = chips.length ? chips.join('') : '<span class="provider-model-empty">未发现对话、生图或视频模型</span>';
  return `<div class="provider-availability" data-provider-availability>
    <header><strong>可用模型</strong><small>检测于 ${esc(formatCheckedAt(record.checkedAt))} · 对话 ${(record.chat || []).length} · 生图 ${(record.image || []).length} · 视频 ${(record.video || []).length}</small></header>
    <div>${body}</div>
  </div>`;
}
function imageModelsForProvider(provider) {
  return unique([provider?.imageModel, ...providerModelsForKind(provider, 'image')].filter(Boolean));
}
function currentImageFallbackChain() {
  return ModelAvailability.imageFallbackChain(host.apiProviders, host.imageFallback, imageModelsForProvider, host.globalModelProviders?.image || '');
}
function imageFallbackRouteLabel(route) {
  return `${route.model} · ${route.providerName}`;
}
function imageFallbackSettingsHtml() {
  const fallback = host.imageFallback;
  const chain = currentImageFallbackChain();
  const editing = !!host.imageFallbackEditing;
  const enabled = ModelAvailability.fallbackEnabled(fallback);
  const chainKeys = new Set([chain.primary?.key, ...chain.backups.map(route => route.key)]);
  const seenModels = new Set();
  const addable = chain.routes.filter(route => !chainKeys.has(route.key)).filter(route => {
    const id = `${route.providerId}::${route.model}`.toLowerCase();
    return !seenModels.has(id) && seenModels.add(id);
  });
  const rows = chain.backups.map((route, index) => `<li data-image-fallback-key="${esc(route.key)}">
      <span class="image-fallback-rank">${index + 1}</span>
      <span class="image-fallback-name" title="${esc(imageFallbackRouteLabel(route))}"><strong>${esc(route.model)}</strong><small>· ${esc(route.providerName)}</small></span>
      <button type="button" class="icon-btn" data-image-fallback-move="-1" title="上移" aria-label="上移" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
      <button type="button" class="icon-btn" data-image-fallback-move="1" title="下移" aria-label="下移" ${index === chain.backups.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
      <button type="button" class="icon-btn image-fallback-remove" data-image-fallback-remove title="移除" aria-label="移除"><i class="fa-solid fa-xmark"></i></button>
    </li>`).join('');
  const editor = editing ? `<div class="image-fallback-editor">
      <div class="image-fallback-primary"><em>默认</em><strong>${esc(chain.primary?.model || '未设置')}</strong>${chain.primary ? `<small>· ${esc(chain.primary.providerName)}</small>` : ''}</div>
      <ol>${rows || '<li class="image-fallback-empty">没有备用模型，默认模型不可用时会直接报错。</li>'}</ol>
      <div class="image-fallback-add">
        <select data-image-fallback-add-select ${addable.length ? '' : 'disabled'}>
          ${addable.length ? addable.map(route => `<option value="${esc(route.key)}">${esc(imageFallbackRouteLabel(route))}${route.confirmed ? ' ✓' : ''}</option>`).join('') : '<option value="">没有更多可添加的模型</option>'}
        </select>
        <button type="button" class="ghost-btn" data-image-fallback-add ${addable.length ? '' : 'disabled'}><i class="fa-solid fa-plus"></i> 添加</button>
        ${chain.customized ? '<button type="button" class="ghost-btn" data-image-fallback-reset title="恢复为自动选择的 2 个备用">恢复自动</button>' : ''}
      </div>
    </div>` : '';
  return `<section class="image-fallback-settings${editing ? ' editing' : ''}" data-image-fallback-settings>
    <header>
      <label><input type="checkbox" data-image-fallback-toggle ${enabled ? 'checked' : ''}> 生图模型不可用时自动切换</label>
      <div class="image-fallback-summary">
        <span data-image-fallback-summary title="遇到 404 / 503 / 不支持该模型时依次尝试">${esc(ModelAvailability.chainSummary(chain))}${chain.customized ? '' : '<em>自动</em>'}</span>
        <button type="button" class="ghost-btn" data-image-fallback-edit aria-expanded="${editing}">${editing ? '完成' : '编辑'}</button>
      </div>
    </header>
    ${editor}
  </section>`;
}
function setImageFallbackChain(keys) {
  host.imageFallback = {...ModelAvailability.normalizeFallbackSettings(host.imageFallback), customized: true, chain: [...new Set(keys.filter(Boolean))]};
  saveSettings();
  renderApiProviders();
}
function moveImageFallbackRoute(key, delta) {
  const keys = currentImageFallbackChain().backups.map(route => route.key);
  setImageFallbackChain(ModelAvailability.moveRoute(keys, key, delta));
}
function removeImageFallbackRoute(key) {
  setImageFallbackChain(currentImageFallbackChain().backups.map(route => route.key).filter(item => item !== key));
}
function addImageFallbackRoute(key) {
  if (!key) return;
  setImageFallbackChain([...currentImageFallbackChain().backups.map(route => route.key), key]);
}
function resetImageFallbackChain() {
  host.imageFallback = {...ModelAvailability.normalizeFallbackSettings(host.imageFallback), customized: false, chain: []};
  saveSettings();
  renderApiProviders();
}
async function detectAvailableModelsForCard(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  syncApiProviderCardFields(card, provider);
  await saveTypedProviderKeyIfNeeded(card);
  const apiKey = await providerApiKey(provider);
  if (!provider.apiUrl) return toast('请先填写 API 地址', 'warn');
  if (!apiKey) return toast(providerKeyUnavailableMessage(provider), 'warn');
  try {
    assertUsableApiBaseAddress(provider.apiUrl);
    const {res} = await fetchApiWithBaseFallback(provider.apiUrl, '/models', {timeoutMs: API_TIMEOUTS.text, retries: 0, headers: {Authorization: 'Bearer ' + apiKey}});
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
    const ids = extractModelRecords(data).map(record => record.id);
    provider.availableModels = ModelAvailability.availabilityRecord(ids, classifyModelKind);
    saveSettings();
    renderApiProviders();
    renderModels();
    toast(`检测完成：对话 ${provider.availableModels.chat.length} 个，生图 ${provider.availableModels.image.length} 个，视频 ${provider.availableModels.video.length} 个`, 'success');
  } catch (err) {
    toast('检测可用模型失败：' + (err?.message || err), 'error');
  }
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
function apiProviderCardHtml(provider, index = 0) {
  const meta = providerTypeMeta(provider.type);
  const capabilities = (meta.capabilities || []).map(item => `<span>${esc(item)}</span>`).join('');
  const healthClass = provider.lastTest?.status === 'ok' ? 'ok' : provider.lastTest?.status === 'warn' ? 'warn' : provider.lastTest?.status === 'fail' ? 'fail' : '';
  const healthText = provider.lastTest?.message || '未测试';
  const imageCapabilityNote = provider.imageCapabilityStatus === 'blocked'
    ? `<p class="provider-note api-provider-alert">当前 Key 未开通图片生成：${esc(provider.imageCapabilityMessage || '请在中转站开通图片权限。')}</p>`
    : provider.imageCapabilityStatus === 'available'
      ? '<p class="provider-note api-provider-success">图片能力已验证，可以开始生图。</p>'
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
            <label class="api-provider-wide api-provider-key-input">API Key<input data-provider-key-input type="password" value="" placeholder="${provider.apiKeySaved ? '粘贴新 Key，自动加入当前服务' : '粘贴 API Key'}"><small>保存后用于当前服务的聊天、生图和视频请求。</small></label>
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
          <button class="ghost-btn" data-provider-detect-models type="button"><i class="fa-solid fa-list-check"></i> 检测可用模型</button>
        </section>
        ${providerAvailabilityHtml(provider)}
        ${imageCapabilityNote}
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
  refreshNodeModelSelects();
}
function syncApiProviderCardFields(card, provider) {
  if (!card || !provider) return provider;
  const imageRouteBefore = [provider.apiUrl, provider.type, provider.imageModel, provider.imageEndpoint].join('\u0000');
  card.querySelectorAll('[data-provider-field]').forEach(input => {
    const field = input.dataset.providerField;
    if (!field) return;
    provider[field] = input.value;
  });
  provider.apiUrl = String(provider.apiUrl || '').trim().replace(/\/$/, '');
  provider.concurrency = Math.max(1, Math.min(4, Number(provider.concurrency || 1)));
  const imageRouteAfter = [provider.apiUrl, provider.type, provider.imageModel, provider.imageEndpoint].join('\u0000');
  if (imageRouteBefore !== imageRouteAfter) {
    provider.imageCapabilityStatus = 'unknown';
    provider.imageCapabilityMessage = '';
  }
  return provider;
}
function handleApiProviderInput(e) {
  // The fallback section sits outside any provider card, so handle it before the card lookup.
  if (e.target?.matches?.('[data-image-fallback-toggle]')) {
    if (e.type !== 'change') return;
    host.imageFallback = {...ModelAvailability.normalizeFallbackSettings(host.imageFallback), enabled: e.target.checked};
    saveSettings();
    return;
  }
  const field = e.target?.dataset?.providerField;
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
  if (!field) return;
  provider[field] = e.target.value;
  if (['apiUrl', 'imageModel'].includes(field)) {
    provider.imageCapabilityStatus = 'unknown';
    provider.imageCapabilityMessage = '';
  }
  if (field === 'apiUrl') {
    provider.lastTest = {status: '', message: '', checkedAt: 0};
  }
  saveSettings();
  renderModels();
  refreshNodeModelSelects();
  // API configuration is explicit: typing or blurring a field never starts a
  // network request. Use “读取模型” when the address and saved Key are ready.
}

async function renameApiProvider(id) {
  const provider = host.apiProviders.find(item => item.id === id);
  if (!provider) return;
  const current = provider.name || providerTypeLabel(provider.type);
  const next = await openModal?.({title: '重命名服务', value: current, okText: '保存'});
  const name = typeof next === 'string' ? next.trim() : '';
  if (!name || name === current) return;
  provider.name = name.slice(0, 60);
  saveSettings();
  renderApiProviders();
  refreshNodeModelSelects();
  toast('服务已重命名', 'success');
}
function handleApiProviderClick(e) {
  const balanceRefresh = e.target.closest('[data-provider-balance-refresh]');
  if (balanceRefresh) {
    e.preventDefault();
    e.stopPropagation();
    const provider = host.apiProviders.find(item => item.id === balanceRefresh.dataset.providerBalanceRefresh);
    return provider && refreshProviderBalance(provider, {force: true});
  }
  const renameProvider = e.target.closest('[data-provider-rename]');
  if (renameProvider) {
    e.preventDefault();
    e.stopPropagation();
    return renameApiProvider(renameProvider.dataset.providerRename);
  }
  const selectProvider = e.target.closest('[data-provider-select]');
  if (selectProvider) {
    host.apiProviderUiSelectedId = selectProvider.dataset.providerSelect;
    renderApiProviders();
    return;
  }
  const moveFallback = e.target.closest('[data-image-fallback-move]');
  if (moveFallback) return moveImageFallbackRoute(moveFallback.closest('[data-image-fallback-key]')?.dataset.imageFallbackKey, Number(moveFallback.dataset.imageFallbackMove));
  const removeFallback = e.target.closest('[data-image-fallback-remove]');
  if (removeFallback) return removeImageFallbackRoute(removeFallback.closest('[data-image-fallback-key]')?.dataset.imageFallbackKey);
  if (e.target.closest('[data-image-fallback-edit]')) {
    host.imageFallbackEditing = !host.imageFallbackEditing;
    return renderApiProviders();
  }
  if (e.target.closest('[data-image-fallback-add]')) {
    return addImageFallbackRoute(e.target.closest('[data-image-fallback-settings]')?.querySelector('[data-image-fallback-add-select]')?.value);
  }
  if (e.target.closest('[data-image-fallback-reset]')) return resetImageFallbackChain();
  const actionCard = e.target.closest('[data-provider-id]');
  const detectButton = e.target.closest('[data-provider-detect-models]');
  if (detectButton) {
    detectButton.disabled = true;
    return detectAvailableModelsForCard(actionCard).finally(() => {
      if (detectButton.isConnected) detectButton.disabled = false;
    });
  }
  if (e.target.closest('[data-provider-toggle]')) return toggleApiProviderCollapsed(actionCard);
  if (e.target.closest('[data-provider-auto-configure]')) return autoConfigureProviderFromCard(actionCard, e.target.closest('[data-provider-auto-configure]'));
  if (e.target.closest('[data-provider-test-image]')) return testImageProviderFromCard(actionCard);
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
  providerKeyCache.delete(id);
  window.secretBridge?.clearProviderApiKey?.(id)?.catch?.(err => console.warn('provider key cleanup failed', err));
  nodes.forEach(node => {
    if ((node.type === 'image' || node.type === 'video') && node.data?.providerId === id) node.data.providerId = '';
  });
  saveSettings();
  renderApiProviders();
  refreshNodeModelSelects();
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
  if (kind && host.globalModelProviders[kind] === provider.id && !FutureAIApiDefaults.get(modelFieldForKind(kind)).trim()) {
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
async function providerApiKey(provider) {
  if (!provider) return '';
  if (provider.useGlobalKey) return FutureAIApiDefaults.get('apiKey').trim() || '';
  if (providerKeyCache.has(provider.id)) return providerKeyCache.get(provider.id) || '';
  const value = await window.secretBridge?.getProviderApiKey?.(provider.id) || '';
  if (value) providerKeyCache.set(provider.id, value);
  return value;
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
  // One Key per provider: saving replaces the stored Key.
  if (provider.apiKeySaved && !provider.useGlobalKey && providerKeyCache.get(provider.id) === value) return true;
  try {
    const saved = await window.secretBridge.setProviderApiKey(provider.id, value);
    if (!saved) throw new Error('主进程没有确认写入');
    const readback = await window.secretBridge.getProviderApiKey?.(provider.id);
    if (readback !== value) throw new Error('写入后读取校验不一致');
  } catch (error) {
    provider.setupStatus = 'failed';
    provider.setupMessage = `Key 保存失败：${apiErrorMessage(error, '本机安全存储不可用')}`;
    saveSettings();
    if (!silent) toast(provider.setupMessage, 'error');
    return false;
  }
  providerKeyCache.set(provider.id, value);
  provider.apiKeySaved = true;
  provider.useGlobalKey = false;
  provider.setupStatus = 'key-saved';
  provider.setupMessage = 'Key 已安全保存，可以读取模型';
  provider.imageCapabilityStatus = 'unknown';
  provider.imageCapabilityMessage = '';
  if (input) input.value = value;
  saveSettings();
  renderApiProviders();
  if (!silent) toast(`已安全保存：${provider.name} 的 Key`, 'success');
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
    apiKey = await withTimeout(providerApiKey(provider), 12000, '读取 API Key 超时，请重启软件后重试');
    if (!apiKey && provider.type !== 'custom-sync') {
      resetButton();
      provider.setupStatus = 'needs-key';
      provider.setupMessage = '请粘贴 API Key';
      saveSettings();
      renderApiProviders();
      return toast(providerKeyUnavailableMessage(provider), 'warn');
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
    saveSettings();
    renderApiProviders();
    renderModels();
    refreshNodeModelSelects();
    const summary = provider.imageModel ? '图片模型 ' + provider.imageModel : '未确认图片模型';
    toast('自动配置完成：' + provider.name + ' · ' + summary, provider.imageModel ? 'success' : 'warn');
  } catch (err) {
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
function setProviderTestStatus(provider, status, message) {
  if (!provider) return;
  provider.lastTest = {status, message, checkedAt: Date.now()};
  saveSettings();
  renderApiProviders();
}
function imageCapabilityForKey(provider) {
  const status = provider?.imageCapabilityStatus;
  return status && status !== 'unknown' ? {status, message: provider.imageCapabilityMessage || ''} : null;
}
function imageCapabilityError(provider) {
  const name = provider?.name || '当前 API 配置';
  const error = new Error(`${name} 的当前 Key 所属账户组未开通图片生成。请在中转站为该账户组开通图片生成，或更换 Key。`);
  error.code = 'IMAGE_CAPABILITY_DISABLED';
  return error;
}
function isImageProviderCapabilityError(err) {
  return err?.code === 'IMAGE_CAPABILITY_DISABLED' || /image generation is not enabled for this group|图片生成未开通|未开通图片生成/i.test(String(err?.message || err || ''));
}
function markImageProviderCapability(provider, status, message = '') {
  if (!provider) return;
  provider.imageCapabilityStatus = status;
  provider.imageCapabilityMessage = String(message || '').trim();
  if (status === 'blocked') provider.lastTest = {status: 'warn', message: '图片能力未开通', checkedAt: Date.now()};
  if (status === 'available') provider.lastTest = {status: 'ok', message: '图片能力已验证', checkedAt: Date.now()};
  saveSettings();
  renderApiProviders();
}
function assertImageProviderCapability(provider) {
  if (imageCapabilityForKey(provider)?.status === 'blocked') throw imageCapabilityError(provider);
}
async function testImageProviderFromCard(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  await saveTypedProviderKeyIfNeeded(card);
  const apiUrl = provider.apiUrl || FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '');
  const model = String(provider.imageModel || '').trim();
  const apiKey = await providerApiKey(provider);
  if (!apiUrl) return toast('API 地址尚未填写，请先填写并保存。', 'warn');
  if (!model) return toast('图片模型尚未填写，请先选择或填写图片模型。', 'warn');
  if (!apiKey) return toast(providerKeyUnavailableMessage(provider), 'warn');
  markImageProviderCapability(provider, 'unknown', '');
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
    markImageProviderCapability(provider, 'available', '');
    toast(`图片能力已验证：${provider.name}`, 'success');
  } catch (err) {
    if (isImageProviderCapabilityError(err)) return toast(err.message, 'error');
    markImageProviderCapability(provider, 'unknown', '');
    setProviderTestStatus(provider, 'warn', '图片检测失败');
    toast(`图片检测失败：\n${err.message || String(err)}`, 'error');
  }
}
async function importModelsForProviderCard(card) {
  const provider = host.apiProviders.find(item => item.id === card?.dataset.providerId);
  if (!provider) return;
  const typedKey = card?.querySelector('[data-provider-key-input]')?.value?.trim() || '';
  if (typedKey && !await saveTypedProviderKeyIfNeeded(card)) return;
  const apiUrl = provider.apiUrl || FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '');
  let selectedCapability = 'chat';
  let apiKey = await providerApiKey(provider);
  if (!apiKey) {
    selectedCapability = 'image';
    apiKey = await providerApiKey(provider);
  }
  if (!apiKey) {
    selectedCapability = 'video';
    apiKey = await providerApiKey(provider);
  }
  if (!apiUrl) return toast('API 地址尚未填写，请先填写并保存。', 'warn');
  if (!apiKey) return toast(providerKeyUnavailableMessage(provider), 'warn');
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
    refreshNodeModelSelects();
    toast(`已为 ${provider.name} 导入模型：${models.length} 个（${modelImportSummary(counts)}）${detected?.message ? `\n${detected.message}` : ''}${usedV1Fallback ? '\n已自动使用 /v1 兼容接口。' : ''}`, 'success');
  } catch (err) {
    toast(`模型导入失败：\n${err.message || String(err)}`, 'error');
  }
}
    return {
      providerTypeLabel,
      providerTypeMeta,
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
      modelPickerGroups,
      currentProviderForNode,
      renderApiProviders,
      hydrateProviderKeyInputs,
      providerInitial,
      providerSetupResultHtml,
      providerModelDatalistHtml,
      providerModelSelectOptionsHtml,
      providerModelGroupHtml,
      providerModelLibraryHtml,
      apiProviderCardHtml,
      addApiProvider,
      syncApiProviderCardFields,
      handleApiProviderInput,
      handleApiProviderClick,
      refreshProviderBalance,
      refreshProviderBalances,
      providerBalanceQueryable,
      providerBalanceState,
      formatBalanceAmount,
      providerBalanceView,
      useProviderModelFromCard,
      addProviderModelFromCard,
      toggleApiProviderCollapsed,
      providerApiKey,
      saveProviderKeyFromCard,
      saveTypedProviderKeyIfNeeded,
      setProviderTestStatus,
      imageCapabilityError,
      isImageProviderCapabilityError,
      markImageProviderCapability,
      assertImageProviderCapability,
      testImageProviderFromCard,
      autoConfigureProviderFromCard,
      importModelsForProviderCard
    };
  }

  window.FutureAIProviderUI = { create };
})();
