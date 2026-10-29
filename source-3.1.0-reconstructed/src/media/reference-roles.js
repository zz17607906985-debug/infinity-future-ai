(() => {
  'use strict';

  const ROLE_LABELS = Object.freeze({
    character: '角色一致',
    costume: '服装',
    scene: '场景',
    object: '物体',
    pose: '姿势动作',
    style: '风格参考',
    composition: '构图布局',
    source: '编辑原图',
    'first-frame': '首帧',
    'last-frame': '尾帧',
    keyframe: '关键帧',
    motion: '动作参考',
    audio: '音频参考',
    reference: '普通参考'
  });

  const SINGLETON_ROLES = new Set(['source', 'first-frame', 'last-frame']);
  // Roles offered on image nodes; costume/scene/object stay valid for older projects and are listed only while selected.
  const IMAGE_ROLES = ['source', 'character', 'pose', 'composition', 'style', 'reference'];
  const LEGACY_IMAGE_ROLES = ['costume', 'scene', 'object'];
  const VIDEO_ROLES = ['source', 'first-frame', 'last-frame', 'keyframe', 'character', 'costume', 'scene', 'object', 'style', 'composition', 'motion', 'audio', 'reference'];
  // Image references are sent in this order so 图1..图N in the prompt matches the attached files.
  const IMAGE_ROLE_PRIORITY = ['source', 'character', 'costume', 'pose', 'composition', 'scene', 'object', 'style', 'reference'];

  const STRENGTHS = Object.freeze(['weak', 'medium', 'strong']);
  const STRENGTH_LABELS = Object.freeze({weak: '弱', medium: '中', strong: '强'});
  const STRENGTH_EN = Object.freeze({weak: 'weak', medium: 'medium', strong: 'strong'});
  const DEFAULT_STRENGTH = 'medium';

  // Per role: English name plus [中文, English] guidance for 弱 / 中 / 强.
  const IMAGE_ROLE_GUIDE = Object.freeze({
    source: {en: 'base image to edit', weak: ['以此图为起点，可按提示词较大幅度改动', 'Use it as a loose starting point; larger changes per the prompt are allowed'], medium: ['以此图为底图修改，保留主体与整体构图', 'Edit on top of it; keep the main subject and overall layout'], strong: ['以此图为底图修改，提示词未提到的部分严格保持不变', 'Edit on top of it; keep everything the prompt does not mention unchanged']},
    character: {en: 'character consistency', weak: ['大致参考角色的外貌特征', 'Loosely follow the character\'s general look'], medium: ['保持角色的脸型、发型与主要配色，服装细节可随提示词变化', 'Keep the character\'s face, hairstyle and main colors; outfit details may follow the prompt'], strong: ['严格保持同一角色：脸型、五官、发型、服装与配色一致，不要换人', 'Keep the exact same character: face, features, hairstyle, outfit and colors; do not change identity']},
    costume: {en: 'outfit', weak: ['可借鉴服装元素', 'Borrow outfit elements loosely'], medium: ['参考服装款式与配色', 'Follow the outfit design and colors'], strong: ['严格还原服装款式、材质与配色', 'Reproduce the outfit design, materials and colors exactly']},
    pose: {en: 'pose', weak: ['大致参考动作方向，不借用其外貌与画风', 'Loosely follow the overall action; do not copy appearance or style'], medium: ['参考人物姿势与动作，不借用其外貌与画风', 'Follow the pose and action; do not copy appearance or style'], strong: ['严格复刻姿势、动作与肢体角度，不借用其外貌与画风', 'Match the pose, gesture and limb angles closely; do not copy appearance or style']},
    composition: {en: 'composition', weak: ['大致参考画面布局，不复制具体内容', 'Loosely follow the layout; do not copy specific content'], medium: ['参考构图布局与镜头角度，不复制具体内容', 'Follow the layout and camera angle; do not copy specific content'], strong: ['严格沿用构图布局、镜头角度与主体位置，不复制具体内容', 'Keep the same layout, camera angle and subject placement; do not copy specific content']},
    scene: {en: 'scene', weak: ['可借鉴场景元素', 'Borrow scene elements loosely'], medium: ['参考场景环境与氛围', 'Follow the environment and mood'], strong: ['沿用场景环境、空间结构与光线', 'Keep the same environment, space and lighting']},
    object: {en: 'object', weak: ['可借鉴物体元素', 'Borrow the object loosely'], medium: ['参考物体外形与材质', 'Follow the object\'s shape and material'], strong: ['保持该物体的外形、材质与细节一致', 'Keep the object\'s shape, material and details identical']},
    style: {en: 'style', weak: ['轻微借鉴色调，不复制内容', 'Lightly borrow the color tone; do not copy content'], medium: ['仅借鉴色彩与笔触，不复制内容', 'Borrow palette and brushwork only; do not copy content'], strong: ['强烈沿用色彩、光影与笔触，仅借鉴风格，不复制内容', 'Strongly adopt its palette, lighting and brushwork; style only, do not copy content']},
    reference: {en: 'general reference', weak: ['仅作轻微参考', 'Use it as a light reference only'], medium: ['作为一般参考', 'Use it as a general reference'], strong: ['尽量贴近此图', 'Follow this image closely']}
  });

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

  function normalizeStrength(value) {
    return STRENGTHS.includes(value) ? value : DEFAULT_STRENGTH;
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
      strength: normalizeStrength(item.strength),
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

  function rolePriority(role) {
    const rank = IMAGE_ROLE_PRIORITY.indexOf(role);
    return rank < 0 ? IMAGE_ROLE_PRIORITY.length : rank;
  }

  // Stable sort by role priority: the user's thumbnail order is kept inside each role.
  function sortImageReferences(references) {
    return (Array.isArray(references) ? references : [])
      .map((item, index) => ({item, index}))
      .sort((a, b) => rolePriority(a.item.role) - rolePriority(b.item.role) || a.index - b.index)
      .map(({item}, order) => Object.assign({}, item, {order}));
  }

  function mergeResolvedReferences({nodeType = 'image', references = [], resolvedItems = []} = {}) {
    const saved = Array.isArray(references) ? references : [];
    const usedSingletons = new Set();
    const merged = (Array.isArray(resolvedItems) ? resolvedItems : []).map((resolved, index) => {
      const existing = saved.find(item => sameReference(item, resolved, index));
      const reference = normalizeReference(Object.assign({}, resolved, existing || {}), resolved, index, nodeType);
      if (SINGLETON_ROLES.has(reference.role)) {
        if (usedSingletons.has(reference.role)) reference.role = 'reference';
        else usedSingletons.add(reference.role);
      }
      return reference;
    });
    return nodeType === 'image' ? sortImageReferences(merged) : merged;
  }

  function updateReference(references, key, patch, missingMessage) {
    const list = (Array.isArray(references) ? references : []).map(item => Object.assign({}, item));
    const index = list.findIndex(item => stableKey(item) === String(key));
    if (index < 0) return {references: list, index, error: missingMessage};
    return {references: list, index, error: '', apply: () => Object.assign(list[index], patch)};
  }

  function setReferenceRole(references, key, role) {
    if (!ROLE_LABELS[role]) return {references: (Array.isArray(references) ? references : []).map(item => Object.assign({}, item)), error: '未知的参考用途'};
    const result = updateReference(references, key, {role}, '没有找到这份参考素材');
    if (result.error) return {references: result.references, error: result.error};
    if (SINGLETON_ROLES.has(role) && result.references.some((item, itemIndex) => itemIndex !== result.index && item.role === role)) {
      return {references: result.references, error: `${roleLabel(role)}只能设置一份`};
    }
    result.apply();
    return {references: result.references, error: ''};
  }

  function setReferenceStrength(references, key, strength) {
    if (!STRENGTHS.includes(strength)) return {references: (Array.isArray(references) ? references : []).map(item => Object.assign({}, item)), error: '未知的参考强度'};
    const result = updateReference(references, key, {strength}, '没有找到这份参考素材');
    if (!result.error) result.apply();
    return {references: result.references, error: result.error};
  }

  // 设为角色设定图: one click turns a reference into a strong character-consistency reference.
  function markCharacterSheet(references, key) {
    const result = updateReference(references, key, {role: 'character', strength: 'strong'}, '没有找到这份参考素材');
    if (!result.error) result.apply();
    return {references: result.references, error: result.error};
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

  function strengthLabel(strength) {
    return STRENGTH_LABELS[normalizeStrength(strength)];
  }

  function rolesForNode(nodeType = 'image', currentRole = '') {
    if (nodeType === 'video') return VIDEO_ROLES.slice();
    return LEGACY_IMAGE_ROLES.includes(currentRole) ? IMAGE_ROLES.concat(currentRole) : IMAGE_ROLES.slice();
  }

  function usableReferences(references) {
    return (Array.isArray(references) ? references : []).filter(item => item?.url || item?.sourceNodeId || item?.assetId);
  }

  // Video requests keep the compact usage list (frame times matter there, strength does not).
  function referenceRoleInstructions(references) {
    const list = usableReferences(references);
    if (!list.length) return '';
    const details = list.map((item, index) => {
      const time = Number.isFinite(Number(item.frameTime)) && ['first-frame', 'last-frame', 'keyframe'].includes(item.role) ? `（${Number(item.frameTime)}秒）` : '';
      return `参考素材 ${index + 1}：${roleLabel(item.role)}${time}`;
    }).join('；');
    return `\n\n参考素材用途（请严格遵守）：${details}。不要交换首帧、尾帧、编辑原图或其他参考素材的用途。`;
  }

  function imageReferenceLine(item, index) {
    const role = IMAGE_ROLE_GUIDE[item.role] ? item.role : 'reference';
    const strength = normalizeStrength(item.strength);
    const [zh, en] = IMAGE_ROLE_GUIDE[role][strength];
    const number = index + 1;
    return `图${number}为${roleLabel(role)}（${STRENGTH_LABELS[strength]}）：${zh}。Image ${number} = ${IMAGE_ROLE_GUIDE[role].en} (${STRENGTH_EN[strength]}): ${en}.`;
  }

  // The block appended to an image prompt; 图N follows the order the images are attached in.
  function imageReferenceInstructions(references) {
    const list = usableReferences(references);
    if (!list.length) return '';
    return [
      '',
      '',
      '参考图说明（按随附图片顺序）/ Reference images, in attached order:',
      ...list.map(imageReferenceLine),
      '请按以上用途使用各图，不要混淆。Use each image only for its stated purpose.'
    ].join('\n');
  }

  window.FutureAIReferenceRoles = {
    ROLE_LABELS,
    SINGLETON_ROLES,
    STRENGTHS,
    STRENGTH_LABELS,
    mergeResolvedReferences,
    sortImageReferences,
    setReferenceRole,
    setReferenceStrength,
    markCharacterSheet,
    setReferenceFrameTime,
    roleLabel,
    strengthLabel,
    rolesForNode,
    mediaType,
    referenceRoleInstructions,
    imageReferenceInstructions
  };
})();
