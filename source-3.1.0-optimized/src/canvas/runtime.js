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
    const runImage = deps.runImage;
    const previewImageRequest = deps.previewImageRequest;
    const runVideo = deps.runVideo;
    const runComfyUI = deps.runComfyUI;
    const runPrompt = deps.runPrompt;
    const runMediaTool = deps.runMediaTool;
    const openFabricEditor = deps.openFabricEditor;
    const openCropperEditor = deps.openCropperEditor;
    const openCameraModal = deps.openCameraModal;
    const openMediaViewer = deps.openMediaViewer;
    const downloadMedia = deps.downloadMedia;
    const restorePreviousImageVersion = deps.restorePreviousImageVersion;
    const openDirectorDesk = deps.openDirectorDesk;
    const openDialogEditWorkbench = deps.openDialogEditWorkbench;
    const persistMediaUrl = deps.persistMediaUrl;
    const providerOptionsHtml = deps.providerOptionsHtml;
    const providerModelsForKind = deps.providerModelsForKind;
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
    const focusCanvasSearch = deps.focusCanvasSearch;
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
  const downloadImage = deps.downloadImage;
  const openMediaUrl = deps.openMediaUrl;
  const showNodeContextMenu = deps.showNodeContextMenu;
  const expandNodeIdsForGroups = deps.expandNodeIdsForGroups;
  const fitNodeIntoView = deps.fitNodeIntoView;
  const comfyWorkflowMapHtml = deps.comfyWorkflowMapHtml;
  const removeNodeFromGroups = deps.removeNodeFromGroups;
  const mediaExtFromMime = deps.mediaExtFromMime;

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
    imageModel: $('imageModel').value || 'gpt-image2',
    videoModel: $('videoModel').value || 'omni-flash',
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
    <div class="node-head">
      <div class="node-title" title="双击重命名"><i class="fa-solid ${icon}"></i><span data-title-text>${esc(nodeDisplayTitle(node))}</span></div>
      <div class="node-actions">${nodeButtons()}</div>
    </div>
    ${renderNodeMetadata(node)}
    ${nodePort('out-text', 'text', 'out', '提示词')}
    <div class="node-content">
      <textarea data-field="prompt" placeholder="输入提示词、角色设定或镜头需求..."></textarea>
      <div class="node-run-row">
        <button data-run="prompt" class="primary-btn">整理</button>
        <button data-optimize-prompt class="ghost-btn"><i class="fa-solid fa-wand-magic-sparkles"></i> 优化</button>
        <button data-clear class="ghost-btn">清空</button>
      </div>
    </div>`;
}
function renderImageNode(node) {
  const provider = currentProviderForNode(node, 'image');
  const normalizedModel = normalizeKnownImageModelAlias(node.data.model, provider);
  if (normalizedModel !== node.data.model) node.data.model = normalizedModel;
  const providerOptions = providerOptionsHtml(node.data.providerId);
  return `
    <div class="node-head">
      <div class="node-title" title="双击重命名"><i class="fa-solid fa-image"></i><span data-title-text>${esc(nodeDisplayTitle(node))}</span></div>
      <div class="node-actions">${nodeButtons()}</div>
    </div>
    ${renderNodeMetadata(node)}
    ${nodePort('in-unified', 'input', 'in', '智能输入', '输入提示词、参考图或素材')}
    ${nodePort('out-image', 'image', 'out', '图片')}
    ${nodeQuickToolbar('image')}
    <div class="node-content">
      <input type="file" accept="image/*,video/*" data-upload class="hidden">
      <div class="image-preview" data-preview></div>
      <div class="node-status hidden" data-status></div>
    </div>
    <div class="image-panel image-composer node-composer" data-composer>
      <div class="composer-head">
        <div class="composer-tabs" role="tablist">
          <button type="button" class="composer-tab active" data-composer-tab="ref" role="tab">参考</button>
          ${composerTabButtonHtml('mark', '标记', node.data.markTag)}
          ${composerTabButtonHtml('style', '风格', node.data.styleTag)}
          ${composerTabButtonHtml('mood', '情绪', node.data.moodTag)}
        </div>
        <button type="button" class="composer-close" data-composer-close title="关闭面板" aria-label="关闭面板"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="composer-pane composer-ref-pane" data-composer-pane="ref">
        <div class="ref-box composer-refs" data-refbox>未连接或上传参考图</div>
        <button type="button" class="composer-add-ref" data-upload-btn title="上传参考图"><i class="fa-solid fa-plus"></i><span>添加</span></button>
      </div>
      ${composerPresetPaneHtml('mark', node.data.markTag)}
      ${composerPresetPaneHtml('style', node.data.styleTag)}
      ${composerPresetPaneHtml('mood', node.data.moodTag)}
      <textarea data-field="prompt" placeholder="描述你想要生成的内容" title="输入当前图片节点自己的指令。连接参考图不会覆盖这里。"></textarea>
      <div class="composer-hint"><span>参考图按用途排序发送，同用途内可拖动排序</span><span class="media-size-summary" data-size-summary></span><span class="media-capability-summary" data-capability-summary>${esc(modelCapabilitySummary(node, 'image'))}</span></div>
        <div class="composer-bar">
          <label class="composer-pill composer-model" title="模型（按 API 服务分组）">
            <i class="fa-solid fa-circle-nodes"></i>
            <select data-model-picker aria-label="模型">${modelPickerHtml(node)}</select>
          </label>
          <label class="composer-pill" title="比例"><select data-field="aspect">${imageAspectOptionsHtml(node)}</select></label>
          <label class="composer-pill" title="清晰度"><select data-field="resolution">${imageResolutionOptionsHtml(node)}</select></label>
          <label class="composer-pill" title="张数"><select data-field="count"><option value="1">1张</option><option value="2">2张</option><option value="3">3张</option><option value="4">4张</option></select></label>
          <button type="button" class="composer-background-toggle" data-background-toggle title="透明背景（仅支持的模型；默认关闭）" aria-label="透明背景" aria-pressed="${node.data.backgroundMode === 'transparent'}"><i class="fa-solid fa-chess-board"></i><span>透明</span></button>
          <button type="button" class="composer-more-toggle" data-more-toggle title="生成质量、透明背景与更多设置" aria-label="更多生成设置"><i class="fa-solid fa-sliders"></i></button>
          <span class="composer-cost" data-cost-estimate></span>
          <button type="button" class="composer-send" data-run="image" title="生成图像 / 图生图" aria-label="生成图像 / 图生图">
            <i class="fa-solid fa-arrow-up"></i>
          </button>
        </div>
        <div class="composer-more hidden" data-composer-more>
          <div class="image-request-controls">
            <label>提示词<select data-field="promptMode"><option value="raw">原文直通</option><option value="context">增强上下文</option></select></label>
            <label>质量<select data-field="quality"><option value="auto">自动质量</option><option value="low">低</option><option value="medium">标准</option><option value="high">高质量</option><option value="hd">HD</option></select></label>
            <label>背景<select data-field="backgroundMode" title="透明背景需要模型和供应商支持，结果保留 PNG 透明通道"><option value="opaque">不透明</option><option value="transparent">透明 PNG</option></select></label>
          </div>
          <div class="image-grid">
            <label class="image-grid-wide">供应商<select data-field="providerId">${providerOptions}</select></label>
          </div>
          <div class="image-tools">
            <button class="dark-btn" data-optimize-prompt><i class="fa-solid fa-wand-magic-sparkles"></i> 优化提示词</button>
            <button class="dark-btn" data-safe><i class="fa-solid fa-shield-heart"></i> 安全改写</button>
            <button class="dark-btn" data-clear-ref>清参考</button>
            <button class="dark-btn" data-copy-prompt title="复制提示词"><i class="fa-solid fa-copy"></i></button>
            <button class="dark-btn" data-download title="下载图片"><i class="fa-solid fa-download"></i></button>
            <button class="dark-btn" data-quick="camera" title="3D 机位"><i class="fa-solid fa-camera"></i></button>
          </div>
          <div class="image-request-controls">
          <button type="button" class="dark-btn" data-preview-request>请求预览</button>
          <button type="button" class="dark-btn" data-last-request>上次请求</button>
          </div>
        </div>
        <div class="image-custom-size hidden" data-image-custom-size>
          <label>宽<input data-field="customWidth" type="number" min="64" max="16384" step="1" placeholder="64-16384"></label>
          <label>高<input data-field="customHeight" type="number" min="64" max="16384" step="1" placeholder="64-16384"></label>
        </div>
    </div>`;
}
function renderVideoNode(node) {
  const modelOptions = modelOptionsHtml('video', node.data.model, node);
  const providerOptions = providerOptionsHtml(node.data.providerId, 'video');
  const sizeOptions = videoSizeOptionsHtml(node);
  const operationOptions = videoOperationOptionsHtml(node);
  const customSizeControls = `<div class="video-custom-size hidden" data-video-custom-size><label>宽度<input data-field="customWidth" type="number" min="64" max="16384" step="1" value="${esc(node.data.customWidth || '')}" placeholder="64-16384"></label><label>高度<input data-field="customHeight" type="number" min="64" max="16384" step="1" value="${esc(node.data.customHeight || '')}" placeholder="64-16384"></label></div>`;
  return `
    <div class="node-head">
      <div class="node-title" title="双击重命名"><i class="fa-solid fa-video"></i><span data-title-text>${esc(nodeDisplayTitle(node))}</span></div>
      <div class="node-actions">${nodeButtons()}</div>
    </div>
    ${renderNodeMetadata(node)}
    ${nodePort('in-unified', 'input', 'in', '智能输入', '输入提示词、首帧或参考图')}
    ${nodePort('out-image', 'video', 'out', '视频')}
    ${nodeQuickToolbar('video')}
    <div class="node-content">
      <div class="image-preview" data-preview></div>
      <div class="image-panel">
        <textarea data-field="prompt" placeholder="输入视频指令。可连接图片节点作为首帧 / 参考，也可连接提示词节点。"></textarea>
        <div class="video-operation-picker">
          <label>我想做什么<select data-field="operation">${operationOptions}</select></label>
          <span data-operation-help>${esc(videoOperationHelp(node))}</span>
        </div>
        <div class="image-grid">
          <label>供应商<select data-field="providerId">${providerOptions}</select></label>
          <label>视频模型<input data-field="model" list="node-models-${esc(node.id)}" value="${esc(node.data.model || '')}" placeholder="跟随全局，或粘贴模型 ID"><datalist id="node-models-${esc(node.id)}">${modelOptions}</datalist></label>
          <label data-video-control="duration">时长<select data-field="duration">${videoDurationOptionsHtml(node)}</select></label>
          <label data-video-control="size">尺寸<select data-field="size">${sizeOptions}</select></label>
          <label data-video-control="speed">速度<input data-field="speed" type="number" min="0.1" max="4" step="0.1" value="${esc(node.data.speed || '1')}"></label>
        </div>
        ${customSizeControls}
        <div class="video-keyframe-timeline hidden" data-keyframe-timeline></div>
        <div class="video-request-summary" data-video-request-summary></div>
        <div class="media-size-summary" data-size-summary></div>
        <div class="media-capability-summary" data-capability-summary>${esc(modelCapabilitySummary(node, 'video'))}</div>
        <div class="image-tools">
          <button class="dark-btn" data-optimize-prompt><i class="fa-solid fa-wand-magic-sparkles"></i> 优化提示词</button>
          <button class="dark-btn" data-safe><i class="fa-solid fa-shield-heart"></i> 安全改写</button>
          <button class="dark-btn" data-clear-ref>清参考</button>
          <button class="dark-btn" data-copy-prompt><i class="fa-solid fa-copy"></i></button>
          <button class="dark-btn" data-download-video><i class="fa-solid fa-download"></i></button>
        </div>
        <div class="node-status hidden" data-status></div>
        <div class="ref-box" data-refbox>连接图片、视频或音频后，为每份素材选择用途</div>
        <button data-run="video" class="primary-btn" style="width:100%;margin-top:10px"><i class="fa-solid fa-video"></i> 生成视频</button>
      </div>
    </div>`;
}
function renderUploadNode(node) {
  return `
    <div class="node-head">
      <div class="node-title" title="双击重命名"><i class="fa-solid fa-upload"></i><span data-title-text>${esc(nodeDisplayTitle(node))}</span></div>
      <div class="node-actions">${nodeButtons()}</div>
    </div>
    ${renderNodeMetadata(node)}
    ${nodePort('out-image', 'media', 'out', '上传素材')}
    <div class="node-content">
      <input type="file" accept="image/*,video/*" data-upload class="hidden">
      <div class="upload-preview" data-preview></div>
      <div class="upload-actions">
        <button class="primary-btn" data-upload-btn><i class="fa-solid fa-folder-open"></i> 选择图片或视频</button>
        <button class="ghost-btn" data-download-media title="下载素材"><i class="fa-solid fa-download"></i></button>
      </div>
      <p class="upload-hint">也可以从文件夹直接拖入画布，上传节点可连接到图片/视频节点作为参考。</p>
    </div>`;
}
function renderMediaToolNode(node) {
  const options = (MediaProcessContract?.OPERATIONS || []).map(item => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('');
  return `
    <div class="node-head">
      <div class="node-title" title="双击重命名"><i class="fa-solid fa-scissors"></i><span data-title-text>${esc(nodeDisplayTitle(node))}</span></div>
      <div class="node-actions">${nodeButtons()}</div>
    </div>
    ${renderNodeMetadata(node)}
    ${nodePort('in-unified', 'media', 'in', '源素材', '可连接一到两个图片、视频、音频或字幕素材')}
    ${nodePort('out-image', 'media', 'out', '处理结果')}
    <div class="node-content">
      <div class="upload-preview" data-preview></div>
      <div class="node-status hidden" data-status></div>
      <div class="media-tool-panel">
        <label>本地操作<select data-field="operation">${options}</select></label>
        <div class="image-grid">
          <label>宽<input data-field="width" type="number" min="64" max="7680"></label>
          <label>高<input data-field="height" type="number" min="64" max="7680"></label>
          <label>开始秒<input data-field="start" type="number" min="0" step="0.1"></label>
          <label>时长秒<input data-field="duration" type="number" min="0.05" step="0.1"></label>
          <label>取帧秒<input data-field="time" type="number" min="0" step="0.1"></label>
          <label>速度<input data-field="speed" type="number" min="0.5" max="2" step="0.1"></label>
          <label>循环次数<input data-field="loops" type="number" min="1" max="100"></label>
          <label>音量<input data-field="volume" type="number" min="0" max="4" step="0.1"></label>
          <label>字幕偏移秒<input data-field="shiftSeconds" type="number" step="0.1"></label>
          <label>输出格式<select data-field="format"><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WebP</option><option value="srt">SRT</option><option value="vtt">VTT</option></select></label>
          <label>背景色<input data-field="background" type="color"></label>
        </div>
        <textarea data-field="subtitleText" placeholder="字幕烧录/转换时可粘贴 SRT 或 VTT；也可以连接字幕文件。"></textarea>
        <div class="ref-box" data-refbox>连接源素材后运行；真实处理会生成新文件，不覆盖源素材。</div>
        <button data-run="media-tool" class="primary-btn" style="width:100%;margin-top:10px"><i class="fa-solid fa-play"></i> 运行本地处理</button>
      </div>
    </div>`;
}
function renderComfyUINode(node) {
  return `
    <div class="node-head">
      <div class="node-title" title="双击重命名"><i class="fa-solid fa-diagram-project"></i><span data-title-text>${esc(nodeDisplayTitle(node))}</span></div>
      <div class="node-actions">${nodeButtons()}</div>
    </div>
    ${renderNodeMetadata(node)}
    ${nodePort('in-unified', 'input', 'in', '智能输入', '输入提示词或参考图')}
    ${nodePort('out-image', 'image', 'out', '图片')}
    <div class="node-content">
      <input type="file" accept=".json,application/json" data-comfy-file class="hidden">
      <div class="image-preview" data-preview></div>
      <div class="image-panel comfyui-panel">
        <textarea data-field="prompt" placeholder="输入 ComfyUI 正向提示词。也可以连接提示词节点。"></textarea>
        <textarea data-field="negative" placeholder="负向提示词，可选。"></textarea>
        <div class="image-grid">
          <label>工作流<input data-field="workflowName" placeholder="工作流名称"></label>
          <label>Seed<input data-field="seed" placeholder="留空随机"></label>
          <label>宽度<input data-field="width" type="number" min="64" step="64"></label>
          <label>高度<input data-field="height" type="number" min="64" step="64"></label>
        </div>
        <div class="image-tools">
          <button class="dark-btn" data-comfy-test><i class="fa-solid fa-vial"></i> 测试连接</button>
          <button class="dark-btn" data-comfy-import><i class="fa-solid fa-file-import"></i> 导入 workflow</button>
          <button class="dark-btn" data-comfy-save-global><i class="fa-solid fa-floppy-disk"></i> 保存全局</button>
          <button class="dark-btn" data-comfy-export><i class="fa-solid fa-file-export"></i> 导出</button>
          <button class="dark-btn" data-comfy-refresh><i class="fa-solid fa-rotate"></i> 刷新结构</button>
        </div>
        <div class="comfyui-workflow-map" data-workflow-map></div>
        <textarea class="comfyui-json-editor" data-field="workflowJson" placeholder="ComfyUI API workflow JSON。可在这里直接编辑，运行时会注入提示词、负向提示词、尺寸和 seed。"></textarea>
        <div class="node-status hidden" data-status></div>
        <div class="ref-box" data-refbox>可连接图片作为参考；第一版会优先注入提示词、尺寸和 seed。</div>
        <button data-run="comfyui" class="primary-btn" style="width:100%;margin-top:10px"><i class="fa-solid fa-diagram-project"></i> 运行 ComfyUI 工作流</button>
      </div>
    </div>`;
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
function nodeQuickToolbar(kind) {
  return UIRenderHelpers.nodeQuickToolbar(kind);
}
function getModelOptions(kind, current = '') {
  const providerModels = kind === 'image'
    ? host.apiProviders.flatMap(item => [item.imageModel, ...(item.models || []).filter(model => /image|img|flux|sdxl|wanx|seedream|dall|gpt-image|kolors|stable/i.test(model))]).filter(Boolean)
    : kind === 'video'
      ? host.apiProviders.flatMap(item => [item.videoModel, ...(item.models || []).filter(model => /video|sora|wan|veo|kling|hailuo|runway|luma|pika|seedance/i.test(model))]).filter(Boolean)
      : host.apiProviders.map(item => item.chatModel).filter(Boolean);
  return UIRenderHelpers.getModelOptions({
    kind,
    current,
    defaultValue: kind === 'video' ? $('videoModel').value : $('imageModel').value,
    importedModels: unique([...providerModels, ...(host.importedModels || [])])
  });
}
function modelOptionsHtml(kind, current = '', node = null) {
  const provider = kind === 'image' ? currentProviderForNode(node, 'image') : kind === 'video' ? currentProviderForNode(node, 'video') : null;
  const providerModels = provider
    ? providerModelsForKind(provider, kind)
    : kind === 'video'
      ? host.apiProviders.flatMap(item => providerModelsForKind(item, 'video')).filter(Boolean)
      : host.apiProviders.flatMap(item => providerModelsForKind(item, 'image')).filter(Boolean);
  return UIRenderHelpers.modelOptionsHtml({
    kind,
    current,
    defaultValue: kind === 'video' ? provider?.videoModel || $('videoModel').value : provider?.imageModel || $('imageModel').value,
    importedModels: unique([current, ...providerModels].filter(Boolean)),
    esc
  });
}
const MODEL_PICKER_CUSTOM = '__custom_model__';
function modelPickerValue(providerId = '', model = '') {
  return JSON.stringify([String(providerId || ''), String(model || '')]);
}
function modelPickerHtml(node) {
  const selectedProvider = String(node.data.providerId || '');
  const selectedModel = String(node.data.model || '');
  const globalModel = $('imageModel')?.value || '';
  const option = (id, model, label, selected) => `<option value="${esc(modelPickerValue(id, model))}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
  const options = [option('', selectedProvider ? '' : selectedModel, `跟随全局 · ${selectedProvider ? globalModel : selectedModel || globalModel}`, !selectedProvider)];
  host.apiProviders.forEach(provider => {
    const models = unique([provider.imageModel, ...providerModelsForKind(provider, 'image').slice(0, 40), selectedProvider === provider.id ? selectedModel : ''].filter(Boolean));
    if (!models.length) return;
    options.push(`<optgroup label="${esc(provider.name || provider.type || 'API')}">${models.map(model =>
      option(provider.id, model, model, selectedProvider === provider.id && selectedModel === model)
    ).join('')}</optgroup>`);
  });
  if (selectedProvider && selectedModel && !host.apiProviders.some(provider => provider.id === selectedProvider)) {
    options.push(`<optgroup label="当前选择">${option(selectedProvider, selectedModel, selectedModel, true)}</optgroup>`);
  }
  options.push(`<option value="${MODEL_PICKER_CUSTOM}">自定义模型 ID…</option>`);
  return options.join('');
}
async function applyModelPick(node, picker) {
  let pick;
  if (picker.value === MODEL_PICKER_CUSTOM) {
    const model = String(await openModal({title: '自定义模型 ID', value: node.data.model || '', okText: '使用'}) || '').trim();
    if (model) pick = {providerId: node.data.providerId || currentProviderForNode(node, 'image')?.id || '', model};
  } else {
    try {
      const [providerId, model] = JSON.parse(picker.value);
      pick = {providerId, model};
    } catch {}
  }
  if (pick) {
    node.data.providerId = pick.providerId;
    node.data.model = pick.model ? normalizeKnownImageModelAlias(pick.model, currentProviderForNode(node, 'image')) : '';
    refreshNodeProviderSelects();
    refreshNodeCapabilityControls(node);
    applyNodeMediaLayout(node);
    applyCanvasFilters();
    queueSave();
  }
  refreshNodeModelSelects();
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
function composerPresetPopHtml(kind, current) {
  const field = COMPOSER_FIELDS[kind];
  const items = COMPOSER_PRESETS[kind] || [];
  return `<div class="composer-pop hidden" data-composer-pop="${esc(kind)}">${items.map(value =>
    `<button type="button" class="composer-pick${current === value ? ' on' : ''}" data-composer-set="${esc(field)}" data-value="${esc(value)}">${esc(value)}</button>`
  ).join('')}</div>`;
}
function composerTabButtonHtml(kind, label, current) {
  return `<button type="button" class="composer-tab${current ? ' on' : ''}" data-composer-tab="${esc(kind)}" data-tab-label="${esc(label)}" role="tab">${esc(current ? `${label}·${current}` : label)}</button>`;
}
function composerPresetPaneHtml(kind, current) {
  return `<div class="composer-pane composer-presets hidden" data-composer-pane="${esc(kind)}">${(COMPOSER_PRESETS[kind] || []).map(value =>
    `<button type="button" class="composer-pick${current === value ? ' on' : ''}" data-composer-set="${esc(COMPOSER_FIELDS[kind])}" data-value="${esc(value)}">${esc(value)}</button>`
  ).join('')}</div>`;
}
function selectComposerTab(root, kind) {
  root.querySelectorAll('[data-composer-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.composerTab === kind));
  root.querySelectorAll('[data-composer-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.composerPane !== kind));
}
function positionImageComposer(node) {
  if (node?.type !== 'image' || !host.selectedNodes.has(node.id)) return;
  requestAnimationFrame(() => {
    const panel = node.el.querySelector('.node-composer');
    const canvas = $('canvas');
    if (!panel || !canvas) return;
    panel.classList.remove('panel-above');
    const bounds = canvas.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const nodeRect = node.el.getBoundingClientRect();
    if (panelRect.bottom > bounds.bottom - 56 && nodeRect.top - panelRect.height > bounds.top + 48) {
      panel.classList.add('panel-above');
    }
  });
}
function imageShotLabel(node) {
  const aspect = String(node?.data?.aspect || '') === 'custom' ? '自定义' : (node?.data?.aspect || '16:9');
  const resolution = node?.data?.resolution || '1K';
  const count = Math.max(1, Math.min(4, parseInt(node?.data?.count, 10) || 1));
  return `${aspect} · ${resolution} · ${count}张`;
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
function closeComposerPops(root, except) {
  root?.querySelectorAll('[data-shot-pop],[data-composer-pop]').forEach(el => {
    if (el !== except) el.classList.add('hidden');
  });
}
function updateImageComposerSummary(node) {
  if (!node?.el || node.type !== 'image') return;
  const shot = node.el.querySelector('[data-shot-label]');
  if (shot) shot.textContent = imageShotLabel(node);
  const cost = node.el.querySelector('[data-cost-estimate]');
  if (cost) {
    const label = imageCostLabel(node);
    cost.textContent = label ? `⚡ ${label}` : '';
    cost.classList.toggle('hidden', !label);
  }
  node.el.querySelectorAll('[data-composer-menu]').forEach(btn => {
    const field = COMPOSER_FIELDS[btn.dataset.composerMenu];
    btn.classList.toggle('on', !!(field && node.data[field]));
  });
  node.el.querySelectorAll('[data-composer-tab][data-tab-label]').forEach(tab => {
    const value = node.data[COMPOSER_FIELDS[tab.dataset.composerTab]] || '';
    tab.classList.toggle('on', !!value);
    tab.textContent = value ? `${tab.dataset.tabLabel}·${value}` : tab.dataset.tabLabel;
  });
  node.el.querySelectorAll('[data-composer-set]').forEach(btn => {
    btn.classList.toggle('on', String(node.data[btn.dataset.composerSet] || '') === btn.dataset.value);
  });
  const more = node.el.querySelector('[data-composer-more]');
  const moreBtn = node.el.querySelector('[data-more-toggle]');
  moreBtn?.classList.toggle('on', more ? !more.classList.contains('hidden') : false);
  const transparent = node.data.backgroundMode === 'transparent';
  node.el.classList.toggle('transparent-preview', transparent);
  const toggle = node.el.querySelector('[data-background-toggle]');
  toggle?.classList.toggle('on', transparent);
  toggle?.setAttribute('aria-pressed', String(transparent));
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
    summary.textContent = [result.text, ...result.issues].join('\n');
    summary.classList.toggle('has-issues', !result.valid);
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
    if (picker) picker.innerHTML = modelPickerHtml(node);
    const control = node.el.querySelector('[data-field="model"]');
    if (!control) {
      refreshNodeCapabilityControls(node);
      return;
    }
    const options = modelOptionsHtml(node.type, node.data.model, node);
    if (control.tagName === 'SELECT') {
      control.innerHTML = options;
    } else {
      const list = control.getAttribute('list');
      const datalist = list ? node.el.querySelector(`#${CSS.escape(list)}`) : null;
      if (datalist) datalist.innerHTML = options;
    }
    control.value = node.data.model || '';
    refreshNodeCapabilityControls(node);
  });
}
function refreshNodeProviderSelects() {
  host.nodes.forEach(node => {
    if (node.type !== 'image' && node.type !== 'video') return;
    const select = node.el.querySelector('[data-field="providerId"]');
    if (!select) return;
    const capability = node.type === 'video' ? 'video' : 'image';
    select.innerHTML = providerOptionsHtml(node.data.providerId, capability);
    select.value = node.data.providerId || '';
  });
}
function bindNode(node) {
  const el = node.el;
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
    if (host.spacePanning) return;
    const refThumb = e.target.closest('.ref-thumb');
    if (refThumb) return startReferenceSort(e, node, refThumb);
    const port = e.target.closest('.port');
    if (port) return startPortDrag(e, node, port);
    if (isNodeInteractiveTarget(e.target) && !isNodeDragSurface(node, e.target)) return;
    if (e.button !== 0) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (host.selectedNodes.has(node.id)) host.selectedNodes.delete(node.id);
      else host.selectedNodes.add(node.id);
      renderSelection();
      e.preventDefault();
      return;
    }
    beginNodeDrag(node, e, e.pointerId);
    e.preventDefault();
  });
  el.addEventListener('mousedown', e => {
    if (host.dragging || host.spacePanning || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
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
    if (node.type === 'image' && field === 'model') {
      const provider = currentProviderForNode(node, 'image');
      node.data.model = normalizeKnownImageModelAlias(node.data.model, provider);
      e.target.value = node.data.model;
    }
    syncMediaSelection(node, field);
    if ((node.type === 'image' || node.type === 'video') && ['aspect', 'size', 'customWidth', 'customHeight', 'resolution'].includes(field)) {
      applyNodeMediaLayout(node);
    }
    if (node.type === 'video' && ['operation', 'duration', 'speed'].includes(field)) updateVideoDirectorControls(node);
    if (node.type === 'image') updateImageComposerSummary(node);
    applyCanvasFilters();
    queueSave();
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
      applyModelPick(node, e.target).catch(error => toast(error.message || String(error), 'error'));
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
    if (field === 'providerId' && (node.type === 'image' || node.type === 'video')) {
      const capability = node.type === 'video' ? 'video' : 'image';
      const provider = currentProviderForNode(node, capability);
      const defaultModel = node.data.providerId ? (node.type === 'video' ? provider?.videoModel : provider?.imageModel) : '';
      if (node.data.providerId && defaultModel) {
        node.data.model = defaultModel;
        const modelControl = node.el.querySelector('[data-field="model"]');
        if (modelControl) {
          modelControl.value = node.data.model;
        }
      } else if (!node.data.providerId) {
        node.data.model = '';
      }
      refreshNodeModelSelects();
    }
    if ((field === 'providerId' || field === 'model') && (node.type === 'image' || node.type === 'video')) {
      ensureSupportedVideoOperation(node);
      refreshNodeCapabilityControls(node);
      applyNodeMediaLayout(node);
    }
    if (node.type === 'video' && ['operation', 'duration', 'speed'].includes(field)) {
      updateVideoDirectorControls(node);
      renderReferenceBox(node.el.querySelector('[data-refbox]'), getResolvedImageRefItems(node.id, node.data.manualRefUrl || ''), 'video');
    }
    if (node.type === 'image') updateImageComposerSummary(node);
    if (e.target.matches('[data-upload]')) readUpload(node, e.target.files[0]);
    if (e.target.matches('[data-comfy-file]')) importComfyWorkflowIntoNode(node, e.target.files[0], e.target);
    applyCanvasFilters();
    queueSave();
  });
  el.addEventListener('click', e => {
    const port = e.target.closest('.port');
    if (port) return portClick(node, port);
    if (host.spacePanning) return;
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && (!isNodeInteractiveTarget(e.target) || isNodeDragSurface(node, e.target))) return;
    closeNodeContextMenu();
    const quick = e.target.closest('[data-quick]');
    if (quick) return runNodeContextAction(node, quick.dataset.quick);
    if (e.target.closest('[data-favorite]')) return toggleNodeFavorite(node.id);
    if (e.target.closest('[data-tags]')) return editNodeTags(node.id);
    if (e.target.closest('[data-rename]')) return renameNode(node.id);
    if (e.target.closest('[data-del]')) return deleteNode(node.id);
    if (e.target.closest('[data-dup]')) return duplicateNode(node.id);
    if (e.target.closest('[data-clear]')) { node.data.prompt = ''; hydrateNode(node); applyCanvasFilters(); saveProject(); return; }
    if (e.target.closest('[data-run="prompt"]')) return runPrompt(node.id);
    const composerTab = e.target.closest('[data-composer-tab]');
    if (composerTab) {
      selectComposerTab(el, composerTab.dataset.composerTab);
      positionImageComposer(node);
      return;
    }
    if (e.target.closest('[data-composer-close]')) {
      host.selectedNodes.delete(node.id);
      renderSelection();
      return;
    }
    if (e.target.closest('[data-background-toggle]')) {
      node.data.backgroundMode = node.data.backgroundMode === 'transparent' ? 'opaque' : 'transparent';
      const select = el.querySelector('[data-field="backgroundMode"]');
      if (select) select.value = node.data.backgroundMode;
      updateImageComposerSummary(node);
      queueSave();
      return;
    }
    if (e.target.closest('[data-shot-toggle]')) {
      const pop = el.querySelector('[data-shot-pop]');
      const willOpen = pop?.classList.contains('hidden');
      closeComposerPops(el);
      if (willOpen) pop?.classList.remove('hidden');
      return;
    }
    if (e.target.closest('[data-composer-menu]')) {
      const kind = e.target.closest('[data-composer-menu]').dataset.composerMenu;
      const pop = el.querySelector(`[data-composer-pop="${kind}"]`);
      const willOpen = pop?.classList.contains('hidden');
      closeComposerPops(el);
      if (willOpen) pop?.classList.remove('hidden');
      return;
    }
    if (e.target.closest('[data-composer-set]')) {
      const pick = e.target.closest('[data-composer-set]');
      const field = pick.dataset.composerSet;
      const value = pick.dataset.value;
      node.data[field] = node.data[field] === value ? '' : value;
      closeComposerPops(el);
      updateImageComposerSummary(node);
      saveProject();
      return;
    }
    if (e.target.closest('[data-more-toggle]')) {
      const more = el.querySelector('[data-composer-more]');
      more?.classList.toggle('hidden');
      updateImageComposerSummary(node);
      positionImageComposer(node);
      return;
    }
    if (e.target.closest('[data-shot-pop],[data-composer-pop]')) return;
    closeComposerPops(el);
    if (e.target.closest('[data-run="image"]')) { runImageFromComposer(node).catch(() => {}); return; }
    if (e.target.closest('[data-run="video"]')) return runVideo(node.id);
    if (e.target.closest('[data-run="comfyui"]')) return runComfyUI(node.id);
    if (e.target.closest('[data-run="media-tool"]')) return runMediaTool(node.id);
    if (e.target.closest('[data-comfy-test]')) return testComfyUI();
    if (e.target.closest('[data-comfy-import]')) return el.querySelector('[data-comfy-file]')?.click();
    if (e.target.closest('[data-comfy-save-global]')) return saveComfyNodeWorkflowGlobal(node);
    if (e.target.closest('[data-comfy-export]')) return exportComfyWorkflowText(node.data.workflowJson || $('comfyWorkflowJson')?.value || '', node.data.workflowName || 'comfyui-workflow');
    if (e.target.closest('[data-comfy-refresh]')) { hydrateNode(node); saveProject(); return toast('ComfyUI workflow 结构已刷新', 'success'); }
    if (e.target.closest('[data-optimize-prompt]')) return optimizePrompt(node.id);
    if (e.target.closest('[data-upload-btn]')) return el.querySelector('[data-upload]').click();
    if (e.target.closest('[data-clear-ref]')) {
      node.data.refUrl = '';
      node.data.manualRefUrl = '';
      node.data.refOrder = [];
      node.data.references = [];
      host.edges = host.edges.filter(edge => !(edge.to === node.id && edge.toPort === 'ref'));
      hydrateNode(node);
      drawEdges();
      saveProject();
      return;
    }
    if (e.target.closest('[data-open-ref]')) return;
    if (e.target.closest('[data-safe]')) { node.data.prompt = softenPrompt(node.data.prompt); hydrateNode(node); saveProject(); return; }
    if (e.target.closest('[data-preview-request],[data-last-request]')) {
      try { return previewImageRequest(node.id, getResolvedImageRefItems(node.id, node.data.manualRefUrl || ''), Boolean(e.target.closest('[data-last-request]'))); }
      catch (error) { return toast(error.message, 'warn'); }
    }
    if (e.target.closest('[data-copy-prompt]')) return navigator.clipboard?.writeText(node.data.prompt || '');
    const variantThumb = e.target.closest('[data-select-variant]');
    if (variantThumb) {
      const urls = imagePreviewUrls(node);
      const next = urls[Number(variantThumb.dataset.selectVariant)];
      if (next && node.data.url !== next) {
        node.data.url = next;
        hydrateNode(node);
        saveProject();
      }
      selectSingleNode(node.id);
      return;
    }
    if (e.target.closest('[data-download]')) {
      const urls = imagePreviewUrls(node);
      if (urls.length > 1) urls.forEach((url, index) => setTimeout(() => downloadImage(url), index * 250));
      else downloadImage(node.data.url);
      return;
    }
    if (e.target.closest('[data-download-video]')) return downloadMedia(node.data.url, 'future_video_' + Date.now() + '.mp4');
    if (e.target.closest('[data-download-media]')) return downloadMedia(node.data.url, safeDownloadName(node));
    selectSingleNode(node.id);
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
    if (node.type !== 'image' && node.type !== 'video') return;
    e.preventDefault();
    showNodeContextMenu(node, e.clientX, e.clientY);
  });
}
function beginNodeDrag(node, e, pointerId = null) {
  releaseDrags(false);
  if (!host.selectedNodes.has(node.id)) selectSingleNode(node.id);
  const dragIds = expandNodeIdsForGroups(host.selectedNodes.has(node.id) ? host.selectedNodes : new Set([node.id]));
  const items = [...dragIds]
    .map(id => host.nodes.get(id))
    .filter(Boolean)
    .map(item => ({node: item, startX: item.x, startY: item.y}));
  host.dragging = {node, items, x: e.clientX, y: e.clientY, pointerId};
  const moved = new Set(items.map(item => item.node.id));
  host.dragging.sizeById = new Map();
  host.groups?.forEach(group => {
    if (!group.nodeIds.some(id => moved.has(id))) return;
    group.nodeIds.forEach(id => {
      const member = host.nodes.get(id);
      if (member && !host.dragging.sizeById.has(id)) host.dragging.sizeById.set(id, nodeSize(member));
    });
  });
  const visiblePaths = new Map([...($('edges')?.querySelectorAll('[data-edge-index]') || [])]
    .map(path => [Number(path.dataset.edgeIndex), path]));
  host.dragging.edgePaths = host.edges.flatMap((edge, index) => {
    const path = visiblePaths.get(index);
    if (!path || (!moved.has(edge.from) && !moved.has(edge.to))) return [];
    const from = portCenter(edge.from, edge.fromPort, 'out');
    const to = portCenter(edge.to, edge.toPort, 'in');
    return from && to ? [{path, from, to, moveFrom: moved.has(edge.from), moveTo: moved.has(edge.to)}] : [];
  });
  items.forEach(item => item.node.el?.classList.add('drag-active'));
  document.body.style.cursor = 'grabbing';
  try {
    if (pointerId != null && node.el.setPointerCapture) node.el.setPointerCapture(pointerId);
  } catch (err) {
    host.dragging.pointerId = null;
  }
}
function isNodeInteractiveTarget(target) {
  return !!target.closest('button,input,textarea,select,option,a,video,.port,.node-actions,.node-composer,.text-expand-btn,[data-zoom]');
}
function isNodeDragSurface(node, target) {
  if (!node || (node.type !== 'image' && node.type !== 'video' && node.type !== 'upload' && node.type !== 'comfyui')) return false;
  if (target.closest('.ref-box,.image-panel,.upload-actions,.node-quick-toolbar,.node-actions')) return false;
  return !!target.closest('[data-preview],.image-preview,.upload-preview,[data-zoom]');
}
function selectSingleNode(id) {
  host.selectedNodes.clear();
  host.selectedNodes.add(id);
  renderSelection();
  positionImageComposer(host.nodes.get(id));
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
  node.el.querySelectorAll('[data-field]').forEach(input => {
    const key = input.dataset.field;
    const value = key === 'promptMode' ? (node.data.promptMode || 'raw') : key === 'quality' ? (node.data.quality || 'high') : (node.data[key] ?? '');
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
    renderReferenceBox(refbox, getResolvedImageRefItems(node.id, ''), 'image');
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
      runButton.innerHTML = node.data.videoTask
        ? '<i class="fa-solid fa-rotate"></i> 继续查询视频'
        : `<i class="fa-solid fa-video"></i> ${esc(VideoDirector?.operationDefinition(node.data.operation)?.label || '生成视频')}`;
    }
    const video = replacePreviewMedia(preview, 'video', node.data.url, {controls: true});
    if (!video) {
      preview.innerHTML = '<div><i class="fa-solid fa-video"></i><br>暂无视频</div>';
    } else {
      video.addEventListener('loadedmetadata', () => {
        if (video.videoWidth && video.videoHeight) {
          node.mediaNaturalUrl = node.data.url;
          node.mediaNaturalRatio = video.videoWidth / video.videoHeight;
          applyNodeMediaLayout(node);
        }
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
    updateVideoDirectorControls(node);
    if (status) {
      status.textContent = node.data.status || node.data.operationNotice || '';
      status.classList.toggle('hidden', !(node.data.status || node.data.operationNotice));
      status.classList.toggle('error', node.data.statusType === 'error');
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
      observePreviewImage(node, replacePreviewMedia(preview, 'img', url, {zoom: true, label: node.data.name || '图片素材'}), url);
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
    if (refbox) refbox.textContent = inputs.length ? `已连接 ${inputs.length} 个源素材 · 输出始终作为新版本` : '连接源素材后运行；真实处理会生成新文件，不覆盖源素材。';
    return;
  }
  if (node.type !== 'image') return;
  const preview = node.el.querySelector('[data-preview]');
  const refbox = node.el.querySelector('[data-refbox]');
  const urls = imagePreviewUrls(node);
  const url = urls[0] || '';
  preview?.classList.remove('has-variants');
  if (urls.length) {
    preview.classList.remove('has-status', 'is-error', 'is-running');
    if (urls.length === 1) observePreviewImage(node, replacePreviewMedia(preview, 'img', urls[0], {zoom: true}), urls[0]);
    else renderImageVariantPreview(preview, urls, safeMediaUrl(node.data.url || urls[0]), node);
  } else if (node.data.statusType && node.data.status) {
    preview.innerHTML = imageStatusHtml(node);
    preview.classList.add('has-status');
    preview.classList.toggle('is-error', node.data.statusType === 'error');
    preview.classList.toggle('is-running', node.data.statusType === 'running');
  } else {
    preview.innerHTML = '<div><i class="fa-solid fa-image"></i><br>暂无图片</div>';
    preview.classList.remove('has-status', 'is-error', 'is-running');
  }
  renderReferenceBox(refbox, getResolvedImageRefItems(node.id, node.data.manualRefUrl || ''), 'image');
  const status = node.el.querySelector('[data-status]');
  if (status) {
    const countLabel = urls.length > 1 ? `${urls.length} 张` : '';
    status.textContent = node.data.status || countLabel;
    status.classList.toggle('hidden', !status.textContent);
    status.classList.toggle('error', node.data.statusType === 'error');
  }
  updateImageComposerSummary(node);
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

function renderImageVariantPreview(preview, urls, activeUrl, node) {
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
    loadCanvasPreview(img, url);
    img.alt = `第 ${index + 1} 张`;
    if (url === activeUrl) observePreviewImage(node, img, url);
    const badge = document.createElement('span');
    badge.textContent = `${index + 1}/${urls.length}`;
    button.append(img, badge);
    preview.appendChild(button);
    hydrateCanvasPreviews(img);
  });
}

function observePreviewImage(node, img, url) {
  if (!img) return;
  const update = () => {
    if (!img.naturalWidth || !img.naturalHeight || !node.el.isConnected) return;
    if (node.type === 'image' && !imagePreviewUrls(node).includes(url)) return;
    if (node.type === 'upload' && safeMediaUrl(node.data.url) !== url) return;
    node.mediaNaturalUrl = url;
    node.mediaNaturalRatio = img.naturalWidth / img.naturalHeight;
    applyNodeMediaLayout(node);
  };
  img.addEventListener('load', update, {once: true});
  if (img.complete) update();
}

function loadCanvasPreview(img, url) {
  if (!img) return;
  img.loading = 'lazy';
  if (!url.startsWith('file:') || !window.localStorageBridge?.canvasPreview) {
    img.src = url;
    return;
  }
  img.dataset.originalUrl = url;
  hydrateCanvasPreviews(img);
}
function hydrateCanvasPreviews(root) {
  const images = root.matches?.('img[data-original-url]') ? [root] : root.querySelectorAll?.('img[data-original-url]') || [];
  images.forEach(img => {
    if (!img.isConnected || img.closest('.node-offscreen') || img.closest('.canvas.is-panning,.canvas.is-zooming') || img.dataset.previewLoading === '1') return;
    const url = img.dataset.originalUrl;
    img.dataset.previewLoading = '1';
    window.localStorageBridge.canvasPreview(url).then(previewUrl => {
      if (img.dataset.originalUrl === url) img.src = previewUrl || url;
    }).catch(() => {
      if (img.dataset.originalUrl === url) img.src = url;
    });
  });
}
function replacePreviewMedia(preview, tagName, value, {controls = false, zoom = false, label = ''} = {}) {
  const url = safeMediaUrl(value);
  if (!preview || !url || !['img', 'video'].includes(tagName)) return null;
  const media = document.createElement(tagName);
  if (tagName === 'img') loadCanvasPreview(media, url);
  else media.src = url;
  if (tagName === 'video') media.controls = controls;
  if (zoom) media.dataset.zoom = '';
  preview.replaceChildren(media);
  if (tagName === 'img') hydrateCanvasPreviews(media);
  if (label) {
    const title = document.createElement('strong');
    title.textContent = String(label);
    preview.appendChild(title);
  }
  return media;
}
function mediaAspectRatio(node) {
  if (!node || (node.type !== 'image' && node.type !== 'video' && node.type !== 'upload')) return 1;
  const url = node.type === 'image' ? safeMediaUrl(node.data.url || imagePreviewUrls(node)[0]) : safeMediaUrl(node.data.url);
  if (url && url === node.mediaNaturalUrl && Number.isFinite(node.mediaNaturalRatio)) return node.mediaNaturalRatio;
  if (node.type === 'upload') return 16 / 9;
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
  if (!node?.el || (node.type !== 'image' && node.type !== 'video' && node.type !== 'upload')) return;
  const sync = () => {
    const ratio = mediaAspectRatio(node);
    const previewHeight = 292;
    node.el.style.setProperty('--node-media-ratio', String(ratio));
    node.el.style.setProperty('--node-preview-height', `${previewHeight}px`);
    const preview = node.el.querySelector('[data-preview]');
    preview?.style.setProperty('--node-media-ratio', String(ratio));
    preview?.style.setProperty('--node-preview-height', `${previewHeight}px`);
  };
  const width = node.el.offsetWidth || Number.parseFloat(getComputedStyle(node.el).width) || 430;
  sync();
  updateMediaSizeSummary(node);
  if (node.type === 'image') updateImageCustomSizeControls(node);
  if (!node.mediaLayoutObserver && typeof ResizeObserver === 'function') {
    node.mediaLayoutWidth = Math.round(width);
    node.mediaLayoutObserver = new ResizeObserver(entries => {
      const nextWidth = Math.round(entries[0]?.contentRect?.width || node.el.offsetWidth || 0);
      if (!nextWidth || nextWidth === node.mediaLayoutWidth) return;
      node.mediaLayoutWidth = nextWidth;
      sync();
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
function duplicateNode(id) {
  const n = host.nodes.get(id);
  if (!n) return;
  addNode(n.type, n.x + 42, n.y + 42, JSON.parse(JSON.stringify(n.data)));
}
function imageNodeHasOutput(node) {
  return Boolean(node?.data?.url || (Array.isArray(node?.data?.urls) && node.data.urls.some(Boolean)));
}
function imageRegenerationData(node) {
  const data = JSON.parse(JSON.stringify(node?.data || {}));
  data.url = '';
  data.urls = [];
  data.imageVersions = [];
  data.variants = [];
  data.provenanceRecords = [];
  delete data.approval;
  delete data.selectedVariantId;
  delete data.generatedAt;
  delete data.outputNormalization;
  delete data.lastImageRequest;
  delete data.outputModel;
  delete data.outputMetadata;
  delete data.status;
  delete data.statusType;
  delete data.statusTitle;
  delete data.lastEstimatedCost;
  return data;
}
function imageRegenerationPosition(node) {
  const width = Math.max(420, Number(node?.el?.offsetWidth || 0));
  const height = Math.max(320, Number(node?.el?.offsetHeight || 0));
  const x = Number(node?.x || 0) + width + 56;
  let y = Number(node?.y || 0);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const occupied = [...host.nodes.values()].some(candidate => (
      candidate.id !== node.id
      && Math.abs(Number(candidate.x || 0) - x) < width * .82
      && Math.abs(Number(candidate.y || 0) - y) < height * .82
    ));
    if (!occupied) return {x, y};
    y += height + 48;
  }
  return {x, y};
}
function createImageRegenerationNode(node) {
  if (!node || node.type !== 'image') return node;
  const position = imageRegenerationPosition(node);
  const next = addNode('image', position.x, position.y, imageRegenerationData(node), null, false);
  host.edges
    .filter(edge => edge.to === node.id && (edge.toPort === 'prompt' || edge.toPort === 'ref'))
    .forEach(edge => connectSilently(edge.from, edge.fromPort, next.id, edge.toPort));
  selectSingleNode(next.id);
  saveProject();
  return next;
}
function runImageFromComposer(node) {
  const target = imageNodeHasOutput(node) ? createImageRegenerationNode(node) : node;
  return runImage(target.id);
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
      node.data.url = result;
      node.data.name = file.name || '上传素材';
      node.data.mime = file.type || '';
      node.data.sizeBytes = Math.max(0, Number(file.size || 0));
      node.data.kind = isVideoMedia(file.type, result) ? 'video' : 'image';
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
function setImageStatus(node, statusType, status = '', statusTitle = '') {
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
  hydrateNode(node);
}
function imageErrorTitle(refCount) {
  return refCount > 1 ? '多参考图生图失败' : refCount === 1 ? '图生图失败' : '生成失败';
}
function referencePreviewHtml(item, label, index = 0) {
  const options = ReferenceRoles?.rolesForNode(item.nodeType || 'image') || ['reference'];
  const roleOptions = options.map(role => `<option value="${esc(role)}"${role === item.role ? ' selected' : ''}>${esc(ReferenceRoles?.roleLabel(role) || role)}</option>`).join('');
  const supportsTime = item.nodeType === 'video' && ['first-frame', 'last-frame', 'keyframe'].includes(item.role);
  const duration = Math.max(0.1, Number(item.targetDuration || 5) || 5);
  const fallbackTime = item.role === 'first-frame' ? 0 : item.role === 'last-frame' ? duration : '';
  const timeControl = supportsTime
    ? `<label class="ref-time-field" title="关键帧在视频中的时间位置"><input type="number" min="0" max="${duration}" step="0.1" value="${esc(item.frameTime ?? fallbackTime)}" data-reference-time data-ref-key="${esc(item.key)}"><span>秒</span></label>`
    : '';
  return UIRenderHelpers.referencePreviewHtml({item, label, index, esc, isVideo: isVideoMedia, roleOptions, timeControl});
}
function renderReferenceBox(refbox, refs, kind = 'image') {
  if (!refbox) return;
  const list = uniqueRefItems(refs);
  if (!list.length) {
    refbox.innerHTML = kind === 'video' ? '可连接图片作为首帧 / 参考' : '未连接或上传参考图';
    refbox.classList.remove('has-refs');
    return;
  }
  refbox.classList.add('has-refs');
  refbox.innerHTML = list.map((item, i) => referencePreviewHtml(Object.assign({}, item, {targetDuration: refbox.closest('.node') ? host.nodes.get(refbox.closest('.node').dataset.node)?.data?.duration : 5}), ReferenceRoles?.roleLabel(item.role) || (i === 0 ? '主体图' : '参考图'), i)).join('');
  refbox.querySelectorAll('img[data-canvas-preview-src]').forEach(img => loadCanvasPreview(img, img.dataset.canvasPreviewSrc));
  if (host.refSorting?.node?.id === refbox.closest('.node')?.dataset.node) {
    refbox.classList.add('sorting');
    refbox.querySelector(`[data-ref-key="${CSS.escape(host.refSorting.key)}"]`)?.classList.add('sorting');
  }
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
  if (target?.data) target.data.references = merged;
  return merged.map(item => Object.assign({nodeType: target?.type || 'image'}, item));
}
function getResolvedImageRefs(id, manualRef = '') {
  return getResolvedImageRefItems(id, manualRef).map(item => item.url);
}
function updateReferenceRole(node, key, role) {
  const refs = getResolvedImageRefItems(node.id, node.data.manualRefUrl || '');
  const result = ReferenceRoles?.setReferenceRole(refs, key, role);
  if (!result || result.error) {
    hydrateNode(node);
    toast(result?.error || '参考素材用途更新失败', 'warn');
    return;
  }
  node.data.references = result.references.map((item, index) => Object.assign({}, item, {order: index}));
  if (node.type === 'video') node.data.references = VideoDirector?.ensureKeyframeTimes(node.data.references, node.data.duration) || node.data.references;
  node.data.refOrder = node.data.references.map(item => item.key);
  hydrateNode(node);
  saveProject();
  toast(`已设为${ReferenceRoles.roleLabel(role)}`, 'success');
}
function updateReferenceFrameTime(node, key, value) {
  const refs = getResolvedImageRefItems(node.id, node.data.manualRefUrl || '');
  const result = ReferenceRoles?.setReferenceFrameTime(refs, key, value, node.data.duration);
  if (!result || result.error) {
    hydrateNode(node);
    toast(result?.error || '关键帧时间更新失败', 'warn');
    return;
  }
  node.data.references = result.references.map((item, index) => Object.assign({}, item, {order: index}));
  node.data.refOrder = node.data.references.map(item => item.key);
  hydrateNode(node);
  saveProject();
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
  node.data.references = refs.map((item, index) => Object.assign({}, item, {order: index}));
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
  if (!targetPort) return toast('拖到目标端口后松开即可连接', 'warn');
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
  toast(toPort === 'ref' ? '已连接为参考图输入' : '已连接为提示词输入', 'success');
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
  node.data.references = items.map((item, index) => Object.assign({}, item, {order: index}));
  hydrateNode(node);
}
function refreshLinkedInputTargets(ids) {
  unique(ids).forEach(id => hydrateLinkedInputs(host.nodes.get(id)));
}
function refreshDownstreamLinkedInputs(sourceId) {
  refreshLinkedInputTargets(host.edges.filter(e => e.from === sourceId && e.toPort === 'ref').map(e => e.to));
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
  if (fast) {
    const width = node.type === 'image' || node.type === 'upload' ? 520
      : node.type === 'video' || node.type === 'comfyui' ? 430 : 320;
    const y = node.type === 'image' || node.type === 'video' ? 101
      : node.type === 'upload' ? 133 : 90;
    return {x: node.x + (io === 'out' ? width : 0), y: node.y + y};
  }
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
  if (host.dragging) return updateDragEdges();
  const svg = $('edges');
  updatePortConnectionStates();
  const view = currentWorldBounds(180);
  const viewportRect = $('viewport').getBoundingClientRect();
  const paths = document.createDocumentFragment();
  host.edges.forEach((edge, index) => {
    const fromNode = host.nodes.get(edge.from);
    const toNode = host.nodes.get(edge.to);
    if (!fromNode || !toNode) return;
    if (!fromNode.mounted || !toNode.mounted) return;
    if (fromNode.el?.classList.contains('search-hidden') || toNode.el?.classList.contains('search-hidden')) return;
    const a = portCenter(edge.from, edge.fromPort, 'out', viewportRect);
    const b = portCenter(edge.to, edge.toPort, 'in', viewportRect);
    if (!a || !b) return;
    if (!segmentIntersectsView(a, b, view)) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', edgePathD(a, b));
    path.setAttribute('class', edgeClassName(edge.toPort));
    path.dataset.edgeIndex = String(index);
    paths.appendChild(path);
  });
  svg.replaceChildren(paths);
}
function updateDragEdges() {
  const drag = host.dragging;
  if (!drag?.edgePaths?.length) return;
  const dx = drag.items[0].node.x - drag.items[0].startX;
  const dy = drag.items[0].node.y - drag.items[0].startY;
  drag.edgePaths.forEach(({path, from, to, moveFrom, moveTo}) => {
    const a = moveFrom ? {x: from.x + dx, y: from.y + dy} : from;
    const b = moveTo ? {x: to.x + dx, y: to.y + dy} : to;
    path.setAttribute('d', edgePathD(a, b));
  });
}
function scheduleDrawEdges() {
  if (host.dragging) {
    updateDragEdges();
    return;
  }
  if (host.edgeFrame) return;
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
      nodeQuickToolbar,
      getModelOptions,
      modelOptionsHtml,
      refreshNodeModelSelects,
      refreshNodeProviderSelects,
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
      hydrateCanvasPreviews,
      imagePreviewUrls,
      applyNodeMediaLayout,
      deleteNode,
      duplicateNode,
      imageNodeHasOutput,
      imageRegenerationData,
      imageRegenerationPosition,
      createImageRegenerationNode,
      runImageFromComposer,
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
