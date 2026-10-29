(function () {
  'use strict';

  const OPERATION_DEFS = Object.freeze([
    {id: 'text-to-video', label: '文生视频', capability: 'generate', icon: 'fa-font'},
    {id: 'image-to-video', label: '单图生视频', capability: 'generate', icon: 'fa-image'},
    {id: 'first-last-frame', label: '首帧 + 尾帧', capability: 'first-last-frame', icon: 'fa-images'},
    {id: 'keyframes', label: '多关键帧', capability: 'keyframes', icon: 'fa-film'},
    {id: 'edit', label: '编辑视频', capability: 'edit', icon: 'fa-pen-to-square'},
    {id: 'stylize', label: '视频风格化', capability: 'stylize', icon: 'fa-palette'},
    {id: 'local-edit', label: '局部修改', capability: 'local-edit', icon: 'fa-crop-simple'},
    {id: 'extend-forward', label: '向后延长', capability: 'extend', icon: 'fa-arrow-right-long'},
    {id: 'extend-backward', label: '向前延长', capability: 'extend', icon: 'fa-arrow-left-long'},
    {id: 'loop', label: '生成循环视频', capability: 'loop', icon: 'fa-repeat'}
  ]);

  const DEF_BY_ID = new Map(OPERATION_DEFS.map(item => [item.id, item]));
  const SOURCE_VIDEO_OPERATIONS = new Set(['edit', 'stylize', 'local-edit', 'extend-forward', 'extend-backward', 'loop']);

  function unique(values = []) {
    return [...new Set(values.filter(Boolean))];
  }

  function operationDefinition(operation) {
    return DEF_BY_ID.get(normalizeOperation(operation)) || DEF_BY_ID.get('text-to-video');
  }

  function normalizeOperation(operation, legacyMode = '') {
    const value = String(operation || '').trim();
    if (DEF_BY_ID.has(value)) return value;
    if (value === 'generate') return legacyMode === 'image' ? 'image-to-video' : 'text-to-video';
    if (value === 'extend') return 'extend-forward';
    if (value === 'first-last') return 'first-last-frame';
    if (legacyMode === 'image') return 'image-to-video';
    return 'text-to-video';
  }

  function capabilityForOperation(operation) {
    return operationDefinition(operation).capability;
  }

  function supportsCapability(profile, capability) {
    const operations = Array.isArray(profile?.operations) ? profile.operations : [];
    if (operations.includes(capability)) return true;
    if (capability === 'stylize' || capability === 'local-edit') return operations.includes('edit');
    if (capability === 'extend') return operations.some(value => value === 'extend' || value === 'extend-forward' || value === 'extend-backward');
    return false;
  }

  function availableOperations(profile) {
    const imageMax = Math.max(0, Number(profile?.inputs?.image?.maxCount || 0));
    return OPERATION_DEFS.filter(item => {
      if (!supportsCapability(profile, item.capability)) return false;
      if (item.id === 'image-to-video' && imageMax < 1) return false;
      return true;
    }).map(item => Object.assign({}, item));
  }

  function mediaType(reference = {}) {
    const explicit = String(reference.mediaType || reference.kind || '').toLowerCase();
    if (['image', 'video', 'audio'].includes(explicit)) return explicit;
    const mime = String(reference.mime || '').toLowerCase();
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('image/')) return 'image';
    const role = String(reference.role || '');
    if (role === 'audio') return 'audio';
    if (role === 'motion' || role === 'source' && /\.(?:mp4|webm|mov|m4v|avi)(?:[?#]|$)/i.test(reference.url || '')) return 'video';
    const url = String(reference.url || '');
    if (/^(?:data:)?video\//i.test(url) || /\.(?:mp4|webm|mov|m4v|avi)(?:[?#]|$)/i.test(url)) return 'video';
    if (/^(?:data:)?audio\//i.test(url) || /\.(?:mp3|wav|m4a|aac|ogg|flac)(?:[?#]|$)/i.test(url)) return 'audio';
    return 'image';
  }

  function referencesByType(references = []) {
    const output = {image: [], video: [], audio: []};
    for (const reference of Array.isArray(references) ? references : []) output[mediaType(reference)].push(reference);
    return output;
  }

  function normalizedFrameTime(reference, duration) {
    if (reference?.role === 'first-frame') return 0;
    if (reference?.role === 'last-frame') return duration;
    const value = Number(reference?.frameTime);
    return Number.isFinite(value) ? Math.max(0, Math.min(duration, value)) : null;
  }

  function keyframeTimeline(references = [], durationValue = 5) {
    const duration = Math.max(0.1, Number(durationValue) || 5);
    return (Array.isArray(references) ? references : [])
      .filter(reference => ['first-frame', 'last-frame', 'keyframe'].includes(reference?.role))
      .map((reference, index) => Object.assign({}, reference, {
        originalIndex: index,
        frameTime: normalizedFrameTime(reference, duration)
      }))
      .sort((a, b) => {
        if (a.frameTime == null && b.frameTime == null) return a.originalIndex - b.originalIndex;
        if (a.frameTime == null) return 1;
        if (b.frameTime == null) return -1;
        return a.frameTime - b.frameTime || a.originalIndex - b.originalIndex;
      });
  }

  function ensureKeyframeTimes(references = [], durationValue = 5) {
    const duration = Math.max(0.1, Number(durationValue) || 5);
    const list = (Array.isArray(references) ? references : []).map(item => Object.assign({}, item));
    const indexes = list.map((item, index) => ['first-frame', 'last-frame', 'keyframe'].includes(item.role) ? index : -1).filter(index => index >= 0);
    indexes.forEach((index, order) => {
      if (list[index].role === 'first-frame') list[index].frameTime = 0;
      else if (list[index].role === 'last-frame') list[index].frameTime = duration;
      else if (!Number.isFinite(Number(list[index].frameTime))) list[index].frameTime = Number(((duration * (order + 1)) / (indexes.length + 1)).toFixed(2));
    });
    return list;
  }

  function validateRequest(request = {}) {
    const errors = [];
    const warnings = [];
    const operation = normalizeOperation(request.operation, request.mode);
    const refs = Array.isArray(request.references) ? request.references : [];
    const grouped = referencesByType(refs);
    const roleCount = role => refs.filter(item => item?.role === role).length;
    if (operation === 'image-to-video' && grouped.image.length < 1) errors.push({code: 'MISSING_IMAGE_REFERENCE', message: '单图生视频需要连接一张图片，并将用途设为首帧或普通参考。'});
    if (operation === 'first-last-frame' && (roleCount('first-frame') !== 1 || roleCount('last-frame') !== 1)) errors.push({code: 'MISSING_FIRST_LAST_FRAME', message: '首帧 + 尾帧需要各连接一张图片，并分别设置为首帧和尾帧。'});
    if (operation === 'keyframes') {
      const timeline = keyframeTimeline(refs, request.duration);
      if (timeline.length < 2) errors.push({code: 'TOO_FEW_KEYFRAMES', message: '多关键帧至少需要两张首帧、尾帧或关键帧图片。'});
      if (timeline.some(item => item.frameTime == null)) errors.push({code: 'MISSING_KEYFRAME_TIME', message: '每张关键帧都需要填写在视频中的时间位置。'});
      const times = timeline.map(item => item.frameTime).filter(value => value != null);
      if (new Set(times.map(String)).size !== times.length) errors.push({code: 'DUPLICATE_KEYFRAME_TIME', message: '关键帧时间不能重复，请调整时间位置。'});
    }
    if (SOURCE_VIDEO_OPERATIONS.has(operation) && grouped.video.length < 1) errors.push({code: 'MISSING_SOURCE_VIDEO', message: `${operationDefinition(operation).label}需要连接原视频，并将用途设为编辑原视频。`});
    const speed = Number(request.speed || 1);
    if (!Number.isFinite(speed) || speed < 0.1 || speed > 4) errors.push({code: 'INVALID_SPEED', message: '视频速度需要在 0.1 倍到 4 倍之间。'});
    if (grouped.audio.length > 1) warnings.push({code: 'MULTIPLE_AUDIO_REFERENCES', message: '已连接多份音频参考，接口可能只使用第一份。'});
    return {valid: errors.length === 0, errors, warnings, operation, grouped};
  }

  function operationInstructions(request = {}) {
    const operation = normalizeOperation(request.operation, request.mode);
    const label = operationDefinition(operation).label;
    const lines = [`视频导演操作：${label}。`];
    if (operation === 'first-last-frame') lines.push('严格以“首帧”作为开场，以“尾帧”作为结束，中间运动自然连续。');
    if (operation === 'keyframes') {
      const timeline = keyframeTimeline(request.references, request.duration);
      lines.push(`关键帧时间顺序：${timeline.map((item, index) => `${index + 1}. ${Number(item.frameTime || 0).toFixed(2)}秒`).join('；')}。`);
    }
    if (operation === 'edit') lines.push('保留原视频未要求修改的内容，只执行用户明确指定的编辑。');
    if (operation === 'stylize') lines.push('保留原视频主体、动作和剪辑节奏，只改变用户指定的视觉风格。');
    if (operation === 'local-edit') lines.push('只修改用户指定的局部区域或对象，其余画面保持不变。');
    if (operation === 'extend-forward') lines.push('从原视频结尾向后自然延长，不改写原视频已有段落。');
    if (operation === 'extend-backward') lines.push('在原视频开头之前自然补充内容，不改写原视频已有段落。');
    if (operation === 'loop') lines.push('让结尾能够无明显跳变地回到开头，形成无缝循环。');
    const speed = Number(request.speed || 1);
    if (Math.abs(speed - 1) > 0.001) lines.push(`目标播放速度：${speed}倍。`);
    return `\n\n${lines.join('\n')}`;
  }

  function protocolPayload(request = {}) {
    const operation = normalizeOperation(request.operation, request.mode);
    const grouped = referencesByType(request.references);
    const timeline = keyframeTimeline(request.references, request.duration);
    return {
      operation,
      capabilityOperation: capabilityForOperation(operation),
      speed: Number(request.speed || 1),
      loop: operation === 'loop' || request.loop === true || request.loop === 'true',
      extendDirection: operation === 'extend-backward' ? 'backward' : operation === 'extend-forward' ? 'forward' : '',
      images: grouped.image.map(item => item.url).filter(Boolean),
      videos: grouped.video.map(item => item.url).filter(Boolean),
      audios: grouped.audio.map(item => item.url).filter(Boolean),
      references: (Array.isArray(request.references) ? request.references : []).map((item, index) => ({
        index,
        role: item.role || 'reference',
        mediaType: mediaType(item),
        frameTime: normalizedFrameTime(item, Math.max(0.1, Number(request.duration) || 5)),
        weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 1,
        url: item.url || ''
      })),
      keyframes: timeline.map((item, index) => ({index, role: item.role, time: item.frameTime, url: item.url || ''}))
    };
  }

  function requestSummary({request = {}, profile = null, estimate = null} = {}) {
    const validation = validateRequest(request);
    const grouped = validation.grouped;
    const parts = [
      operationDefinition(validation.operation).label,
      String(request.size || '未选尺寸'),
      `${Number(request.duration || 0) || 0}秒`,
      `${grouped.image.length}图 / ${grouped.video.length}视频 / ${grouped.audio.length}音频`
    ];
    if (estimate) {
      const min = Number(estimate.minAmount ?? estimate.amount);
      const max = Number(estimate.maxAmount ?? estimate.amount);
      parts.push(Math.abs(max - min) > 0.0000005
        ? `预计 ${estimate.currency} ${min} - ${max}`
        : `预计 ${estimate.amount} ${estimate.currency}`);
    }
    else if (profile?.billing?.estimatedPrice == null) parts.push('费用待接口确认');
    const issues = validation.errors.concat(validation.warnings).map(item => item.message);
    return {text: parts.join(' · '), issues, valid: validation.valid};
  }

  window.FutureAIVideoDirector = {
    OPERATION_DEFS,
    SOURCE_VIDEO_OPERATIONS,
    normalizeOperation,
    capabilityForOperation,
    operationDefinition,
    availableOperations,
    mediaType,
    referencesByType,
    keyframeTimeline,
    ensureKeyframeTimes,
    validateRequest,
    operationInstructions,
    protocolPayload,
    requestSummary,
    unique
  };
})();
