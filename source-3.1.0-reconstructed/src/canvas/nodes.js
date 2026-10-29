(() => {
  'use strict';

  function unique(values) {
    return [...new Set(values)];
  }

  function defaultPromptFor(type) {
    if (type === 'character') return '角色卡：姓名 / 年龄段 / 身份 / 服装 / 发型 / 性格 / 固定特征 / 禁用变化。';
    if (type === 'video') return '输入视频指令，可连接图片节点作为首帧或参考。';
    if (type === 'image') return '';
    if (type === 'media-tool') return '连接源素材，选择本地处理操作后运行。';
    return '镜头 01：角色建立，明确人物身份、服装、场景、光线和情绪。';
  }

  function normalizeTags(value) {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[,，\n]/);
    return unique(raw.map(tag => String(tag || '').trim()).filter(Boolean)).slice(0, 12);
  }

  function normalizeNodeMetadata(data) {
    const normalized = data || {};
    delete normalized.outputDimensions;
    delete normalized.outputNormalization;
    if (normalized.outputMetadata && typeof normalized.outputMetadata === 'object') {
      delete normalized.outputMetadata.actualSize;
    }
    delete normalized.outputDimensions;
    if (Array.isArray(normalized.variants)) {
      normalized.variants.forEach(item => { if (item && typeof item === 'object') delete item.actualSize; });
    }
    if (Array.isArray(normalized.provenanceRecords)) {
      normalized.provenanceRecords.forEach(item => {
        if (item?.actual && typeof item.actual === 'object') delete item.actual.size;
      });
    }
    return Object.assign(normalized, {
      favorite: Boolean(data?.favorite),
      tags: normalizeTags(data?.tags)
    });
  }

  function normalizeData(type, data, defaults = {}) {
    const dimensions = window.FutureAIMediaDimensions;
    const base = type === 'image'
      ? {prompt: '', model: defaults.imageModel || 'gpt-image2', aspect: '16:9', size: '1024x576', resolution: '1K', count: '1', url: '', urls: [], refUrl: '', manualRefUrl: '', refOrder: [], references: []}
      : type === 'video'
        ? {prompt: '', model: defaults.videoModel || 'omni-flash', operation: 'text-to-video', mode: 'auto', size: '1280x720', customWidth: '', customHeight: '', duration: '5', speed: '1', loop: false, url: '', urls: [], refUrl: '', manualRefUrl: '', refOrder: [], references: [], outputMetadata: null}
        : type === 'upload'
          ? {url: '', name: '', mime: '', kind: '', prompt: ''}
          : type === 'media-tool'
            ? {operation: 'extract-first-frame', sourceUrls: [], url: '', urls: [], status: '', statusType: '', width: '1280', height: '720', start: '0', duration: '5', time: '0', speed: '1', loops: '2', volume: '1', shiftSeconds: '0', format: 'png', background: '#000000', subtitleText: '', transformations: []}
          : type === 'comfyui'
            ? {prompt: '', negative: '', seed: '', width: '1024', height: '1024', workflowName: defaults.comfyWorkflowName || '默认工作流', workflowJson: defaults.comfyWorkflowJson || '', promptId: '', url: '', urls: [], status: '', statusType: '', statusTitle: ''}
            : {prompt: ''};
    const normalized = Object.assign(base, data || {});
    if ((type === 'image' || type === 'video') && !Array.isArray(normalized.references)) normalized.references = [];
    if (type === 'image' || type === 'video') window.FutureAIVariantManager?.migrateLegacyHistory(normalized, type);
    if (type === 'image') {
      // Retired per-node settings: image quality is always 'high' and the prompt is always composed the same way.
      delete normalized.quality;
      delete normalized.promptMode;
    }
    if (type === 'video') {
      const director = window.FutureAIVideoDirector;
      normalized.operation = director?.normalizeOperation(normalized.operation, normalized.mode) || normalized.operation || (normalized.mode === 'image' ? 'image-to-video' : 'text-to-video');
      normalized.speed = String(Math.max(0.1, Math.min(4, Number(normalized.speed || 1) || 1)));
    }
    if (type === 'image' && dimensions) {
      const oldSelection = String(data?.aspect || data?.size || '16:9');
      normalized.aspect = oldSelection === 'custom' ? 'custom' : dimensions.normalizeAspect(oldSelection, '16:9');
      normalized.size = normalized.aspect === 'custom'
        ? 'custom'
        : dimensions.imageSizeForResolution(normalized.aspect, normalized.resolution || '1K');
    }
    if (type === 'video' && dimensions) {
      const target = dimensions.videoTargetSize(normalized);
      normalized.size = target || 'custom';
    }
    return normalizeNodeMetadata(normalized);
  }

  function nodeDefaultTitle(node) {
    return ({
      image: '图片节点',
      video: '视频节点',
      upload: '上传节点',
      'media-tool': '本地媒体工具',
      comfyui: 'ComfyUI 节点',
      character: '角色卡',
      prompt: '提示词'
    })[node?.type] || '节点';
  }

  function nodeDisplayTitle(node) {
    return String(node?.data?.title || '').trim() || nodeDefaultTitle(node);
  }

  function canvasSearchText(node) {
    const data = node?.data || {};
    return [
      node?.type,
      nodeDisplayTitle(node),
      data.prompt,
      data.negative,
      data.model,
      data.operation,
      data.workflowName,
      data.name,
      data.mime,
      ...(Array.isArray(data.tags) ? data.tags : [])
    ].map(value => String(value || '').toLowerCase()).join('\n');
  }

  // 2x upscale target for the local image-resize tool, capped to the tool's 7680px limit.
  function upscaleSize(size, factor = 2, max = 7680) {
    const width = Number(size?.width || 0);
    const height = Number(size?.height || 0);
    if (!(width > 0 && height > 0)) return null;
    const scale = Math.min(factor, max / Math.max(width, height));
    if (scale <= 1) return null;
    return {width: Math.round(width * scale), height: Math.round(height * scale)};
  }

  // Next-step choices when a wire is dropped on empty canvas. io is the dragged port side;
  // mediaKind is what the source outputs ('text' | 'image' | 'video' | ''), sourceSize its pixel size if known.
  function wireDropOptions(node, io, mediaKind = '', sourceSize = null) {
    if (!node) return [];
    const option = (id, label, icon, type, data = {}) => ({id, label, icon, type, data});
    if (io === 'in') {
      if (node.type === 'media-tool') return [option('upload', '上传素材', 'fa-upload', 'upload')];
      if (node.type !== 'image' && node.type !== 'video') return [];
      return [
        option('prompt', '提示词', 'fa-note-sticky', 'prompt', {prompt: ''}),
        option('upload', '上传参考', 'fa-upload', 'upload'),
        option('image', node.type === 'video' ? '生成首帧图' : '生成参考图', 'fa-image', 'image')
      ];
    }
    if (mediaKind === 'text') {
      return [
        option('text-to-image', '文生图', 'fa-image', 'image'),
        option('text-to-video', '文生视频', 'fa-video', 'video', {operation: 'text-to-video'})
      ];
    }
    if (mediaKind === 'image') {
      const list = [
        option('image-to-image', '图生图', 'fa-rotate', 'image'),
        option('image-to-video', '图生视频', 'fa-wand-magic-sparkles', 'video', {operation: 'image-to-video'})
      ];
      const size = upscaleSize(sourceSize);
      if (size) list.push(option('upscale', `放大 2× · ${size.width}×${size.height}`, 'fa-up-right-and-down-left-from-center', 'media-tool', {operation: 'image-resize', width: String(size.width), height: String(size.height), format: 'png'}));
      return list;
    }
    if (mediaKind === 'video') {
      return [
        option('last-frame', '截取尾帧', 'fa-forward-step', 'media-tool', {operation: 'extract-last-frame', format: 'png'}),
        option('first-frame', '截取首帧', 'fa-backward-step', 'media-tool', {operation: 'extract-first-frame', format: 'png'}),
        option('trim', '剪辑片段', 'fa-scissors', 'media-tool', {operation: 'video-trim'})
      ];
    }
    return [];
  }

  // Stacking order from the context menu (置顶/置底); 0 keeps the stylesheet default.
  function layerZIndex(data) {
    const z = Math.round(Number(data?.z) || 0);
    return z ? String(Math.max(3, Math.min(70, 10 + z))) : '';
  }

  window.FutureAICanvasNodes = {
    defaultPromptFor,
    normalizeTags,
    normalizeNodeMetadata,
    normalizeData,
    nodeDefaultTitle,
    nodeDisplayTitle,
    canvasSearchText,
    upscaleSize,
    wireDropOptions,
    layerZIndex
  };
})();
