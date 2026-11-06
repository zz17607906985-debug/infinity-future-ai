(() => {
  'use strict';

  /**
   * Provider protocol domain: OpenAI-compatible text / image / video request core.
   * Provider card UI remains in app.js; this module owns request adapters and size policy.
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const toast = deps.toast;
    const wait = deps.wait;
    const fetchJsonWithRetry = deps.fetchJsonWithRetry;
    const API_TIMEOUTS = deps.API_TIMEOUTS;
    const cleanAiText = deps.cleanAiText;
    const persistMediaUrl = deps.persistMediaUrl;
    const saveSettings = deps.saveSettings;
    const renderApiProviders = deps.renderApiProviders;
    const unique = deps.unique;
    const MediaUtils = deps.MediaUtils;
    const MediaDimensions = deps.MediaDimensions || window.FutureAIMediaDimensions;
    const ModelCapabilities = deps.ModelCapabilities || window.FutureAIModelCapabilities;
    const ReferenceRoles = deps.ReferenceRoles || window.FutureAIReferenceRoles;
    const VideoDirector = deps.VideoDirector || window.FutureAIVideoDirector;
    const authorizeGenerationBudget = deps.authorizeGenerationBudget;
    const completeGenerationBudget = deps.completeGenerationBudget;
    const VariantManager = deps.VariantManager || window.FutureAIVariantManager;
    const Provenance = deps.Provenance || window.FutureAIProvenance;
    // Canvas/node collaborators used by runVideo (orchestration stays thin in this domain)
    const getNode = deps.getNode || (id => null);
    const hydrateNode = deps.hydrateNode;
    const saveProject = deps.saveProject;
    const addHistory = deps.addHistory;
    const getInputPrompt = deps.getInputPrompt;
    const promptWithCanvasContext = deps.promptWithCanvasContext;
    const ensureInputImageRefs = deps.ensureInputImageRefs;
  const currentProviderForNode = deps.currentProviderForNode;
  const providerApiKey = deps.providerApiKey;
  const reportProviderKeyResult = deps.reportProviderKeyResult;
  const globalProviderForKind = deps.globalProviderForKind;
  const setGlobalModelValue = deps.setGlobalModelValue;
  const classifyModelKind = deps.classifyModelKind;
  const compactModelId = deps.compactModelId;
  const effectiveImageModel = deps.effectiveImageModel;
  const extractModelRecords = deps.extractModelRecords;
  const applyImportedModelRecordsToProvider = deps.applyImportedModelRecordsToProvider;
  const providerTypeLabel = deps.providerTypeLabel;
  const mediaUrlToBlob = deps.mediaUrlToBlob;
  const assertImageProviderCapability = deps.assertImageProviderCapability;
  const normalizeKnownImageModelAlias = deps.normalizeKnownImageModelAlias;
  const markImageProviderCapability = deps.markImageProviderCapability;
  const imageCapabilityError = deps.imageCapabilityError;
  const multimodalImageUnderstand = deps.multimodalImageUnderstand;
  const isImageProviderCapabilityError = deps.isImageProviderCapabilityError;
  const assertUsableApiBaseAddress = deps.assertUsableApiBaseAddress;
  const normalizeShortVideoTask = deps.normalizeShortVideoTask;
  const formatError = deps.formatError;
    const isSafetyError = deps.isSafetyError;
    const softenPrompt = deps.softenPrompt;
    const nodes = { get: id => getNode(id) };

function modelAgnosticGenerationPrefix(mode = 'image') {
  const target = mode === 'video' ? '视频生成模型' : mode === 'comfy' ? 'ComfyUI 图像工作流' : '图片生成或图像编辑模型';
  return [
    '模型无关规则：适用于任何支持图像生成、图像编辑或多模态理解的模型。',
    `模型无关规则：以下要求适用于任何${target}，不依赖某个模型厂商、模型名称或专属能力。`,
    '优先理解用户最后一句真实意图；不要机械套用默认模板、旧提示词或固定景别。',
    '如果提示词包含参考图、首帧、上一张或画布上下文，请按文字判断用途：局部修改只改指定内容，风格参考只继承风格，新主体生成必须重新设计主体，角色延续才保持身份一致。',
    mode === 'video'
      ? '视频任务重点保持主体、服装、场景、镜头方向、动作连续性和时间节奏一致；不要把首帧参考误解成需要复制静态拼贴。'
      : '图像任务重点服从主体、景别、构图、画幅比例、风格、光影、材质和细节要求；不要让参考图覆盖用户最后一句明确指令。'
  ].join('\n');
}
function applyModelAgnosticGenerationRules(prompt, mode = 'image') {
  const text = String(prompt || '').trim();
  if (!text) return text;
  return [modelAgnosticGenerationPrefix(mode), `用户原始指令\n${text}`].join('\n\n');
}
function modelAgnosticTextPrefix(mode = 'chat') {
  const task = mode === 'json' ? '结构化文本生成' : mode === 'prompt' ? '提示词优化' : '聊天与创作协助';
  return [
    `模型无关规则：以下要求适用于任何${task}模型，包括但不限于 GPT、Claude、Gemini、Qwen、DeepSeek、Kimi 或其他 OpenAI 兼容文本模型；不要依赖某个模型厂商的专属能力。`,
    '优先理解用户最后一句真实意图，结合上下文完成任务；不要机械套用旧模板、默认人设或固定输出习惯。',
    '如果用户要求 JSON、数组或固定字段，只输出可解析内容，不要添加解释、标题、Markdown 代码块或内部思考。',
    '如果任务是提示词、分镜、故事或资产规划，保留用户原意，并把主体、风格、构图、镜头、连续性和可执行细节表达清楚。',
    '面向普通创作者回答时，界面和建议尽量使用中文名称；不要直接抛英文库名、英文工具名或英文缩写，除非用户明确要求技术选型。'
  ].join('\n');
}
function applyModelAgnosticTextRules(system, mode = 'chat') {
  return [modelAgnosticTextPrefix(mode), String(system || '').trim()].filter(Boolean).join('\n\n');
}
function extractChatText(data) {
  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? data?.output_text ?? data?.content ?? data?.text ?? '';
  if (Array.isArray(content)) {
    return content.map(part => typeof part === 'string' ? part : (part.text || part.content || '')).join('\n').trim();
  }
  return String(content || '').trim();
}
function apiErrorMessage(err, context = '') {
  const msg = err?.message || String(err || '未知错误');
  if (/请求超时|timeout|aborted|AbortError/i.test(msg)) {
    return `${context ? context + '：\n' : ''}${msg}\n\n建议：确认聊天模型名是否真实可用；如果 /models 能通但生成超时，通常是该模型排队过久、服务商中转不稳定，或模型不支持 /chat/completions。`;
  }
  if (/model|not found|does not exist|unsupported|无效|不存在|不支持/i.test(msg)) {
    return `${context ? context + '：\n' : ''}${msg}\n\n建议：点击“导入模型”，从列表里选择真实存在的聊天模型。`;
  }
  if (/401|403|unauthorized|forbidden|invalid.*key|api.?key|认证|密钥|权限/i.test(msg)) {
    return `${context ? context + '：\n' : ''}${msg}\n\n建议：检查 API 密钥、额度和该模型权限。`;
  }
  return `${context ? context + '：\n' : ''}${msg}`;
}
async function chatCompletionTextRequest({apiUrl, apiKey, model, messages, temperature = .55, maxTokens = 1600, timeoutMs = API_TIMEOUTS.text, retries = 1, endpoint = '/chat/completions'}) {
  const {res} = await fetchApiWithBaseFallback(apiUrl, endpoint || '/chat/completions', {
    timeoutMs,
    retries,
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey},
    body: JSON.stringify({model, messages, temperature, max_tokens: maxTokens})
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
  const text = extractChatText(data);
  if (!text) throw new Error('聊天模型没有返回文本内容');
  return cleanAiText(text);
}

function isOpenAiImageGenerationModel(model = '') {
  return /^(?:gpt-image|dall-e)(?:[-_]|$)/i.test(String(model || '').trim());
}
function applyKnownImageProtocol(provider, model = '') {
  if (!provider || provider.type !== 'chat-image' || !isOpenAiImageGenerationModel(model)) return false;
  provider.type = 'openai-images';
  provider.imageEndpoint = '/images/generations';
  provider.editEndpoint = '/images/edits';
  provider.enabledText = true;
  provider.enabledImage = true;
  return true;
}
function saveKnownImageProtocolCorrection(provider, model = '') {
  if (!applyKnownImageProtocol(provider, model)) return false;
  saveSettings();
  renderApiProviders();
  return true;
}
function isUnsupportedImageModelError(err) {
  const message = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || '').toLowerCase();
  const type = String(err?.type || '').toLowerCase();
  const status = Number(err?.status || 0);
  if (/(?:model[_ -]?(?:not[_ -]?found|not[_ -]?available|unsupported|invalid)|invalid[_ -]?model|unsupported[_ -]?model)/i.test(`${code} ${type}`)) return true;
  if (status === 404 && !/(?:size|dimension|resolution)/i.test(message)) return true;
  return /not supported by any configured account|no available (?:model )?channels?|no available distributor|unsupported\s+(?:image\s+)?model|model.+(?:not\s+supported|not\s+found|does\s+not\s+exist)|invalid\s+model|model.+(?:no\s+access|not\s+available)|模型.*(?:不支持|不存在|无权限|不可用|无可用渠道)/i.test(message);
}
function isImageGenerationDisabledError(err) {
  return /image generation is not enabled for this group|image generation.+(?:disabled|not enabled)|图片生成.+(?:未开通|未启用|不可用)/i.test(String(err?.message || err || ''));
}
function providerImageModelIds(provider = {}) {
  const catalog = Array.isArray(provider?.modelCatalog) ? provider.modelCatalog : [];
  const labeled = catalog
    .filter(record => (record?.kind || classifyModelKind(`${record?.id || ''} ${record?.label || ''}`)) === 'image')
    .map(record => String(record.id || '').trim());
  return unique([...labeled, ...(provider?.models || []).filter(model => classifyModelKind(model) === 'image')]);
}
function equivalentProviderModelId(model, available = []) {
  const value = String(model || '').trim();
  if (!value) return '';
  const exact = available.find(candidate => String(candidate || '').trim().toLowerCase() === value.toLowerCase());
  if (exact) return String(exact).trim();
  const compact = compactModelId(value);
  const equivalent = available.find(candidate => compactModelId(candidate) === compact);
  return equivalent ? String(equivalent).trim() : '';
}
function imageModelResolutionTier(model = '') {
  const value = String(model || '').trim().toLowerCase();
  if (/(?:^|[-_])4k(?:$|[-_])/i.test(value)) return 4;
  if (/(?:^|[-_])2k(?:$|[-_])/i.test(value)) return 2;
  if (/(?:^|[-_])1k(?:$|[-_])/i.test(value)) return 1;
  if (/^image2(?:$|[-_])/i.test(value) || /^gpt[-_]?image[-_]?2$/i.test(value)) return 1;
  return 0;
}
function sortImageModelCandidates(candidates = [], resolution = '1K', explicit = '') {
  const targetTier = Math.max(1, Math.min(4, Number(String(resolution || '1K').replace(/[^124]/g, '').slice(0, 1)) || 1));
  const selected = String(explicit || '').trim();
  const available = unique(candidates);
  // An explicit alias is only pinned when it resolves to a candidate supplied
  // by the provider. Never reinsert a raw/unlisted ID during a refresh pass.
  const selectedCandidate = available.find(model => String(model).toLowerCase() === selected.toLowerCase())
    || (selected ? available.find(model => compactModelId(model) === compactModelId(selected)) : '');
  const rest = available.filter(model => model !== selectedCandidate);
  const score = model => {
    const tier = imageModelResolutionTier(model);
    if (!tier) return 50;
    if (tier === targetTier) return /^image2$/i.test(String(model || '')) && targetTier === 1 ? 0 : 1;
    return Math.abs(tier - targetTier) * 10 + (tier > targetTier ? 2 : 0);
  };
  return unique([selectedCandidate, ...rest.sort((a, b) => score(a) - score(b))]);
}
function imageModelCandidates(provider, selected = '', includeStandardFallbacks = false, resolution = '1K') {
  const configured = [
    selected,
    provider?.imageModel,
    $('imageModel')?.value?.trim()
  ].map(model => effectiveImageModel(provider, model, resolution)).filter(Boolean);
  const available = providerImageModelIds(provider);
  if (available.length) {
    const matched = configured.map(model => equivalentProviderModelId(model, available)).filter(Boolean);
    // Once /models is known, never send a display name or invented fallback ID.
    return sortImageModelCandidates(unique([...matched, ...available]), resolution, matched[0] || '');
  }
  const standardFallbacks = includeStandardFallbacks && !provider?.modelCatalog?.length
    ? ['gpt-image2', 'gpt-image-2', 'gpt-image-1', 'dall-e-3'] : [];
  return sortImageModelCandidates(unique([...configured, ...standardFallbacks]), resolution, configured[0] || '');
}
async function refreshProviderImageModels(provider, apiUrl, apiKey) {
  if (!provider || !apiUrl || !apiKey) return [];
  const fetchedAt = Number(provider.imageModelsFetchedAt || 0);
  if (fetchedAt > 0 && Date.now() - fetchedAt < 5 * 60 * 1000) return providerImageModelIds(provider);
  try {
    const {res} = await fetchApiWithBaseFallback(apiUrl, '/models', {
      timeoutMs: API_TIMEOUTS.text,
      headers: {Authorization: 'Bearer ' + apiKey}
    });
    const data = await safeJson(res);
    if (!res.ok) return [];
    const records = extractModelRecords(data);
    if (!records.length) return [];
    applyImportedModelRecordsToProvider(provider, records);
    provider.imageModelsFetchedAt = Date.now();
    saveSettings();
    return providerImageModelIds(provider);
  } catch {
    return [];
  }
}
function rememberWorkingImageModel(provider, model = '') {
  const workingModel = String(model || '').trim();
  if (!provider || !workingModel) return;
  provider.imageModel = workingModel;
  provider.models = unique([workingModel, ...(provider.models || [])]);
  if (provider.id === globalProviderForKind('image')?.id) {
    setGlobalModelValue('image', workingModel, {save: false, rerender: false});
  }
  saveSettings();
}
function classifyImageProviderError(err) {
  const message = String(err?.message || err || '');
  if (/<(?:!doctype|html)\b/i.test(message) || /接口返回网页/i.test(message)) return {kind: 'upstream-html', retryable: false};
  const code = String(err?.code || '').toLowerCase();
  const param = String(err?.param || '').toLowerCase();
  const status = Number(err?.status || 0);
  const sizeCodes = new Set(['invalid_size', 'unsupported_size', 'invalid_image_size', 'unsupported_image_size', 'invalid_dimensions', 'unsupported_dimensions']);
  if (sizeCodes.has(code) || ((status === 400 || status === 422) && /^(?:size|width|height|dimensions|resolution)$/.test(param))) {
    return {kind: 'size-unsupported', retryable: true};
  }
  if ((status === 400 || status === 422 || !status) && /(?:unsupported|not supported|invalid|must be|only supports?|allowed values?).{0,48}(?:image )?(?:size|resolution|dimensions)|(?:image )?(?:size|resolution|dimensions).{0,48}(?:unsupported|not supported|invalid|must be|only supports?|allowed values?)/i.test(message)) {
    return {kind: 'size-unsupported', retryable: true};
  }
  return {kind: status >= 500 ? 'upstream-failure' : 'other', retryable: status >= 500};
}
function createProviderApiError(data, response) {
  const detail = data?.error && typeof data.error === 'object' ? data.error : data || {};
  const message = detail.message || data?.message || response?.statusText || JSON.stringify(data);
  const error = new Error(String(message || '图片供应商请求失败'));
  error.code = String(detail.code || data?.code || '');
  error.param = String(detail.param || data?.param || '');
  error.type = String(detail.type || data?.type || '');
  error.status = Number(response?.status || data?.status || 0);
  return error;
}
function imageTaskAdapterConfig(provider = {}) {
  return {
    queryEndpoint: String(provider.imageQueryEndpoint || '/image/query').trim(),
    taskIdPath: String(provider.imageTaskIdPath || 'task_id').trim(),
    statusPath: String(provider.imageTaskStatusPath || 'status').trim(),
    resultPath: String(provider.imageTaskResultPath || provider.responsePath || 'data.0.url').trim(),
    pollIntervalMs: Math.max(1000, Math.min(30000, Number(provider.imagePollIntervalMs || 3000))),
    maxPollAttempts: Math.max(1, Math.min(300, Number(provider.imageMaxPollAttempts || 120)))
  };
}
function usableGeneratedImageUrl(value) {
  return /^(?:https?:|data:image\/|blob:|file:)/i.test(String(value || ''));
}
function asyncImageUrlFromResponse(data, path = '') {
  const mapped = imageUrlFromUnknown(valueAtPath(data, path));
  if (usableGeneratedImageUrl(mapped)) return mapped;
  try {
    const detected = extractImageUrl(data);
    return usableGeneratedImageUrl(detected) ? detected : '';
  } catch {
    return '';
  }
}
  async function requestAsyncImageTask(o) {
  const config = imageTaskAdapterConfig(o.provider);
  const headers = {'Content-Type': 'application/json'};
  if (o.apiKey) headers.Authorization = 'Bearer ' + o.apiKey;
  const body = {model: o.model, prompt: o.prompt, n: 1, ...imageRequestDimensionFields(o.provider, o.size || '1024x1024'), ...imageRequestSeedFields(o), quality: o.quality || 'auto'};
  const {res} = await fetchApiWithBaseFallback(o.apiUrl, o.provider?.imageEndpoint || '/images/generations', {
    timeoutMs: API_TIMEOUTS.image,
    signal: o.signal,
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const created = await safeJson(res);
  if (!res.ok) throw createProviderApiError(created, res);
  const immediate = asyncImageUrlFromResponse(created, config.resultPath);
  if (immediate) return immediate;
  const taskId = valueAtPath(created, config.taskIdPath) || created.task_id || created.id || created.data?.task_id || created.data?.id;
  if (!taskId) {
    const error = new Error('异步图片接口未返回可识别的任务 ID');
    error.code = 'IMAGE_ASYNC_TASK_ID_MISSING';
    throw error;
  }
  o.onTask?.({id: String(taskId), protocol: 'generic-image', queryEndpoint: config.queryEndpoint});
  for (let attempt = 0; attempt < config.maxPollAttempts; attempt += 1) {
    await sleep(config.pollIntervalMs, o.signal);
    const queryPath = config.queryEndpoint.includes('{id}')
      ? config.queryEndpoint.replace('{id}', encodeURIComponent(taskId))
      : `${config.queryEndpoint}${config.queryEndpoint.includes('?') ? '&' : '?'}id=${encodeURIComponent(taskId)}`;
    const query = await fetchApiWithBaseFallback(o.apiUrl, queryPath, {timeoutMs: API_TIMEOUTS.poll, signal: o.signal, headers: {Accept: 'application/json', ...(o.apiKey ? {Authorization: 'Bearer ' + o.apiKey} : {})}});
    const data = await safeJson(query.res);
    if (!query.res.ok) throw createProviderApiError(data, query.res);
    const imageUrl = asyncImageUrlFromResponse(data, config.resultPath);
    if (imageUrl) return imageUrl;
    const status = String(valueAtPath(data, config.statusPath) || data.status || data.state || '').toLowerCase();
    o.onStatus?.(`图片任务 ${taskId}：${status || `轮询 ${attempt + 1}/${config.maxPollAttempts}`}`);
    if (/(?:fail|error|cancel|reject)/.test(status)) {
      const error = new Error(data.message || data.error?.message || `异步图片任务失败：${status}`);
      error.code = 'IMAGE_ASYNC_TASK_FAILED';
      throw error;
    }
  }
  const error = new Error(`异步图片任务仍未完成：${taskId}`);
  error.code = 'IMAGE_ASYNC_TASK_TIMEOUT';
  throw error;
}
async function rawImageGenerationWithModel(o, model, requestSize) {
  const type = o.provider?.type || 'openai-images';
  const request = {...o, model, size: requestSize};
  if (o.provider?.imageTaskMode === 'async' || type === 'dashscope-wanx' || type === 'volcengine-ark') {
    return await requestAsyncImageTask(request);
  }
  if (type === 'chat-image') return await chatImageGenerateRequest(request);
  if (type === 'custom-sync') return await customSyncImageRequest(request);
   const body = {model, prompt: o.prompt, n: 1, ...imageRequestDimensionFields(o.provider, requestSize), ...imageRequestSeedFields({...o, model}), ...imageBackgroundFields(o, model)};
  if (o.quality && o.quality !== 'auto') body.quality = o.quality;
  const endpoint = o.provider?.imageEndpoint || o.provider?.endpoint || '/images/generations';
  const {res} = await fetchApiWithBaseFallback(o.apiUrl, endpoint, {timeoutMs: API_TIMEOUTS.image, signal: o.signal, method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + o.apiKey}, body: JSON.stringify(body)});
  const data = await safeJson(res);
  if (!res.ok) throw createProviderApiError(data, res);
  return extractImageUrl(data, o.provider?.responsePath);
}
async function rawImageEditRequest(o) {
  const type = o.provider?.type || 'openai-images';
  if (type === 'custom-sync') return await customSyncImageRequest(o);
  if (type !== 'openai-images') {
    throw new Error(`${providerTypeLabel(type)} 当前配置不支持直接图生图。可改用 OpenAI Images、ComfyUI，或配置一个支持 refs 的自定义同步接口。`);
  }
  const fieldName = o.imageFieldName || 'image';
  const dimensions = imageRequestDimensionFields(o.provider, o.size || '1024x1024');
  const fd = new FormData();
  fd.append('model', o.model);
  fd.append('prompt', o.prompt);
  fd.append('n', '1');
  Object.entries(dimensions).forEach(([key, value]) => fd.append(key, String(value)));
  Object.entries(imageRequestSeedFields(o)).forEach(([key, value]) => fd.append(key, String(value)));
  if (o.quality && o.quality !== 'auto') fd.append('quality', o.quality);
   Object.entries(imageBackgroundFields(o, o.model)).forEach(([key, value]) => fd.append(key, value));
  for (let i = 0; i < o.refUrls.length; i++) {
    fd.append(fieldName, await mediaUrlToBlob(o.refUrls[i]), `reference_${i + 1}.png`);
  }
  const endpoint = o.provider?.editEndpoint || '/images/edits';
  const {res} = await fetchApiWithBaseFallback(o.apiUrl, endpoint, {timeoutMs: API_TIMEOUTS.image, signal: o.signal, method: 'POST', headers: {Authorization: 'Bearer ' + o.apiKey}, body: fd});
  const data = await safeJson(res);
  if (!res.ok) throw createProviderApiError(data, res);
  return extractImageUrl(data, o.provider?.responsePath);
}
function imageBackgroundFields(o, model) {
  const transparent = o.backgroundMode === 'transparent';
  const supportsBackground = (o.provider?.type || 'openai-images') === 'openai-images'
    && /^gpt-image-(?:1(?:\.5|-mini)?|2(?:-2026-04-21)?|2\.5(?:-(?:sunburst|flare)(?:-2026-09-08)?)?)$/i.test(String(model || ''));
  if (transparent && !supportsBackground) {
    throw new Error('当前图片模型或供应商未确认支持透明背景，请选择 GPT Image 的 OpenAI Images 兼容接口');
  }
  if (!supportsBackground) return {};
  return {background: transparent ? 'transparent' : 'opaque', output_format: 'png'};
}
async function imageGenerateBatchRequest(o) {
  if ((o.provider?.type || 'openai-images') !== 'openai-images' || !Number.isInteger(o.count) || o.count < 2 || o.count > 4) {
    throw new Error('当前接口不支持单次多图请求');
  }
  const model = normalizeKnownImageModelAlias(o.model, o.provider);
  const body = {
    model, prompt: o.prompt, n: o.count,
    ...imageRequestDimensionFields(o.provider, o.size),
    ...imageBackgroundFields(o, model)
  };
  if (o.quality && o.quality !== 'auto') body.quality = o.quality;
  const endpoint = o.provider?.imageEndpoint || o.provider?.endpoint || '/images/generations';
  const {res} = await fetchApiWithBaseFallback(o.apiUrl, endpoint, {
    timeoutMs: API_TIMEOUTS.image, method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + o.apiKey},
    body: JSON.stringify(body)
  });
  const data = await safeJson(res);
  if (!res.ok) throw createProviderApiError(data, res);
  const images = Array.isArray(data.data) ? data.data : Array.isArray(data.images) ? data.images : [];
  if (images.length !== o.count) throw new Error(`接口返回 ${images.length} 张图片，预期 ${o.count} 张；不会重复提交以避免重复扣费`);
  return images.map(item => ({url: extractImageUrl(item), model}));
}
async function requestImageGenerationWithModel(o, model) {
  assertImageProviderCapability(o.provider, o.apiKey);
  const requestModel = normalizeKnownImageModelAlias(model, o.provider);
  if (o.backgroundMode === 'transparent') imageBackgroundFields(o, requestModel);
  saveKnownImageProtocolCorrection(o.provider, requestModel);
  const requestSizes = providerImageRequestSizes(o.size || '1024x1024', o.provider, requestModel);
  let lastError = null;
  try {
    for (let index = 0; index < requestSizes.length; index += 1) {
      try {
        const rawUrl = await rawImageGenerationWithModel(o, requestModel, requestSizes[index]);
        recordImageSizeCapability(o.provider, requestModel, requestSizes[index], true);
        return {url: rawUrl, model: requestModel};
      } catch (err) {
        lastError = err;
        if (isUnsupportedImageSizeError(err)) recordImageSizeCapability(o.provider, requestModel, requestSizes[index], false);
        if (!isUnsupportedImageSizeError(err) || index === requestSizes.length - 1) throw err;
      }
    }
    throw lastError || new Error('供应商未返回可用图片');
  } catch (err) {
    if (isImageGenerationDisabledError(err)) {
      markImageProviderCapability(o.provider, 'blocked', '当前密钥所属账户组未启用图片生成。', o.apiKey);
      throw imageCapabilityError(o.provider, o.apiKey);
    }
    throw err;
  }
}
async function imageGenerateRequest(o) {
  if (o.allowModelFallback !== true && String(o.model || '').trim()) {
    return await requestImageGenerationWithModel(o, o.model);
  }
  saveKnownImageProtocolCorrection(o.provider, o.model);
  const tried = new Set();
  let lastError = null;
  let catalog = await refreshProviderImageModels(o.provider, o.apiUrl, o.apiKey);
  let models = imageModelCandidates(o.provider, o.model, false, o.resolution || '1K');
  if (!models.length && !catalog.length) models = imageModelCandidates(o.provider, o.model, true, o.resolution || '1K');
  for (let pass = 0; pass < 2; pass += 1) {
    if (pass === 1 && !catalog.length) {
      catalog = await refreshProviderImageModels(o.provider, o.apiUrl, o.apiKey);
      models = sortImageModelCandidates(unique([...models, ...catalog, ...imageModelCandidates(o.provider, o.model, true, o.resolution || '1K')]), o.resolution || '1K');
    }
    for (const model of models) {
      if (tried.has(model)) continue;
      tried.add(model);
      try {
        const result = await requestImageGenerationWithModel(o, model);
        rememberWorkingImageModel(o.provider, model);
        return result;
      } catch (err) {
        lastError = err;
        if (!isUnsupportedImageModelError(err)) throw err;
      }
    }
    if (!lastError || !isUnsupportedImageModelError(lastError)) break;
  }
  const attempted = [...tried].join('、');
  const detail = lastError?.message || String(lastError || '未返回可用模型');
  throw new Error(`当前图片供应商未提供可用的图像模型。\n已自动尝试：${attempted}\n${detail}`);
}
async function requestImageEditWithModel(o, model) {
  const requestModel = normalizeKnownImageModelAlias(model, o.provider);
  if (o.backgroundMode === 'transparent') imageBackgroundFields(o, requestModel);
  saveKnownImageProtocolCorrection(o.provider, requestModel);
  const requestSizes = providerImageRequestSizes(o.size || '1024x1024', o.provider, requestModel);
  let lastError = null;
  for (let index = 0; index < requestSizes.length; index += 1) {
    try {
      const rawUrl = await rawImageEditRequest({...o, model: requestModel, size: requestSizes[index]});
      recordImageSizeCapability(o.provider, requestModel, requestSizes[index], true);
      return {url: rawUrl, model: requestModel};
    } catch (err) {
      lastError = err;
      if (isUnsupportedImageSizeError(err)) recordImageSizeCapability(o.provider, requestModel, requestSizes[index], false);
      if (!isUnsupportedImageSizeError(err) || index === requestSizes.length - 1) throw err;
    }
  }
  throw lastError || new Error('供应商未返回可用图片');
}
async function imageEditRequest(o) {
  assertImageProviderCapability(o.provider, o.apiKey);
  if (o.allowModelFallback !== true && String(o.model || '').trim()) {
    return await requestImageEditWithModel(o, o.model);
  }
  const tried = new Set();
  let lastError = null;
  let catalog = await refreshProviderImageModels(o.provider, o.apiUrl, o.apiKey);
  let models = imageModelCandidates(o.provider, o.model, false, o.resolution || '1K');
  if (!models.length && !catalog.length) models = imageModelCandidates(o.provider, o.model, true, o.resolution || '1K');
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      if (pass === 1 && !catalog.length) {
        catalog = await refreshProviderImageModels(o.provider, o.apiUrl, o.apiKey);
        models = sortImageModelCandidates(unique([...models, ...catalog, ...imageModelCandidates(o.provider, o.model, true, o.resolution || '1K')]), o.resolution || '1K');
      }
      for (const model of models) {
        if (tried.has(model)) continue;
        tried.add(model);
        try {
          const result = await requestImageEditWithModel(o, model);
          rememberWorkingImageModel(o.provider, model);
          return result;
        } catch (err) {
          lastError = err;
          if (!isUnsupportedImageModelError(err)) throw err;
        }
      }
      if (!lastError || !isUnsupportedImageModelError(lastError)) break;
    }
    const attempted = [...tried].join('、');
    const detail = lastError?.message || String(lastError || '未返回可用模型');
    throw new Error(`当前图片供应商没有可用于图生图的模型。\n已自动尝试：${attempted}\n${detail}`);
  } catch (err) {
    if (isImageGenerationDisabledError(err)) {
      markImageProviderCapability(o.provider, 'blocked', '当前密钥所属账户组未启用图片生成。', o.apiKey);
      throw imageCapabilityError(o.provider, o.apiKey);
    }
    throw err;
  }
}
async function referenceGuidedImageFallback(o) {
  const chatProvider = globalProviderForKind('chat');
  const chatApiUrl = chatProvider?.apiUrl || $('apiUrl')?.value.trim().replace(/\/$/, '') || '';
  const chatApiKey = await providerApiKey(chatProvider, 'chat');
  const chatModel = String(chatProvider?.chatModel || $('chatModel')?.value || '').trim();
  if (!chatApiUrl || !chatApiKey || !chatModel) {
    if (chatApiKey) reportProviderKeyResult?.(chatProvider, 'chat', {releaseOnly: true}, chatApiKey);
    throw new Error('图生图接口超时，且未配置可用的视觉聊天模型用于参考图兼容生成。');
  }
  let referenceProfile = String(o.referenceProfile || '').trim();
  if (!referenceProfile) {
    o.onStatus?.('图生图接口超时，正在读取参考图的角色和画面特征...');
    referenceProfile = await multimodalImageUnderstand({
      apiUrl: chatApiUrl,
      apiKey: chatApiKey,
      model: chatModel,
      endpoint: chatProvider.chatEndpoint,
      images: o.refUrls || [],
      prompt: '请提取图中主体的脸部特征、发型、年龄感、服装、身材比例、姿态、场景、光线、构图和要保持的细节。只输出可供生图使用的中文视觉约束，不要解释。'
    });
  }
  o.onStatus?.('参考特征兼容生成中，将保留角色外观、服装、构图和风格约束...');
  const prompt = `${o.prompt}\n\n参考图特征约束（自动提取，必须遵守）：\n${referenceProfile}`;
  const result = await imageGenerateRequest({...o, prompt, refUrls: []});
  return {...result, referenceProfile};
}
async function imageEditWithFallback(o) {
  if (o.allowReferenceFallback === false || o.refUrls.length <= 1) return await imageEditRequest(o);
  const attempts = [];
  try {
    o.onFallback?.('正在尝试原始多文件 image 字段');
    return await imageEditRequest(o);
  } catch (multiErr) {
    if (isImageProviderCapabilityError(multiErr)) throw multiErr;
    if (isApiGatewayTimeoutError(multiErr)) throw multiErr;
    attempts.push('多文件 image 提交失败：' + shortError(multiErr));
  }
  try {
    o.onFallback?.('正在尝试 image[] 多文件字段');
    return await imageEditRequest({...o, imageFieldName: 'image[]'});
  } catch (arrayErr) {
    if (isImageProviderCapabilityError(arrayErr)) throw arrayErr;
    attempts.push('多文件 image[] 提交失败：' + shortError(arrayErr));
  }
  o.onFallback?.('正在将多张参考图合成为单张参考板，避免多文件接口不兼容');
  try {
    const mergedRef = await composeReferenceBoard(o.refUrls);
    return await imageEditRequest({
      ...o,
      prompt: referenceBoardPrompt(o.prompt, o.refUrls.length),
      refUrls: [mergedRef],
      imageFieldName: 'image'
    });
  } catch (boardErr) {
    attempts.push('参考板单图提交失败：' + shortError(boardErr));
    throw new Error('多参考图全部兼容路径失败。\n' + attempts.join('\n'));
  }
}
function referenceBoardPrompt(prompt, count) {
  return `请把随附的参考板作为${count}张参考图理解：左上角/第一格是主体图，后续格子是参考图。保持主体图的人物身份、服装、脸部特征和核心构图，融合其他参考格的场景、光线、氛围或细节。不要把参考板边框、格子、标签文字画进最终图。\n\n${prompt}`;
}
function shortError(err) {
  return (err?.message || String(err || '')).replace(/\s+/g, ' ').slice(0, 220);
}
async function composeReferenceBoard(urls) {
  const images = [];
  for (const url of urls.slice(0, 6)) images.push(await loadImageForCanvas(url));
  const cols = images.length <= 2 ? images.length : 2;
  const rows = Math.ceil(images.length / cols);
  const cell = Math.floor(Math.min(512, 1024 / Math.max(cols, rows)));
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((img, i) => {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * cell;
    drawImageContain(ctx, img, x + 18, y + 44, cell - 36, cell - 62);
    ctx.fillStyle = 'rgba(0,0,0,.68)';
    ctx.fillRect(x + 18, y + 12, 48, 28);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(String(i + 1), x + 34, y + 32);
  });
  return canvas.toDataURL('image/png', .92);
}
async function loadImageForCanvas(url) {
  const blob = await mediaUrlToBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('无法读取参考图用于合成参考板'));
      img.src = objectUrl;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
function drawImageContain(ctx, img, x, y, w, h) {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function imageSizeForResolution(size, resolution = '1K') {
  return MediaDimensions?.imageSizeForResolution(size, resolution) || '1024x1024';
}
function customImageTargetSize(data = {}) {
  return MediaDimensions?.customImageTargetSize(data) || '';
}
function imageTargetSize(data = {}) {
  return MediaDimensions?.imageTargetSize(data) || '';
}
function imageSizeFromDialogPrompt(text, fallbackSize = '') {
  const normalized = String(text || '').replace(/[：]/g, ':');
  const requested = normalized.match(/(?:^|[^\d])((?:1:1)|(?:3:4)|(?:4:3)|(?:6:19)|(?:19:6)|(?:21:9)|(?:9:21)|(?:9:16)|(?:16:9))(?:[^\d]|$)/);
  const aspect = requested?.[1] || sizeToAspect(fallbackSize || '1024x1024');
  const canonical = MediaDimensions?.imageSizeForResolution?.(aspect, '1K');
  if (canonical) return canonical;
  const sizes = {
    '1:1': '1024x1024',
    '3:4': '768x1024',
    '4:3': '1024x768',
    '6:19': '600x1900',
    '19:6': '1900x600',
    '21:9': '1344x576',
    '9:21': '576x1344',
    '9:16': '720x1280',
    '16:9': '1280x720'
  };
  return sizes[aspect] || '1024x1024';
}
function apiCompatibleImageSize(size) {
  try {
    return validateGeneratedImageTargetSize(size).size;
  } catch {
    return '';
  }
}
function imageSizeCapabilityProfile(provider = {}, model = '') {
  const type = String(provider?.type || 'openai-images');
  const modelProfile = provider?.imageModelSizeProfiles && typeof provider.imageModelSizeProfiles === 'object'
    ? provider.imageModelSizeProfiles[String(model || '')]
    : null;
  const configured = Array.isArray(modelProfile?.acceptedSizes)
    ? modelProfile.acceptedSizes
    : Array.isArray(provider?.imageAcceptedSizes) ? provider.imageAcceptedSizes : [];
  const defaults = type === 'openai-images' ? ['1024x1024', '1536x1024', '1024x1536'] : [];
  const acceptedSizes = [];
  for (const value of [...configured, ...defaults]) {
    try {
      const size = validateGeneratedImageTargetSize(value).size;
      if (!acceptedSizes.includes(size)) acceptedSizes.push(size);
    } catch {}
  }
  const rejectedSizes = [];
  for (const value of Array.isArray(modelProfile?.rejectedSizes) ? modelProfile.rejectedSizes : []) {
    try {
      const size = validateGeneratedImageTargetSize(value).size;
      if (!rejectedSizes.includes(size)) rejectedSizes.push(size);
    } catch {}
  }
  return {
    supportsArbitrarySize: Boolean(modelProfile?.supportsArbitrarySize ?? provider?.imageSupportsArbitrarySize ?? (type !== 'openai-images')),
    acceptedSizes,
    rejectedSizes,
    source: modelProfile ? 'model-profile' : configured.length ? 'provider-profile' : 'protocol-default'
  };
}
function recordImageSizeCapability(provider, model, size, supported) {
  if (!provider) return;
  let normalizedSize;
  try {
    normalizedSize = validateGeneratedImageTargetSize(size).size;
  } catch {
    return;
  }
  const modelId = String(model || provider.imageModel || '').trim();
  provider.imageModelSizeProfiles = provider.imageModelSizeProfiles && typeof provider.imageModelSizeProfiles === 'object' ? provider.imageModelSizeProfiles : {};
  const previous = provider.imageModelSizeProfiles[modelId] || {};
  const acceptedSizes = Array.isArray(previous.acceptedSizes) ? [...previous.acceptedSizes] : [];
  const rejectedSizes = Array.isArray(previous.rejectedSizes) ? [...previous.rejectedSizes] : [];
  const addTo = supported ? acceptedSizes : rejectedSizes;
  const removeFrom = supported ? rejectedSizes : acceptedSizes;
  if (!addTo.includes(normalizedSize)) addTo.push(normalizedSize);
  const staleIndex = removeFrom.indexOf(normalizedSize);
  if (staleIndex >= 0) removeFrom.splice(staleIndex, 1);
  provider.imageModelSizeProfiles[modelId] = {acceptedSizes, rejectedSizes, checkedAt: Date.now()};
  if (supported) provider.imageAcceptedSizes = unique([...(provider.imageAcceptedSizes || []), normalizedSize]);
  saveSettings();
}
function providerImageRequestSizes(targetSize) {
  return [validateGeneratedImageTargetSize(targetSize).size];
}
function parseSize(size) {
  const match = String(size || '').match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return null;
  return {width: Number(match[1]), height: Number(match[2])};
}
function validateGeneratedImageTargetSize(size) {
  const target = parseSize(size);
  if (!target || !Number.isSafeInteger(target.width) || !Number.isSafeInteger(target.height) || target.width <= 0 || target.height <= 0) {
    const error = new Error(`图片目标尺寸无效：${String(size || '')}`);
    error.code = 'INVALID_IMAGE_TARGET_SIZE';
    throw error;
  }
  const pixels = target.width * target.height;
  const maxPixels = 16777216;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
    const error = new Error(`目标尺寸 ${target.width}x${target.height} 共 ${pixels.toLocaleString()} 像素，超过安全上限 ${maxPixels.toLocaleString()} 像素。`);
    error.code = 'IMAGE_PIXEL_BUDGET_EXCEEDED';
    error.width = target.width;
    error.height = target.height;
    error.pixels = pixels;
    error.maxPixels = maxPixels;
    throw error;
  }
  return {width: target.width, height: target.height, pixels, size: `${target.width}x${target.height}`};
}
function isUnsupportedImageSizeError(err) {
  return classifyImageProviderError(err).kind === 'size-unsupported';
}
function isApiGatewayTimeoutError(err) {
  return /\b52[0-4]\b|a timeout occurred|gateway timeout|upstream.*timeout|timeout|timed out|超时|网关/i.test(err?.message || String(err || ''));
}
function joinApiPath(apiUrl, endpoint) {
  const base = String(apiUrl || '').replace(/\/$/, '');
  const path = String(endpoint || '').trim();
  if (/^https?:\/\//i.test(path)) return path;
  assertUsableApiBaseAddress(base);
  return base + '/' + path.replace(/^\//, '');
}
function apiRequestCandidates(apiUrl, endpoint = '') {
  const path = String(endpoint || '').trim();
  if (/^https?:\/\//i.test(path)) return [path];
  const base = String(apiUrl || '').trim().replace(/\/$/, '');
  const primary = joinApiPath(base, path);
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    return [primary];
  }
  if (parsed.pathname.split('/').some(segment => /^v1$/i.test(segment))) return [primary];
  const fallbackBase = `${base}/v1`;
  const fallback = joinApiPath(fallbackBase, path);
  return fallback === primary ? [primary] : [primary, fallback];
}
function imageRequestDimensionFields(provider = {}, size = '1024x1024') {
  const target = validateGeneratedImageTargetSize(size);
  const format = ['auto', 'size', 'width-height', 'aspect-ratio', 'size-and-aspect'].includes(String(provider?.imageRequestFormat || 'auto'))
    ? String(provider?.imageRequestFormat || 'auto')
    : 'auto';
  if (format === 'width-height') return {width: target.width, height: target.height};
  if (format === 'aspect-ratio') return {aspect_ratio: sizeToAspect(target.size)};
  if (format === 'size-and-aspect') return {size: target.size, aspect_ratio: sizeToAspect(target.size)};
  return {size: target.size};
}
function imageRequestSeedFields(o = {}) {
  if (o.seed == null || o.seed === '') return {};
  if (isOpenAiImageGenerationModel(o.model)) return {};
  const seed = Number(o.seed);
  if (!Number.isFinite(seed)) return {};
  return {seed: Math.max(0, Math.floor(seed))};
}
async function fetchApiWithBaseFallback(apiUrl, endpoint, options = {}) {
  const urls = apiRequestCandidates(apiUrl, endpoint);
  let response = null;
  for (let index = 0; index < urls.length; index += 1) {
    response = await fetchJsonWithRetry(urls[index], options);
    if (response.status === 404 && typeof response.clone === 'function') {
      const payload = await response.clone().json().catch(() => null);
      const detail = [payload?.error?.code, payload?.error?.param, payload?.error?.message, payload?.message].filter(Boolean).join(' ');
      if (/model|account|group|permission|quota|billing|模型|账户|分组|权限|余额/i.test(detail)) {
        return {res: response, requestUrl: urls[index], usedV1Fallback: index > 0};
      }
    }
    if (response.status !== 404 || index === urls.length - 1) {
      return {res: response, requestUrl: urls[index], usedV1Fallback: index > 0};
    }
  }
  return {res: response, requestUrl: urls[0], usedV1Fallback: false};
}
async function chatImageGenerateRequest(o) {
  const dimensions = imageRequestDimensionFields(o.provider, o.size || '1024x1024');
  const {res} = await fetchApiWithBaseFallback(o.apiUrl, o.provider?.imageEndpoint || o.provider?.chatEndpoint || o.provider?.endpoint || '/chat/completions', {
    timeoutMs: API_TIMEOUTS.image,
    signal: o.signal,
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + o.apiKey},
    body: JSON.stringify({
      model: o.model,
      messages: [
        {role: 'system', content: 'Generate one image for the user prompt and return an image URL or base64 image in the response.'},
        {role: 'user', content: o.prompt}
      ],
      ...dimensions,
      ...(o.quality && o.quality !== 'auto' ? {quality: o.quality} : {})
    })
  });
  const data = await safeJson(res);
  if (!res.ok) throw createProviderApiError(data, res);
  return extractImageUrl(data, o.provider?.responsePath);
}
async function customSyncImageRequest(o) {
  const dimensions = imageRequestDimensionFields(o.provider, o.size || '1024x1024');
  const endpoint = o.provider?.imageEndpoint || o.provider?.endpoint || '/images/generations';
  const headers = {'Content-Type': 'application/json'};
  if (o.apiKey) headers.Authorization = 'Bearer ' + o.apiKey;
  const {res} = await fetchApiWithBaseFallback(o.apiUrl, endpoint, {
    timeoutMs: API_TIMEOUTS.image,
    signal: o.signal,
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: o.model,
      prompt: o.prompt,
      ...dimensions,
      ...imageRequestSeedFields(o),
      quality: o.quality || 'auto',
      refs: o.refUrls || []
    })
  });
  const data = await safeJson(res);
  if (!res.ok) throw createProviderApiError(data, res);
  return extractImageUrl(data, o.provider?.responsePath);
}
function valueAtPath(data, path) {
  if (!path) return undefined;
  return String(path).split('.').filter(Boolean).reduce((value, key) => {
    if (value == null) return undefined;
    return value[Number.isInteger(Number(key)) ? Number(key) : key];
  }, data);
}
function imageUrlFromUnknown(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.url) return value.url;
    if (value.b64_json) return 'data:image/png;base64,' + value.b64_json;
    if (value.image_url) return typeof value.image_url === 'string' ? value.image_url : value.image_url.url;
    if (value.content) return extractImageUrl(value);
  }
  return '';
}
function extractImageUrl(data, responsePath = '') {
  const mapped = imageUrlFromUnknown(valueAtPath(data, responsePath));
  if (mapped) return mapped;
  const first = data.data?.[0] || data;
  if (first.url) return first.url;
  if (first.b64_json) return 'data:image/png;base64,' + first.b64_json;
  const messageContent = data.choices?.[0]?.message?.content;
  if (Array.isArray(messageContent)) {
    for (const part of messageContent) {
      const url = imageUrlFromUnknown(part);
      if (url) return url;
    }
  }
  if (typeof messageContent === 'string') {
    const dataUrl = messageContent.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i)?.[0];
    if (dataUrl) return dataUrl;
    const url = messageContent.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)(?:\?\S*)?/i)?.[0];
    if (url) return url;
  }
  const output = data.output || data.result || data.images || data.image;
  const outputUrl = Array.isArray(output) ? imageUrlFromUnknown(output[0]) : imageUrlFromUnknown(output);
  if (outputUrl) return outputUrl;
  throw new Error('接口未返回图片 URL 或 b64_json');
}
async function runVideo(id, visiting = new Set()) {
  const node = nodes.get(id);
  if (!node) return;
  const generationStartedAt = Date.now();
  const previousUrl = node.data.url || '';
  const previousUrls = Array.isArray(node.data.urls) ? [...node.data.urls] : (previousUrl ? [previousUrl] : []);
  const ownPrompt = (node.data.prompt || '').trim();
  const linkedPrompt = getInputPrompt(id);
  let prompt = ownPrompt || linkedPrompt;
  prompt = promptWithCanvasContext(prompt, 'video', node.id);
  prompt = applyModelAgnosticGenerationRules(prompt, 'video');
  const refs = await ensureInputImageRefs(id, visiting);
  const resolvedReferences = ReferenceRoles?.mergeResolvedReferences({
    nodeType: 'video',
    references: node.data.references,
    resolvedItems: refs.map((url, index) => Object.assign({}, node.data.references?.[index] || {}, {
      url,
      key: node.data.references?.[index]?.key || `resolved-${index}`
    }))
  }) || refs.map((url, index) => ({url, role: index === 0 ? 'first-frame' : 'reference', order: index}));
  node.data.references = resolvedReferences;
  const operation = VideoDirector?.normalizeOperation(node.data.operation, node.data.mode) || node.data.operation || 'text-to-video';
  node.data.operation = operation;
  node.data.mode = operation === 'image-to-video' ? 'image' : operation === 'text-to-video' ? 'text' : 'auto';
  prompt += ReferenceRoles?.referenceRoleInstructions(resolvedReferences) || '';
  prompt += VideoDirector?.operationInstructions({operation, duration: node.data.duration, speed: node.data.speed, references: resolvedReferences}) || '';
  if (refs[0]) node.data.refUrl = refs[0];
  hydrateNode(node);
  if (!prompt) { toast('视频节点缺少提示词', 'warn'); return false; }
  const directorValidation = VideoDirector?.validateRequest({
    operation,
    mode: node.data.mode,
    size: MediaDimensions?.videoTargetSize(node.data) || node.data.size,
    duration: node.data.duration || '5',
    speed: node.data.speed || '1',
    references: resolvedReferences
  });
  if (directorValidation?.errors?.length) {
    updateVideoStatus(node, directorValidation.errors.map(item => item.message).join('\n'), 'error');
    toast(directorValidation.errors.map(item => item.message).join('\n'), 'warn');
    return false;
  }
  const provider = currentProviderForNode(node, 'video');
  const apiUrl = provider.apiUrl || $('apiUrl').value.trim().replace(/\/$/, '');
  const videoModel = node.data.model || provider.videoModel || $('videoModel').value || 'omni-flash';
  const apiKey = await providerApiKey(provider, 'video', videoModel);
  if (!apiUrl || !apiKey) {
    if (apiKey) reportProviderKeyResult?.(provider, 'video', {releaseOnly: true}, apiKey);
    toast('请先在设置里完善该视频节点选择的 API 配置和密钥', 'warn');
    return false;
  }
  if (!videoModel) {
    reportProviderKeyResult?.(provider, 'video', {releaseOnly: true}, apiKey);
    toast('请先选择或填写视频模型', 'warn');
    return false;
  }
  const videoBudgetRequest = {
    operation,
    size: MediaDimensions?.videoTargetSize(node.data) || node.data.size,
    duration: node.data.duration || '5',
    count: 1,
    references: resolvedReferences
  };
  let videoCapabilityProfile = null;
  if (ModelCapabilities) {
    videoCapabilityProfile = ModelCapabilities.resolveProfile({provider, modelId: videoModel, kind: 'video'});
    const capability = ModelCapabilities.validateRequest(videoCapabilityProfile, {
      operation,
      size: MediaDimensions?.videoTargetSize(node.data) || node.data.size,
      duration: node.data.duration || '5',
      references: resolvedReferences
    });
    node.data.modelCapability = {
      schemaVersion: videoCapabilityProfile.schemaVersion,
      profileVersion: videoCapabilityProfile.profileVersion,
      source: videoCapabilityProfile.source,
      checkedAt: Date.now(),
      warnings: capability.warnings.map(item => item.message)
    };
    if (capability.errors.length) {
      reportProviderKeyResult?.(provider, 'video', {releaseOnly: true}, apiKey);
      toast(capability.errors.map(item => item.message).join('\n'), 'warn');
      return false;
    }
  }
  let budgetEntryId = '';
  let budgetActualRequests = 0;
  try {
    budgetEntryId = await authorizeGenerationBudget?.({node, provider, model: videoModel, kind: 'video', request: videoBudgetRequest, profile: videoCapabilityProfile}) || '';
  } catch (error) {
    reportProviderKeyResult?.(provider, 'video', {releaseOnly: true}, apiKey);
    toast(error?.message || '已由预算保护停止，未发送 API 请求', 'warn');
    return false;
  }
  const btn = node.el.querySelector('[data-run="video"]');
  btn.disabled = true;
  const savedTask = node.data.videoTask && normalizeShortVideoTask(node.data.videoTask);
  btn.innerHTML = savedTask ? '继续查询视频...' : `${VideoDirector?.operationDefinition(operation)?.label || '视频生成'}中...`;
  updateVideoStatus(node, '正在提交视频任务...', 'info');
  try {
    const refUrls = resolvedReferences.map(item => item.url).filter(Boolean);
    const request = {
      apiUrl,
      apiKey,
      provider,
      model: videoModel,
      prompt,
      size: savedTask?.requestedSize || MediaDimensions?.videoTargetSize(node.data) || '1280x720',
      duration: node.data.duration || '5',
      operation,
      speed: node.data.speed || '1',
      loop: operation === 'loop',
      mode: node.data.mode || 'auto',
      refUrl: refUrls[0] || '',
      references: resolvedReferences,
      onTask: task => {
        node.data.videoTask = {...task, requestedSize: request.size, providerId: provider.id, model: videoModel, createdAt: Date.now()};
        updateVideoStatus(node, '任务已提交，软件重启后可以继续查询', 'info');
        saveProject();
      },
      onStatus: text => updateVideoStatus(node, text, 'info')
    };
    budgetActualRequests = savedTask ? 0 : 1;
    const generatedUrl = savedTask
      ? await resumeShortVideoTask(request, savedTask)
      : await videoGenerateRequest(request);
    const url = await persistMediaUrl(generatedUrl, `generated_video_${Date.now()}`, 'mp4');
    node.data.prompt = ownPrompt || node.data.prompt;
    if (previousUrl && previousUrl !== url && VideoDirector?.isVersionedOperation(operation)) {
      const versions = Array.isArray(node.data.videoVersions) ? node.data.videoVersions.slice() : [];
      if (!versions.some(item => item.url === previousUrl)) versions.push({
        id: `video-version-${Date.now()}`,
        url: previousUrl,
        operation: node.data.lastOperation || 'source',
        outputMetadata: node.data.outputMetadata || null,
        preservedAt: Date.now()
      });
      node.data.videoVersions = versions.slice(-20);
    }
    node.data.url = url;
    node.data.urls = [url];
    node.data.videoTask = null;
    node.data.lastOperation = operation;
    const outputMetadata = await probeVideoMetadata(url);
    node.data.outputMetadata = Object.assign({}, outputMetadata, {
      requestedSize: request.size,
      requestedDuration: Number(request.duration || 0),
      operation,
      speed: Number(request.speed || 1),
      referenceCount: resolvedReferences.length,
      recordedAt: Date.now()
    });
    node.data.generatedAt = Date.now();
    VariantManager?.recordOutputs(node.data, [{
      url,
      mediaType: 'video',
      status: 'unseen',
      model: videoModel,
      provider: provider.name || provider.id || '',
       prompt,
       parameters: videoBudgetRequest,
       elapsedMs: Date.now() - generationStartedAt,
       estimatedCost: node.data.lastEstimatedCost || null,
       actualDuration: outputMetadata.actualDuration ?? null,
       createdAt: Date.now()
    }]);
    Provenance?.recordNodeOutputs(node.data, [{
      url,
      mediaType: 'video',
      providerId: provider.id || '',
      providerName: provider.name || '',
      modelId: videoModel,
      capabilityProfileVersion: videoCapabilityProfile?.profileVersion || 1,
      requestProtocol: provider.type || 'openai-compatible',
      prompt,
      parameters: videoBudgetRequest,
       references: resolvedReferences,
       requested: {size: request.size, duration: Number(request.duration || 0)},
       actual: {duration: outputMetadata.actualDuration ?? null, codec: outputMetadata.codec || 'unknown', audioTrack: outputMetadata.audioTrack || 'unknown'},
       estimatedCost: node.data.lastEstimatedCost || null,
       generatedAt: Date.now()
      }]);
    const outputStatus = videoOutputStatus(node.data.outputMetadata);
    updateVideoStatus(node, outputStatus, 'success');
    hydrateNode(node);
    addHistory({type: 'video', url, refUrl: refUrls[0] || '', references: resolvedReferences, prompt, model: videoModel, provider: provider.name, operation, size: request.size, outputMetadata: node.data.outputMetadata, duration: node.data.duration, time: Date.now()});
    saveProject();
    toast('视频生成完成', 'success');
    reportProviderKeyResult?.(provider, 'video', null, apiKey);
    completeGenerationBudget?.(budgetEntryId, {actualRequests: budgetActualRequests, status: 'completed', differenceReason: savedTask ? '继续查询已有任务，未重复提交生成' : ''});
    return true;
  } catch (err) {
    reportProviderKeyResult?.(provider, 'video', err, apiKey);
    if (isSafetyError(err)) node.data.prompt = softenPrompt(prompt);
    node.data.url = previousUrl;
    node.data.urls = previousUrls;
    VariantManager?.recordOutputs(node.data, [{
      mediaType: 'video',
      status: 'revision',
      model: videoModel,
      provider: provider.name || provider.id || '',
      prompt,
      parameters: videoBudgetRequest,
      elapsedMs: Date.now() - generationStartedAt,
      error: err?.message || String(err),
      createdAt: Date.now()
    }]);
    if (isTerminalShortVideoTaskError(err)) node.data.videoTask = null;
    updateVideoStatus(node, formatVideoError(err), 'error');
    hydrateNode(node);
    saveProject();
    completeGenerationBudget?.(budgetEntryId, {actualRequests: budgetActualRequests, status: 'failed', differenceReason: err?.message || '视频生成失败'});
    toast(formatVideoError(err), 'error');
    return false;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-video"></i> 生成视频';
  }
}
function updateVideoStatus(node, text, type = 'info') {
  if (!node) return;
  node.data.status = text || '';
  node.data.statusType = type === 'error' ? 'error' : '';
  const box = node.el.querySelector('[data-status]');
  if (box) {
    box.textContent = node.data.status;
    box.classList.toggle('hidden', !node.data.status);
    box.classList.toggle('error', node.data.statusType === 'error');
  }
}
function buildVideoCreateBody(o, refs) {
  const model = o.model || 'omni-flash';
  const isVeo = /^veo/i.test(model);
  const aspect = sizeToAspect(o.size);
  const director = VideoDirector?.protocolPayload(o) || {operation: 'text-to-video', images: refs, videos: [], audios: [], references: [], keyframes: [], speed: 1, loop: false, extendDirection: ''};
  const images = director.images?.length ? director.images : refs;
  const extras = {};
  if (!['text-to-video', 'image-to-video'].includes(director.operation)) extras.operation = director.operation;
  if (Math.abs(Number(director.speed || 1) - 1) > 0.001) extras.speed = Number(director.speed);
  if (director.loop) extras.loop = true;
  if (director.extendDirection) extras.extend_direction = director.extendDirection;
  if (director.keyframes?.length) extras.keyframes = director.keyframes;
  if (director.videos?.length) extras.videos = director.videos;
  if (director.audios?.length) extras.audios = director.audios;
  if (director.references?.length > 1 || Object.keys(extras).length) extras.references = director.references;
  if (isVeo) {
    return {enable_upsample: true, enhance_prompt: true, images, model, prompt: o.prompt, aspect_ratio: aspect, ...extras};
  }
  return {
    images,
    model,
    orientation: ['9:16', '9:21', '6:19'].includes(aspect) ? 'portrait' : 'landscape',
    prompt: o.prompt,
    size: /large|small/i.test(o.size || '') ? o.size : 'large',
    duration: parseInt(o.duration, 10) || 10,
    watermark: false,
    private: true,
    ...extras
  };
}
function sizeToAspect(size) {
  return MediaDimensions?.normalizeAspect(size, '16:9') || '16:9';
}
async function pollVideoTask(apiUrl, apiKey, id, onStatus, endpoint = '/video/query') {
  let last = null;
  for (let i = 0; i < 122; i++) {
    await sleep(i < 3 ? 2500 : 5000);
    const res = await fetchJsonWithRetry(joinApiPath(apiUrl, endpoint || '/video/query') + '?id=' + encodeURIComponent(id), {timeoutMs: API_TIMEOUTS.poll,
      headers: {Accept: 'application/json', Authorization: 'Bearer ' + apiKey}
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
    last = data;
    const url = tryExtractVideoUrl(data);
    if (url) return url;
    const status = String(data.status || data.detail?.status || '').toLowerCase();
    onStatus?.('视频生成中，任务 ID：' + id + '\n当前状态：' + (status || '等待中'));
    if (/fail|error|cancel|reject/.test(status)) throw new Error(data.detail?.failure_reason || data.message || '视频任务失败：' + JSON.stringify(data));
  }
  throw new Error('视频任务仍在生成中，请稍后重试。任务 ID：' + id + '\n最后状态：' + JSON.stringify(last || {}));
}
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('生成任务已取消'), {name: 'AbortError', isCanceled: true}));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      reject(Object.assign(new Error('生成任务已取消'), {name: 'AbortError', isCanceled: true}));
    };
    function finish() {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }
    signal?.addEventListener?.('abort', onAbort, {once: true});
  });
}
function isTerminalShortVideoTaskError(err) {
  return /(?:任务|视频).*(?:失败|取消|拒绝)|failed|cancelled|canceled|rejected|not found|HTTP 404|任务不存在|审核拒绝/i.test(err?.message || String(err || ''));
}
async function resumeShortVideoTask(o, task) {
  const saved = normalizeShortVideoTask(task);
  if (!saved) throw new Error('未完成视频任务记录已损坏，不会自动重新提交');
  o.onStatus?.(`正在继续查询已提交任务：${saved.id}`);
  return saved.protocol === 'openai'
    ? await pollOpenAiVideoTask(o.apiUrl, o.apiKey, saved.id, o.onStatus)
    : await pollVideoTask(o.apiUrl, o.apiKey, saved.id, o.onStatus, o.provider?.videoQueryEndpoint);
}
async function videoGenerateRequest(o) {
  if (shouldUseOpenAiVideoEndpoint(o)) return await openAiVideoRequest(o);
  o.onStatus?.('正在创建视频任务...');
  const structured = VideoDirector?.protocolPayload(o);
  const body = buildVideoCreateBody(o, structured?.images?.length ? structured.images : [o.refUrl].filter(Boolean));
  try {
    const endpoint = o.provider?.videoEndpoint || '/video/create';
    const res = await fetchJsonWithRetry(joinApiPath(o.apiUrl, endpoint), {timeoutMs: API_TIMEOUTS.video,
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + o.apiKey},
      body: JSON.stringify(body)
    });
    const data = await safeJson(res);
    if (!res.ok) throw videoApiError(data);
    const immediate = tryExtractVideoUrl(data);
    if (immediate) return immediate;
    const taskId = data.id || data.task_id || data.detail?.id;
    if (!taskId) throw videoApiError(data, 'API 未返回视频任务 ID');
    o.onTask?.({id: taskId, protocol: 'legacy'});
    o.onStatus?.('视频任务已提交，任务 ID：' + taskId + '\n正在等待生成结果...');
    return await pollVideoTask(o.apiUrl, o.apiKey, taskId, o.onStatus, o.provider?.videoQueryEndpoint);
  } catch (err) {
    if (!shouldFallbackToVideosEndpoint(err)) throw err;
    o.onStatus?.('/video/create 不适配当前服务，正在改用 /videos 重新提交...');
    return await openAiVideoRequest(o);
  }
}
function shouldUseOpenAiVideoEndpoint(o) {
  return /^veo_3_1(?:-fast)?$/i.test(String(o.model || '')) || String(o.mode || '') === 'openai' || String(o.mode || '') === 'videos';
}
function videoApiError(data, prefix = '') {
  const message = data.error?.message || data.Error?.Message || data.message || data.detail?.failure_reason || JSON.stringify(data);
  const err = new Error(prefix ? prefix + '：' + message : message);
  err.data = data;
  return err;
}
function shouldFallbackToVideosEndpoint(err) {
  const msg = err?.message || String(err);
  return /X-TC-Action|MissingParameter|common parameter|未返回视频任务 ID/i.test(msg) && !isSafetyError(err);
}
async function openAiVideoRequest(o) {
  o.onStatus?.('正在创建 /videos 视频任务...');
  const fd = new FormData();
  fd.append('model', o.model || 'veo_3_1-fast');
  fd.append('prompt', o.prompt);
  fd.append('seconds', String(parseInt(o.duration, 10) || 8));
  fd.append('size', sizeToOpenAiVideoSize(o.size));
  fd.append('watermark', 'false');
  const director = VideoDirector?.protocolPayload(o) || {operation: 'text-to-video', images: [o.refUrl].filter(Boolean), videos: [], audios: [], keyframes: [], speed: 1, loop: false, extendDirection: ''};
  if (director.images[0]) fd.append('input_reference', await mediaUrlToBlob(director.images[0]), 'reference.png');
  if (director.operation === 'first-last-frame' && director.images[1]) fd.append('last_frame', await mediaUrlToBlob(director.images[1]), 'last-frame.png');
  if (director.keyframes?.length > 2) fd.append('keyframes', JSON.stringify(director.keyframes.map(item => ({index: item.index, role: item.role, time: item.time}))));
  if (director.videos[0]) fd.append('input_video', await mediaUrlToBlob(director.videos[0]), 'source.mp4');
  if (director.audios[0]) fd.append('input_audio', await mediaUrlToBlob(director.audios[0]), 'reference-audio.mp3');
  if (!['text-to-video', 'image-to-video'].includes(director.operation)) fd.append('operation', director.operation);
  if (director.extendDirection) fd.append('extend_direction', director.extendDirection);
  if (director.loop) fd.append('loop', 'true');
  if (Math.abs(Number(director.speed || 1) - 1) > 0.001) fd.append('speed', String(director.speed));
  const res = await fetchJsonWithRetry(joinApiPath(o.apiUrl, o.provider?.videoEndpoint || '/videos'), {timeoutMs: API_TIMEOUTS.video,
    method: 'POST',
    headers: {Accept: 'application/json', Authorization: 'Bearer ' + o.apiKey},
    body: fd
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
  const immediate = tryExtractVideoUrl(data);
  if (immediate) return immediate;
  const id = data.id || data.video_id || data.task_id;
  if (!id) throw new Error('API 未返回视频 ID：' + JSON.stringify(data));
  o.onTask?.({id, protocol: 'openai'});
  o.onStatus?.('视频任务已提交，视频 ID：' + id + '\n正在等待生成结果...');
  return await pollOpenAiVideoTask(o.apiUrl, o.apiKey, id, o.onStatus);
}
function sizeToOpenAiVideoSize(size) {
  const compatible = MediaDimensions?.openAiVideoSize(size) || '';
  if (!compatible) throw new Error(`OpenAI 视频接口不支持 ${size || '当前尺寸'}，请改用 1280x720、720x1280、1792x1024 或 1024x1792。`);
  return compatible;
}
async function probeVideoMetadata(url, timeoutMs = 12000) {
  if (typeof document === 'undefined' || !url) return {actualDuration: null, codec: 'unknown', audioTrack: 'unknown'};
  return await new Promise(resolve => {
    const video = document.createElement('video');
    let timer = 0;
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load?.();
      resolve(value);
    };
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      const actualDuration = Number.isFinite(Number(video.duration)) ? Number(Number(video.duration).toFixed(3)) : null;
      const codec = /\.webm(?:[?#]|$)/i.test(url) ? 'webm' : /\.mp4(?:[?#]|$)/i.test(url) ? 'mp4' : /\.mov(?:[?#]|$)/i.test(url) ? 'mov' : 'unknown';
      const audioTrack = video.audioTracks?.length > 0 || video.mozHasAudio === true || Number(video.webkitAudioDecodedByteCount || 0) > 0 ? 'present' : 'unknown';
      finish({actualDuration, codec, audioTrack});
    };
    video.onerror = () => finish({actualDuration: null, codec: 'unknown', audioTrack: 'unknown'});
    timer = setTimeout(() => finish({actualDuration: null, codec: 'unknown', audioTrack: 'unknown'}), timeoutMs);
    video.src = url;
  });
}
function videoOutputStatus(metadata = {}) {
  const parts = [`视频生成完成 · 请求尺寸 ${metadata.requestedSize || '未记录'}`];
  const requestedDuration = Number(metadata.requestedDuration || 0);
  const actualDuration = Number(metadata.actualDuration || 0);
  if (actualDuration > 0) {
    const mismatch = requestedDuration > 0 && Math.abs(actualDuration - requestedDuration) > 0.2;
    parts.push(mismatch ? `请求 ${requestedDuration}秒，实际 ${actualDuration}秒（已保留）` : `实际 ${actualDuration}秒`);
  } else parts.push('实际时长待读取');
  parts.push(`编码 ${metadata.codec || 'unknown'}`);
  parts.push(`音轨 ${metadata.audioTrack === 'present' ? '有' : metadata.audioTrack === 'none' ? '无' : '待确认'}`);
  return parts.join(' · ');
}
async function pollOpenAiVideoTask(apiUrl, apiKey, id, onStatus) {
  let last = null;
  for (let i = 0; i < 122; i++) {
    await sleep(i < 3 ? 2500 : 5000);
    const res = await fetchJsonWithRetry(apiUrl + '/videos/' + encodeURIComponent(id), {timeoutMs: API_TIMEOUTS.poll,
      headers: {Accept: 'application/json', Authorization: 'Bearer ' + apiKey}
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
    last = data;
    const url = tryExtractVideoUrl(data);
    if (url) return url;
    const status = String(data.status || '').toLowerCase();
    onStatus?.('视频生成中，视频 ID：' + id + '\n当前状态：' + (status || '等待中'));
    if (/fail|error|cancel|reject/.test(status)) throw new Error(data.error?.message || data.message || '视频任务失败：' + JSON.stringify(data));
    if (/completed|succeeded|success/.test(status)) {
      const content = await fetchOpenAiVideoContent(apiUrl, apiKey, id);
      if (content) return content;
    }
  }
  throw new Error('视频任务仍在生成中，请稍后重试。视频 ID：' + id + '\n最后状态：' + JSON.stringify(last || {}));
}
async function fetchOpenAiVideoContent(apiUrl, apiKey, id) {
  const res = await fetchJsonWithRetry(apiUrl + '/videos/' + encodeURIComponent(id) + '/content', {timeoutMs: API_TIMEOUTS.video,
    headers: {Authorization: 'Bearer ' + apiKey}
  });
  if (!res.ok) return '';
  const type = res.headers.get('content-type') || '';
  if (/json/i.test(type)) {
    const data = await safeJson(res);
    return tryExtractVideoUrl(data);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
function tryExtractVideoUrl(data) {
  const first = data.data?.[0] || data.output?.[0] || data;
  if (typeof first === 'string') return first;
  if (first.url) return first.url;
  if (first.video_url) return first.video_url;
  if (first.videoUrl) return first.videoUrl;
  if (first.downloadable_url) return first.downloadable_url;
  if (first.content_url) return first.content_url;
  if (first.result_url) return first.result_url;
  if (first.detail?.url) return first.detail.url;
  if (first.detail?.video_url) return first.detail.video_url;
  if (first.detail?.downloadable_url) return first.detail.downloadable_url;
  if (first.detail?.draft_info?.downloadable_url) return first.detail.draft_info.downloadable_url;
  if (first.detail?.draft_info?.url) return first.detail.draft_info.url;
  if (first.detail?.draft_info?.encodings?.source?.path) return first.detail.draft_info.encodings.source.path;
  if (data.url) return data.url;
  if (data.video_url) return data.video_url;
  if (data.videoUrl) return data.videoUrl;
  if (data.downloadable_url) return data.downloadable_url;
  if (data.content_url) return data.content_url;
  if (data.result_url) return data.result_url;
  if (first.b64_json) return 'data:video/mp4;base64,' + first.b64_json;
  if (data.b64_json) return 'data:video/mp4;base64,' + data.b64_json;
  return '';
}
function formatVideoError(err) {
  const msg = err?.message || String(err);
  if (/PUBLIC_ERROR_UNSAFE_GENERATION|unsafe|安全|safety/i.test(msg)) {
    return '视频生成失败：\n平台安全策略拒绝了这次生成。\n\n建议：把人物关系、亲密动作、未成年人、裸露、危险动作等描述改得更克制；也可以点击“安全改写”后再生成。';
  }
  if (/X-TC-Action|MissingParameter|common parameter/i.test(msg)) {
    return '视频生成失败：\n当前 API 返回腾讯云网关参数缺失，缺少 X-TC-Action。\n\n软件已支持 /video/create 与 /videos 自动切换；如果仍出现此提示，请把“模式”改为“自动”，并确认 API 地址是服务商提供的兼容中转地址，而不是腾讯云原生接口地址。';
  }
  if (isSafetyError(err)) return formatError(err);
  return '视频生成失败：\n' + msg + '\n已支持 /videos multipart 和 /video/create 两种视频接口。';
}
function apiResponseErrorText(res, text = '') {
  const body = String(text || '');
  const contentType = String(res?.headers?.get?.('content-type') || '');
  if (!/text\/html/i.test(contentType) && !/<(?:!doctype|html)\b/i.test(body)) return '';
  const title = (body.match(/<title[^>]*>\s*([^<]+?)\s*<\/title>/i)?.[1] || '')
    .replace(/\s+/g, ' ')
    .trim();
  const status = Number(res?.status) || 0;
  return `接口返回网页（HTTP ${status || '未知'}${title ? '：' + title : ''}）`;
}
async function safeJson(res) {
  const text = await res.text();
  const htmlError = apiResponseErrorText(res, text);
  if (htmlError) return {message: htmlError};
  try { return JSON.parse(text); } catch { return {message: text || res.statusText}; }
}
async function persistGeneratedImageResult(result, name = 'generated_image', ext = 'png') {
  if (!result?.url) throw new Error('图片生成结果缺少可保存的 URL');
  const temporaryUrl = String(result.url);
  const persistedUrl = await persistMediaUrl(temporaryUrl, name, ext, {required: true});
  if (temporaryUrl.startsWith('blob:') && persistedUrl !== temporaryUrl) {
    URL.revokeObjectURL(temporaryUrl);
  }
  return persistedUrl;
}
    return {
      modelAgnosticGenerationPrefix,
      applyModelAgnosticGenerationRules,
      modelAgnosticTextPrefix,
      applyModelAgnosticTextRules,
      extractChatText,
      apiErrorMessage,
      chatCompletionTextRequest,
      isOpenAiImageGenerationModel,
      applyKnownImageProtocol,
      saveKnownImageProtocolCorrection,
      isUnsupportedImageModelError,
      isImageGenerationDisabledError,
      providerImageModelIds,
      equivalentProviderModelId,
      imageModelResolutionTier,
      sortImageModelCandidates,
      imageModelCandidates,
      refreshProviderImageModels,
      rememberWorkingImageModel,
      classifyImageProviderError,
      createProviderApiError,
      imageTaskAdapterConfig,
      usableGeneratedImageUrl,
      asyncImageUrlFromResponse,
      requestAsyncImageTask,
      rawImageGenerationWithModel,
      rawImageEditRequest,
      requestImageGenerationWithModel,
      imageGenerateRequest,
      imageGenerateBatchRequest,
      requestImageEditWithModel,
      imageEditRequest,
      referenceGuidedImageFallback,
      imageEditWithFallback,
      referenceBoardPrompt,
      shortError,
      composeReferenceBoard,
      loadImageForCanvas,
      drawImageContain,
      imageSizeForResolution,
      customImageTargetSize,
      imageTargetSize,
      imageSizeFromDialogPrompt,
      apiCompatibleImageSize,
      imageSizeCapabilityProfile,
      recordImageSizeCapability,
      providerImageRequestSizes,
      parseSize,
      validateGeneratedImageTargetSize,
      isUnsupportedImageSizeError,
      isApiGatewayTimeoutError,
      joinApiPath,
      apiRequestCandidates,
      imageRequestDimensionFields,
      imageRequestSeedFields,
      fetchApiWithBaseFallback,
      chatImageGenerateRequest,
      customSyncImageRequest,
      valueAtPath,
      imageUrlFromUnknown,
      extractImageUrl,
      runVideo,
      updateVideoStatus,
      buildVideoCreateBody,
      sizeToAspect,
      pollVideoTask,
      sleep,
      isTerminalShortVideoTaskError,
      resumeShortVideoTask,
      videoGenerateRequest,
      shouldUseOpenAiVideoEndpoint,
      videoApiError,
      shouldFallbackToVideosEndpoint,
      openAiVideoRequest,
      sizeToOpenAiVideoSize,
      probeVideoMetadata,
      videoOutputStatus,
      pollOpenAiVideoTask,
      fetchOpenAiVideoContent,
      tryExtractVideoUrl,
      formatVideoError,
      apiResponseErrorText,
      safeJson,
      persistGeneratedImageResult
    };
  }

  window.FutureAIProviderApi = { create };
})();
