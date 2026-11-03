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
    if (Array.isArray(normalized.videoVersions)) {
      normalized.videoVersions.forEach(item => {
        if (!item || typeof item !== 'object') return;
        delete item.outputDimensions;
        if (item.outputMetadata && typeof item.outputMetadata === 'object') delete item.outputMetadata.actualSize;
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
      ? {prompt: '', model: defaults.imageModel || 'gpt-image2', quality: 'high', backgroundMode: 'opaque', promptMode: 'raw', aspect: '16:9', size: '1024x576', resolution: '1K', count: '1', url: '', urls: [], refUrl: '', manualRefUrl: '', refOrder: [], references: []}
      : type === 'video'
        ? {prompt: '', model: defaults.videoModel || 'omni-flash', operation: 'text-to-video', mode: 'auto', size: '1280x720', customWidth: '', customHeight: '', duration: '5', speed: '1', loop: false, url: '', urls: [], refUrl: '', manualRefUrl: '', refOrder: [], references: [], videoVersions: [], outputMetadata: null}
        : type === 'upload'
          ? {url: '', name: '', mime: '', kind: '', prompt: ''}
          : type === 'media-tool'
            ? {operation: 'extract-first-frame', sourceUrls: [], url: '', urls: [], status: '', statusType: '', width: '1280', height: '720', start: '0', duration: '5', time: '0', speed: '1', loops: '2', volume: '1', shiftSeconds: '0', format: 'png', background: '#000000', subtitleText: '', mediaVersions: [], transformations: []}
          : type === 'comfyui'
            ? {prompt: '', negative: '', seed: '', width: '1024', height: '1024', workflowName: defaults.comfyWorkflowName || '默认工作流', workflowJson: defaults.comfyWorkflowJson || '', promptId: '', url: '', urls: [], status: '', statusType: '', statusTitle: ''}
            : {prompt: ''};
    const normalized = Object.assign(base, data || {});
    if ((type === 'image' || type === 'video') && !Array.isArray(normalized.references)) normalized.references = [];
    if (type === 'video') {
      const director = window.FutureAIVideoDirector;
      normalized.operation = director?.normalizeOperation(normalized.operation, normalized.mode) || normalized.operation || (normalized.mode === 'image' ? 'image-to-video' : 'text-to-video');
      normalized.speed = String(Math.max(0.1, Math.min(4, Number(normalized.speed || 1) || 1)));
      normalized.videoVersions = Array.isArray(normalized.videoVersions) ? normalized.videoVersions : [];
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

  window.FutureAICanvasNodes = {
    defaultPromptFor,
    normalizeTags,
    normalizeNodeMetadata,
    normalizeData,
    nodeDefaultTitle,
    nodeDisplayTitle,
    canvasSearchText
  };
})();
