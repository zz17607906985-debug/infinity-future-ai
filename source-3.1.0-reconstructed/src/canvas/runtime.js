(() => {
  'use strict';

  /**
   * Canvas runtime: nodes, ports, edges, selection helpers used by the infinite canvas.
   * Geometry helpers remain in canvas/core.js & canvas/edges.js (window.FutureAICanvas*).
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    const CanvasNodes = deps.CanvasNodes || window.FutureAICanvasNodes;
    const UIRenderHelpers = deps.UIRenderHelpers || window.FutureAIUIRenderHelpers;
    const MediaUtils = deps.MediaUtils || window.FutureAIMediaUtils || {};
    const MediaDimensions = deps.MediaDimensions || window.FutureAIMediaDimensions;
    const ModelCapabilities = deps.ModelCapabilities || window.FutureAIModelCapabilities;
    const ReferenceRoles = deps.ReferenceRoles || window.FutureAIReferenceRoles;
    const VideoDirector = deps.VideoDirector || window.FutureAIVideoDirector;
    const MediaProcessContract = deps.MediaProcessContract || window.FutureAIMediaProcessContract;
    const safeMediaUrl = deps.safeMediaUrl || MediaUtils.safeMediaUrl || (() => '');
    const {
      portCenterFromRects,
      fallbackPortCenter,
      edgePathD,
      segmentIntersectsView,
      edgeClassName
    } = deps.canvasEdges || window.FutureAICanvasEdges || {};
    const saveProject = deps.saveProject;
    const mountNode = deps.mountNode;
    const shouldVirtualizeNode = deps.shouldVirtualizeNode;
    const currentWorldBounds = deps.currentWorldBounds;
    const scheduleVisibilityUpdate = deps.scheduleVisibilityUpdate;
    const enhanceTextareas = deps.enhanceTextareas;
    const globalProviderForKind = deps.globalProviderForKind;
    const normalizeKnownImageModelAlias = deps.normalizeKnownImageModelAlias;
    const generateImageKeepingOriginal = deps.generateImageKeepingOriginal;
    const runVideoKeepingOriginal = deps.runVideoKeepingOriginal;
    const runComfyUI = deps.runComfyUI;
    const runPrompt = deps.runPrompt;
    const runMediaToolKeepingOriginal = deps.runMediaToolKeepingOriginal;
    const spawnRight = deps.spawnRight;
    const openFabricEditor = deps.openFabricEditor;
    const openCropperEditor = deps.openCropperEditor;
    const openCameraModal = deps.openCameraModal;
    const openMediaViewer = deps.openMediaViewer;
    const downloadMedia = deps.downloadMedia;
    const openDirectorDesk = deps.openDirectorDesk;
    const openDialogEditWorkbench = deps.openDialogEditWorkbench;
    const persistMediaUrl = deps.persistMediaUrl;
    const modelPickerGroups = deps.modelPickerGroups;
    const modelsForKind = deps.modelsForKind;
    const effectiveImageModel = deps.effectiveImageModel;
    const currentProviderForNode = deps.currentProviderForNode;
    const openModal = deps.openModal;
    const WAITING_ANIMATION_SRC = deps.WAITING_ANIMATION_SRC || './assets/generation-waiting.mp4';
    const screenToWorldPoint = deps.screenToWorldPoint;
    const viewportCenter = deps.viewportCenter;
    const releaseDrags = deps.releaseDrags;
    const setCanvasProxyActive = deps.setCanvasProxyActive;
    const closeFloatingCanvasUi = deps.closeFloatingCanvasUi;
    const unique = deps.unique || (arr => [...new Set(arr || [])]);
    const renderSelection = deps.renderSelection || (() => {});
    const queueSave = deps.queueSave || (() => {});
    const screenToWorld = deps.screenToWorld || deps.screenToWorldPoint || (() => ({x: 0, y: 0}));
  const setSelectedPort = deps.setSelectedPort || (v => { try { host.selectedPort = v; } catch {} });
  const importComfyWorkflowIntoNode = deps.importComfyWorkflowIntoNode;
  const closeNodeContextMenu = deps.closeNodeContextMenu;
  const runNodeContextAction = deps.runNodeContextAction;
  const testComfyUI = deps.testComfyUI;
  const saveComfyNodeWorkflowGlobal = deps.saveComfyNodeWorkflowGlobal;
  const exportComfyWorkflowText = deps.exportComfyWorkflowText;
  const optimizePrompt = deps.optimizePrompt;
  const softenPrompt = deps.softenPrompt;
  const openMediaUrl = deps.openMediaUrl;
  const showNodeContextMenu = deps.showNodeContextMenu;
  const expandNodeIdsForGroups = deps.expandNodeIdsForGroups;
  const fitNodeIntoView = deps.fitNodeIntoView;
  const comfyWorkflowMapHtml = deps.comfyWorkflowMapHtml;
  const removeNodeFromGroups = deps.removeNodeFromGroups;
  const mediaExtFromMime = deps.mediaExtFromMime;
  const openCanvasMenu = deps.openCanvasMenu;
  const VariantManager = deps.VariantManager || window.FutureAIVariantManager;

function addNode(type, x, y, data = {}, id = null, save = true) {
  const node = {
    id: id || 'n_' + (host.nextNodeSeq()),
    type,
    x,
    y,
    data: normalizeData(type, data),
    el: document.createElement('div'),
    mounted: false
  };
  node.el.className = 'node ' + (type === 'image' ? 'image-node' : type === 'video' ? 'video-node' : type === 'upload' ? 'upload-node' : type === 'media-tool' ? 'media-tool-node' : type === 'comfyui' ? 'comfyui-node' : type === 'character' ? 'character-node' : 'prompt-node');
  node.el.dataset.node = node.id;
  node.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  node.el.innerHTML = renderNode(node);
  if (shouldVirtualizeNode(node, currentWorldBounds(1800))) node.el.classList.add('node-virtual-hidden');
  else mountNode(node);
  host.nodes.set(node.id, node);
  bindNode(node);
  enhanceTextareas(node.el);
  hydrateNode(node);
  scheduleVisibilityUpdate();
  applyCanvasFilters();
  if (save) saveProject();
  return node;
}
function normalizeTags(value) {
  return CanvasNodes.normalizeTags(value);
}
function normalizeNodeMetadata(data) {
  return CanvasNodes.normalizeNodeMetadata(data);
}
function normalizeData(type, data) {
  const normalized = CanvasNodes.normalizeData(type, data, {
    imageModel: FutureAIApiDefaults.get('imageModel') || 'gpt-image2',
    videoModel: FutureAIApiDefaults.get('videoModel') || 'omni-flash',
    comfyWorkflowName: $('comfyWorkflowName')?.value || '默认工作流',
    comfyWorkflowJson: $('comfyWorkflowJson')?.value || ''
  });
  if (type === 'image') {
    const provider = normalized.providerId ? host.apiProviders.find(item => item.id === normalized.providerId) : globalProviderForKind('image');
    normalized.model = normalizeKnownImageModelAlias(normalized.model, provider);
  }
  return normalized;
}
function nodePort(className, port, io, label, title = '') {
  const direction = io === 'in' ? '输入' : '输出';
  const accessible = title || `${direction}${label}`;
  return `<div class="port ${esc(className)}" data-port="${esc(port)}" data-io="${esc(io)}" data-label="${esc(`${direction} · ${label}`)}" title="${esc(accessible)}" aria-label="${esc(accessible)}" role="button" tabindex="0"><i class="fa-solid fa-plus" aria-hidden="true"></i></div>`;
}
function renderNode(node) {
  if (node.type === 'image') return renderImageNode(node);
  if (node.type === 'video') return renderVideoNode(node);
  if (node.type === 'upload') return renderUploadNode(node);
  if (node.type === 'media-tool') return renderMediaToolNode(node);
  if (node.type === 'comfyui') return renderComfyUINode(node);
  const icon = node.type === 'character' ? 'fa-user-astronaut' : 'fa-note-sticky';
  return `
    ${nodeHeadHtml(node, icon)}
    ${nodePort('out-text', 'text', 'out', '提示词')}
    ${nodeFloatToolbar(node.type === 'character' ? 'character' : 'prompt')}
    <div class="node-content">
      <textarea data-field="prompt" placeholder="输入提示词、角色设定或镜头需求..."></textarea>
    </div>`;
}
function nodeHeadHtml(node, icon) {
  return `
    <div class="node-head">
      <div class="node-title" title="双击重命名"><i class="fa-solid ${icon}"></i><span data-title-text>${esc(nodeDisplayTitle(node))}</span></div>
      <div class="node-actions">${nodeButtons()}</div>
    </div>
    ${renderNodeMetadata(node)}`;
}
// Shared prompt/settings panel shown under the selected node (image, video, ComfyUI, media tool).
// head: tab buttons or a title; panes/body: content; bar: one row of pills ending with cost + round send.
function nodeComposerHtml({head = '', panes = '', body = '', hint = '', bar = '', send, after = ''}) {
  return `<div class="node-composer" data-composer>
      <div class="composer-head">
        ${head}
        <button type="button" class="composer-close" data-composer-close title="关闭面板" aria-label="关闭面板"><i class="fa-solid fa-xmark"></i></button>
      </div>
      ${panes}
      ${body}
      ${hint ? `<div class="composer-hint">${hint}</div>` : ''}
      <div class="composer-bar">
        ${bar}
        <span class="composer-cost hidden" data-cost-estimate></span>
        <button type="button" class="composer-send" data-run="${esc(send.run)}" title="${esc(send.title)}" aria-label="${esc(send.title)}"><i class="fa-solid ${esc(send.icon || 'fa-arrow-up')}"></i></button>
      </div>
      ${after}
    </div>`;
}
function composerTabsHtml(tabs) {
  return `<div class="composer-tabs" role="tablist">${tabs.join('')}</div>`;
}
function composerTab(id, label, active = false) {
  return `<button type="button" class="composer-tab${active ? ' active' : ''}" data-composer-tab="${esc(id)}" role="tab">${esc(label)}</button>`;
}
function composerTitle(label) {
  return `<span class="composer-title">${esc(label)}</span>`;
}
function composerPane(id, inner, active = false, cls = '') {
  return `<div class="composer-pane${cls ? ' ' + cls : ''}${active ? '' : ' hidden'}" data-composer-pane="${esc(id)}">${inner}</div>`;
}
function composerPill(title, inner, extra = '') {
  // extra may carry data-* attributes and a class="..." that is merged into the pill's class list.
  const extraClass = (extra.match(/ class="([^"]*)"/) || [])[1];
  const attrs = extra.replace(/ class="[^"]*"/, '');
  return `<label class="composer-pill${extraClass ? ' ' + extraClass : ''}" title="${esc(title)}"${attrs}>${inner}</label>`;
}
function composerNumberPill(title, field, attrs, unit = '', extra = '') {
  return composerPill(title, `<span class="composer-pill-label">${esc(title)}</span><input data-field="${esc(field)}" type="number" ${attrs}>${unit ? `<span class="composer-pill-unit">${esc(unit)}</span>` : ''}`, extra);
}
function composerModelPill(node, kind) {
  return `<label class="composer-pill composer-model" title="模型（按 API 服务分组）"><i class="fa-solid fa-circle-nodes"></i><select data-model-picker aria-label="模型">${modelPickerHtml(node, kind)}</select></label>`;
}
function composerCustomSizeHtml(attr) {
  return `<div class="image-custom-size hidden" ${attr}>
        <label>宽<input data-field="customWidth" type="number" min="64" max="16384" step="1" placeholder="64-16384"></label>
        <label>高<input data-field="customHeight" type="number" min="64" max="16384" step="1" placeholder="64-16384"></label>
      </div>`;
}
function composerSummariesHtml(node, kind) {
  return `<span class="media-size-summary" data-size-summary></span><span class="media-capability-summary" data-capability-summary>${esc(modelCapabilitySummary(node, kind))}</span>`;
}
function renderImageNode(node) {
  const provider = currentProviderForNode(node, 'image');
  const normalizedModel = normalizeKnownImageModelAlias(node.data.model, provider);
  if (normalizedModel !== node.data.model) node.data.model = normalizedModel;
  const composer = nodeComposerHtml({
    head: composerTabsHtml([
      composerTab('ref', '参考', true),
      composerTabButtonHtml('mark', '标记', node.data.markTag),
      composerTabButtonHtml('style', '风格', node.data.styleTag),
      composerTabButtonHtml('mood', '情绪', node.data.moodTag)
    ]),
    panes: composerPane('ref', `<div class="ref-box composer-refs" data-refbox>未连接或上传参考图</div>
        <button type="button" class="composer-add-ref" data-upload-btn title="上传参考图"><i class="fa-solid fa-plus"></i><span>添加</span></button>
        <div class="ref-guide hidden" data-ref-guide></div>`, true, 'composer-ref-pane')
      + composerPresetPaneHtml('mark', node.data.markTag)
      + composerPresetPaneHtml('style', node.data.styleTag)
      + composerPresetPaneHtml('mood', node.data.moodTag),
    body: '<textarea data-field="prompt" data-inline-optimize placeholder="描述你想要生成的内容" title="输入当前图片节点自己的指令。连接参考图不会覆盖这里。"></textarea>',
    hint: `<span class="composer-hint-text" title="参考图按用途优先级（编辑原图 → 角色一致 → 姿势动作 → 构图布局 → 风格参考 → 一般参考）发送，同一用途内可拖动排序；也可从其它节点连线到「智能输入」作为参考。">参考图按用途排序发送，同用途内可拖动排序</span>${composerSummariesHtml(node, 'image')}`,
    bar: composerModelPill(node, 'image')
      + composerPill('比例', `<select data-field="aspect">${imageAspectOptionsHtml(node)}</select>`)
      + composerPill('清晰度', `<select data-field="resolution">${imageResolutionOptionsHtml(node)}</select>`)
      + composerPill('张数', '<select data-field="count"><option value="1">1张</option><option value="2">2张</option><option value="3">3张</option><option value="4">4张</option></select>'),
    send: {run: 'image', title: '生成图像 / 图生图'},
    after: composerCustomSizeHtml('data-image-custom-size')
  });
  return `
    ${nodeHeadHtml(node, 'fa-image')}
    ${nodePort('in-unified', 'input', 'in', '智能输入', '输入提示词、参考图或素材')}
    ${nodePort('out-image', 'image', 'out', '图片')}
    ${nodeFloatToolbar('image')}
    <div class="node-content">
      <input type="file" accept="image/*,video/*" data-upload class="hidden">
      <div class="image-preview" data-preview></div>
      ${outputHistoryNavHtml()}
      <div class="node-status hidden" data-status></div>
    </div>
    ${composer}`;
}
function renderVideoNode(node) {
  const composer = nodeComposerHtml({
    head: composerTabsHtml([composerTab('ref', '素材', true)]),
    panes: composerPane('ref', '<div class="ref-box composer-refs" data-refbox>连接图片、视频或音频后，为每份素材选择用途</div>', true),
    body: `<div class="video-keyframe-timeline hidden" data-keyframe-timeline></div>
      <textarea data-field="prompt" data-inline-optimize placeholder="描述镜头内容。可连线图片作为首帧 / 参考，也可连接提示词节点。"></textarea>
      <div class="composer-issues hidden" data-video-request-summary></div>`,
    hint: `<span class="composer-hint-text" data-operation-help>${esc(videoOperationHelp(node))}</span>${composerSummariesHtml(node, 'video')}`,
    bar: composerModelPill(node, 'video')
      + composerPill('我想做什么', `<select data-field="operation">${videoOperationOptionsHtml(node)}</select>`)
      + composerPill('时长', `<select data-field="duration">${videoDurationOptionsHtml(node)}</select>`)
      + composerPill('尺寸', `<select data-field="size">${videoSizeOptionsHtml(node)}</select>`)
      + composerNumberPill('速度', 'speed', 'min="0.1" max="4" step="0.1"', '×'),
    send: {run: 'video', title: '生成视频'},
    after: composerCustomSizeHtml('data-video-custom-size')
  });
  return `
    ${nodeHeadHtml(node, 'fa-video')}
    ${nodePort('in-unified', 'input', 'in', '智能输入', '输入提示词、首帧或参考图')}
    ${nodePort('out-image', 'video', 'out', '视频')}
    ${nodeFloatToolbar('video')}
    <div class="node-content">
      <div class="image-preview" data-preview></div>
      ${outputHistoryNavHtml()}
      <div class="node-status hidden" data-status></div>
    </div>
    ${composer}`;
}
function renderUploadNode(node) {
  return `
    ${nodeHeadHtml(node, 'fa-upload')}
    ${nodePort('out-image', 'media', 'out', '上传素材')}
    ${nodeFloatToolbar('upload')}
    <div class="node-content">
      <input type="file" accept="image/*,video/*" data-upload class="hidden">
      <div class="upload-preview" data-preview></div>
    </div>`;
}
// Only the parameters the selected local operation really reads are shown (MediaProcessContract fields).
function renderMediaToolNode(node) {
  const options = (MediaProcessContract?.OPERATIONS || []).map(item => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('');
  const used = MediaProcessContract?.operation?.(node.data.operation)?.fields || [];
  const field = name => ` data-tool-field="${name}"${used.includes(name) ? '' : ' class="hidden"'}`;
  const composer = nodeComposerHtml({
    head: composerTitle('本地处理'),
    body: `<textarea data-field="subtitleText"${field('subtitleText')} placeholder="粘贴 SRT 或 VTT 字幕；也可以连接字幕文件。"></textarea>`,
    hint: '<span class="composer-hint-text" data-refbox>连接源素材后运行；处理结果是新文件，不覆盖源素材。</span>',
    bar: composerPill('本地操作', `<select data-field="operation">${options}</select>`)
      + composerNumberPill('宽', 'width', 'min="64" max="7680"', '', field('width'))
      + composerNumberPill('高', 'height', 'min="64" max="7680"', '', field('height'))
      + composerNumberPill('开始', 'start', 'min="0" step="0.1"', '秒', field('start'))
      + composerNumberPill('时长', 'duration', 'min="0.05" step="0.1"', '秒', field('duration'))
      + composerNumberPill('取帧', 'time', 'min="0" step="0.1"', '秒', field('time'))
      + composerNumberPill('速度', 'speed', 'min="0.5" max="2" step="0.1"', '×', field('speed'))
      + composerNumberPill('循环', 'loops', 'min="1" max="100"', '次', field('loops'))
      + composerNumberPill('音量', 'volume', 'min="0" max="4" step="0.1"', '×', field('volume'))
      + composerNumberPill('偏移', 'shiftSeconds', 'step="0.1"', '秒', field('shiftSeconds'))
      + composerPill('背景色', '<span class="composer-pill-label">背景</span><input data-field="background" type="color">', field('background'))
      + composerPill('输出格式', `<select data-field="format">${mediaToolFormatOptionsHtml(node)}</select>`, field('format')),
    send: {run: 'media-tool', title: '运行本地处理', icon: 'fa-play'}
  });
  return `
    ${nodeHeadHtml(node, 'fa-scissors')}
    ${nodePort('in-unified', 'media', 'in', '源素材', '可连接一到两个图片、视频、音频或字幕素材')}
    ${nodePort('out-image', 'media', 'out', '处理结果')}
    ${nodeFloatToolbar('media-tool')}
    <div class="node-content">
      <div class="upload-preview" data-preview></div>
      <div class="node-status hidden" data-status></div>
    </div>
    ${composer}`;
}
function mediaToolFormatOptionsHtml(node) {
  return (MediaProcessContract?.formatOptions?.(node.data.operation) || []).map(value => `<option value="${value}">${value === 'webp' ? 'WebP' : value.toUpperCase()}</option>`).join('');
}
function updateMediaToolFields(node) {
  if (!node?.el || node.type !== 'media-tool' || !MediaProcessContract) return;
  const definition = MediaProcessContract.operation(node.data.operation);
  const fields = definition.fields || [];
  node.el.querySelectorAll('[data-tool-field]').forEach(el => el.classList.toggle('hidden', !fields.includes(el.dataset.toolField)));
  const format = node.el.querySelector('[data-field="format"]');
  if (format) {
    const allowed = MediaProcessContract.formatOptions(definition.id);
    format.innerHTML = mediaToolFormatOptionsHtml(node);
    if (allowed.length && !allowed.includes(node.data.format)) node.data.format = allowed[0];
    format.value = node.data.format || '';
  }
}
function renderComfyUINode(node) {
  const composer = nodeComposerHtml({
    head: composerTabsHtml([composerTab('prompt', '提示词', true), composerTab('workflow', '工作流')]),
    panes: composerPane('prompt', `<div class="ref-box composer-refs" data-refbox>可连线图片作为参考</div>
        <textarea data-field="prompt" placeholder="正向提示词。也可以连接提示词节点。"></textarea>
        <textarea data-field="negative" class="composer-negative" placeholder="负向提示词（可选）"></textarea>`, true, 'composer-stack')
      + composerPane('workflow', `<label class="composer-field">工作流名称<input data-field="workflowName" placeholder="工作流名称"></label>
        <div class="comfyui-workflow-map" data-workflow-map></div>
        <textarea class="comfyui-json-editor" data-field="workflowJson" placeholder="ComfyUI API workflow JSON。运行时会注入提示词、负向提示词、尺寸和 seed。"></textarea>`, false, 'composer-stack'),
    hint: '<span class="composer-hint-text">运行时注入提示词、负向提示词、尺寸和 seed</span>',
    bar: composerPill('Seed（留空随机）', '<span class="composer-pill-label">Seed</span><input data-field="seed" placeholder="随机">')
      + composerNumberPill('宽', 'width', 'min="64" step="64"')
      + composerNumberPill('高', 'height', 'min="64" step="64"'),
    send: {run: 'comfyui', title: '运行 ComfyUI 工作流'}
  });
  return `
    ${nodeHeadHtml(node, 'fa-diagram-project')}
    ${nodePort('in-unified', 'input', 'in', '智能输入', '输入提示词或参考图')}
    ${nodePort('out-image', 'image', 'out', '图片')}
    ${nodeFloatToolbar('comfyui')}
    <div class="node-content">
      <input type="file" accept=".json,application/json" data-comfy-file class="hidden">
      <div class="image-preview" data-preview></div>
      <div class="node-status hidden" data-status></div>
    </div>
    ${composer}`;
}
// Generation history of an image/video node: ‹ n/m › over every output recorded on the node.
function outputHistoryNavHtml() {
  return '<div class="output-history-nav hidden" data-output-history><button type="button" data-history-step="-1" title="上一版" aria-label="上一版"><i class="fa-solid fa-chevron-left"></i></button><span data-history-count></span><button type="button" data-history-step="1" title="下一版" aria-label="下一版"><i class="fa-solid fa-chevron-right"></i></button></div>';
}
function renderOutputHistoryNav(node) {
  const nav = node.el.querySelector('[data-output-history]');
  if (!nav || !VariantManager) return;
  const {index, total} = VariantManager.historyPosition(node.data);
  const busy = node.data.statusType === 'running';
  nav.classList.toggle('hidden', total < 2 || busy);
  if (total < 2) return;
  nav.querySelector('[data-history-count]').textContent = `${index >= 0 ? index + 1 : '–'}/${total}`;
  nav.querySelector('[data-history-step="-1"]').disabled = index === 0;
  nav.querySelector('[data-history-step="1"]').disabled = index === total - 1;
}
function stepOutputHistory(node, delta) {
  if (!VariantManager || node.data.statusType === 'running') return;
  const entry = VariantManager.stepHistory(node.data, delta, node.type === 'video' ? 'video' : 'image');
  if (!entry) return;
  hydrateNode(node);
  refreshDownstreamLinkedInputs(node.id);
  saveProject();
}
function nodeButtons() {
  return `<button class="icon-btn" data-favorite title="收藏节点"><i class="fa-regular fa-heart"></i></button><button class="icon-btn" data-tags title="编辑标签"><i class="fa-solid fa-tag"></i></button><button class="icon-btn" data-rename title="重命名"><i class="fa-solid fa-pen"></i></button><button class="icon-btn" data-dup title="复制"><i class="fa-solid fa-copy"></i></button><button class="icon-btn" data-del title="删除"><i class="fa-solid fa-trash"></i></button>`;
}
function renderNodeMetadata(node) {
  return UIRenderHelpers.renderNodeMetadata(node, {normalizeTags, esc});
}
function nodeDefaultTitle(node) {
  return CanvasNodes.nodeDefaultTitle(node);
}
function nodeDisplayTitle(node) {
  return CanvasNodes.nodeDisplayTitle(node);
}
function nodeFloatToolbar(kind) {
  return UIRenderHelpers.nodeFloatToolbar(kind);
}
// One model dropdown per media node: models grouped by API service (optgroup).
// Each option value is JSON [providerId, model]; an empty providerId follows the global service.
const MODEL_PICKER_CUSTOM = '__custom_model__';
function modelPickerValue(providerId = '', model = '') {
  return JSON.stringify([String(providerId || ''), String(model || '')]);
}
function parseModelPickerValue(value) {
  try {
    const [providerId = '', model = ''] = JSON.parse(value);
    return {providerId: String(providerId), model: String(model)};
  } catch {
    return null;
  }
}
function modelPickerHtml(node, kind = 'image') {
  const {globalProviderName = '', globalModel = '', groups = []} = modelPickerGroups?.(kind) || {};
  const providerId = String(node?.data?.providerId || '');
  const model = String(node?.data?.model || '');
  const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
  const followModel = providerId ? '' : model;
  const html = [option(modelPickerValue('', followModel), ['跟随全局', followModel || globalModel || globalProviderName].filter(Boolean).join(' · '), !providerId)];
  groups.forEach(group => {
    const selectedModel = group.providerId === providerId ? model || group.defaultModel : '';
    const models = unique([...group.models, selectedModel].filter(Boolean));
    html.push(`<optgroup label="${esc(group.label)}">${models.map(item => option(modelPickerValue(group.providerId, item), item, item === selectedModel)).join('')}</optgroup>`);
  });
  // Keep a pick whose service no longer lists models of this kind visible instead of silently showing 跟随全局.
  if (providerId && model && !groups.some(group => group.providerId === providerId)) {
    html.push(`<optgroup label="当前选择">${option(modelPickerValue(providerId, model), model, true)}</optgroup>`);
  }
  html.push(option(MODEL_PICKER_CUSTOM, '自定义模型 ID…', false));
  return html.join('');
}
function modelCapabilityProfile(node, kind = node?.type || 'image') {
  if (!ModelCapabilities || !node) return null;
  const provider = currentProviderForNode(node, kind);
  const modelId = String(node.data.model || (kind === 'video' ? provider?.videoModel : provider?.imageModel) || '');
  return ModelCapabilities.resolveProfile({provider, modelId, kind});
}
function optionListHtml(items, current, labelFor) {
  const normalizedCurrent = String(current ?? '');
  const values = unique(items.map(value => String(value)));
  if (normalizedCurrent && !values.includes(normalizedCurrent)) values.unshift(normalizedCurrent);
  return values.map(value => {
    const unsupported = value === normalizedCurrent && !items.map(item => String(item)).includes(value);
    const label = labelFor(value) + (unsupported ? ' · 当前模型不支持' : '');
    return `<option value="${esc(value)}">${esc(label)}</option>`;
  }).join('');
}
function imageAspectOptionsHtml(node) {
  const profile = modelCapabilityProfile(node, 'image');
  const allowed = profile?.outputs?.image?.aspects || (MediaDimensions?.ASPECT_PRESETS || []).map(item => item.value).concat('custom');
  return optionListHtml(allowed, node.data.aspect || '16:9', value => value === 'custom' ? '自定义' : value);
}
function imageResolutionOptionsHtml(node) {
  const profile = modelCapabilityProfile(node, 'image');
  const allowed = profile?.outputs?.image?.resolutions || ['1K', '2K', '4K'];
  return optionListHtml(allowed, node.data.resolution || '1K', value => value);
}
const COMPOSER_PRESETS = {
  mark: ['主体居中', '特写', '全身', '三分法', '留白', '低机位'],
  style: ['电影感', '写实', '二次元', '赛博朋克', '水墨', '3D渲染'],
  mood: ['史诗', '温暖', '压抑', '浪漫', '紧张', '空灵']
};
const COMPOSER_FIELDS = {mark: 'markTag', style: 'styleTag', mood: 'moodTag'};
function composerTabButtonHtml(kind, label, current) {
  return `<button type="button" class="composer-tab${current ? ' on' : ''}" data-composer-tab="${esc(kind)}" data-tab-label="${esc(label)}" role="tab">${esc(current ? `${label}·${current}` : label)}</button>`;
}
function composerPresetPaneHtml(kind, current) {
  const field = COMPOSER_FIELDS[kind];
  const items = COMPOSER_PRESETS[kind] || [];
  return `<div class="composer-pane composer-presets hidden" data-composer-pane="${esc(kind)}">${items.map(value =>
    `<button type="button" class="composer-pick${current === value ? ' on' : ''}" data-composer-set="${esc(field)}" data-value="${esc(value)}">${esc(value)}</button>`
  ).join('')}</div>`;
}
function selectComposerTab(root, kind) {
  root?.querySelectorAll('[data-composer-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.composerTab === kind));
  root?.querySelectorAll('[data-composer-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.composerPane !== kind));
}
function imageCostLabel(node) {
  const profile = modelCapabilityProfile(node, 'image');
  const estimate = ModelCapabilities?.estimateCost?.(profile, {
    count: node?.data?.count || 1,
    resolution: node?.data?.resolution || '1K',
    aspect: node?.data?.aspect || '',
    references: node?.data?.references || []
  });
  if (!estimate) return '';
  return ModelCapabilities.formatEstimate(estimate);
}
function updateImageComposerSummary(node) {
  if (!node?.el || node.type !== 'image') return;
  const cost = node.el.querySelector('[data-cost-estimate]');
  if (cost) {
    const label = imageCostLabel(node);
    cost.textContent = label ? `⚡ ${label}` : '';
    cost.classList.toggle('hidden', !label);
  }
  node.el.querySelectorAll('[data-composer-tab][data-tab-label]').forEach(tab => {
    const value = node.data[COMPOSER_FIELDS[tab.dataset.composerTab]] || '';
    tab.classList.toggle('on', !!value);
    tab.textContent = value ? `${tab.dataset.tabLabel}·${value}` : tab.dataset.tabLabel;
  });
  node.el.querySelectorAll('[data-composer-set]').forEach(btn => {
    btn.classList.toggle('on', String(node.data[btn.dataset.composerSet] || '') === btn.dataset.value);
  });
}
function videoSizeOptionsHtml(node) {
  const profile = modelCapabilityProfile(node, 'video');
  const allowed = [...(profile?.outputs?.video?.sizes || (MediaDimensions?.VIDEO_PRESETS || []).map(item => item.value))];
  if (!allowed.includes('custom')) allowed.push('custom');
  const presets = new Map((MediaDimensions?.VIDEO_PRESETS || []).map(item => [item.value, item.label]));
  return optionListHtml(allowed, node.data.size || '1280x720', value => presets.get(value) || value.replace('x', ' × '));
}
function videoDurationOptionsHtml(node) {
  const profile = modelCapabilityProfile(node, 'video');
  const allowed = profile?.outputs?.video?.durations || [5, 8, 10, 15];
  return optionListHtml(allowed, node.data.duration || '5', value => `${value}秒`);
}
function videoOperationOptionsHtml(node) {
  const profile = modelCapabilityProfile(node, 'video');
  const available = VideoDirector?.availableOperations(profile) || [{id: 'text-to-video', label: '文生视频'}];
  const current = VideoDirector?.normalizeOperation(node.data.operation, node.data.mode) || node.data.operation || 'text-to-video';
  const values = available.map(item => item.id);
  const options = available.map(item => `<option value="${esc(item.id)}"${item.id === current ? ' selected' : ''}>${esc(item.label)}</option>`);
  if (current && !values.includes(current)) {
    const label = VideoDirector?.operationDefinition(current)?.label || current;
    options.unshift(`<option value="${esc(current)}" selected disabled>${esc(label)} · 当前模型不支持</option>`);
  }
  return options.join('');
}
function videoOperationHelp(node) {
  const operation = VideoDirector?.normalizeOperation(node.data.operation, node.data.mode) || 'text-to-video';
  return ({
    'text-to-video': '只需描述镜头内容；参考图可选。',
    'image-to-video': '连接一张图片作为首帧或参考。',
    'first-last-frame': '分别指定首帧和尾帧。',
    keyframes: '为两张以上关键帧填写时间位置。',
    edit: '连接原视频，只修改明确指定的内容。',
    stylize: '连接原视频和风格参考。',
    'local-edit': '连接原视频，并描述要修改的局部。',
    'extend-forward': '从原视频结尾向后续写。',
    'extend-backward': '在原视频开头之前补充内容。',
    loop: '连接原视频，生成首尾无缝衔接版本。'
  })[operation] || '根据模型能力准备素材。';
}
function videoKeyframeTimelineHtml(node) {
  const timeline = VideoDirector?.keyframeTimeline(node.data.references, node.data.duration) || [];
  if (!timeline.length) return '<span>连接图片并设为首帧、尾帧或关键帧后，可在这里调整时间。</span>';
  const duration = Math.max(0.1, Number(node.data.duration) || 5);
  return timeline.map((item, index) => {
    const time = Number(item.frameTime || 0);
    const left = Math.max(0, Math.min(100, time / duration * 100));
    return `<div class="video-keyframe-marker" style="--keyframe-left:${left}%" title="${esc(ReferenceRoles?.roleLabel(item.role) || item.role)} · ${time.toFixed(2)}秒"><i class="fa-solid fa-diamond"></i><strong>${index + 1}</strong><span>${time.toFixed(2)}s</span></div>`;
  }).join('');
}
function updateVideoDirectorControls(node) {
  if (!node?.el || node.type !== 'video') return;
  const profile = modelCapabilityProfile(node, 'video');
  const available = VideoDirector?.availableOperations(profile) || [];
  const select = node.el.querySelector('[data-field="operation"]');
  const current = VideoDirector?.normalizeOperation(node.data.operation, node.data.mode) || 'text-to-video';
  if (select) {
    select.innerHTML = videoOperationOptionsHtml(node);
    select.value = current;
  }
  const help = node.el.querySelector('[data-operation-help]');
  if (help) help.textContent = videoOperationHelp(node);
  const timeline = node.el.querySelector('[data-keyframe-timeline]');
  if (timeline) {
    const show = current === 'keyframes' || current === 'first-last-frame';
    timeline.classList.toggle('hidden', !show);
    timeline.innerHTML = show ? videoKeyframeTimelineHtml(node) : '';
  }
  const summary = node.el.querySelector('[data-video-request-summary]');
  if (summary && VideoDirector) {
    const request = {operation: current, size: node.data.size, duration: node.data.duration, speed: node.data.speed, references: node.data.references};
    const estimate = ModelCapabilities?.estimateCost(profile, request) || null;
    const result = VideoDirector.requestSummary({request, profile, estimate});
    // Only problems are shown here; the price sits next to the send button like the image composer.
    summary.textContent = result.issues.join('\n');
    summary.classList.toggle('hidden', !result.issues.length);
    summary.classList.toggle('has-issues', !result.valid);
    const cost = node.el.querySelector('[data-cost-estimate]');
    if (cost) {
      const label = estimate ? ModelCapabilities.formatEstimate(estimate) : '';
      cost.textContent = label ? `⚡ ${label}` : '';
      cost.classList.toggle('hidden', !label);
    }
  }
  const supportedIds = available.map(item => item.id);
  node.el.classList.toggle('video-operation-unsupported', current && !supportedIds.includes(current));
}
function ensureSupportedVideoOperation(node) {
  if (!node || node.type !== 'video' || !VideoDirector) return;
  const profile = modelCapabilityProfile(node, 'video');
  const available = VideoDirector.availableOperations(profile);
  const current = VideoDirector.normalizeOperation(node.data.operation, node.data.mode);
  if (!available.length || available.some(item => item.id === current)) return;
  const previous = VideoDirector.operationDefinition(current)?.label || current;
  node.data.operationNotice = `当前模型不支持“${previous}”，没有修改当前选择，也没有发送请求。请选择受支持的操作后再运行。`;
}
function modelCapabilitySummary(node, kind = node?.type || 'image') {
  const profile = modelCapabilityProfile(node, kind);
  return ModelCapabilities?.profileSummary(profile) || '能力档案不可用';
}
function refreshNodeCapabilityControls(node) {
  if (!node?.el || (node.type !== 'image' && node.type !== 'video')) return;
  if (node.type === 'image') {
    const aspect = node.el.querySelector('[data-field="aspect"]');
    const resolution = node.el.querySelector('[data-field="resolution"]');
    if (aspect) {
      aspect.innerHTML = imageAspectOptionsHtml(node);
      aspect.value = node.data.aspect || '16:9';
    }
    if (resolution) {
      resolution.innerHTML = imageResolutionOptionsHtml(node);
      resolution.value = node.data.resolution || '1K';
    }
    updateImageCustomSizeControls(node);
    updateImageComposerSummary(node);
  } else {
    const size = node.el.querySelector('[data-field="size"]');
    const duration = node.el.querySelector('[data-field="duration"]');
    if (size) {
      size.innerHTML = videoSizeOptionsHtml(node);
      size.value = node.data.size || '1280x720';
    }
    if (duration) {
      duration.innerHTML = videoDurationOptionsHtml(node);
      duration.value = node.data.duration || '5';
    }
    updateVideoCustomSizeControls(node);
    updateVideoDirectorControls(node);
  }
  const summary = node.el.querySelector('[data-capability-summary]');
  if (summary) {
    const profile = modelCapabilityProfile(node, node.type);
    summary.textContent = ModelCapabilities?.profileSummary(profile) || '能力档案不可用';
    summary.classList.toggle('unconfirmed', profile?.source?.kind === 'safe-default');
    summary.classList.toggle('retired', profile?.lifecycle?.status === 'retired');
  }
}
function refreshNodeModelSelects() {
  host.nodes.forEach(node => {
    if (node.type !== 'image' && node.type !== 'video') return;
    const picker = node.el.querySelector('[data-model-picker]');
    if (!picker) return;
    picker.innerHTML = modelPickerHtml(node, node.type);
    syncModelPickerTitle(picker);
    refreshNodeCapabilityControls(node);
  });
}
// The pill may ellipsize a long label, so the full choice stays readable on hover.
function syncModelPickerTitle(picker) {
  picker.title = picker.selectedOptions[0]?.textContent || '模型';
}
async function applyModelPick(node, picker) {
  let pick = parseModelPickerValue(picker.value);
  if (picker.value === MODEL_PICKER_CUSTOM) {
    const model = String(await openModal({title: '自定义模型 ID', value: node.data.model || '', okText: '使用'}) || '').trim();
    pick = model ? {providerId: currentProviderForNode(node, node.type).id || '', model} : null;
  }
  if (pick) {
    node.data.providerId = pick.providerId;
    node.data.model = node.type === 'image' && pick.model ? normalizeKnownImageModelAlias(pick.model, currentProviderForNode(node, 'image')) : pick.model;
  }
  refreshNodeModelSelects();
  ensureSupportedVideoOperation(node);
  refreshNodeCapabilityControls(node);
  applyNodeMediaLayout(node);
  if (node.type === 'image') {
    updateImageComposerSummary(node);
    refreshImageReferences(node);
  }
  applyCanvasFilters();
  queueSave();
}
function removeReference(node, key) {
  if (key === '__manual_ref__') {
    ['refUrl', 'manualRefUrl', 'manualRefMime', 'manualRefSizeBytes', 'manualRefName'].forEach(field => { node.data[field] = ''; });
  } else {
    host.edges = host.edges.filter(edge => !(edge.from === key && edge.to === node.id && edge.toPort === 'ref'));
  }
  node.data.references = (node.data.references || []).filter(item => item.key !== key);
  node.data.refOrder = (node.data.refOrder || []).filter(item => item !== key);
  hydrateNode(node);
  drawEdges();
  saveProject();
}
function bindNode(node) {
  const el = node.el;
  const modelPicker = el.querySelector('[data-model-picker]');
  if (modelPicker) syncModelPickerTitle(modelPicker);
  el.addEventListener('wheel', e => {
    const control = e.target.closest('select,input[type="number"]');
    if (!control || document.activeElement !== control) return;
    e.preventDefault();
    control.blur();
  }, {passive: false});
  el.addEventListener('keydown', e => {
    const port = e.target.closest('.port');
    if (!port || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    portClick(node, port);
  });
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('[data-remove-ref],[data-ref-strength],[data-ref-sheet]')) return;
    const refThumb = e.target.closest('.ref-thumb');
    if (refThumb) return startReferenceSort(e, node, refThumb);
    const port = e.target.closest('.port');
    if (port) return startPortDrag(e, node, port);
    if (isNodeInteractiveTarget(e.target) && !isNodeDragSurface(node, e.target)) return;
    if (e.button !== 0) return;
    beginNodeDrag(node, e, e.pointerId);
    e.preventDefault();
  });
  el.addEventListener('mousedown', e => {
    if (host.dragging || e.button !== 0) return;
    if (e.target.closest('.ref-thumb,.port')) return;
    if (isNodeInteractiveTarget(e.target) && !isNodeDragSurface(node, e.target)) return;
    beginNodeDrag(node, e, null);
    e.preventDefault();
  });
  el.addEventListener('input', e => {
    if (e.target.matches('[data-reference-time]')) return;
    const field = e.target.dataset.field;
    if (!field) return;
    node.data[field] = e.target.value;
    syncMediaSelection(node, field);
    if ((node.type === 'image' || node.type === 'video') && ['aspect', 'size', 'customWidth', 'customHeight', 'resolution'].includes(field)) {
      applyNodeMediaLayout(node);
    }
    if (node.type === 'video' && ['operation', 'duration', 'speed'].includes(field)) updateVideoDirectorControls(node);
    if (node.type === 'media-tool' && field === 'operation') updateMediaToolFields(node);
    if (node.type === 'image') updateImageComposerSummary(node);
    applyCanvasFilters();
    queueSave({coalesce: `${node.id}:${field}`});
  });
  el.addEventListener('change', e => {
    if (e.target.matches('[data-reference-time]')) {
      updateReferenceFrameTime(node, e.target.dataset.refKey, e.target.value);
      return;
    }
    if (e.target.matches('[data-reference-role]')) {
      updateReferenceRole(node, e.target.dataset.refKey, e.target.value);
      return;
    }
    if (e.target.matches('[data-model-picker]')) {
      applyModelPick(node, e.target);
      return;
    }
    const field = e.target.dataset.field;
    if (field) node.data[field] = e.target.value;
    if (node.type === 'video' && field === 'operation') {
      node.data.operation = VideoDirector?.normalizeOperation(node.data.operation, node.data.mode) || node.data.operation;
      node.data.mode = node.data.operation === 'image-to-video' ? 'image' : node.data.operation === 'text-to-video' ? 'text' : 'auto';
      node.data.operationNotice = '';
      node.data.references = VideoDirector?.ensureKeyframeTimes(node.data.references, node.data.duration) || node.data.references;
    }
    if (node.type === 'video' && field === 'duration') node.data.references = VideoDirector?.ensureKeyframeTimes(node.data.references, node.data.duration) || node.data.references;
    syncMediaSelection(node, field);
    if ((node.type === 'image' || node.type === 'video') && ['aspect', 'size', 'customWidth', 'customHeight', 'resolution'].includes(field)) {
      applyNodeMediaLayout(node);
    }
    if (node.type === 'video' && ['operation', 'duration', 'speed'].includes(field)) {
      updateVideoDirectorControls(node);
      renderReferenceBox(node.el.querySelector('[data-refbox]'), getResolvedImageRefItems(node.id, node.data.manualRefUrl || ''), 'video');
    }
    if (node.type === 'media-tool' && field === 'operation') updateMediaToolFields(node);
    if (node.type === 'image') updateImageComposerSummary(node);
    if (e.target.matches('[data-upload]')) readUpload(node, e.target.files[0]);
    if (e.target.matches('[data-comfy-file]')) importComfyWorkflowIntoNode(node, e.target.files[0], e.target);
    applyCanvasFilters();
    queueSave();
  });
  el.addEventListener('click', e => {
    const port = e.target.closest('.port');
    if (port) return portClick(node, port);
    closeNodeContextMenu();
    const quick = e.target.closest('[data-quick]');
    if (quick) return runNodeContextAction(node, quick.dataset.quick);
    if (e.target.closest('[data-favorite]')) return toggleNodeFavorite(node.id);
    if (e.target.closest('[data-tags]')) return editNodeTags(node.id);
    if (e.target.closest('[data-rename]')) return renameNode(node.id);
    if (e.target.closest('[data-del]')) return runNodeContextAction(node, 'delete');
    if (e.target.closest('[data-dup]')) return runNodeContextAction(node, 'copy');
    const historyStep = e.target.closest('[data-history-step]');
    if (historyStep) return stepOutputHistory(node, Number(historyStep.dataset.historyStep));
    if (e.target.closest('[data-clear]')) { node.data.prompt = ''; hydrateNode(node); applyCanvasFilters(); saveProject(); return; }
    if (e.target.closest('[data-run="prompt"]')) return runPrompt(node.id);
    const composerTab = e.target.closest('[data-composer-tab]');
    if (composerTab) return selectComposerTab(el, composerTab.dataset.composerTab);
    if (e.target.closest('[data-composer-close]')) {
      host.selectedNodes.delete(node.id);
      renderSelection();
      return;
    }
    if (e.target.closest('[data-composer-set]')) {
      const pick = e.target.closest('[data-composer-set]');
      const field = pick.dataset.composerSet;
      const value = pick.dataset.value;
      node.data[field] = node.data[field] === value ? '' : value;
      updateImageComposerSummary(node);
      saveProject();
      return;
    }
    if (e.target.closest('[data-run="image"]')) {
      // A node that already shows a result keeps it: 重新生成 runs on a new node to its right.
      Promise.resolve(generateImageKeepingOriginal(node)).catch(() => {});
      return;
    }
    if (e.target.closest('[data-run="video"]')) return runVideoKeepingOriginal(node);
    if (e.target.closest('[data-run="comfyui"]')) return runComfyUI(node.id);
    if (e.target.closest('[data-run="media-tool"]')) return runMediaToolKeepingOriginal(node);
    if (e.target.closest('[data-comfy-test]')) return testComfyUI();
    if (e.target.closest('[data-comfy-import]')) return el.querySelector('[data-comfy-file]')?.click();
    if (e.target.closest('[data-comfy-save-global]')) return saveComfyNodeWorkflowGlobal(node);
    if (e.target.closest('[data-comfy-export]')) return exportComfyWorkflowText(node.data.workflowJson || $('comfyWorkflowJson')?.value || '', node.data.workflowName || 'comfyui-workflow');
    if (e.target.closest('[data-comfy-refresh]')) { hydrateNode(node); saveProject(); return toast('ComfyUI workflow 结构已刷新', 'success'); }
    if (e.target.closest('[data-optimize-prompt]')) return optimizePrompt(node.id);
    if (e.target.closest('[data-upload-btn]')) return el.querySelector('[data-upload]').click();
    const removeRef = e.target.closest('[data-remove-ref]');
    if (removeRef) return removeReference(node, removeRef.dataset.refKey);
    const strengthBtn = e.target.closest('[data-ref-strength]');
    if (strengthBtn) return updateReferenceStrength(node, strengthBtn.dataset.refKey, strengthBtn.dataset.refStrength);
    const sheetBtn = e.target.closest('[data-ref-sheet]');
    if (sheetBtn) return markReferenceCharacterSheet(node, sheetBtn.dataset.refKey);
    if (e.target.closest('[data-open-ref]')) return;
    if (e.target.closest('[data-safe]')) {
      // Offered only inside a content-safety error message.
      node.data.prompt = softenPrompt(node.data.prompt);
      delete node.data.statusSafety;
      hydrateNode(node);
      saveProject();
      toast('已改写为更安全的表达，可再次生成', 'success');
      return;
    }
    const variantThumb = e.target.closest('[data-select-variant]');
    if (variantThumb) {
      const urls = imagePreviewUrls(node);
      const next = urls[Number(variantThumb.dataset.selectVariant)];
      if (next && node.data.url !== next) {
        node.data.url = next;
        hydrateNode(node);
        refreshDownstreamLinkedInputs(node.id);
        saveProject();
      }
      selectSingleNode(node.id);
      return;
    }
    if (e.target.closest('[data-download-media]')) return downloadMedia(node.data.url, safeDownloadName(node));
    if (!isSelectionToggle(e)) selectSingleNode(node.id);
  });
  el.addEventListener('dblclick', e => {
    if (e.target.closest('.node-title')) {
      e.preventDefault();
      e.stopPropagation();
      return renameNode(node.id);
    }
    if (e.target.closest('[data-open-ref]')) {
      const refs = getResolvedImageRefs(node.id, node.data.manualRefUrl || '');
      openMediaUrl(refs[Number(e.target.closest('[data-open-ref]').dataset.refIndex) || 0] || node.data.manualRefUrl || '');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isNodeInteractiveTarget(e.target) && !e.target.closest('[data-preview]')) return;
    if (node.type === 'image' || node.type === 'video' || node.type === 'upload' || node.type === 'media-tool') {
      openMediaViewer(node);
      e.preventDefault();
      e.stopPropagation();
    }
  });
  el.addEventListener('contextmenu', e => {
    if (isEditableField(e.target)) return;
    e.preventDefault();
    showNodeContextMenu(node, e.clientX, e.clientY);
  });
}
// Shift/Ctrl-click adds a node to the selection, or takes a selected one out again.
function isSelectionToggle(e) {
  return !!(e.shiftKey || e.ctrlKey || e.metaKey);
}
function beginNodeDrag(node, e, pointerId = null) {
  releaseDrags(false);
  if (isSelectionToggle(e)) {
    if (host.selectedNodes.has(node.id)) {
      host.selectedNodes.delete(node.id);
      return renderSelection();
    }
    host.selectedNodes.add(node.id);
    renderSelection();
  } else if (!host.selectedNodes.has(node.id)) selectSingleNode(node.id);
  const dragIds = expandNodeIdsForGroups(host.selectedNodes.has(node.id) ? host.selectedNodes : new Set([node.id]));
  const items = [...dragIds]
    .map(id => host.nodes.get(id))
    .filter(item => item && !item.data.locked)
    .map(item => ({node: item, startX: item.x, startY: item.y}));
  host.dragging = {node, items, x: e.clientX, y: e.clientY, pointerId};
  document.body.style.cursor = 'grabbing';
  try {
    if (pointerId != null && node.el.setPointerCapture) node.el.setPointerCapture(pointerId);
  } catch (err) {
    host.dragging.pointerId = null;
  }
}
function isEditableField(target) {
  return !!target?.closest?.('input,textarea,select,[contenteditable="true"]');
}
function isNodeInteractiveTarget(target) {
  return !!target.closest('button,input,textarea,select,option,a,video,.port,.node-actions,.node-composer,.node-float-toolbar,.text-expand-btn,[data-zoom]');
}
function isNodeDragSurface(node, target) {
  if (!node || (node.type !== 'image' && node.type !== 'video' && node.type !== 'upload' && node.type !== 'comfyui')) return false;
  if (target.closest('.ref-box,.node-composer,.node-float-toolbar,.node-actions')) return false;
  return !!target.closest('[data-preview],.image-preview,.upload-preview,[data-zoom]');
}
function selectSingleNode(id) {
  host.selectedNodes.clear();
  host.selectedNodes.add(id);
  renderSelection();
}
function selectAllCanvasNodes() {
  host.selectedNodes.clear();
  host.nodes.forEach((_, id) => host.selectedNodes.add(id));
  renderSelection();
  toast(host.selectedNodes.size ? '已全选画布节点：' + host.selectedNodes.size + ' 个' : '当前画布没有可选节点', host.selectedNodes.size ? 'success' : 'warn');
}
function clearCanvasSearch(updateInputs = true) {
  host.canvasSearchQuery = '';
  host.canvasTypeFilter = 'all';
  host.canvasFavoritesOnly = false;
  if (updateInputs) {
    if ($('canvasSearchInput')) $('canvasSearchInput').value = '';
    if ($('canvasTypeFilter')) $('canvasTypeFilter').value = 'all';
  }
  applyCanvasFilters();
}
function canvasSearchText(node) {
  return CanvasNodes.canvasSearchText(node);
}
function nodeMatchesCanvasFilters(node) {
  if (!node) return false;
  if (host.canvasTypeFilter !== 'all' && node.type !== host.canvasTypeFilter) return false;
  if (host.canvasFavoritesOnly && !node.data?.favorite) return false;
  const query = String(host.canvasSearchQuery || '').trim().toLowerCase();
  if (!query) return true;
  return query.split(/\s+/).filter(Boolean).every(term => canvasSearchText(node).includes(term));
}
function applyCanvasFilters() {
  let visible = 0;
  const total = host.nodes.size;
  const queryActive = !!String(host.canvasSearchQuery || '').trim();
  host.nodes.forEach(node => {
    node.data = normalizeNodeMetadata(node.data || {});
    const match = nodeMatchesCanvasFilters(node);
    if (match) visible++;
    node.el?.classList.toggle('search-hidden', !match);
    node.el?.classList.toggle('search-match', match && queryActive);
    node.el?.classList.toggle('favorite-node', !!node.data.favorite);
  });
  const count = $('canvasSearchCount');
  if (count) count.textContent = `${visible}/${total}`;
  $('canvasFavoritesOnly')?.classList.toggle('active', host.canvasFavoritesOnly);
  $('canvasSearchBtn')?.classList.toggle('active', queryActive || host.canvasTypeFilter !== 'all' || host.canvasFavoritesOnly);
  drawEdges();
}
function focusCanvasSearchResult() {
  const node = [...host.nodes.values()].find(item => nodeMatchesCanvasFilters(item));
  if (!node) return toast('没有匹配的节点', 'warn');
  selectSingleNode(node.id);
  fitNodeIntoView(node, true);
}
function hydrateNode(node) {
  node.data = normalizeNodeMetadata(node.data || {});
  refreshNodeCapabilityControls(node);
  applyNodeMediaLayout(node);
  const titleEl = node.el.querySelector('[data-title-text]');
  if (titleEl) titleEl.textContent = nodeDisplayTitle(node);
  const metadata = node.el.querySelector('[data-node-metadata]');
  if (metadata) metadata.outerHTML = renderNodeMetadata(node);
  const favoriteBtn = node.el.querySelector('[data-favorite]');
  if (favoriteBtn) {
    favoriteBtn.classList.toggle('active', !!node.data.favorite);
    favoriteBtn.title = node.data.favorite ? '取消收藏' : '收藏节点';
    favoriteBtn.innerHTML = node.data.favorite ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';
  }
  node.el.classList.toggle('favorite-node', !!node.data.favorite);
  node.el.classList.toggle('locked-node', !!node.data.locked);
  if (!host.selectedNodes.has(node.id)) node.el.style.zIndex = CanvasNodes.layerZIndex(node.data);
  node.el.querySelectorAll('[data-field]').forEach(input => {
    const key = input.dataset.field;
    const value = node.data[key] ?? '';
    if (input.value !== String(value)) input.value = value;
  });
  updateMediaSizeSummary(node);
  if (node.type === 'comfyui' && !node.data.workflowJson && $('comfyWorkflowJson')?.value) {
    node.data.workflowJson = $('comfyWorkflowJson').value;
  }
  if (node.type === 'comfyui') {
    const preview = node.el.querySelector('[data-preview]');
    const refbox = node.el.querySelector('[data-refbox]');
    const status = node.el.querySelector('[data-status]');
    const map = node.el.querySelector('[data-workflow-map]');
    if (replacePreviewMedia(preview, 'img', node.data.url, {zoom: true})) {
      preview.classList.remove('has-status', 'is-error', 'is-running');
    } else if (node.data.statusType && node.data.status) {
      preview.innerHTML = imageStatusHtml(node);
      preview.classList.add('has-status');
      preview.classList.toggle('is-error', node.data.statusType === 'error');
      preview.classList.toggle('is-running', node.data.statusType === 'running');
    } else {
      preview.innerHTML = '<div><i class="fa-solid fa-diagram-project"></i><br>暂无 ComfyUI 输出</div>';
      preview.classList.remove('has-status', 'is-error', 'is-running');
    }
    renderReferenceBox(refbox, getResolvedImageRefItems(node.id, ''), 'comfyui');
    if (status) {
      status.textContent = node.data.status || '';
      status.classList.toggle('hidden', !node.data.status);
      status.classList.toggle('error', node.data.statusType === 'error');
    }
    if (map) map.innerHTML = comfyWorkflowMapHtml(node.data.workflowJson || $('comfyWorkflowJson')?.value || '');
    return;
  }
  if (node.type === 'video') {
    const preview = node.el.querySelector('[data-preview]');
    const refbox = node.el.querySelector('[data-refbox]');
    const status = node.el.querySelector('[data-status]');
    const runButton = node.el.querySelector('[data-run="video"]');
    if (runButton && !runButton.disabled) {
      const label = node.data.videoTask ? '继续查询视频' : node.data.url ? '重新生成（新建节点，原视频保留）' : VideoDirector?.operationDefinition(node.data.operation)?.label || '生成视频';
      UIRenderHelpers.setRunButtonBusy(runButton, false, node.data.videoTask ? 'fa-rotate' : 'fa-arrow-up');
      runButton.title = label;
      runButton.setAttribute('aria-label', label);
    }
    const video = replacePreviewMedia(preview, 'video', node.data.url, {controls: true});
    if (!video) {
      preview.innerHTML = '<div><i class="fa-solid fa-video"></i><br>暂无视频</div>';
    } else {
      video.addEventListener('loadedmetadata', () => {
        const actualDuration = Number(video.duration || 0);
        const audioTrack = video.audioTracks?.length > 0 || video.mozHasAudio === true || Number(video.webkitAudioDecodedByteCount || 0) > 0
          ? 'present'
          : node.data.outputMetadata?.audioTrack || 'unknown';
        node.data.outputMetadata = Object.assign({}, node.data.outputMetadata || {}, {
          actualDuration: Number.isFinite(actualDuration) ? Number(actualDuration.toFixed(3)) : null,
          codec: node.data.outputMetadata?.codec || (/\.webm(?:[?#]|$)/i.test(node.data.url || '') ? 'webm' : /\.mp4(?:[?#]|$)/i.test(node.data.url || '') ? 'mp4' : 'unknown'),
          audioTrack
        });
        saveProject();
      }, {once: true});
    }
    renderReferenceBox(refbox, getResolvedImageRefItems(node.id, node.data.manualRefUrl || ''), 'video');
    renderOutputHistoryNav(node);
    updateVideoDirectorControls(node);
    if (status) {
      renderNodeStatus(status, node, node.data.status || node.data.operationNotice || '', true);
    }
    return;
  }
  if (node.type === 'upload') {
    const preview = node.el.querySelector('[data-preview]');
    const url = safeMediaUrl(node.data.url || '');
    if (!url) {
      preview.innerHTML = '<div><i class="fa-solid fa-upload"></i><br>暂无上传素材</div>';
    } else if (isVideoMedia(node.data.mime, url)) {
      replacePreviewMedia(preview, 'video', url, {controls: true, label: node.data.name || '视频素材'});
    } else {
      replacePreviewMedia(preview, 'img', url, {zoom: true, label: node.data.name || '图片素材'});
    }
    return;
  }
  if (node.type === 'media-tool') {
    const preview = node.el.querySelector('[data-preview]');
    const status = node.el.querySelector('[data-status]');
    const refbox = node.el.querySelector('[data-refbox]');
    const url = safeMediaUrl(node.data.url || '');
    if (!url) preview.innerHTML = '<div><i class="fa-solid fa-scissors"></i><br>暂无处理结果</div>';
    else if (/\.(mp4|webm|mov)(?:[?#]|$)/i.test(url)) replacePreviewMedia(preview, 'video', url, {controls: true});
    else if (/\.(m4a|mp3|wav|aac|ogg)(?:[?#]|$)/i.test(url)) preview.innerHTML = `<audio src="${esc(url)}" controls></audio>`;
    else if (/\.(srt|vtt)(?:[?#]|$)/i.test(url)) preview.innerHTML = '<div><i class="fa-solid fa-closed-captioning"></i><br>字幕文件已生成</div>';
    else replacePreviewMedia(preview, 'img', url, {zoom: true});
    if (status) {
      status.textContent = node.data.status || '';
      status.classList.toggle('hidden', !node.data.status);
      status.classList.toggle('error', node.data.statusType === 'error');
    }
    const inputs = Array.isArray(node.data.sourceUrls) ? node.data.sourceUrls : [];
    if (refbox) refbox.textContent = inputs.length ? `已连接 ${inputs.length} 个源素材 · 结果作为新文件输出` : '连接源素材后运行；处理结果是新文件，不覆盖源素材。';
    updateMediaToolFields(node);
    return;
  }
  if (node.type !== 'image') return;
  const preview = node.el.querySelector('[data-preview]');
  const urls = imagePreviewUrls(node);
  const url = urls[0] || '';
  preview?.classList.remove('has-variants');
  if (urls.length) {
    preview.classList.remove('has-status', 'is-error', 'is-running');
    if (urls.length === 1) replacePreviewMedia(preview, 'img', urls[0], {zoom: true});
    else renderImageVariantPreview(preview, urls, safeMediaUrl(node.data.url || urls[0]));
  } else if (node.data.statusType && node.data.status) {
    preview.innerHTML = imageStatusHtml(node);
    preview.classList.add('has-status');
    preview.classList.toggle('is-error', node.data.statusType === 'error');
    preview.classList.toggle('is-running', node.data.statusType === 'running');
  } else {
    preview.innerHTML = '<div><i class="fa-solid fa-image"></i><br>暂无图片</div>';
    preview.classList.remove('has-status', 'is-error', 'is-running');
  }
  refreshImageReferences(node);
  renderOutputHistoryNav(node);
  const imageRun = node.el.querySelector('[data-run="image"]');
  if (imageRun) {
    const runLabel = node.data.url || urls.some(Boolean) ? '重新生成（新建节点，原图保留）' : '生成图像 / 图生图';
    imageRun.title = runLabel;
    imageRun.setAttribute('aria-label', runLabel);
  }
  const status = node.el.querySelector('[data-status]');
  if (status) {
    const countLabel = urls.length > 1 ? `${urls.length} 张` : '';
    // Without an output image the preview already shows the status card (and its 安全改写 button).
    renderNodeStatus(status, node, node.data.status || countLabel, urls.length > 0);
  }
  updateImageComposerSummary(node);
}
function renderNodeStatus(status, node, text, allowSafetyAction) {
  status.textContent = text;
  if (allowSafetyAction && node.data.statusType === 'error' && node.data.statusSafety) status.insertAdjacentHTML('beforeend', UIRenderHelpers.safetyRewriteButtonHtml());
  status.classList.toggle('hidden', !text);
  status.classList.toggle('error', node.data.statusType === 'error');
}

function imagePreviewUrls(node) {
  const seen = new Set();
  const list = [];
  const add = value => {
    const url = safeMediaUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    list.push(url);
  };
  if (Array.isArray(node?.data?.urls)) node.data.urls.forEach(add);
  add(node?.data?.url);
  return list.slice(0, 4);
}

function renderImageVariantPreview(preview, urls, activeUrl) {
  if (!preview) return;
  preview.classList.add('has-variants');
  preview.replaceChildren();
  urls.forEach((url, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-variant-thumb' + (url === activeUrl ? ' is-active' : '');
    button.dataset.selectVariant = String(index);
    button.dataset.zoom = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = `第 ${index + 1} 张`;
    const badge = document.createElement('span');
    badge.textContent = `${index + 1}/${urls.length}`;
    button.append(img, badge);
    preview.appendChild(button);
    trackMediaPersistence(button, img, url, 'img');
  });
}

function replacePreviewMedia(preview, tagName, value, {controls = false, zoom = false, label = ''} = {}) {
  const url = safeMediaUrl(value);
  if (!preview || !url || !['img', 'video'].includes(tagName)) return null;
  const media = document.createElement(tagName);
  media.src = url;
  if (tagName === 'video') media.controls = controls;
  if (zoom) media.dataset.zoom = '';
  preview.replaceChildren(media);
  if (label) {
    const title = document.createElement('strong');
    title.textContent = String(label);
    preview.appendChild(title);
  }
  trackMediaPersistence(preview, media, url, tagName);
  return media;
}
// Remote URLs mean the result is not in <storageDir>/media yet ("未保存", retried
// in the background); a local file that fails to load is shown as missing
// instead of an empty shell.
function trackMediaPersistence(container, media, url, tagName) {
  container.classList.remove('media-missing');
  if (/^https?:/i.test(url)) {
    const badge = document.createElement('span');
    badge.className = 'media-unsaved-badge';
    badge.title = '该结果仍是远程链接，尚未保存到本地存储目录，正在自动重试';
    badge.textContent = '未保存';
    container.appendChild(badge);
  }
  media.addEventListener('error', () => {
    const missing = document.createElement('div');
    missing.className = 'media-missing-state';
    // The node and its stored reference are kept; 重新定位 lets the user point it at the file.
    missing.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>${tagName === 'video' ? '视频文件找不到' : '图片文件找不到'}</span>`;
    missing.title = String(url);
    const relocate = document.createElement('span');
    relocate.className = 'media-relocate-btn';
    relocate.setAttribute('role', 'button');
    relocate.tabIndex = 0;
    relocate.textContent = '重新定位';
    const fire = event => {
      event.preventDefault();
      event.stopPropagation();
      const nodeId = container.closest('.node')?.dataset.node || '';
      document.dispatchEvent(new CustomEvent('futureai:media-relocate', {detail: {url: String(url), nodeId, kind: tagName === 'video' ? 'video' : 'image'}}));
    };
    relocate.addEventListener('pointerdown', event => event.stopPropagation());
    relocate.addEventListener('click', fire);
    relocate.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') fire(event); });
    missing.appendChild(relocate);
    container.classList.add('media-missing');
    media.replaceWith(missing);
  }, {once: true});
}
function mediaAspectRatio(node) {
  if (!node || (node.type !== 'image' && node.type !== 'video')) return 1;
  return MediaDimensions?.mediaAspectRatio(node.data, node.type) || 1;
}
function syncMediaSelection(node, field) {
  if (!node || !MediaDimensions) return;
  if (node.type === 'image') {
    if (field === 'customWidth' || field === 'customHeight') {
      node.data.aspect = 'custom';
      node.data.size = 'custom';
      const aspectControl = node.el.querySelector('[data-field="aspect"]');
      if (aspectControl) aspectControl.value = 'custom';
    } else if (field === 'aspect' || field === 'resolution') {
      node.data.aspect = String(node.data.aspect || '') === 'custom' ? 'custom' : MediaDimensions.normalizeAspect(node.data.aspect, '16:9');
      node.data.size = node.data.aspect === 'custom' ? 'custom' : MediaDimensions.imageSizeForResolution(node.data.aspect, node.data.resolution || '1K');
    }
    updateImageCustomSizeControls(node);
  } else if (node.type === 'video' && ['size', 'customWidth', 'customHeight'].includes(field)) {
    if (field === 'customWidth' || field === 'customHeight') node.data.size = 'custom';
    else if (node.data.size !== 'custom') node.data.size = MediaDimensions.videoTargetSize(node.data);
    updateVideoCustomSizeControls(node);
  }
  updateMediaSizeSummary(node);
}
function updateImageCustomSizeControls(node) {
  if (!node?.el || node.type !== 'image') return;
  const container = node.el.querySelector('[data-image-custom-size]');
  const custom = String(node.data.aspect || '') === 'custom';
  container?.classList.toggle('hidden', !custom);
  const width = container?.querySelector('[data-field="customWidth"]');
  const height = container?.querySelector('[data-field="customHeight"]');
  if (width && width.value !== String(node.data.customWidth ?? '')) width.value = node.data.customWidth ?? '';
  if (height && height.value !== String(node.data.customHeight ?? '')) height.value = node.data.customHeight ?? '';
}
function updateVideoCustomSizeControls(node) {
  if (!node?.el || node.type !== 'video') return;
  const container = node.el.querySelector('[data-video-custom-size]');
  const select = node.el.querySelector('[data-field="size"]');
  const custom = String(node.data.size || '') === 'custom';
  container?.classList.toggle('hidden', !custom);
  if (select && select.value !== String(node.data.size || '')) select.value = node.data.size || '1280x720';
  const width = container?.querySelector('[data-field="customWidth"]');
  const height = container?.querySelector('[data-field="customHeight"]');
  if (width && width.value !== String(node.data.customWidth ?? '')) width.value = node.data.customWidth ?? '';
  if (height && height.value !== String(node.data.customHeight ?? '')) height.value = node.data.customHeight ?? '';
}
function updateMediaSizeSummary(node) {
  const summary = node?.el?.querySelector?.('[data-size-summary]');
  if (!summary || !MediaDimensions) return;
  if (node.type === 'image') {
    const target = MediaDimensions.imageTargetSize(node.data);
    const aspect = target ? MediaDimensions.sizeAspectLabel(target) : '';
    if (!target) {
      summary.textContent = '请填写有效的自定义宽高';
      return;
    }
    summary.textContent = `输出目标 ${target.replace('x', ' × ')} · ${aspect}`;
    return;
  }
  if (node.type === 'video') {
    const requested = MediaDimensions.videoTargetSize(node.data);
    if (!requested) {
      summary.textContent = 'Please enter a valid custom video width and height';
      return;
    }
    const requestedAspect = MediaDimensions.sizeAspectLabel(requested);
    summary.textContent = `请求尺寸 ${requested.replace('x', ' × ')} · ${requestedAspect}`;
  }
}
function applyNodeMediaLayout(node) {
  if (!node?.el || (node.type !== 'image' && node.type !== 'video')) return;
  const sync = width => {
    const ratio = mediaAspectRatio(node);
    const previewHeight = Math.max(160, Math.round(width / ratio));
    node.el.style.setProperty('--node-media-ratio', String(ratio));
    node.el.style.setProperty('--node-preview-height', `${previewHeight}px`);
    const preview = node.el.querySelector('[data-preview]');
    preview?.style.setProperty('--node-media-ratio', String(ratio));
    preview?.style.setProperty('--node-preview-height', `${previewHeight}px`);
  };
  const width = node.el.offsetWidth || Number.parseFloat(getComputedStyle(node.el).width) || 430;
  sync(width);
  updateMediaSizeSummary(node);
  if (node.type === 'image') updateImageCustomSizeControls(node);
  if (!node.mediaLayoutObserver && typeof ResizeObserver === 'function') {
    node.mediaLayoutWidth = Math.round(width);
    node.mediaLayoutObserver = new ResizeObserver(entries => {
      const nextWidth = Math.round(entries[0]?.contentRect?.width || node.el.offsetWidth || 0);
      if (!nextWidth || nextWidth === node.mediaLayoutWidth) return;
      node.mediaLayoutWidth = nextWidth;
      sync(nextWidth);
      scheduleDrawEdges();
      scheduleVisibilityUpdate();
    });
    node.mediaLayoutObserver.observe(node.el);
  }
  scheduleDrawEdges();
  scheduleVisibilityUpdate();
}
function deleteNode(id, commit = true) {
  const node = host.nodes.get(id);
  if (!node) return;
  const affectedTargets = host.edges.filter(e => e.from === id && e.toPort === 'ref').map(e => e.to);
  node.mediaLayoutObserver?.disconnect();
  node.el.remove();
  host.nodes.delete(id);
  host.selectedNodes.delete(id);
  removeNodeFromGroups(id);
  host.edges = host.edges.filter(e => e.from !== id && e.to !== id);
  refreshLinkedInputTargets(affectedTargets);
  applyCanvasFilters();
  if (commit) {
    drawEdges();
    saveProject();
    renderSelection();
  }
}
// Copies nodes (and the wires between them) offset by 42px, selects the copies, one save / undo step.
function duplicateNodes(ids) {
  const sources = unique(ids).map(id => host.nodes.get(id)).filter(Boolean);
  if (!sources.length) return [];
  const copies = new Map();
  sources.forEach(source => {
    const data = JSON.parse(JSON.stringify(source.data));
    delete data.locked;
    copies.set(source.id, addNode(source.type, source.x + 42, source.y + 42, data, null, false));
  });
  host.edges
    .filter(edge => copies.has(edge.from) && copies.has(edge.to))
    .forEach(edge => connectSilently(copies.get(edge.from).id, edge.fromPort, copies.get(edge.to).id, edge.toPort));
  host.selectedNodes.clear();
  copies.forEach(copy => host.selectedNodes.add(copy.id));
  renderSelection();
  saveProject();
  return [...copies.values()];
}
async function renameNode(id) {
  const node = host.nodes.get(id);
  if (!node) return;
  const name = await openModal({title: '重命名节点', value: nodeDisplayTitle(node), okText: '保存'});
  if (!name || !String(name).trim()) return;
  node.data.title = name.trim();
  hydrateNode(node);
  applyCanvasFilters();
  saveProject();
  toast('节点已重命名', 'success');
}
function toggleNodeFavorite(id) {
  const node = host.nodes.get(id);
  if (!node) return;
  node.data.favorite = !node.data.favorite;
  hydrateNode(node);
  applyCanvasFilters();
  saveProject();
  toast(node.data.favorite ? '已收藏节点' : '已取消收藏', 'success');
}
async function editNodeTags(id) {
  const node = host.nodes.get(id);
  if (!node) return;
  const value = normalizeTags(node.data.tags).join(', ');
  const next = await openModal({title: '编辑节点标签', value, okText: '保存'});
  if (next === null) return;
  node.data.tags = normalizeTags(next);
  hydrateNode(node);
  applyCanvasFilters();
  saveProject();
  toast(node.data.tags.length ? '标签已更新' : '标签已清空', 'success');
}
function readUpload(node, file) {
  if (!file) return;
  if (!isSupportedUploadFile(file)) return toast('只支持上传图片或视频文件', 'warn');
  const reader = new FileReader();
  reader.onload = async () => {
    const result = await persistMediaUrl(reader.result, file.name || 'upload', mediaExtFromMime(file.type, file.name));
    if (node.type === 'upload') {
      const fileData = {
        url: result,
        name: file.name || '上传素材',
        mime: file.type || '',
        sizeBytes: Math.max(0, Number(file.size || 0)),
        kind: isVideoMedia(file.type, result) ? 'video' : 'image'
      };
      if (node.data.url) {
        // An upload node that already holds a file keeps it; the newly chosen file gets its own node to the right.
        const next = spawnRight(node, 'upload', fileData);
        hydrateNode(next);
        selectSingleNode(next.id);
        saveProject();
        toast('新素材已放到右侧新节点，原素材保留', 'success');
        return;
      }
      Object.assign(node.data, fileData);
    } else {
      node.data.refUrl = result;
      node.data.manualRefUrl = result;
      node.data.manualRefMime = file.type || '';
      node.data.manualRefSizeBytes = Math.max(0, Number(file.size || 0));
      node.data.manualRefName = file.name || '参考素材';
      if (!node.data.url && node.type !== 'video') node.data.url = result;
    }
    hydrateNode(node);
    refreshDownstreamLinkedInputs(node.id);
    saveProject();
  };
  reader.readAsDataURL(file);
}
function isSupportedUploadFile(file) {
  return MediaUtils.isSupportedUploadFile(file);
}
function isVideoMedia(mime = '', url = '') {
  return MediaUtils.isVideoMedia(mime, url);
}
function safeDownloadName(node) {
  return MediaUtils.safeDownloadName(node);
}
function imageStatusHtml(node) {
  return UIRenderHelpers.imageStatusHtml({node, waitingAnimationSrc: WAITING_ANIMATION_SRC, esc});
}
function imageStatusMessage(status, title = '') {
  return UIRenderHelpers.imageStatusMessage(status, title);
}
function setImageStatus(node, statusType, status = '', statusTitle = '', {safety = false} = {}) {
  if (!node) return;
  if (!statusType) {
    delete node.data.status;
    delete node.data.statusType;
    delete node.data.statusTitle;
  } else {
    node.data.status = status;
    node.data.statusType = statusType;
    node.data.statusTitle = statusTitle;
  }
  // A content-safety failure offers the 安全改写 button inside the status message.
  if (statusType === 'error' && safety) node.data.statusSafety = true;
  else delete node.data.statusSafety;
  hydrateNode(node);
}
function imageErrorTitle(refCount) {
  return refCount > 1 ? '多参考图生图失败' : refCount === 1 ? '图生图失败' : '生成失败';
}
function referenceStrengthHtml(item) {
  const current = ReferenceRoles.STRENGTHS.includes(item.strength) ? item.strength : 'medium';
  const buttons = ReferenceRoles.STRENGTHS.map(strength => {
    const label = ReferenceRoles.strengthLabel(strength);
    return `<button type="button" class="${strength === current ? 'active' : ''}" data-ref-strength="${strength}" data-ref-key="${esc(item.key)}" aria-pressed="${strength === current}" title="参考强度：${label}">${label}</button>`;
  }).join('');
  return `<div class="ref-strength" role="group" aria-label="参考强度">${buttons}</div>`;
}
function referenceSheetButtonHtml(item) {
  const active = item.role === 'character' && item.strength === 'strong';
  return `<button type="button" class="ref-sheet${active ? ' active' : ''}" data-ref-sheet data-ref-key="${esc(item.key)}" title="${active ? '已是角色设定图（角色一致 · 强）' : '设为角色设定图（角色一致 · 强）'}" aria-label="设为角色设定图"><i class="fa-solid fa-user-check"></i></button>`;
}
function referencePreviewHtml(item, label, index = 0, overLimit = false) {
  const isImage = (item.nodeType || 'image') === 'image';
  const options = ReferenceRoles?.rolesForNode(item.nodeType || 'image', item.role) || ['reference'];
  const roleOptions = options.map(role => `<option value="${esc(role)}"${role === item.role ? ' selected' : ''}>${esc(ReferenceRoles?.roleLabel(role) || role)}</option>`).join('');
  const supportsTime = item.nodeType === 'video' && ['first-frame', 'last-frame', 'keyframe'].includes(item.role);
  const duration = Math.max(0.1, Number(item.targetDuration || 5) || 5);
  const fallbackTime = item.role === 'first-frame' ? 0 : item.role === 'last-frame' ? duration : '';
  const timeControl = supportsTime
    ? `<label class="ref-time-field" title="关键帧在视频中的时间位置"><input type="number" min="0" max="${duration}" step="0.1" value="${esc(item.frameTime ?? fallbackTime)}" data-reference-time data-ref-key="${esc(item.key)}"><span>秒</span></label>`
    : '';
  return UIRenderHelpers.referencePreviewHtml({
    item, label, index, esc, isVideo: isVideoMedia, roleOptions, timeControl, overLimit,
    strengthControl: isImage && ReferenceRoles ? referenceStrengthHtml(item) : '',
    sheetButton: isImage && ReferenceRoles ? referenceSheetButtonHtml(item) : ''
  });
}
function referenceThumbLabel(item, index, kind) {
  if (kind === 'image') return `图${index + 1}`;
  return ReferenceRoles?.roleLabel(item.role) || (index === 0 ? '主体图' : '参考图');
}
// maxCount (image nodes only) dims the thumbnails the current model cannot take.
function renderReferenceBox(refbox, refs, kind = 'image', maxCount = Infinity) {
  if (!refbox) return;
  const list = uniqueRefItems(refs);
  if (!list.length) {
    refbox.innerHTML = ({video: '连线图片、视频或音频作为首帧 / 参考', comfyui: '可连线图片作为参考'})[kind] || '未连接或上传参考图';
    refbox.classList.remove('has-refs');
    return;
  }
  refbox.classList.add('has-refs');
  const duration = refbox.closest('.node') ? host.nodes.get(refbox.closest('.node').dataset.node)?.data?.duration : 5;
  refbox.innerHTML = list.map((item, i) => referencePreviewHtml(Object.assign({}, item, {targetDuration: duration}), referenceThumbLabel(item, i, kind), i, i >= maxCount)).join('');
  refbox.querySelectorAll('.ref-thumb img').forEach(markMissingReferenceThumb);
  if (host.refSorting?.node?.id === refbox.closest('.node')?.dataset.node) {
    refbox.classList.add('sorting');
    refbox.querySelector(`[data-ref-key="${CSS.escape(host.refSorting.key)}"]`)?.classList.add('sorting');
  }
}
// A reference thumbnail whose file is gone shows the same 「找不到」 state as the node preview.
function markMissingReferenceThumb(img) {
  img.addEventListener('error', () => {
    const missing = document.createElement('i');
    missing.className = 'fa-solid fa-triangle-exclamation ref-missing-icon';
    img.closest('.ref-thumb')?.classList.add('ref-missing');
    const thumb = img.closest('.ref-thumb');
    if (thumb) thumb.title = '图片文件找不到：' + String(img.getAttribute('src') || '');
    img.replaceWith(missing);
  }, {once: true});
}
function imageReferenceLimit(node) {
  const maxCount = modelCapabilityProfile(node, 'image')?.inputs?.image?.maxCount;
  return Number.isFinite(Number(maxCount)) ? Math.max(0, Number(maxCount)) : Infinity;
}
// What each provider really does with roles and strengths; strengths are never a native per-image weight.
function referenceDeliveryNote(node) {
  const type = currentProviderForNode(node, 'image')?.type || '';
  if (type === 'openai-images') return '按图1…图N 顺序上传；用途与强弱写进提示词，接口没有逐图权重参数。若接口拒收多图，会拼成一张参考板（编号不变）。';
  if (type === 'chat-image') return '按图1…图N 顺序作为图片消息发送；用途与强弱写进提示词，接口没有逐图权重参数。';
  if (type === 'custom-sync') return '按图1…图N 顺序发送，并附带 reference_roles 字段；服务端是否读取该字段取决于中转，提示词说明始终附带。';
  return '用途与强弱写进提示词，接口没有逐图权重参数。';
}
function renderReferenceGuide(node, refs, maxCount) {
  const guide = node.el?.querySelector('[data-ref-guide]');
  if (!guide || !ReferenceRoles) return;
  const count = refs.length;
  let tip = '';
  if (maxCount === 0) tip = count ? '当前模型不接收参考图，请换用支持图生图的模型或移除参考图' : '当前模型只支持文生图，不接收参考图';
  else if (count > maxCount) tip = `当前模型最多接收 ${maxCount} 张参考图，请移除 ${count - maxCount} 张（已标暗）`;
  const instructions = count && maxCount > 0 ? ReferenceRoles.imageReferenceInstructions(refs).trim() : '';
  if (!tip && !instructions) {
    guide.classList.add('hidden');
    guide.innerHTML = '';
    return;
  }
  const wasOpen = Boolean(guide.querySelector('details[data-ref-preview]')?.open);
  guide.classList.remove('hidden');
  guide.innerHTML = (tip ? `<div class="ref-guide-tip${count ? ' warn' : ''}"><i class="fa-solid fa-circle-info"></i>${esc(tip)}</div>` : '')
    + (instructions ? `<details class="ref-guide-preview" data-ref-preview${wasOpen ? ' open' : ''}><summary>将附加的参考说明</summary><pre>${esc(instructions)}</pre><small>${esc(referenceDeliveryNote(node))}</small></details>` : '');
}
function refreshImageReferences(node) {
  const refbox = node.el?.querySelector('[data-refbox]');
  if (!refbox) return;
  const refs = getResolvedImageRefItems(node.id, node.data.manualRefUrl || '');
  const maxCount = imageReferenceLimit(node);
  renderReferenceBox(refbox, refs, 'image', maxCount);
  renderReferenceGuide(node, uniqueRefItems(refs), maxCount);
}
function primaryMediaUrl(node) {
  if (!node) return '';
  return node.data.url || (node.data.urls || [])[0] || '';
}
function uniqueRefItems(items) {
  return UIRenderHelpers.uniqueRefItems(items);
}
function orderRefItems(targetNode, items) {
  const order = Array.isArray(targetNode?.data?.refOrder) ? targetNode.data.refOrder : [];
  if (!order.length) return items;
  const rank = new Map(order.map((key, i) => [key, i]));
  return items.map((item, index) => ({item, index}))
    .sort((a, b) => {
      const ar = rank.has(a.item.key) ? rank.get(a.item.key) : Number.MAX_SAFE_INTEGER;
      const br = rank.has(b.item.key) ? rank.get(b.item.key) : Number.MAX_SAFE_INTEGER;
      return ar === br ? a.index - b.index : ar - br;
    })
    .map(entry => entry.item);
}
function getResolvedImageRefItems(id, manualRef = '') {
  const target = host.nodes.get(id);
  const items = host.edges.filter(e => e.to === id && e.toPort === 'ref')
    .map(e => {
      const source = host.nodes.get(e.from);
      return {key: e.from, sourceNodeId: e.from, url: primaryMediaUrl(source), mediaType: source?.type === 'video' ? 'video' : ReferenceRoles?.mediaType({mime: source?.data?.mime, url: primaryMediaUrl(source)}) || 'image', mime: source?.data?.mime || '', sizeBytes: Math.max(0, Number(source?.data?.sizeBytes || 0)), fileName: source?.data?.name || ''};
    })
    .filter(item => item.url);
  const fallbackRef = target?.data?.manualRefUrl || manualRef;
  if (!host.edges.some(e => e.to === id && e.toPort === 'ref') && fallbackRef) items.push({key: '__manual_ref__', url: fallbackRef, mime: target?.data?.manualRefMime || '', sizeBytes: Math.max(0, Number(target?.data?.manualRefSizeBytes || 0)), fileName: target?.data?.manualRefName || ''});
  const ordered = orderRefItems(target, uniqueRefItems(items));
  const merged = ReferenceRoles?.mergeResolvedReferences({
    nodeType: target?.type || 'image',
    references: target?.data?.references,
    resolvedItems: ordered
  }) || ordered;
  if (target?.data && target.type !== 'image') target.data.references = merged;
  else if (target?.data) {
    // Roles saved for refs whose edge is not wired yet (template insert, batch copy) wait here until it arrives.
    const resolvedKeys = new Set(merged.map(item => item.key));
    const waiting = (Array.isArray(target.data.references) ? target.data.references : []).filter(item => item?.key && !resolvedKeys.has(item.key));
    target.data.references = merged.concat(waiting);
  }
  return merged.map(item => Object.assign({nodeType: target?.type || 'image'}, item));
}
// Call right after getResolvedImageRefItems: resolved refs get a fresh order, and role memory
// still waiting for its edge or media (image nodes, appended there) stays after them.
function storeResolvedReferences(node, items) {
  node.data.references = items.map((item, index) => Object.assign({}, item, {order: index})).concat((node.data.references || []).slice(items.length));
}
function getResolvedImageRefs(id, manualRef = '') {
  return getResolvedImageRefItems(id, manualRef).map(item => item.url);
}
// Stores an edited reference list; image references are regrouped by role priority so 图N matches the send order.
function commitReferences(node, result, failMessage) {
  if (!result || result.error) {
    hydrateNode(node);
    toast(result?.error || failMessage, 'warn');
    return false;
  }
  let refs = node.type === 'image' ? ReferenceRoles.sortImageReferences(result.references) : result.references;
  if (node.type === 'video') refs = VideoDirector?.ensureKeyframeTimes(refs, node.data.duration) || refs;
  const keys = new Set(refs.map(item => item.key));
  // Keep remembered roles of wired refs that have no media yet (e.g. an empty upload node).
  const waiting = node.type !== 'image' ? [] : (node.data.references || []).filter(item => item?.key && !keys.has(item.key) && host.edges.some(e => e.from === item.key && e.to === node.id && e.toPort === 'ref'));
  node.data.references = refs.map((item, index) => Object.assign({}, item, {order: index})).concat(waiting);
  node.data.refOrder = refs.map(item => item.key);
  hydrateNode(node);
  saveProject();
  return true;
}
function currentReferences(node) {
  return getResolvedImageRefItems(node.id, node.data.manualRefUrl || '');
}
function updateReferenceRole(node, key, role) {
  if (commitReferences(node, ReferenceRoles?.setReferenceRole(currentReferences(node), key, role), '参考素材用途更新失败')) {
    toast(`已设为${ReferenceRoles.roleLabel(role)}`, 'success');
  }
}
function updateReferenceStrength(node, key, strength) {
  commitReferences(node, ReferenceRoles?.setReferenceStrength(currentReferences(node), key, strength), '参考强度更新失败');
}
function markReferenceCharacterSheet(node, key) {
  if (commitReferences(node, ReferenceRoles?.markCharacterSheet(currentReferences(node), key), '设为角色设定图失败')) {
    toast('已设为角色设定图（角色一致 · 强）', 'success');
  }
}
function updateReferenceFrameTime(node, key, value) {
  commitReferences(node, ReferenceRoles?.setReferenceFrameTime(currentReferences(node), key, value, node.data.duration), '关键帧时间更新失败');
}
function startReferenceSort(e, node, thumb) {
  const refs = getResolvedImageRefItems(node.id, node.data.manualRefUrl || '');
  if (e.button !== 0 || refs.length < 2) return;
  host.refSorting = {node, key: thumb.dataset.refKey, pointerId: e.pointerId};
  thumb.setPointerCapture?.(e.pointerId);
  thumb.closest('.ref-box')?.classList.add('sorting');
  thumb.classList.add('sorting');
  e.preventDefault();
  e.stopPropagation();
}
function updateReferenceSort(e) {
  if (!host.refSorting || e.pointerId !== host.refSorting.pointerId) return;
  const node = host.refSorting.node;
  const box = node.el.querySelector('[data-refbox]');
  const thumbs = [...box.querySelectorAll('.ref-thumb')];
  if (thumbs.length < 2) return;
  const keys = thumbs.map(thumb => thumb.dataset.refKey);
  const draggedKey = host.refSorting.key;
  const remaining = keys.filter(key => key !== draggedKey);
  let insertAt = remaining.length;
  for (const thumb of thumbs.filter(thumb => thumb.dataset.refKey !== draggedKey)) {
    const r = thumb.getBoundingClientRect();
    if (e.clientX < r.left + r.width / 2) {
      insertAt = remaining.indexOf(thumb.dataset.refKey);
      break;
    }
  }
  const next = remaining.slice();
  next.splice(insertAt, 0, draggedKey);
  if (next.join('|') === keys.join('|')) return;
  node.data.refOrder = next;
  hydrateNode(node);
}
function finishReferenceSort(e) {
  if (!host.refSorting || e.pointerId !== host.refSorting.pointerId) return;
  const node = host.refSorting.node;
  const refs = getResolvedImageRefItems(node.id, node.data.manualRefUrl || '');
  node.data.refOrder = refs.map(item => item.key);
  storeResolvedReferences(node, refs);
  node.el.querySelector('[data-refbox]')?.classList.remove('sorting');
  host.refSorting = null;
  saveProject();
  toast('参考图顺序已更新', 'success');
}

function portClick(node, port) {
  if (Date.now() < host.suppressPortClickUntil) return;
  const info = {node: node.id, port: port.dataset.port, io: port.dataset.io};
  if (!host.selectedPort && info.io === 'in') {
    toast('请先点击一个输出端口，再点击输入端口', 'warn');
    return;
  }
  document.querySelectorAll('.port.selected').forEach(p => p.classList.remove('selected'));
  port.classList.add('selected');
  if (!host.selectedPort) {
    host.selectedPort = info;
    host.linkMode = true;
    updateLinkMode();
    toast('已选择输出端口，请点击目标输入端口', 'success');
    return;
  }
  if (host.selectedPort.node === info.node) { host.selectedPort = null; port.classList.remove('selected'); return; }
  let from = host.selectedPort, to = info;
  if (from.io === 'in' && to.io === 'out') [from, to] = [to, from];
  if (from.io !== 'out' || to.io !== 'in') {
    host.selectedPort = null;
    host.linkMode = false;
    updateLinkMode();
    document.querySelectorAll('.port.selected').forEach(p => p.classList.remove('selected'));
    return toast('请从输出端连接到输入端', 'warn');
  }
  connect(from.node, from.port, to.node, to.port);
  host.selectedPort = null;
  host.linkMode = false;
  updateLinkMode();
  document.querySelectorAll('.port.selected').forEach(p => p.classList.remove('selected'));
}
function startPortDrag(e, node, port) {
  if (e.button !== 0) return;
  const info = {node: node.id, port: port.dataset.port, io: port.dataset.io};
  const start = portCenter(info.node, info.port, info.io);
  if (!start) return;
  e.preventDefault();
  e.stopPropagation();
  closeFloatingCanvasUi();
  document.querySelectorAll('.port.selected').forEach(p => p.classList.remove('selected'));
  port.classList.add('selected');
  host.selectedPort = info.io === 'out' ? info : null;
  host.linkMode = true;
  updateLinkMode();
  host.linkDrag = {info, start, x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: false};
  port.setPointerCapture?.(e.pointerId);
  drawLinkPreview(start, screenToWorld(e.clientX, e.clientY));
}
function updateLinkDrag(e) {
  if (!host.linkDrag || e.pointerId !== host.linkDrag.pointerId) return;
  const dx = Math.abs(e.clientX - host.linkDrag.x);
  const dy = Math.abs(e.clientY - host.linkDrag.y);
  if (dx > 3 || dy > 3) host.linkDrag.moved = true;
  drawLinkPreview(host.linkDrag.start, screenToWorld(e.clientX, e.clientY));
}
const PORT_SNAP_RADIUS = 38;
function nearbyPortAt(clientX, clientY, dragInfo) {
  const wantedIo = dragInfo.io === 'out' ? 'in' : 'out';
  let closest = null;
  let closestDistance = Infinity;
  document.querySelectorAll(`.port[data-io="${wantedIo}"]`).forEach(port => {
    if (getComputedStyle(port).visibility === 'hidden') return;
    const targetNode = host.nodes.get(port.closest('.node')?.dataset.node || '');
    if (!targetNode || targetNode.id === dragInfo.node) return;
    const candidate = {node: targetNode.id, port: port.dataset.port, io: port.dataset.io};
    let from = dragInfo;
    let to = candidate;
    if (from.io === 'in') [from, to] = [to, from];
    if (!normalizeConnection(host.nodes.get(from.node), host.nodes.get(to.node), from.port, to.port)) return;
    const rect = port.getBoundingClientRect();
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance <= PORT_SNAP_RADIUS && distance < closestDistance) {
      closest = port;
      closestDistance = distance;
    }
  });
  return closest;
}
function finishPortDrag(e) {
  if (!host.linkDrag || e.pointerId !== host.linkDrag.pointerId) return;
  const drag = host.linkDrag;
  const targetPort = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.port') || nearbyPortAt(e.clientX, e.clientY, drag.info);
  cancelPortDrag();
  if (!drag.moved) {
    const sourceNode = host.nodes.get(drag.info.node);
    const sourcePort = sourceNode?.el.querySelector(`.port[data-port="${drag.info.port}"][data-io="${drag.info.io}"]`);
    if (sourceNode && sourcePort) portClick(sourceNode, sourcePort);
    return;
  }
  host.suppressPortClickUntil = Date.now() + 250;
  if (!targetPort) {
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const onEmptyCanvas = under && !under.closest('.node') && (under.closest('#viewport') || under.id === 'canvas' || under.id === 'canvasProxyLayer');
    if (!onEmptyCanvas) return toast('拖到目标端口后松开即可连接', 'warn');
    return showWireDropMenu(drag.info, e.clientX, e.clientY);
  }
  const targetNodeEl = targetPort.closest('.node');
  const targetNode = host.nodes.get(targetNodeEl?.dataset.node || '');
  if (!targetNode || targetNode.id === drag.info.node) return toast('不能连接到同一个节点', 'warn');
  const target = {node: targetNode.id, port: targetPort.dataset.port, io: targetPort.dataset.io};
  let from = drag.info;
  let to = target;
  if (from.io === 'in' && to.io === 'out') [from, to] = [to, from];
  if (from.io !== 'out' || to.io !== 'in') return toast('请从输出端拖到输入端', 'warn');
  connect(from.node, from.port, to.node, to.port);
}
function nodeOutputKind(node) {
  if (!node) return '';
  if (node.type === 'prompt' || node.type === 'character') return 'text';
  if (node.type === 'image' || node.type === 'video') return node.type;
  if (node.type === 'upload') return node.data.url && isVideoMedia(node.data.mime, node.data.url) ? 'video' : 'image';
  if (node.type === 'media-tool') {
    const kind = MediaProcessContract?.operation?.(node.data.operation)?.kind;
    return kind === 'image' || kind === 'video' ? kind : '';
  }
  return '';
}
function nodeImagePixelSize(node) {
  const img = [...node.el.querySelectorAll('[data-preview] img')].find(item => item.naturalWidth && (!node.data.url || item.currentSrc === safeMediaUrl(node.data.url) || item.src === safeMediaUrl(node.data.url)))
    || node.el.querySelector('[data-preview] img');
  if (img?.naturalWidth) return {width: img.naturalWidth, height: img.naturalHeight};
  const match = String(node.data.size || '').match(/^(\d+)x(\d+)$/);
  return match ? {width: Number(match[1]), height: Number(match[2])} : null;
}
function wireDropOptionsFor(node, io) {
  const kind = io === 'out' ? nodeOutputKind(node) : '';
  return CanvasNodes.wireDropOptions(node, io, kind, kind === 'image' ? nodeImagePixelSize(node) : null)
    .filter(option => {
      const probe = {type: option.type, data: option.data};
      return io === 'in' ? normalizeConnection(probe, node, '', '') : normalizeConnection(node, probe, '', '');
    });
}
// Dropping a wire on empty canvas offers the next steps that make sense for that port.
function showWireDropMenu(info, clientX, clientY) {
  const node = host.nodes.get(info.node);
  const options = wireDropOptionsFor(node, info.io);
  if (!options.length) return toast('拖到目标端口后松开即可连接', 'warn');
  const html = `<div class="node-type-menu-title">${info.io === 'out' ? '创建下一步' : '添加输入'}</div>` + options.map(option => `<button type="button" data-option="${esc(option.id)}"><i class="fa-solid ${esc(option.icon)}"></i>${esc(option.label)}</button>`).join('');
  openCanvasMenu(clientX, clientY, html, picked => {
    const option = options.find(item => item.id === picked.option);
    if (!option) return;
    const pos = screenToWorld(clientX, clientY);
    const width = option.type === 'image' || option.type === 'video' ? 520 : option.type === 'upload' || option.type === 'media-tool' ? 360 : 320;
    createConnectedNode(node.id, info.io, option, info.io === 'out' ? pos.x + 24 : pos.x - width - 24, pos.y - 60);
  }, 'wire-drop-menu');
}
// Creates a node already wired to anchorId (io 'out': anchor feeds the new node; 'in': the new node feeds the anchor).
function createConnectedNode(anchorId, io, option, x, y) {
  const anchor = host.nodes.get(anchorId);
  if (!anchor || !option) return null;
  const next = addNode(option.type, x, y, JSON.parse(JSON.stringify(option.data || {})), null, false);
  const [from, to] = io === 'in' ? [next, anchor] : [anchor, next];
  if (!connectSilently(from.id, '', to.id, '')) {
    deleteNode(next.id, false);
    toast('当前节点类型不能这样连接', 'warn');
    return null;
  }
  selectSingleNode(next.id);
  saveProject();
  return next;
}
function cancelPortDrag() {
  host.linkDrag = null;
  host.selectedPort = null;
  host.linkMode = false;
  updateLinkMode();
  document.querySelectorAll('.port.selected').forEach(p => p.classList.remove('selected'));
  removeLinkPreview();
}
function drawLinkPreview(start, end) {
  const svg = $('edges');
  removeLinkPreview();
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', edgePathD(start, end));
  path.setAttribute('class', 'edge-preview');
  path.dataset.preview = 'link';
  svg.appendChild(path);
}
function removeLinkPreview() {
  $('edges')?.querySelector('[data-preview="link"]')?.remove();
}
function connect(from, fromPort, to, toPort) {
  const src = host.nodes.get(from);
  const dst = host.nodes.get(to);
  const normalized = normalizeConnection(src, dst, fromPort, toPort);
  if (!normalized) return toast('当前节点类型不能这样连接', 'warn');
  fromPort = normalized.fromPort;
  toPort = normalized.toPort;
  if (host.edges.some(e => e.from === from && e.fromPort === fromPort && e.to === to && e.toPort === toPort)) return;
  if (toPort === 'prompt') host.edges = host.edges.filter(e => !(e.to === to && e.toPort === 'prompt'));
  host.edges.push({from, fromPort, to, toPort});
  hydrateLinkedInputs(dst);
  drawEdges();
  saveProject();
  toast(toPort === 'ref' ? '已连接为参考图输入' : toPort === 'media' ? '已连接为媒体源' : '已连接为提示词输入', 'success');
}
function connectSilently(from, fromPort, to, toPort) {
  const src = host.nodes.get(from);
  const dst = host.nodes.get(to);
  const normalized = normalizeConnection(src, dst, fromPort, toPort);
  if (!normalized) return false;
  fromPort = normalized.fromPort;
  toPort = normalized.toPort;
  if (host.edges.some(e => e.from === from && e.fromPort === fromPort && e.to === to && e.toPort === toPort)) return true;
  if (toPort === 'prompt') host.edges = host.edges.filter(e => !(e.to === to && e.toPort === 'prompt'));
  host.edges.push({from, fromPort, to, toPort});
  hydrateLinkedInputs(dst);
  drawEdges();
  return true;
}
function normalizeConnection(src, dst, fromPort, toPort) {
  if (!src || !dst) return null;
  if (dst.type === 'media-tool' && ['image', 'video', 'upload', 'media-tool'].includes(src.type)) return {fromPort: src.type === 'upload' ? 'media' : src.type === 'image' ? 'image' : src.type === 'video' ? 'video' : 'media', toPort: 'media'};
  if (src.type === 'prompt' || src.type === 'character') {
    if (dst.type !== 'image' && dst.type !== 'video') return null;
    return {fromPort: 'text', toPort: 'prompt'};
  }
  if (src.type === 'image' || src.type === 'upload' || src.type === 'media-tool') {
    if (dst.type !== 'image' && dst.type !== 'video') return null;
    return {fromPort: src.type === 'image' ? 'image' : 'media', toPort: 'ref'};
  }
  if (src.type === 'video') return null;
  return {fromPort, toPort};
}
function hydrateLinkedInputs(node) {
  if (!node) return;
  if (node.type === 'media-tool') {
    node.data.sourceUrls = host.edges.filter(edge => edge.to === node.id && edge.toPort === 'media').map(edge => primaryMediaUrl(host.nodes.get(edge.from))).filter(Boolean).slice(0, 2);
    hydrateNode(node);
    return;
  }
  if (node.type !== 'image' && node.type !== 'video') return;
  const items = getResolvedImageRefItems(node.id, node.data.manualRefUrl || '');
  node.data.refUrl = items[0]?.url || '';
  node.data.refOrder = items.map(item => item.key);
  storeResolvedReferences(node, items);
  hydrateNode(node);
}
function refreshLinkedInputTargets(ids) {
  unique(ids).forEach(id => hydrateLinkedInputs(host.nodes.get(id)));
}
function refreshDownstreamLinkedInputs(sourceId) {
  refreshLinkedInputTargets(host.edges.filter(e => e.from === sourceId && (e.toPort === 'ref' || e.toPort === 'media')).map(e => e.to));
}
function refreshAllLinkedInputs() {
  refreshLinkedInputTargets(host.edges.filter(e => e.toPort === 'ref' || e.toPort === 'prompt').map(e => e.to));
}
function toggleLinkMode() {
  host.linkMode = !host.linkMode;
  setSelectedPort(null);
  document.querySelectorAll('.port.selected').forEach(p => p.classList.remove('selected'));
  updateLinkMode();
  toast(host.linkMode ? '连线模式已开启：点击输出端口，再点击输入端口' : '连线模式已关闭', 'success');
}
function updateLinkMode() {
  document.body.classList.toggle('link-mode', host.linkMode);
  const btn = $('railLink');
  if (btn) btn.classList.toggle('active', host.linkMode);
}
function inputPortElement(node, portName) {
  if (!node?.el) return null;
  return node.el.querySelector(`.port[data-port="${portName}"][data-io="in"]`)
    || (portName === 'ref' || portName === 'prompt' || portName === 'input'
      ? node.el.querySelector('.port[data-port="input"][data-io="in"]')
      : null);
}
function portElement(node, portName, io) {
  if (!node?.el) return null;
  return io === 'in'
    ? inputPortElement(node, portName)
    : node.el.querySelector(`.port[data-port="${portName}"][data-io="out"]`);
}
function portCenter(id, portName, io, viewportRect = null, fast = false) {
  const node = host.nodes.get(id);
  if (!node) return null;
  if (fast) return fallbackPortCenter({node, size: nodeSize(node), io});
  const port = portElement(node, portName, io);
  viewportRect = viewportRect || $('viewport').getBoundingClientRect();
  if (port) {
    const r = port.getBoundingClientRect();
    return portCenterFromRects({portRect: r, viewportRect, scale: host.scale});
  }
  const size = nodeSize(node);
  return fallbackPortCenter({node, size, io});
}
function nodeSize(node) {
  const fallbackWidth = node.type === 'image' || node.type === 'video' ? 520 : node.type === 'upload' || node.type === 'media-tool' ? 360 : 320;
  const fallbackHeight = node.type === 'image' || node.type === 'video' ? 520 : node.type === 'media-tool' ? 560 : 230;
  const rect = node.el?.getBoundingClientRect?.();
  const width = node.el?.offsetWidth || (rect?.width ? rect.width / Math.max(host.scale || 1, .01) : fallbackWidth);
  const height = node.el?.offsetHeight || (rect?.height ? rect.height / Math.max(host.scale || 1, .01) : fallbackHeight);
  return {width: Math.ceil(width), height: Math.ceil(height)};
}
function updatePortConnectionStates() {
  document.querySelectorAll('.port.connected').forEach(port => port.classList.remove('connected'));
  host.edges.forEach(edge => {
    portElement(host.nodes.get(edge.from), edge.fromPort, 'out')?.classList.add('connected');
    inputPortElement(host.nodes.get(edge.to), edge.toPort)?.classList.add('connected');
  });
}
function drawEdges() {
  const svg = $('edges');
  svg.innerHTML = '';
  updatePortConnectionStates();
  const view = currentWorldBounds(180);
  const viewportRect = $('viewport').getBoundingClientRect();
  const fast = !!host.dragging;
  host.edges.forEach(edge => {
    const fromNode = host.nodes.get(edge.from);
    const toNode = host.nodes.get(edge.to);
    if (!fromNode || !toNode) return;
    if (!fromNode.mounted || !toNode.mounted) return;
    if (fromNode.el?.classList.contains('search-hidden') || toNode.el?.classList.contains('search-hidden')) return;
    const a = portCenter(edge.from, edge.fromPort, 'out', viewportRect, fast);
    const b = portCenter(edge.to, edge.toPort, 'in', viewportRect, fast);
    if (!a || !b) return;
    if (!segmentIntersectsView(a, b, view)) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', edgePathD(a, b));
    path.setAttribute('class', edgeClassName(edge.toPort));
    svg.appendChild(path);
  });
}
function scheduleDrawEdges() {
  if (host.edgeFrame) return;
  if (host.dragging) {
    const now = performance.now();
    const wait = Math.max(0, 52 - (now - host.edgeDrawLastAt));
    if (host.edgeThrottleTimer) return;
    host.edgeThrottleTimer = setTimeout(() => {
      host.edgeThrottleTimer = null;
      host.edgeDrawLastAt = performance.now();
      drawEdges();
    }, wait);
    return;
  }
  host.edgeFrame = requestAnimationFrame(() => {
    host.edgeFrame = null;
    host.edgeDrawLastAt = performance.now();
    drawEdges();
  });
}
    return {
      addNode,
      normalizeTags,
      normalizeNodeMetadata,
      normalizeData,
      nodePort,
      renderNode,
      renderImageNode,
      renderVideoNode,
      renderUploadNode,
      renderComfyUINode,
      nodeButtons,
      renderNodeMetadata,
      nodeDefaultTitle,
      nodeDisplayTitle,
      refreshNodeModelSelects,
      refreshNodeCapabilityControls,
      bindNode,
      beginNodeDrag,
      isNodeInteractiveTarget,
      isNodeDragSurface,
      selectSingleNode,
      selectAllCanvasNodes,
      clearCanvasSearch,
      canvasSearchText,
      nodeMatchesCanvasFilters,
      applyCanvasFilters,
      focusCanvasSearchResult,
      hydrateNode,
      imagePreviewUrls,
      applyNodeMediaLayout,
      deleteNode,
      duplicateNodes,
      stepOutputHistory,
      renameNode,
      toggleNodeFavorite,
      editNodeTags,
      readUpload,
      isSupportedUploadFile,
      isVideoMedia,
      safeDownloadName,
      imageStatusHtml,
      imageStatusMessage,
       setImageStatus,
      imageErrorTitle,
      referencePreviewHtml,
      renderReferenceBox,
      primaryMediaUrl,
      uniqueRefItems,
      orderRefItems,
      getResolvedImageRefItems,
      getResolvedImageRefs,
      updateReferenceRole,
      startReferenceSort,
      updateReferenceSort,
      finishReferenceSort,
      portClick,
      startPortDrag,
      updateLinkDrag,
      nearbyPortAt,
      finishPortDrag,
      cancelPortDrag,
      drawLinkPreview,
      removeLinkPreview,
      connect,
      connectSilently,
      createConnectedNode,
      showWireDropMenu,
      normalizeConnection,
      hydrateLinkedInputs,
      refreshLinkedInputTargets,
      refreshDownstreamLinkedInputs,
      refreshAllLinkedInputs,
      toggleLinkMode,
      updateLinkMode,
      inputPortElement,
      portElement,
      portCenter,
      nodeSize,
      updatePortConnectionStates,
      drawEdges,
      scheduleDrawEdges
    };
  }

  window.FutureAICanvasRuntime = { create };
})();
