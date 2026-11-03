(() => {
  'use strict';

  const ROLE_LABELS = Object.freeze({
    character: '角色',
    costume: '服装',
    scene: '场景',
    object: '物体',
    style: '风格参考',
    composition: '构图参考',
    source: '编辑原图',
    'first-frame': '首帧',
    'last-frame': '尾帧',
    keyframe: '关键帧',
    motion: '动作参考',
    audio: '音频参考',
    reference: '普通参考'
  });

  const SINGLETON_ROLES = new Set(['source', 'first-frame', 'last-frame']);
  const IMAGE_ROLES = ['source', 'character', 'costume', 'scene', 'object', 'style', 'composition', 'reference'];
  const VIDEO_ROLES = ['source', 'first-frame', 'last-frame', 'keyframe', 'character', 'costume', 'scene', 'object', 'style', 'composition', 'motion', 'audio', 'reference'];

  function mediaType(item = {}) {
    const explicit = String(item.mediaType || item.kind || '').toLowerCase();
    if (['image', 'video', 'audio'].includes(explicit)) return explicit;
    const mime = String(item.mime || '').toLowerCase();
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('image/')) return 'image';
    const url = String(item.url || '');
    if (/^(?:data:)?video\//i.test(url) || /\.(?:mp4|webm|mov|m4v|avi)(?:[?#]|$)/i.test(url)) return 'video';
    if (/^(?:data:)?audio\//i.test(url) || /\.(?:mp3|wav|m4a|aac|ogg|flac)(?:[?#]|$)/i.test(url)) return 'audio';
    return 'image';
  }

  function stableKey(item = {}, index = 0) {
    return String(item.key || item.sourceNodeId || item.assetId || item.url || `reference-${index}`);
  }

  function sameReference(saved = {}, resolved = {}, index = 0) {
    const key = stableKey(resolved, index);
    return stableKey(saved) === key
      || (saved.sourceNodeId && resolved.sourceNodeId && saved.sourceNodeId === resolved.sourceNodeId)
      || (saved.assetId && resolved.assetId && saved.assetId === resolved.assetId)
      || (saved.url && resolved.url && saved.url === resolved.url);
  }

  function defaultRole(nodeType, index, item = {}) {
    const type = mediaType(item);
    if (nodeType === 'video' && type === 'video') return 'source';
    if (nodeType === 'video' && type === 'audio') return 'audio';
    if (index > 0) return 'reference';
    return nodeType === 'video' ? 'first-frame' : 'source';
  }

  function normalizeReference(item = {}, fallback = {}, index = 0, nodeType = 'image') {
    const key = stableKey(item, index);
    const weight = Number(item.weight);
    const frameTime = item.frameTime == null || item.frameTime === '' ? null : Number(item.frameTime);
    return {
      key,
      assetId: String(item.assetId || fallback.assetId || ''),
      sourceNodeId: String(item.sourceNodeId || fallback.sourceNodeId || (key === '__manual_ref__' ? '' : key)),
      url: String(item.url || fallback.url || ''),
      role: ROLE_LABELS[item.role] ? item.role : defaultRole(nodeType, index, Object.assign({}, fallback, item)),
      order: index,
      weight: Number.isFinite(weight) && weight >= 0 ? weight : 1,
      frameTime: Number.isFinite(frameTime) && frameTime >= 0 ? frameTime : null,
      notes: String(item.notes || ''),
      locked: item.locked !== false,
      mediaType: mediaType(Object.assign({}, fallback, item)),
      mime: String(item.mime || fallback.mime || ''),
      sizeBytes: Math.max(0, Number(item.sizeBytes ?? fallback.sizeBytes ?? 0) || 0),
      fileName: String(item.fileName || fallback.fileName || '')
    };
  }

  function mergeResolvedReferences({nodeType = 'image', references = [], resolvedItems = []} = {}) {
    const saved = Array.isArray(references) ? references : [];
    const usedSingletons = new Set();
    return (Array.isArray(resolvedItems) ? resolvedItems : []).map((resolved, index) => {
      const existing = saved.find(item => sameReference(item, resolved, index));
      const merged = normalizeReference(Object.assign({}, resolved, existing || {}), resolved, index, nodeType);
      if (SINGLETON_ROLES.has(merged.role)) {
        if (usedSingletons.has(merged.role)) merged.role = 'reference';
        else usedSingletons.add(merged.role);
      }
      return merged;
    });
  }

  function setReferenceRole(references, key, role) {
    const list = (Array.isArray(references) ? references : []).map(item => Object.assign({}, item));
    if (!ROLE_LABELS[role]) return {references: list, error: '未知的参考用途'};
    const index = list.findIndex(item => stableKey(item) === String(key));
    if (index < 0) return {references: list, error: '没有找到这份参考素材'};
    if (SINGLETON_ROLES.has(role) && list.some((item, itemIndex) => itemIndex !== index && item.role === role)) {
      return {references: list, error: `${roleLabel(role)}只能设置一份`};
    }
    list[index].role = role;
    return {references: list, error: ''};
  }

  function setReferenceFrameTime(references, key, frameTime, duration = 5) {
    const list = (Array.isArray(references) ? references : []).map(item => Object.assign({}, item));
    const index = list.findIndex(item => stableKey(item) === String(key));
    if (index < 0) return {references: list, error: '没有找到这份关键帧'};
    if (!['first-frame', 'last-frame', 'keyframe'].includes(list[index].role)) return {references: list, error: '只有首帧、尾帧和关键帧可以设置时间'};
    const max = Math.max(0.1, Number(duration) || 5);
    const value = list[index].role === 'first-frame' ? 0 : list[index].role === 'last-frame' ? max : Number(frameTime);
    if (!Number.isFinite(value) || value < 0 || value > max) return {references: list, error: `关键帧时间需要在 0 到 ${max} 秒之间`};
    list[index].frameTime = Number(value.toFixed(2));
    return {references: list, error: ''};
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || ROLE_LABELS.reference;
  }

  function rolesForNode(nodeType = 'image') {
    return (nodeType === 'video' ? VIDEO_ROLES : IMAGE_ROLES).slice();
  }

  function referenceRoleInstructions(references) {
    const list = (Array.isArray(references) ? references : []).filter(item => item?.url || item?.sourceNodeId || item?.assetId);
    if (!list.length) return '';
    const details = list.map((item, index) => {
      const time = Number.isFinite(Number(item.frameTime)) && ['first-frame', 'last-frame', 'keyframe'].includes(item.role) ? `（${Number(item.frameTime)}秒）` : '';
      return `参考素材 ${index + 1}：${roleLabel(item.role)}${time}`;
    }).join('；');
    return `\n\n参考素材用途（请严格遵守）：${details}。不要交换首帧、尾帧、编辑原图或其他参考素材的用途。`;
  }

  window.FutureAIReferenceRoles = {
    ROLE_LABELS,
    SINGLETON_ROLES,
    mergeResolvedReferences,
    setReferenceRole,
    setReferenceFrameTime,
    roleLabel,
    rolesForNode,
    mediaType,
    referenceRoleInstructions
  };
})();
